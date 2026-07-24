//! MySQL driver implementation

use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, PoolConstraints, Row};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::{ElevenError, Result};
use crate::types::*;

/// MySQL driver for database connections
pub struct MysqlDriver {
    config: ConnectionConfig,
    password: String,
    pool: Option<Pool>,
}

impl MysqlDriver {
    /// Create a new MySQL driver
    pub fn new(config: ConnectionConfig, password: String) -> Self {
        Self {
            config,
            password,
            pool: None,
        }
    }

    /// Connect to the database
    pub async fn connect(&mut self) -> Result<()> {
        if self.pool.is_some() {
            return Ok(());
        }

        let opts = OptsBuilder::new()
            .ip_or_hostname(&self.config.host)
            .tcp_port(self.config.port)
            .user(Some(&self.config.username))
            .pass(Some(&self.password))
            .db_name(self.config.database.clone())
            .connect_timeout(std::time::Duration::from_millis(
                self.config.timeout_ms.unwrap_or(8000)
            ))
            .pool_constraints(PoolConstraints::new(1, 8).unwrap());

        let pool = Pool::new(opts);
        
        // Test connection
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;
        
        // Execute a simple query to verify connection
        conn.query_drop("SELECT 1").await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;
        
        self.pool = Some(pool);
        Ok(())
    }

    /// Check if the driver is alive
    pub fn is_alive(&self) -> bool {
        self.pool.is_some()
    }

    /// Close the connection
    pub async fn close(&mut self) -> Result<()> {
        if let Some(pool) = self.pool.take() {
            pool.disconnect().await
                .map_err(|e| ElevenError::Connection(e.to_string()))?;
        }
        Ok(())
    }

    /// List objects in a database
    pub async fn list_objects(&self, database: Option<&str>) -> Result<Vec<SchemaObject>> {
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        let db = database.unwrap_or_else(|| 
            self.config.database.as_deref().unwrap_or("")
        );

        if db.is_empty() {
            // List all databases
            let rows: Vec<Row> = conn.query("SHOW DATABASES").await
                .map_err(|e| ElevenError::Query(e.to_string()))?;
            return Ok(rows.iter()
                .map(|r| SchemaObject {
                    name: r.get::<String, _>(0).unwrap_or_default(),
                    obj_type: SchemaObjectType::Database,
                    schema: None,
                })
                .collect());
        }

        let mut objects = Vec::new();

        // Tables
        let tables: Vec<Row> = conn.exec_iter(
            "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            (db,)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;
        
        for row in tables {
            if let Ok(name) = row.get::<String, _>(0) {
                objects.push(SchemaObject {
                    name,
                    obj_type: SchemaObjectType::Table,
                    schema: Some(db.to_string()),
                });
            }
        }

        // Views
        let views: Vec<Row> = conn.exec_iter(
            "SELECT TABLE_NAME FROM information_schema.views WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            (db,)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;
        
        for row in views {
            if let Ok(name) = row.get::<String, _>(0) {
                objects.push(SchemaObject {
                    name,
                    obj_type: SchemaObjectType::View,
                    schema: Some(db.to_string()),
                });
            }
        }

        // Routines
        let routines: Vec<Row> = conn.exec_iter(
            "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME",
            (db,)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;
        
        for row in routines {
            if let (Ok(name), Ok(type_str)) = (row.get::<String, _>(0), row.get::<String, _>(1)) {
                let obj_type = match type_str.to_uppercase().as_str() {
                    "PROCEDURE" => SchemaObjectType::Procedure,
                    "FUNCTION" => SchemaObjectType::Function,
                    _ => continue,
                };
                objects.push(SchemaObject {
                    name,
                    obj_type,
                    schema: Some(db.to_string()),
                });
            }
        }

        Ok(objects)
    }

    /// Get table schema
    pub async fn get_table_schema(&self, database: &str, table: &str) -> Result<Vec<TableColumn>> {
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        let rows: Vec<Row> = conn.exec_iter(
            r#"SELECT 
                COLUMN_NAME,
                COLUMN_TYPE,
                IS_NULLABLE,
                COLUMN_KEY,
                COLUMN_DEFAULT,
                COLUMN_COMMENT
            FROM information_schema.columns 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION"#,
            (database, table)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        Ok(rows.iter().map(|r| {
            TableColumn {
                name: r.get::<String, _>(0).unwrap_or_default(),
                col_type: r.get::<String, _>(1).unwrap_or_default(),
                length: None,
                nullable: r.get::<String, _>(2).map(|v| v == "YES").unwrap_or(false),
                is_primary: r.get::<String, _>(3).map(|v| v == "PRI").unwrap_or(false),
                default_value: r.get::<Option<String>, _>(4).unwrap_or(None),
                comment: r.get::<String, _>(5),
            }
        }).collect())
    }

    /// Get table detail
    pub async fn get_table_detail(&self, database: &str, table: &str) -> Result<TableDetail> {
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        // DDL
        let ddl_rows: Vec<Row> = conn.exec_iter(
            &format!("SHOW CREATE TABLE `{database}`.`{table}`"),
            ()
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;
        
        let ddl = ddl_rows.first()
            .and_then(|r| r.get::<String, _>(1).ok())
            .unwrap_or_default();

        // Columns
        let col_rows: Vec<Row> = conn.exec_iter(
            r#"SELECT 
                COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, 
                COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLUMN_KEY
            FROM information_schema.columns 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION"#,
            (database, table)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        let fields: Vec<TableFieldDetail> = col_rows.iter().map(|r| {
            let nullable_str = r.get::<String, _>(2).unwrap_or("NO".to_string());
            let extra = r.get::<String, _>(4).unwrap_or_default();
            let default_raw: Option<String> = r.get::<Option<String>, _>(3).unwrap_or(None);
            let is_auto_inc = extra.to_lowercase().contains("auto_increment");
            
            let (default_value, default_is_null) = if let Some(def) = default_raw {
                if def == "NULL" {
                    (Some("NULL".to_string()), true)
                } else {
                    (Some(def), false)
                }
            } else if nullable_str == "YES" {
                (Some("NULL".to_string()), true)
            } else {
                (None, false)
            };

            TableFieldDetail {
                name: r.get::<String, _>(0).unwrap_or_default(),
                raw_type: r.get::<String, _>(1).unwrap_or_default(),
                nullable: nullable_str == "YES",
                default_value,
                default_is_null,
                comment: r.get::<String, _>(5).unwrap_or_default(),
                is_primary: r.get::<String, _>(6).map(|v| v == "PRI").unwrap_or(false),
            }
        }).collect();

        // Table info
        let tbl_rows: Vec<Row> = conn.exec_iter(
            "SELECT TABLE_COMMENT, ENGINE, TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            (database, table)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        let (table_comment, engine, collation) = if let Some(row) = tbl_rows.first() {
            (
                row.get::<String, _>(0).unwrap_or_default(),
                row.get::<String, _>(1).ok(),
                row.get::<String, _>(2).ok(),
            )
        } else {
            (String::new(), None, None)
        };

        let charset = collation.as_ref().and_then(|c| c.split('_').next().map(String::from));

        // Auto increment
        let ai_rows: Vec<Row> = conn.exec_iter(
            "SELECT AUTO_INCREMENT FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            (database, table)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        let auto_increment = ai_rows.first()
            .and_then(|r| r.get::<u64, _>(0).ok());

        Ok(TableDetail {
            database: database.to_string(),
            table: table.to_string(),
            ddl,
            fields,
            table_comment,
            engine,
            charset,
            auto_increment,
        })
    }

    /// Fetch data with pagination
    pub async fn fetch_data(&self, options: FetchDataOptions) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        let db = options.database.as_deref()
            .or_else(|| self.config.database.as_deref())
            .unwrap_or("");
        let table = &options.table;
        let limit = options.page_size.unwrap_or(1000).min(10000);
        let page = options.page.unwrap_or(1).max(1);
        let offset = (page - 1) * limit;
        
        let where_clause = options.where.as_ref()
            .map(|w| format!("WHERE {}", w))
            .unwrap_or_default();
        
        let order_clause = options.order_by.as_ref()
            .map(|o| format!("ORDER BY `{}` {}", o, options.order_dir.as_deref().unwrap_or("ASC")))
            .unwrap_or_default();

        // Data query
        let query = format!(
            "SELECT * FROM `{db}`.`{table}` {where_clause} {order_clause} LIMIT {limit} OFFSET {offset}"
        );
        
        let rows: Vec<Row> = conn.query(&query).await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        let columns: Vec<ColumnInfo> = if let Some(first) = rows.first() {
            first.columns().iter()
                .map(|col| ColumnInfo {
                    name: col.name_str().to_string(),
                    col_type: String::new(),
                })
                .collect()
        } else {
            Vec::new()
        };

        let row_data: Vec<serde_json::Value> = rows.iter().map(|row| {
            let mut map = serde_json::Map::new();
            for col in row.columns() {
                let name = col.name_str();
                let value: serde_json::Value = match row.get::<mysql_async::Value, _>(name.as_str()) {
                    Ok(mysql_async::Value::NULL) => serde_json::Value::Null,
                    Ok(mysql_async::Value::Bytes(b)) => {
                        serde_json::Value::String(String::from_utf8_lossy(&b).to_string())
                    }
                    Ok(mysql_async::Value::Int(i)) => serde_json::Value::Number(i.into()),
                    Ok(mysql_async::Value::UInt(u)) => serde_json::Value::Number(u.into()),
                    Ok(mysql_async::Value::Float(f)) => {
                        serde_json::Number::from_f64(f as f64)
                            .map(serde_json::Value::Number)
                            .unwrap_or(serde_json::Value::Null)
                    }
                    Ok(mysql_async::Value::Double(d)) => {
                        serde_json::Number::from_f64(d)
                            .map(serde_json::Value::Number)
                            .unwrap_or(serde_json::Value::Null)
                    }
                    Ok(mysql_async::Value::Date(y, m, d, h, mi, s, _)) => {
                        serde_json::Value::String(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, h, mi, s))
                    }
                    _ => serde_json::Value::Null,
                };
                map.insert(name.to_string(), value);
            }
            serde_json::Value::Object(map)
        }).collect();

        // Count query
        let count_query = format!(
            "SELECT COUNT(*) FROM `{db}`.`{table}` {where_clause}"
        );
        let count_rows: Vec<Row> = conn.query(&count_query).await
            .map_err(|e| ElevenError::Query(e.to_string()))?;
        let total_count = count_rows.first()
            .and_then(|r| r.get::<i64, _>(0).ok())
            .unwrap_or(0) as u64;

        Ok(QueryResult {
            columns,
            rows: row_data,
            affected_rows: Some(total_count),
            elapsed_ms: start.elapsed().as_millis() as u64,
            insert_id: None,
        })
    }

    /// Execute SQL query
    pub async fn execute(&self, sql: &str) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        // Split statements
        let statements: Vec<&str> = sql.split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty() && !s.starts_with("--"))
            .collect();

        let mut last_result: Option<QueryResult> = None;

        for stmt in statements {
            let result = conn.query_iter(stmt).await
                .map_err(|e| ElevenError::Query(e.to_string()))?;
            
            let (affected, insert_id) = result.affected_rows();
            
            last_result = Some(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows: Some(affected),
                elapsed_ms: start.elapsed().as_millis() as u64,
                insert_id: if insert_id > 0 { Some(insert_id) } else { None },
            });
        }

        Ok(last_result.unwrap_or_else(|| QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(0),
            elapsed_ms: start.elapsed().as_millis() as u64,
            insert_id: None,
        }))
    }

    /// Apply ALTER TABLE changes
    pub async fn apply_alter(&self, database: &str, table: &str, edits: Vec<FieldEdit>, extras: Option<AlterExtras>) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        if edits.is_empty() && extras.as_ref().map(|e| e.drop_primary.is_empty()).unwrap_or(true) {
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows: Some(0),
                elapsed_ms: 0,
                insert_id: None,
            });
        }

        conn.start_transaction().await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        let full_name = format!("`{database}`.`{table}`");
        let mut stmt_count = 0;

        // Drop primary key
        if let Some(ref extras) = extras {
            if !extras.drop_primary.is_empty() {
                conn.query_drop(format!("ALTER TABLE {full_name} DROP PRIMARY KEY"))
                    .await
                    .map_err(|e| ElevenError::Query(e.to_string()))?;
                stmt_count += 1;
            }
        }

        for edit in edits {
            let stmt = match edit.op {
                FieldOp::Drop => {
                    if let Some(ref name) = edit.original_name {
                        format!("ALTER TABLE {full_name} DROP COLUMN `{name}`")
                    } else {
                        continue;
                    }
                }
                FieldOp::Add => {
                    if let Some(ref name) = edit.new_name {
                        let def = field_definition_clause(&edit);
                        let tail = if edit.is_primary { " PRIMARY KEY" } else { "" };
                        format!("ALTER TABLE {full_name} ADD COLUMN `{name}` {def}{tail}")
                    } else {
                        continue;
                    }
                }
                FieldOp::Modify => {
                    if let Some(ref name) = edit.original_name {
                        let def = field_definition_clause(&edit);
                        format!("ALTER TABLE {full_name} MODIFY COLUMN `{name}` {def}")
                    } else {
                        continue;
                    }
                }
                FieldOp::Change => {
                    if let (Some(ref old_name), Some(ref new_name)) = (edit.original_name, edit.new_name) {
                        let def = field_definition_clause(&edit);
                        format!("ALTER TABLE {full_name} CHANGE COLUMN `{old_name}` `{new_name}` {def}")
                    } else {
                        continue;
                    }
                }
            };
            conn.query_drop(&stmt).await
                .map_err(|e| ElevenError::Query(e.to_string()))?;
            stmt_count += 1;
        }

        conn.commit().await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(stmt_count),
            elapsed_ms: start.elapsed().as_millis() as u64,
            insert_id: None,
        })
    }

    /// Commit batch changes
    pub async fn commit(&self, database: &str, table: &str, rows: Vec<CommitRow>) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        conn.start_transaction().await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        for row in rows {
            match row.op {
                CommitOp::Insert => {
                    let data = row.data.as_object().unwrap();
                    let cols: Vec<String> = data.keys().map(|k| format!("`{}`", k)).collect();
                    let placeholders: Vec<String> = (0..cols.len()).map(|_| "?".to_string()).collect();
                    let values: Vec<serde_json::Value> = data.values().cloned().collect();
                    
                    let sql = format!(
                        "INSERT INTO `{database}`.`{table}` ({}) VALUES ({})",
                        cols.join(", "),
                        placeholders.join(", ")
                    );
                    
                    let params: Vec<mysql_async::Value> = values.iter().map(|v| {
                        match v {
                            serde_json::Value::Null => mysql_async::Value::NULL,
                            serde_json::Value::String(s) => mysql_async::Value::Bytes(s.clone().into_bytes()),
                            serde_json::Value::Number(n) => {
                                n.as_i64()
                                    .map(mysql_async::Value::Int)
                                    .or_else(|| n.as_u64().map(mysql_async::Value::UInt))
                                    .or_else(|| n.as_f64().map(|f| mysql_async::Value::Double(f)))
                                    .unwrap_or(mysql_async::Value::NULL)
                            }
                            serde_json::Value::Bool(b) => mysql_async::Value::Int(if *b { 1 } else { 0 }),
                            _ => mysql_async::Value::NULL,
                        }
                    }).collect();
                    
                    conn.exec_iter(&sql, params).await
                        .map_err(|e| ElevenError::Query(e.to_string()))?;
                }
                CommitOp::Update => {
                    let pk = row.pk.as_ref()
                        .and_then(|p| p.as_object())
                        .ok_or_else(|| ElevenError::Query("Update requires primary key".to_string()))?;
                    let data = row.data.as_object().unwrap();
                    
                    let sets: Vec<String> = data.keys()
                        .map(|k| format!("`{}` = ?", k))
                        .collect();
                    let wheres: Vec<String> = pk.keys()
                        .map(|k| format!("`{}` = ?", k))
                        .collect();
                    
                    let sql = format!(
                        "UPDATE `{database}`.`{table}` SET {} WHERE {}",
                        sets.join(", "),
                        wheres.join(" AND ")
                    );
                    
                    let mut params: Vec<mysql_async::Value> = data.values().map(|v| {
                        match v {
                            serde_json::Value::Null => mysql_async::Value::NULL,
                            serde_json::Value::String(s) => mysql_async::Value::Bytes(s.clone().into_bytes()),
                            serde_json::Value::Number(n) => {
                                n.as_i64()
                                    .map(mysql_async::Value::Int)
                                    .or_else(|| n.as_u64().map(mysql_async::Value::UInt))
                                    .unwrap_or(mysql_async::Value::NULL)
                            }
                            serde_json::Value::Bool(b) => mysql_async::Value::Int(if *b { 1 } else { 0 }),
                            _ => mysql_async::Value::NULL,
                        }
                    }).collect();
                    
                    for v in pk.values() {
                        match v {
                            serde_json::Value::Null => params.push(mysql_async::Value::NULL),
                            serde_json::Value::String(s) => params.push(mysql_async::Value::Bytes(s.clone().into_bytes())),
                            serde_json::Value::Number(n) => {
                                params.push(n.as_i64()
                                    .map(mysql_async::Value::Int)
                                    .or_else(|| n.as_u64().map(mysql_async::Value::UInt))
                                    .unwrap_or(mysql_async::Value::NULL));
                            }
                            serde_json::Value::Bool(b) => params.push(mysql_async::Value::Int(if *b { 1 } else { 0 })),
                            _ => params.push(mysql_async::Value::NULL),
                        }
                    }
                    
                    conn.exec_iter(&sql, params).await
                        .map_err(|e| ElevenError::Query(e.to_string()))?;
                }
                CommitOp::Delete => {
                    let pk = row.pk.as_ref()
                        .and_then(|p| p.as_object())
                        .ok_or_else(|| ElevenError::Query("Delete requires primary key".to_string()))?;
                    
                    let wheres: Vec<String> = pk.keys()
                        .map(|k| format!("`{}` = ?", k))
                        .collect();
                    
                    let sql = format!(
                        "DELETE FROM `{database}`.`{table}` WHERE {}",
                        wheres.join(" AND ")
                    );
                    
                    let params: Vec<mysql_async::Value> = pk.values().map(|v| {
                        match v {
                            serde_json::Value::Null => mysql_async::Value::NULL,
                            serde_json::Value::String(s) => mysql_async::Value::Bytes(s.clone().into_bytes()),
                            serde_json::Value::Number(n) => {
                                n.as_i64()
                                    .map(mysql_async::Value::Int)
                                    .or_else(|| n.as_u64().map(mysql_async::Value::UInt))
                                    .unwrap_or(mysql_async::Value::NULL)
                            }
                            serde_json::Value::Bool(b) => mysql_async::Value::Int(if *b { 1 } else { 0 }),
                            _ => mysql_async::Value::NULL,
                        }
                    }).collect();
                    
                    conn.exec_iter(&sql, params).await
                        .map_err(|e| ElevenError::Query(e.to_string()))?;
                }
            }
        }

        conn.commit().await
            .map_err(|e| ElevenError::Query(e.to_string()))?;

        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(rows.len() as u64),
            elapsed_ms: start.elapsed().as_millis() as u64,
            insert_id: None,
        })
    }

    /// Dump entire database
    pub async fn dump_database(&self, database: &str) -> Result<String> {
        let pool = self.pool.as_ref()
            .ok_or_else(|| ElevenError::Connection("Not connected".to_string()))?;
        let mut conn = pool.get_conn().await
            .map_err(|e| ElevenError::Connection(e.to_string()))?;

        let mut output = Vec::new();

        // Header
        use std::io::Write;
        writeln!(output, "-- Eleven DB dump").map_err(|e| ElevenError::Io(e))?;
        writeln!(output, "-- Database: `{}`", database).map_err(|e| ElevenError::Io(e))?;
        writeln!(output, "-- Generated at {}", chrono::Utc::now().to_rfc3339()).map_err(|e| ElevenError::Io(e))?;
        writeln!(output).map_err(|e| ElevenError::Io(e))?;
        writeln!(output, "SET NAMES utf8mb4;").map_err(|e| ElevenError::Io(e))?;
        writeln!(output, "SET FOREIGN_KEY_CHECKS = 0;").map_err(|e| ElevenError::Io(e))?;
        writeln!(output).map_err(|e| ElevenError::Io(e))?;

        // Tables
        let tables: Vec<String> = conn.exec_iter(
            "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
            (database,)
        ).await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .collect()
            .await
            .map_err(|e| ElevenError::Query(e.to_string()))?
            .iter()
            .filter_map(|r| r.get::<String, _>(0).ok())
            .collect();

        for table in tables {
            // DDL
            let ddl_rows: Vec<Row> = conn.exec_iter(
                &format!("SHOW CREATE TABLE `{database}`.`{table}`"),
                ()
            ).await
                .map_err(|e| ElevenError::Query(e.to_string()))?
                .collect()
                .await
                .map_err(|e| ElevenError::Query(e.to_string()))?;
            
            if let Some(row) = ddl_rows.first() {
                if let Ok(ddl) = row.get::<String, _>(1) {
                    writeln!(output, "DROP TABLE IF EXISTS `{table}`;").map_err(|e| ElevenError::Io(e))?;
                    writeln!(output, "{};", ddl).map_err(|e| ElevenError::Io(e))?;
                }
            }

            // Data
            let rows: Vec<Row> = conn.query(&format!("SELECT * FROM `{database}`.`{table}`")).await
                .map_err(|e| ElevenError::Query(e.to_string()))?;
            
            if !rows.is_empty() {
                let cols: Vec<String> = rows[0].columns().iter()
                    .map(|c| format!("`{}`", c.name_str()))
                    .collect();
                
                for chunk in rows.chunks(200) {
                    let values: Vec<String> = chunk.iter().map(|row| {
                        let vals: Vec<String> = row.columns().iter().map(|col| {
                            let v = row.get::<mysql_async::Value, _>(col.name_str()).unwrap_or(mysql_async::Value::NULL);
                            mysql_value_to_sql(&v)
                        }).collect();
                        format!("({})", vals.join(", "))
                    }).collect();
                    
                    writeln!(output, "INSERT INTO `{table}` ({}) VALUES", cols.join(", ")).map_err(|e| ElevenError::Io(e))?;
                    writeln!(output, "{};", values.join(",\n")).map_err(|e| ElevenError::Io(e))?;
                }
            }
            
            writeln!(output).map_err(|e| ElevenError::Io(e))?;
        }

        writeln!(output, "SET FOREIGN_KEY_CHECKS = 1;").map_err(|e| ElevenError::Io(e))?;

        String::from_utf8(output)
            .map_err(|e| ElevenError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
    }
}

fn mysql_value_to_sql(v: &mysql_async::Value) -> String {
    match v {
        mysql_async::Value::NULL => "NULL".to_string(),
        mysql_async::Value::Bytes(b) => {
            let s = String::from_utf8_lossy(b);
            if s.chars().all(|c| c.is_ascii_graphic() || c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                format!("'{}'", s.replace('\'', "''"))
            } else {
                format!("X'{}'", hex_encode(&b))
            }
        }
        mysql_async::Value::Int(i) => i.to_string(),
        mysql_async::Value::UInt(u) => u.to_string(),
        mysql_async::Value::Float(f) => format!("{}", f),
        mysql_async::Value::Double(d) => format!("{}", d),
        mysql_async::Value::Date(y, m, d, h, mi, s, _) => {
            format!("'{:04}-{:02}-{:02} {:02}:{:02}:{:02}'", y, m, d, h, mi, s)
        }
    }
}

fn field_definition_clause(edit: &FieldEdit) -> String {
    let field_type = edit.field_type.trim();
    if field_type.is_empty() {
        return String::new();
    }
    
    let null_clause = if edit.nullable { "NULL" } else { "NOT NULL" };
    
    let default_clause = if edit.default_is_null {
        " DEFAULT NULL".to_string()
    } else if let Some(ref def) = edit.default_value {
        if !def.is_empty() {
            let def = def.trim();
            if def.parse::<f64>().is_ok() || def.to_uppercase().contains("CURRENT_TIMESTAMP") || def.to_uppercase().contains("NOW()") {
                format!(" DEFAULT {}", def)
            } else {
                format!(" DEFAULT '{}'", def.replace('\'', "''"))
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    
    let comment_clause = if !edit.comment.is_empty() {
        format!(" COMMENT '{}'", edit.comment.replace('\'', "''"))
    } else {
        String::new()
    };
    
    format!("{} {}{}{}", field_type, null_clause, default_clause, comment_clause)
}

use std::fmt::Write as FmtWrite;

fn hex_encode(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        result.push(HEX_CHARS[(b >> 4) as usize] as char);
        result.push(HEX_CHARS[(b & 0xf) as usize] as char);
    }
    result
}
