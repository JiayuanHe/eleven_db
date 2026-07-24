//! Shared types for Eleven DB

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Database kind
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Mysql,
    Oracle,
    Redis,
}

impl Default for DbKind {
    fn default() -> Self {
        DbKind::Mysql
    }
}

/// Redis configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisConfig {
    pub mode: RedisMode,
    pub db: u8,
    pub username: Option<String>,
    pub password: Option<String>,
    pub password_cipher: Option<String>,
    pub sentinel_name: Option<String>,
    pub sentinel_nodes: Option<Vec<String>>,
    pub cluster_nodes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RedisMode {
    Single,
    Sentinel,
    Cluster,
}

impl Default for RedisMode {
    fn default() -> Self {
        RedisMode::Single
    }
}

/// Connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password_cipher: Option<String>,
    pub database: Option<String>,
    pub service_name: Option<String>,
    pub sid: Option<String>,
    pub tns: Option<String>,
    pub charset: Option<String>,
    pub timeout_ms: Option<u64>,
    pub redis: Option<RedisConfig>,
    pub ssh: Option<SshConfig>,
    pub group: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ConnectionConfig {
    pub fn new(name: String, kind: DbKind, host: String, port: u16, username: String) -> Self {
        let now = Utc::now().timestamp_millis();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            kind,
            host,
            port,
            username,
            password_cipher: None,
            database: None,
            service_name: None,
            sid: None,
            tns: None,
            charset: Some("utf8mb4".to_string()),
            timeout_ms: Some(8000),
            redis: None,
            ssh: None,
            group: None,
            color: None,
            created_at: now,
            updated_at: now,
        }
    }
}

/// SSH tunnel configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
}

/// Schema object type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaObjectType {
    Table,
    View,
    Procedure,
    Function,
    Trigger,
    Index,
    Database,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObject {
    pub name: String,
    #[serde(rename = "type")]
    pub obj_type: SchemaObjectType,
    pub schema: Option<String>,
}

/// Table column information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    pub length: Option<u64>,
    pub nullable: bool,
    pub is_primary: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

/// Field detail for table editing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFieldDetail {
    pub name: String,
    pub raw_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub default_is_null: bool,
    pub comment: String,
    pub is_primary: bool,
}

/// Table detail information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    pub database: String,
    pub table: String,
    pub ddl: String,
    pub fields: Vec<TableFieldDetail>,
    pub table_comment: String,
    pub engine: Option<String>,
    pub charset: Option<String>,
    pub auto_increment: Option<u64>,
}

/// Field edit operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldOp {
    Add,
    Drop,
    Modify,
    Change,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldEdit {
    pub original_name: Option<String>,
    pub op: FieldOp,
    pub new_name: Option<String>,
    #[serde(rename = "type")]
    pub field_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub default_is_null: bool,
    pub comment: String,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterExtras {
    pub drop_primary: Vec<String>,
}

/// Query result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Value>,
    pub affected_rows: Option<u64>,
    pub elapsed_ms: u64,
    pub insert_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
}

/// Query history item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryItem {
    pub id: String,
    pub connection_id: String,
    pub sql: String,
    pub elapsed_ms: u64,
    pub rows: usize,
    pub executed_at: i64,
    pub success: bool,
    pub error: Option<String>,
}

/// IPC result wrapper
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcResult<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<IpcError>,
}

#[derive(Debug, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl<T: Serialize> IpcResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(code: &str, message: &str) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(IpcError {
                code: code.to_string(),
                message: message.to_string(),
            }),
        }
    }
}

/// Commit row for batch operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitOp {
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub op: CommitOp,
    pub data: serde_json::Value,
    pub pk: Option<serde_json::Value>,
}

/// Redis key types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisKeyType {
    String,
    Hash,
    List,
    Set,
    Zset,
    Stream,
    Unknown,
}

/// Redis key info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    pub name: String,
    pub key_type: RedisKeyType,
    pub ttl: i64,
    pub size: Option<u64>,
}

/// Redis key value
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyValue {
    pub key: String,
    pub key_type: RedisKeyType,
    pub string_value: Option<String>,
    pub hash_value: Option<Vec<(String, String)>>,
    pub list_value: Option<Vec<String>>,
    pub set_value: Option<Vec<String>>,
    pub zset_value: Option<Vec<ZsetMember>>,
    pub stream_value: Option<Vec<StreamEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZsetMember {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEntry {
    pub id: String,
    pub fields: Vec<(String, String)>,
}

/// List keys options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListKeysOptions {
    pub database: Option<u8>,
    pub pattern: Option<String>,
    pub cursor: Option<u64>,
    pub count: Option<u64>,
}

/// List keys result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListKeysResult {
    pub keys: Vec<String>,
    pub next_cursor: u64,
}

/// Test connection result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
}

/// Build config input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfigInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: Option<String>,
    pub service_name: Option<String>,
    pub sid: Option<String>,
    pub tns: Option<String>,
    pub charset: Option<String>,
    pub timeout_ms: Option<u64>,
    pub redis: Option<RedisConfig>,
    pub group: Option<String>,
    pub color: Option<String>,
}
