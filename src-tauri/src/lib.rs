//! Eleven DB - Rust Backend Library
//! 
//! Core modules for database client functionality using Tauri.

mod error;
mod types;
mod connection_manager;
mod drivers;
mod stores;
mod commands;
mod crypto;

pub use error::*;
pub use types::*;
pub use connection_manager::ConnectionManager;
pub use stores::ConnectionStore;
pub use commands::*;

/// Initialize and run the Tauri application
pub fn run() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    
    log::info!("Starting Eleven DB v{}", env!("CARGO_PKG_VERSION"));
    
    // Initialize application state
    let store = ConnectionStore::new()
        .expect("Failed to initialize connection store");
    let connection_manager = ConnectionManager::new(store);
    
    let app_state = commands::AppState {
        connection_manager: std::sync::Arc::new(tokio::sync::Mutex::new(connection_manager)),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Connection management
            commands::list_connections,
            commands::get_connection,
            commands::create_connection,
            commands::update_connection,
            commands::remove_connection,
            commands::duplicate_connection,
            commands::test_connection,
            commands::resolve_connection,
            commands::list_objects,
            
            // SQL operations
            commands::execute_sql,
            commands::build_update_sql,
            commands::list_history,
            commands::clear_history,
            
            // Table operations
            commands::get_table_schema,
            commands::get_table_data,
            commands::commit_table,
            commands::get_table_detail,
            commands::alter_table,
            
            // Redis operations
            commands::redis_list_databases,
            commands::redis_list_keys,
            commands::redis_describe_key,
            commands::redis_get_value,
            commands::redis_set_value,
            commands::redis_expire,
            commands::redis_persist,
            commands::redis_rename,
            commands::redis_delete,
            commands::redis_run_command,
            
            // Import/Export
            commands::dump_database,
            commands::export_csv,
            commands::export_sql,
            
            // Application
            commands::get_version,
        ])
        .setup(|app| {
            log::info!("Eleven DB initialized successfully");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested, shutting down...");
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running Eleven DB");
}
