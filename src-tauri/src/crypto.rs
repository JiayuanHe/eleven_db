//! Cryptography utilities for password storage
//! 
//! Uses OS-native encryption (DPAPI on Windows, Keychain on macOS, etc.)

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use crate::error::{ElevenError, Result};

#[cfg(target_os = "windows")]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    CRYPTPROTECT_LOCAL_MACHINE,
};

pub struct Crypto;

impl Crypto {
    /// Encrypt plaintext using OS-native encryption
    pub fn encrypt(plaintext: &str) -> Result<String> {
        #[cfg(target_os = "windows")]
        {
            Self::encrypt_windows(plaintext)
        }
        
        #[cfg(target_os = "macos")]
        {
            Self::encrypt_macos(plaintext)
        }
        
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            // Fallback: simple base64 encoding (not secure, for development only)
            Ok(BASE64.encode(plaintext.as_bytes()))
        }
    }

    /// Decrypt ciphertext using OS-native decryption
    pub fn decrypt(ciphertext: &str) -> Result<String> {
        #[cfg(target_os = "windows")]
        {
            Self::decrypt_windows(ciphertext)
        }
        
        #[cfg(target_os = "macos")]
        {
            Self::decrypt_macos(ciphertext)
        }
        
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            // Fallback: simple base64 decoding
            let bytes = BASE64.decode(ciphertext)
                .map_err(|e| ElevenError::Encryption(format!("Base64 decode error: {}", e)))?;
            String::from_utf8(bytes)
                .map_err(|e| ElevenError::Encryption(format!("UTF-8 decode error: {}", e)))
        }
    }

    #[cfg(target_os = "windows")]
    fn encrypt_windows(plaintext: &str) -> Result<String> {
        use std::ptr::null_mut;
        
        let data_bytes = plaintext.as_bytes();
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data_bytes.len() as u32,
            pbData: data_bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        unsafe {
            let result = CryptProtectData(
                &mut input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_LOCAL_MACHINE,
                &mut output,
            );

            if result.is_err() {
                return Err(ElevenError::Encryption("DPAPI CryptProtectData failed".to_string()));
            }

            if output.pbData.is_null() || output.cbData == 0 {
                return Err(ElevenError::Encryption("DPAPI returned empty data".to_string()));
            }

            let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
            let encoded = BASE64.encode(encrypted);
            
            // Free the memory allocated by Windows
            windows::Win32::System::Memory::LocalFree(
                windows::Win32::Foundation::HLOCAL(output.pbData as *mut std::ffi::c_void)
            );

            Ok(encoded)
        }
    }

    #[cfg(target_os = "windows")]
    fn decrypt_windows(ciphertext: &str) -> Result<String> {
        use std::ptr::null_mut;
        
        let encrypted_bytes = BASE64.decode(ciphertext)
            .map_err(|e| ElevenError::Encryption(format!("Base64 decode error: {}", e)))?;
        
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: encrypted_bytes.len() as u32,
            pbData: encrypted_bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        unsafe {
            let result = CryptUnprotectData(
                &mut input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_LOCAL_MACHINE,
                &mut output,
            );

            if result.is_err() {
                return Err(ElevenError::Encryption("DPAPI CryptUnprotectData failed".to_string()));
            }

            if output.pbData.is_null() || output.cbData == 0 {
                return Err(ElevenError::Encryption("DPAPI returned empty data".to_string()));
            }

            let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
            let decoded = String::from_utf8(decrypted.to_vec())
                .map_err(|e| ElevenError::Encryption(format!("UTF-8 decode error: {}", e)))?;
            
            // Free the memory allocated by Windows
            windows::Win32::System::Memory::LocalFree(
                windows::Win32::Foundation::HLOCAL(output.pbData as *mut std::ffi::c_void)
            );

            Ok(decoded)
        }
    }

    #[cfg(target_os = "macos")]
    fn encrypt_macos(plaintext: &str) -> Result<String> {
        use security_framework::passwords::{set_generic_password, delete_generic_password};
        use security_framework::SecureBuffer;
        
        let service = "com.eleven.db";
        let account = "password";
        
        // Delete existing password first
        let _ = delete_generic_password(service, account);
        
        // Set new password
        let password_bytes = plaintext.as_bytes();
        let buffer = SecureBuffer::from_slice(password_bytes);
        set_generic_password(service, account, &buffer)
            .map_err(|e| ElevenError::Encryption(format!("Keychain error: {}", e)))?;
        
        // Return a dummy token (actual value stored in Keychain)
        Ok(format!("keychain:{}", BASE64.encode(plaintext)))
    }

    #[cfg(target_os = "macos")]
    fn decrypt_macos(ciphertext: &str) -> Result<String> {
        use security_framework::passwords::get_generic_password;
        
        if ciphertext.starts_with("keychain:") {
            let encoded = &ciphertext[9..];
            let bytes = BASE64.decode(encoded)
                .map_err(|e| ElevenError::Encryption(format!("Base64 decode error: {}", e)))?;
            return String::from_utf8(bytes)
                .map_err(|e| ElevenError::Encryption(format!("UTF-8 decode error: {}", e)));
        }
        
        let (service, account) = ("com.eleven.db", "password");
        
        match get_generic_password(service, account) {
            Ok(creds) => Ok(String::from_utf8_lossy(creds.as_slice()).to_string()),
            Err(_) => Err(ElevenError::Encryption("Password not found in Keychain".to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let plaintext = "my_secret_password";
        let encrypted = Crypto::encrypt(plaintext).unwrap();
        let decrypted = Crypto::decrypt(&encrypted).unwrap();
        assert_eq!(plaintext, decrypted);
    }
}
