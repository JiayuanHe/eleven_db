//! Tauri IPC commands

use tauri::State;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::{ElevenError, Result};
use crate::types::*;
use crate::connection_manager::ConnectionManager;
use crate::crypto::Crypto;
use crate::stores::ConnectionStore;

/// Application state
pub struct AppState {
    pub connection_manager: Arc<Mutex<ConnectionManager>>,
}

// ============================================================================
// Connection Management
// ============================================================================

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionConfig>, String> {
    let manager = state.connection_manager.lock().await;
    manager.store().list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection(state: State<'_, AppState>, id: String) -> Result<Option<ConnectionConfig>, String> {
    let manager = state.connection_manager.lock().await;
    let mut cfg = manager.store().get(&id).map_err(|e| e.to_string())?;
    if let Some(ref mut c) = cfg {
        c.password_cipher = None;
    }
    Ok(cfg)
}

#[tauri::command]
pub async fn create_connection(
    state: State<'_, AppState>,
    input: BuildConfigInput,
    password: Option<String>,
    save_password: bool,
    redis_password: Option<String>,
    save_redis_password: bool,
) -> Result<ConnectionConfig, String> {
    let manager = state.connection_manager.lock().await;
    let cfg = manager.build_config(input);
    
    let cipher = if save_password {
        password.as_ref().map(|p| Crypto::encrypt(p)).transpose().map_err(|e| e.to_string())?
    } else {
        None
    };
    
    let redis_cipher = if save_redis_password {
        redis_password.as_ref().map(|p| Crypto::encrypt(p)).transpose().map_err(|e| e.to_string())?
    } else {
        None
    };
    
    manager.store().create(cfg.clone(), cipher, redis_cipher).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    input: BuildConfigInput,
    password: Option<String>,
    save_password: bool,
    redis_password: Option<String>,
    save_redis_password: bool,
) -> Result<ConnectionConfig, String> {
    let manager = state.connection_manager.lock().await;
    
    // Get existing record
    let record = manager.store().get_raw(&input.id.as_ref().ok_or("Missing ID")?)
        .map_err(|e| e.to_string())?
        .ok_or("Connection not found")?;
    
    let merged = manager.build_config(input);
    let cipher = if save_password {
        password.as_ref().map(|p| Crypto::encrypt(p)).transpose().map_err(|e| e.to_string())?
    } else {
        None
    };
    
    let redis_cipher = if save_redis_password {
        redis_password.as_ref().map(|p| Crypto::encrypt(p)).transpose().map_err(|e| e.to_string())?
    } else {
        None
    };
    
    manager.store().update(merged.clone(), cipher, redis_cipher).map_err(|e| e.to_string())?;
    
    // Close existing connection (will reconnect with new config)
    manager.close(&merged.id).await.map_err(|e| e.to_string())?;
    
    Ok(merged)
}

#[tauri::command]
pub async fn remove_connection(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    manager.close(&id).await.map_err(|e| e.to_string())?;
    manager.store().remove(&id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn duplicate_connection(state: State<'_, AppState>, id: String) -> Result<ConnectionConfig, String> {
    let manager = state.connection_manager.lock().await;
    
    let record = manager.store().get_raw(&id)
        .map_err(|e| e.to_string())?
        .ok_or("Connection not found")?;
    
    let copy = manager.build_config(BuildConfigInput {
        id: None,
        name: format!("{} (副本)", record.config.name),
        kind: record.config.kind.clone(),
        host: record.config.host.clone(),
        port: record.config.port,
        username: record.config.username.clone(),
        database: record.config.database.clone(),
        service_name: record.config.service_name.clone(),
        sid: record.config.sid.clone(),
        tns: record.config.tns.clone(),
        charset: record.config.charset.clone(),
        timeout_ms: record.config.timeout_ms,
        redis: record.config.redis.clone(),
        group: record.config.group.clone(),
        color: record.config.color.clone(),
    });
    
    manager.store().create(copy.clone(), record.password_cipher.clone(), record.redis_password_cipher.clone())
        .map_err(|e| e.to_string())?;
    
    Ok(copy)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    input: BuildConfigInput,
    password: Option<String>,
    redis_password: Option<String>,
) -> Result<TestResult, String> {
    let start = std::time::Instant::now();
    let manager = state.connection_manager.lock().await;
    let cfg = manager.build_config(input);
    
    match cfg.kind {
        DbKind::Redis => {
            use crate::drivers::RedisDriver;
            let pwd = redis_password.or_else(|| {
                manager.store().get_redis_password_cipher(&cfg.id).ok().flatten()
                    .and_then(|c| Crypto::decrypt(&c).ok())
            });
            let mut driver = RedisDriver::new(cfg, pwd);
            driver.connect().await.map_err(|e| e.to_string())?;
            let _ = driver.close().await;
            Ok(TestResult {
                ok: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            })
        }
        _ => {
            use crate::drivers::MysqlDriver;
            let pwd = password.or_else(|| {
                manager.store().get_password_cipher(&cfg.id).ok().flatten()
                    .and_then(|c| Crypto::decrypt(&c).ok())
            });
            let mut driver = MysqlDriver::new(cfg, pwd.unwrap_or_default());
            driver.connect().await.map_err(|e| e.to_string())?;
            let _ = driver.close().await;
            Ok(TestResult {
                ok: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            })
        }
    }
}

#[tauri::command]
pub async fn resolve_connection(state: State<'_, AppState>, id: String, password: Option<String>) -> Result<serde_json::Value, String> {
    let manager = state.connection_manager.lock().await;
    
    let record = manager.store().get_raw(&id)
        .map_err(|e| e.to_string())?
        .ok_or("Connection not found")?;
    
    if record.config.kind == DbKind::Redis {
        let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "kind": "redis",
            "isAlive": driver.is_alive()
        }))
    } else {
        let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "kind": driver.config.kind,
            "isAlive": driver.is_alive()
        }))
    }
}

#[tauri::command]
pub async fn list_objects(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: Option<String>,
    redis_password: Option<String>,
) -> Result<Vec<SchemaObject>, String> {
    let manager = state.connection_manager.lock().await;
    
    let record = manager.store().get_raw(&id)
        .map_err(|e| e.to_string())?
        .ok_or("Connection not found")?;
    
    if record.config.kind == DbKind::Redis {
        let driver = manager.open_redis(&id, redis_password).await.map_err(|e| e.to_string())?;
        let dbs = driver.list_databases().await.map_err(|e| e.to_string())?;
        Ok(dbs.into_iter().map(|d| SchemaObject {
            name: format!("db{}", d),
            obj_type: SchemaObjectType::Database,
            schema: Some(d.to_string()),
        }).collect())
    } else {
        let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
        driver.list_objects(database.as_deref()).await.map_err(|e| e.to_string())
    }
}

// ============================================================================
// SQL Operations
// ============================================================================

#[tauri::command]
pub async fn execute_sql(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    sql: String,
) -> Result<QueryResult, String> {
    use uuid::Uuid;
    
    let start = std::time::Instant::now();
    let history_id = Uuid::new_v4().to_string();
    let manager = state.connection_manager.lock().await;
    
    match manager.open(&id, password).await {
        Ok(driver) => {
            match driver.execute(&sql).await {
                Ok(result) => {
                    // Add to history
                    let _ = manager.store().add_history(QueryHistoryItem {
                        id: history_id,
                        connection_id: id,
                        sql: sql.clone(),
                        elapsed_ms: result.elapsed_ms,
                        rows: result.rows.len(),
                        success: true,
                        executed_at: chrono::Utc::now().timestamp_millis(),
                        error: None,
                    });
                    Ok(result)
                }
                Err(e) => {
                    let _ = manager.store().add_history(QueryHistoryItem {
                        id: history_id,
                        connection_id: id,
                        sql,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        rows: 0,
                        success: false,
                        executed_at: chrono::Utc::now().timestamp_millis(),
                        error: Some(e.to_string()),
                    });
                    Err(e.to_string())
                }
            }
        }
        Err(e) => Err(e.to_string())
    }
}

#[tauri::command]
pub async fn build_update_sql(
    table: String,
    primary_keys: Vec<String>,
    old_row: serde_json::Value,
    new_row: serde_json::Value,
) -> Result<String, String> {
    let old_map = old_row.as_object().ok_or("Invalid old_row")?;
    let new_map = new_row.as_object().ok_or("Invalid new_row")?;
    
    let sets: Vec<String> = new_map.iter()
        .filter(|(k, v)| {
            old_map.get(*k).map(|ov| !serde_json::jsonто_string(ov).unwrap_or_default().eq(&serde_json::jsonто_string(v).unwrap_or_default())).unwrap_or(true)
        })
        .map(|(k, v)| format!("`{}` = {}", k, value_to_sql(v)))
        .collect();
    
    let wheres: Vec<String> = primary_keys.iter()
        .filter_map(|k| old_map.get(k).map(|v| format!("`{}` = {}", k, value_to_sql(v))))
        .collect();
    
    if sets.is_empty() || wheres.is_empty() {
        return Err("Invalid update".to_string());
    }
    
    Ok(format!(
        "UPDATE `{}` SET {} WHERE {};",
        table,
        sets.join(", "),
        wheres.join(" AND ")
    ))
}

fn value_to_sql(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        _ => "NULL".to_string(),
    }
}

fn serde_json::jsonто_string(v: &serde_json::Value) -> std::result::Result<String, serde_json::Error> {
    serde_json::to_string(v)
}

#[tauri::command]
pub async fn list_history(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<QueryHistoryItem>, String> {
    let manager = state.connection_manager.lock().await;
    manager.store().list_history(limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    manager.store().clear_history().map_err(|e| e.to_string())?;
    Ok(true)
}

// ============================================================================
// Table Operations
// ============================================================================

#[tauri::command]
pub async fn get_table_schema(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
    table: String,
) -> Result<Vec<TableColumn>, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    driver.get_table_schema(&database, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_data(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
    table: String,
    page_size: Option<u64>,
    page: Option<u64>,
    order_by: Option<String>,
    order_dir: Option<String>,
    filter_where: Option<String>,
) -> Result<QueryResult, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    
    let options = FetchDataOptions {
        database: Some(database),
        table,
        page_size,
        page,
        order_by,
        order_dir: order_dir.and_then(|s| if s == "DESC" { Some("DESC".to_string()) } else { Some("ASC".to_string()) }),
        where: filter_where,
    };
    
    driver.fetch_data(options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn commit_table(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
    table: String,
    rows: Vec<CommitRow>,
) -> Result<QueryResult, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    driver.commit(&database, &table, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_table_detail(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
    table: String,
) -> Result<TableDetail, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    driver.get_table_detail(&database, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn alter_table(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
    table: String,
    edits: Vec<FieldEdit>,
    extras: Option<AlterExtras>,
) -> Result<QueryResult, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    driver.apply_alter(&database, &table, edits, extras).await.map_err(|e| e.to_string())
}

// ============================================================================
// Redis Operations
// ============================================================================

#[tauri::command]
pub async fn redis_list_databases(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
) -> Result<Vec<u8>, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.list_databases().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_list_keys(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: Option<u8>,
    pattern: Option<String>,
    cursor: Option<u64>,
    count: Option<u64>,
) -> Result<ListKeysResult, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    let options = ListKeysOptions { database, pattern, cursor, count };
    driver.list_keys(options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_describe_key(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
) -> Result<RedisKeyInfo, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.describe_key(database, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_get_value(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
    key_type: RedisKeyType,
) -> Result<RedisKeyValue, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.get_value(database, &key, key_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_set_value(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
    key_type: RedisKeyType,
    data: RedisKeyValue,
    ttl_sec: Option<u64>,
) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.set_value(database, &key, key_type, data, ttl_sec).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn redis_expire(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
    ttl_sec: u64,
) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.expire_key(database, &key, ttl_sec).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn redis_persist(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.persist_key(database, &key).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn redis_rename(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    old_name: String,
    new_name: String,
) -> Result<bool, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.rename_key(database, &old_name, &new_name).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn redis_delete(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    key: String,
) -> Result<u64, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.delete_key(database, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_run_command(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: u8,
    command: String,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open_redis(&id, password).await.map_err(|e| e.to_string())?;
    driver.run_command(database, &command, args).await.map_err(|e| e.to_string())
}

// ============================================================================
// Import/Export
// ============================================================================

#[tauri::command]
pub async fn dump_database(
    state: State<'_, AppState>,
    id: String,
    password: Option<String>,
    database: String,
) -> Result<String, String> {
    let manager = state.connection_manager.lock().await;
    let driver = manager.open(&id, password).await.map_err(|e| e.to_string())?;
    driver.dump_database(&database).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_csv(
    contents: String,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    
    let file_path = FileDialogBuilder::new()
        .set_title("导出 CSV")
        .add_filter("CSV", &["csv"])
        .save_file();
    
    if let Some(path) = file_path {
        std::fs::write(&path, "\u{FEFF}".to_string() + &contents)
            .map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn export_sql(
    contents: String,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    
    let file_path = FileDialogBuilder::new()
        .set_title("导出 SQL")
        .add_filter("SQL", &["sql"])
        .save_file();
    
    if let Some(path) = file_path {
        std::fs::write(&path, contents)
            .map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

// ============================================================================
// Application
// ============================================================================

#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
