//! Error types for Eleven DB

use thiserror::Error;

#[derive(Error, Debug)]
pub enum ElevenError {
    #[error("Database connection error: {0}")]
    Connection(String),
    
    #[error("Query error: {0}")]
    Query(String),
    
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Encryption error: {0}")]
    Encryption(String),
    
    #[error("Store error: {0}")]
    Store(String),
    
    #[error("Redis error: {0}")]
    Redis(String),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("Database pool error: {0}")]
    Pool(String),
}

impl serde::Serialize for ElevenError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, ElevenError>;
