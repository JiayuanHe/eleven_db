//! Redis driver implementation

use redis::{AsyncCommands, Client, RedisError, ToRedisArgs};
use redis::aio::ConnectionManager;
use redis::aio::ConnectionLike;
use redis::types::{RedisKeyType, RedisKeyInfo as RedisKeyInfoType, RedisKeyValue as RedisKeyValueType};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::{ElevenError, Result};
use crate::types::*;

/// Redis driver for Redis connections
pub struct RedisDriver {
    config: ConnectionConfig,
    password: Option<String>,
    connection: Option<ConnectionManager>,
    current_db: u8,
}

impl RedisDriver {
    /// Create a new Redis driver
    pub fn new(config: ConnectionConfig, password: Option<String>) -> Self {
        Self {
            config,
            password,
            connection: None,
            current_db: 0,
        }
    }

    /// Connect to Redis
    pub async fn connect(&mut self) -> Result<()> {
        if self.connection.is_some() {
            return Ok(());
        }

        let redis_config = self.config.redis.as_ref()
            .ok_or_else(|| ElevenError::InvalidConfig("Redis config missing".to_string()))?;

        let url = match redis_config.mode {
            RedisMode::Single => {
                format!(
                    "redis://{}:{}@{}:{}/{}",
                    redis_config.username.as_deref().unwrap_or(""),
                    self.password.as_deref().unwrap_or(""),
                    self.config.host,
                    self.config.port,
                    redis_config.db
                )
            }
            RedisMode::Sentinel => {
                // For sentinel, we need to use a different connection method
                // This is simplified - full implementation would use RedisSink
                let sentinels = redis_config.sentinel_nodes.as_ref()
                    .ok_or_else(|| ElevenError::InvalidConfig("Sentinel nodes required".to_string()))?;
                let sentinel_url = sentinels.first()
                    .ok_or_else(|| ElevenError::InvalidConfig("At least one sentinel required".to_string()))?;
                format!(
                    "redis://{}:{}@{}/{}",
                    redis_config.username.as_deref().unwrap_or(""),
                    self.password.as_deref().unwrap_or(""),
                    sentinel_url,
                    redis_config.db
                )
            }
            RedisMode::Cluster => {
                // For cluster, we need multiple nodes
                let nodes = redis_config.cluster_nodes.as_ref()
                    .ok_or_else(|| ElevenError::InvalidConfig("Cluster nodes required".to_string()))?;
                let first_node = nodes.first()
                    .ok_or_else(|| ElevenError::InvalidConfig("At least one cluster node required".to_string()))?;
                format!(
                    "redis://{}:{}@{}",
                    redis_config.username.as_deref().unwrap_or(""),
                    self.password.as_deref().unwrap_or(""),
                    first_node
                )
            }
        };

        let client = Client::open(url)
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        let conn = ConnectionManager::new(client).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        // Test connection with PING
        let mut test_conn = conn.clone();
        let _: String = test_conn.ping().await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        self.connection = Some(conn);
        self.current_db = redis_config.db;

        Ok(())
    }

    /// Check if connected
    pub fn is_alive(&self) -> bool {
        self.connection.is_some()
    }

    /// Close connection
    pub async fn close(&mut self) -> Result<()> {
        if let Some(conn) = self.connection.take() {
            let _ = conn;
            // ConnectionManager doesn't have a close method
            // The connection will be dropped when the struct is dropped
        }
        Ok(())
    }

    /// List databases (0-15 typically)
    pub async fn list_databases(&self) -> Result<Vec<u8>> {
        if matches!(self.config.redis.as_ref().map(|r| &r.mode), Some(RedisMode::Cluster)) {
            // Cluster mode: only db 0
            return Ok(vec![0]);
        }
        Ok((0..16u8).collect())
    }

    /// Select database
    pub async fn select_database(&mut self, db: u8) -> Result<()> {
        if matches!(self.config.redis.as_ref().map(|r| &r.mode), Some(RedisMode::Cluster)) {
            self.current_db = 0;
            return Ok(());
        }

        if let Some(ref mut conn) = self.connection {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
            self.current_db = db;
        }
        Ok(())
    }

    /// Get current database
    pub fn current_database(&self) -> u8 {
        self.current_db
    }

    /// List keys with SCAN
    pub async fn list_keys(&self, options: ListKeysOptions) -> Result<ListKeysResult> {
        let conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;

        let db = options.database.unwrap_or(self.current_db);
        let pattern = options.pattern.as_deref().unwrap_or("*");
        let count = options.count.unwrap_or(200) as isize;
        let cursor = options.cursor.unwrap_or(0);

        // Select database
        let mut conn = conn.clone();
        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count)
            .query_async(&mut conn)
            .await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(ListKeysResult {
            keys,
            next_cursor,
        })
    }

    /// Describe a key (type, TTL, size)
    pub async fn describe_key(&self, db: u8, key: &str) -> Result<RedisKeyInfo> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let key_type: String = conn.key_type(key).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;
        let ttl: i64 = conn.ttl(key).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;
        
        let normalized_type = match key_type.to_lowercase().as_str() {
            "string" => RedisKeyType::String,
            "hash" => RedisKeyType::Hash,
            "list" => RedisKeyType::List,
            "set" => RedisKeyType::Set,
            "zset" => RedisKeyType::Zset,
            "stream" => RedisKeyType::Stream,
            _ => RedisKeyType::Unknown,
        };

        let size = match normalized_type {
            RedisKeyType::String => Some(1),
            RedisKeyType::Hash => {
                conn.hlen(key).await.ok().map(|h| h as u64)
            }
            RedisKeyType::List => {
                conn.llen(key).await.ok().map(|l| l as u64)
            }
            RedisKeyType::Set => {
                conn.scard(key).await.ok().map(|s| s as u64)
            }
            RedisKeyType::Zset => {
                conn.zcard(key).await.ok().map(|z| z as u64)
            }
            RedisKeyType::Stream => {
                conn.xlen(key).await.ok().map(|x| x as u64)
            }
            RedisKeyType::Unknown => None,
        };

        Ok(RedisKeyInfo {
            name: key.to_string(),
            key_type: normalized_type,
            ttl,
            size,
        })
    }

    /// Get value of a key
    pub async fn get_value(&self, db: u8, key: &str, key_type: RedisKeyType) -> Result<RedisKeyValue> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let mut result = RedisKeyValue {
            key: key.to_string(),
            key_type: key_type.clone(),
            string_value: None,
            hash_value: None,
            list_value: None,
            set_value: None,
            zset_value: None,
            stream_value: None,
        };

        match key_type {
            RedisKeyType::String => {
                let val: Option<String> = conn.get(key).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.string_value = val;
            }
            RedisKeyType::Hash => {
                let val: Option<HashMap<String, String>> = conn.hgetall(key).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.hash_value = val.map(|h| h.into_iter().collect());
            }
            RedisKeyType::List => {
                let val: Vec<String> = conn.lrange(key, 0, -1).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.list_value = Some(val);
            }
            RedisKeyType::Set => {
                let val: Vec<String> = conn.smembers(key).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.set_value = Some(val);
            }
            RedisKeyType::Zset => {
                let val: Vec<(String, f64)> = conn.zrange_with_scores(key, 0, -1).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.zset_value = Some(val.into_iter().map(|(member, score)| ZsetMember {
                    member,
                    score,
                }).collect());
            }
            RedisKeyType::Stream => {
                let val: Vec<(String, Vec<String>)> = conn.xrange(key, "-", "+", "COUNT", 200).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
                result.stream_value = Some(val.into_iter().map(|(id, fields)| {
                    let chunked: Vec<(String, String)> = fields.chunks(2)
                        .filter_map(|chunk| {
                            if chunk.len() == 2 {
                                Some((chunk[0].clone(), chunk[1].clone()))
                            } else {
                                None
                            }
                        })
                        .collect();
                    StreamEntry { id, fields: chunked }
                }).collect());
            }
            RedisKeyType::Unknown => {}
        }

        Ok(result)
    }

    /// Set value of a key
    pub async fn set_value(&self, db: u8, key: &str, key_type: RedisKeyType, data: RedisKeyValue, ttl_sec: Option<u64>) -> Result<()> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        match key_type {
            RedisKeyType::String => {
                if let Some(val) = data.string_value {
                    let _: () = conn.set(key, val).await
                        .map_err(|e| ElevenError::Redis(e.to_string()))?;
                }
            }
            RedisKeyType::Hash => {
                if let Some(fields) = data.hash_value {
                    // Delete first, then set
                    let _: () = conn.del(key).await
                        .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    if !fields.is_empty() {
                        let flat: Vec<String> = fields.into_iter()
                            .flat_map(|(k, v)| vec![k, v])
                            .collect();
                        let _: () = conn.hset(key, flat).await
                            .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    }
                }
            }
            RedisKeyType::List => {
                if let Some(values) = data.list_value {
                    let _: () = conn.del(key).await
                        .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    if !values.is_empty() {
                        let _: () = conn.rpush(key, values).await
                            .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    }
                }
            }
            RedisKeyType::Set => {
                if let Some(values) = data.set_value {
                    let _: () = conn.del(key).await
                        .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    if !values.is_empty() {
                        let _: () = conn.sadd(key, values).await
                            .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    }
                }
            }
            RedisKeyType::Zset => {
                if let Some(members) = data.zset_value {
                    let _: () = conn.del(key).await
                        .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    for m in members {
                        let _: () = conn.zadd(key, m.member, m.score).await
                            .map_err(|e| ElevenError::Redis(e.to_string()))?;
                    }
                }
            }
            RedisKeyType::Stream => {
                return Err(ElevenError::Redis("Stream write not implemented".to_string()));
            }
            RedisKeyType::Unknown => {
                return Err(ElevenError::Redis("Unknown key type".to_string()));
            }
        }

        // Handle TTL
        if let Some(ttl) = ttl_sec {
            if ttl > 0 {
                let _: () = conn.expire(key, ttl).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
            } else {
                let _: () = conn.persist(key).await
                    .map_err(|e| ElevenError::Redis(e.to_string()))?;
            }
        }

        Ok(())
    }

    /// Set TTL on a key
    pub async fn expire_key(&self, db: u8, key: &str, ttl_sec: u64) -> Result<()> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let _: () = conn.expire(key, ttl_sec).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(())
    }

    /// Remove TTL from a key
    pub async fn persist_key(&self, db: u8, key: &str) -> Result<()> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let _: () = conn.persist(key).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(())
    }

    /// Rename a key
    pub async fn rename_key(&self, db: u8, old_name: &str, new_name: &str) -> Result<()> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let _: () = conn.rename(old_name, new_name).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(())
    }

    /// Delete a key
    pub async fn delete_key(&self, db: u8, key: &str) -> Result<u64> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let deleted: u64 = conn.del(key).await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(deleted)
    }

    /// Run arbitrary Redis command
    pub async fn run_command(&self, db: u8, command: &str, args: Vec<String>) -> Result<serde_json::Value> {
        let mut conn = self.connection.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?
            .clone();

        if db != self.current_db {
            let _: () = conn.select(db).await
                .map_err(|e| ElevenError::Redis(e.to_string()))?;
        }

        let cmd_lower = command.to_lowercase();
        
        // Security: deny dangerous commands
        let denied = ["shutdown", "bgrewriteaof", "bgsave", "save", 
                      "flushall", "flushdb", "config", "debug", 
                      "monitor", "sync", "slaveof", "replicaof", 
                      "cluster", "keys"];
        
        if denied.contains(&cmd_lower.as_str()) {
            return Err(ElevenError::Redis(format!("Security policy: {} command is denied", command)));
        }

        // Build and execute command
        let result = redis::cmd(&cmd_lower)
            .arg(&args)
            .query_async::<_, Vec<String>>(&mut conn)
            .await
            .map_err(|e| ElevenError::Redis(e.to_string()))?;

        Ok(serde_json::json!(result))
    }
}
