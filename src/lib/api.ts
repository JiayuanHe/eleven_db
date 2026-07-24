/**
 * API layer abstraction for Eleven DB
 * 
 * Automatically selects the appropriate backend (Electron or Tauri)
 * based on the runtime environment.
 */

import * as electronApi from './api-electron';
import * as tauriApi from './api-tauri';

// Detect runtime environment
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

const api = isTauri ? tauriApi : electronApi;

export const {
  // Connection management
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  removeConnection,
  duplicateConnection,
  testConnection,
  resolveConnection,
  listObjects,
  
  // SQL operations
  executeSql,
  buildUpdateSql,
  listHistory,
  clearHistory,
  
  // Table operations
  getTableSchema,
  getTableData,
  commitTable,
  getTableDetail,
  alterTable,
  
  // Redis operations
  redisListDatabases,
  redisListKeys,
  redisDescribeKey,
  redisGetValue,
  redisSetValue,
  redisExpire,
  redisPersist,
  redisRename,
  redisDelete,
  redisRunCommand,
  
  // Import/Export
  dumpDatabase,
  exportCsv,
  exportSql,
  
  // Application
  getVersion,
} = api;

export type {
  ConnectionConfig,
  QueryResult,
  TableColumn,
  TableDetail,
  SchemaObject,
  QueryHistoryItem,
  RedisKeyInfo,
  RedisKeyValue,
  ListKeysResult,
  TestResult,
} from './api-tauri';
