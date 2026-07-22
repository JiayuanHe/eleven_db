/**
 * 密码存储抽象。V0.1：Electron safeStorage（Windows = DPAPI，macOS = Keychain，Linux = kwallet/gnome-libsecret）。
 *
 * V0.5+ 可换 1Password CLI / HashiCorp Vault / 自研加密。
 */

import { safeStorage } from 'electron';
import { CipherUnavailableError } from '../errors';

/**
 * 抽象。V0.1 的实现：明文密码 → safeStorage 加密 → Base64 落库。
 * 反向：Base64 → safeStorage 解密 → 明文。
 *
 * 注意：safeStorage 在某些环境（如未登录的 Linux）下不可用，需显式错误。
 */
export interface SecretStore {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  isAvailable(): boolean;
}

export class ElectronSafeStorageStore implements SecretStore {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(plain: string): string {
    if (!this.isAvailable()) {
      throw new CipherUnavailableError(
        '当前系统环境下 safeStorage 不可用。请勿勾选"保存密码"，改为每次手动输入。',
      );
    }
    const buf = safeStorage.encryptString(plain);
    return buf.toString('base64');
  }

  decrypt(cipher: string): string {
    if (!this.isAvailable()) {
      throw new CipherUnavailableError('safeStorage 不可用，无法解密已保存密码。');
    }
    const buf = Buffer.from(cipher, 'base64');
    return safeStorage.decryptString(buf);
  }
}

export const secretStore: SecretStore = new ElectronSafeStorageStore();