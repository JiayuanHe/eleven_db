//! Data stores for Eleven DB
//! 
//! V0.1: JSON file storage
//! Future: SQLite or cloud-based storage

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use crate::error::{ElevenError, Result};
use crate::types::*;

/// Connection store for managing database connections
pub struct ConnectionStore {
    file_path: PathBuf,
    data: Mutex<StoreData>,
}

#[derive(Debug, Clone, Default)]
struct StoreData {
    connections: Vec<ConnectionRecord>,
    history: Vec<QueryHistoryItem>,
    recent: Vec<RecentConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionRecord {
    #[serde(flatten)]
    config: ConnectionConfig,
    #[serde(rename = "_passwordCipher")]
    password_cipher: Option<String>,
    #[serde(rename = "_redisPasswordCipher")]
    redis_password_cipher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentConnection {
    connection_id: String,
    last_used_at: i64,
}

impl ConnectionStore {
    /// Create a new connection store
    pub fn new() -> Result<Self> {
        let data_dir = Self::get_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        
        let file_path = data_dir.join("eleven.json");
        let data = if file_path.exists() {
            let content = fs::read_to_string(&file_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            StoreData::default()
        };

        Ok(Self {
            file_path,
            data: Mutex::new(data),
        })
    }

    fn get_data_dir() -> Result<PathBuf> {
        let data_dir = if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            PathBuf::from(data_home).join("eleven-db")
        } else if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            PathBuf::from(local_app_data).join("Eleven DB")
        } else if let Some(home) = dirs::home_dir() {
            home.join(".local/share/eleven-db")
        } else {
            return Err(ElevenError::Store("Cannot determine data directory".to_string()));
        };
        Ok(data_dir)
    }

    fn persist(&self) -> Result<()> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let content = serde_json::to_string_pretty(&*data)?;
        
        // Atomic write: write to temp file first, then rename
        let tmp_path = self.file_path.with_extension("json.tmp");
        fs::write(&tmp_path, content)?;
        fs::rename(&tmp_path, &self.file_path)?;
        
        Ok(())
    }

    /// List all connections
    pub fn list(&self) -> Result<Vec<ConnectionConfig>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let mut configs: Vec<_> = data.connections.iter()
            .map(|r| {
                let mut cfg = r.config.clone();
                cfg.password_cipher = None;
                cfg
            })
            .collect();
        configs.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(configs)
    }

    /// Get a connection by ID
    pub fn get(&self, id: &str) -> Result<Option<ConnectionConfig>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let record = data.connections.iter().find(|r| r.config.id == id);
        Ok(record.map(|r| {
            let mut cfg = r.config.clone();
            cfg.password_cipher = None;
            cfg
        }))
    }

    /// Get a connection with password cipher (internal use)
    pub fn get_raw(&self, id: &str) -> Result<Option<ConnectionRecord>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        Ok(data.connections.iter().find(|r| r.config.id == id).cloned())
    }

    /// Create a new connection
    pub fn create(&self, config: ConnectionConfig, password_cipher: Option<String>, redis_password_cipher: Option<String>) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        data.connections.push(ConnectionRecord {
            config,
            password_cipher,
            redis_password_cipher,
        });
        drop(data);
        self.persist()
    }

    /// Update an existing connection
    pub fn update(&self, config: ConnectionConfig, password_cipher: Option<String>, redis_password_cipher: Option<String>) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let idx = data.connections.iter().position(|r| r.config.id == config.id)
            .ok_or_else(|| ElevenError::ConnectionNotFound(config.id.clone()))?;
        
        let prev = &data.connections[idx];
        data.connections[idx] = ConnectionRecord {
            config: config.clone(),
            password_cipher: password_cipher.or_else(|| prev.password_cipher.clone()),
            redis_password_cipher: redis_password_cipher.or_else(|| prev.redis_password_cipher.clone()),
        };
        drop(data);
        self.persist()
    }

    /// Remove a connection
    pub fn remove(&self, id: &str) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        data.connections.retain(|r| r.config.id != id);
        data.recent.retain(|r| r.connection_id != id);
        drop(data);
        self.persist()
    }

    /// Get password cipher for a connection
    pub fn get_password_cipher(&self, id: &str) -> Result<Option<String>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        Ok(data.connections.iter().find(|r| r.config.id == id).and_then(|r| r.password_cipher.clone()))
    }

    /// Get Redis password cipher for a connection
    pub fn get_redis_password_cipher(&self, id: &str) -> Result<Option<String>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        Ok(data.connections.iter().find(|r| r.config.id == id).and_then(|r| r.redis_password_cipher.clone()))
    }

    /// Update last used timestamp
    pub fn touch(&self, id: &str) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let now = chrono::Utc::now().timestamp_millis();
        let recent = RecentConnection {
            connection_id: id.to_string(),
            last_used_at: now,
        };
        data.recent.retain(|r| r.connection_id != id);
        data.recent.insert(0, recent);
        data.recent.truncate(50);
        drop(data);
        self.persist()
    }

    /// Get recent connections
    pub fn recent(&self, limit: usize) -> Result<Vec<ConnectionConfig>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        let result: Vec<_> = data.recent.iter()
            .take(limit)
            .filter_map(|r| {
                data.connections.iter().find(|c| c.config.id == r.connection_id)
            })
            .map(|r| {
                let mut cfg = r.config.clone();
                cfg.password_cipher = None;
                cfg
            })
            .collect();
        Ok(result)
    }

    /// Add query history entry
    pub fn add_history(&self, item: QueryHistoryItem) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        data.history.insert(0, item);
        if data.history.len() > 200 {
            data.history.truncate(200);
        }
        drop(data);
        self.persist()
    }

    /// List query history
    pub fn list_history(&self, limit: usize) -> Result<Vec<QueryHistoryItem>> {
        let data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        Ok(data.history.iter().take(limit).cloned().collect())
    }

    /// Clear query history
    pub fn clear_history(&self) -> Result<()> {
        let mut data = self.data.lock().map_err(|e| ElevenError::Store(e.to_string()))?;
        data.history.clear();
        drop(data);
        self.persist()
    }
}

impl Default for ConnectionStore {
    fn default() -> Self {
        Self::new().expect("Failed to create connection store")
    }
}
