//! Connection manager for Eleven DB

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::{ElevenError, Result};
use crate::types::*;
use crate::drivers::{MysqlDriver, RedisDriver};
use crate::stores::ConnectionStore;
use crate::crypto::Crypto;

pub struct ConnectionManager {
    sql_drivers: Arc<Mutex<HashMap<String, MysqlDriver>>>,
    redis_drivers: Arc<Mutex<HashMap<String, RedisDriver>>>,
    store: Arc<ConnectionStore>,
}

impl ConnectionManager {
    pub fn new(store: ConnectionStore) -> Self {
        Self {
            sql_drivers: Arc::new(Mutex::new(HashMap::new())),
            redis_drivers: Arc::new(Mutex::new(HashMap::new())),
            store: Arc::new(store),
        }
    }

    /// Open a SQL connection (MySQL/Oracle)
    pub async fn open(&self, id: &str, password: Option<String>) -> Result<MysqlDriver> {
        let mut drivers = self.sql_drivers.lock().await;
        
        // Check existing connection
        if let Some(driver) = drivers.get_mut(id) {
            if driver.is_alive() {
                return Ok(driver.clone());
            }
        }

        // Get connection config
        let record = self.store.get_raw(id)?
            .ok_or_else(|| ElevenError::ConnectionNotFound(id.to_string()))?;

        if record.config.kind == DbKind::Redis {
            return Err(ElevenError::InvalidConfig("Use open_redis for Redis connections".to_string()));
        }

        // Resolve password
        let pwd = resolve_password(&record, password)?;
        
        // Create and connect
        let mut driver = MysqlDriver::new(record.config.clone(), pwd);
        driver.connect().await?;
        
        drivers.insert(id.to_string(), driver.clone());
        self.store.touch(id)?;
        
        Ok(driver)
    }

    /// Open a Redis connection
    pub async fn open_redis(&self, id: &str, password: Option<String>) -> Result<RedisDriver> {
        let mut drivers = self.redis_drivers.lock().await;
        
        // Check existing connection
        if let Some(driver) = drivers.get_mut(id) {
            if driver.is_alive() {
                return Ok(driver.clone());
            }
        }

        // Get connection config
        let record = self.store.get_raw(id)?
            .ok_or_else(|| ElevenError::ConnectionNotFound(id.to_string()))?;

        if record.config.kind != DbKind::Redis {
            return Err(ElevenError::InvalidConfig("Use open for SQL connections".to_string()));
        }

        // Resolve Redis password
        let redis_pwd = if let Some(ref cipher) = record.redis_password_cipher {
            Some(Crypto::decrypt(cipher)?)
        } else {
            password
        };

        // Create and connect
        let mut driver = RedisDriver::new(record.config.clone(), redis_pwd);
        driver.connect().await?;
        
        drivers.insert(id.to_string(), driver.clone());
        self.store.touch(id)?;
        
        Ok(driver)
    }

    /// Close a connection
    pub async fn close(&self, id: &str) -> Result<()> {
        // Close SQL driver
        {
            let mut drivers = self.sql_drivers.lock().await;
            if let Some(mut driver) = drivers.remove(id) {
                let _ = driver.close().await;
            }
        }

        // Close Redis driver
        {
            let mut drivers = self.redis_drivers.lock().await;
            if let Some(mut driver) = drivers.remove(id) {
                let _ = driver.close().await;
            }
        }

        Ok(())
    }

    /// Close all connections
    pub async fn close_all(&self) -> Result<()> {
        // Close SQL drivers
        {
            let mut drivers = self.sql_drivers.lock().await;
            for (_, mut driver) in drivers.drain() {
                let _ = driver.close().await;
            }
        }

        // Close Redis drivers
        {
            let mut drivers = self.redis_drivers.lock().await;
            for (_, mut driver) in drivers.drain() {
                let _ = driver.close().await;
            }
        }

        Ok(())
    }

    /// Check if a connection is open
    pub async fn has(&self, id: &str) -> bool {
        let sql = self.sql_drivers.lock().await;
        if let Some(d) = sql.get(id) {
            return d.is_alive();
        }
        let redis = self.redis_drivers.lock().await;
        if let Some(d) = redis.get(id) {
            return d.is_alive();
        }
        false
    }

    /// Build a connection config
    pub fn build_config(&self, input: BuildConfigInput) -> ConnectionConfig {
        let now = chrono::Utc::now().timestamp_millis();
        ConnectionConfig {
            id: input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            name: input.name.trim().to_string(),
            kind: input.kind,
            host: input.host.trim().to_string(),
            port: input.port,
            username: input.username.trim().to_string(),
            password_cipher: None,
            database: input.database.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
            service_name: input.service_name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            sid: input.sid.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            tns: input.tns.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
            charset: input.charset.or_else(|| Some("utf8mb4".to_string())),
            timeout_ms: input.timeout_ms.or(Some(8000)),
            redis: input.redis,
            ssh: None,
            group: input.group,
            color: input.color,
            created_at: now,
            updated_at: now,
        }
    }

    /// Get store reference
    pub fn store(&self) -> &ConnectionStore {
        &self.store
    }
}

impl Clone for MysqlDriver {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            password: self.password.clone(),
            pool: None, // Connection pool cannot be cloned
        }
    }
}

impl Clone for RedisDriver {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            password: self.password.clone(),
            connection: None, // Connection cannot be cloned
            current_db: self.current_db,
        }
    }
}

fn resolve_password(record: &crate::stores::ConnectionRecord, override_pwd: Option<String>) -> Result<String> {
    if let Some(pwd) = override_pwd {
        return Ok(pwd);
    }
    
    if let Some(ref cipher) = record.password_cipher {
        return Crypto::decrypt(cipher);
    }
    
    Ok(String::new())
}
