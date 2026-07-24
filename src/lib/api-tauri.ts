/**
 * Tauri IPC adapter for Eleven DB frontend
 * 
 * This module provides the same API interface as the Electron version,
 * allowing the frontend to work with both Electron and Tauri backends.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
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
} from './types';

// ============================================================================
// Connection Management
// ============================================================================

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke('list_connections');
}

export async function getConnection(id: string): Promise<ConnectionConfig | null> {
  return invoke('get_connection', { id });
}

export async function createConnection(
  input: BuildConfigInput,
  password?: string,
  savePassword?: boolean,
  redisPassword?: string,
  saveRedisPassword?: boolean
): Promise<ConnectionConfig> {
  return invoke('create_connection', {
    input,
    password,
    savePassword: savePassword ?? false,
    redisPassword,
    saveRedisPassword: saveRedisPassword ?? false,
  });
}

export async function updateConnection(
  input: BuildConfigInput & { id: string },
  password?: string,
  savePassword?: boolean,
  redisPassword?: string,
  saveRedisPassword?: boolean
): Promise<ConnectionConfig> {
  return invoke('update_connection', {
    input,
    password,
    savePassword: savePassword ?? false,
    redisPassword,
    saveRedisPassword: saveRedisPassword ?? false,
  });
}

export async function removeConnection(id: string): Promise<boolean> {
  return invoke('remove_connection', { id });
}

export async function duplicateConnection(id: string): Promise<ConnectionConfig> {
  return invoke('duplicate_connection', { id });
}

export async function testConnection(
  input: BuildConfigInput,
  password?: string,
  redisPassword?: string
): Promise<TestResult> {
  return invoke('test_connection', { input, password, redisPassword });
}

export async function resolveConnection(
  id: string,
  password?: string
): Promise<{ kind: string; isAlive: boolean }> {
  return invoke('resolve_connection', { id, password });
}

export async function listObjects(
  id: string,
  password?: string,
  database?: string,
  redisPassword?: string
): Promise<SchemaObject[]> {
  return invoke('list_objects', { id, password, database, redisPassword });
}

// ============================================================================
// SQL Operations
// ============================================================================

export async function executeSql(
  id: string,
  password: string,
  sql: string
): Promise<QueryResult> {
  return invoke('execute_sql', { id, password, sql });
}

export async function buildUpdateSql(
  table: string,
  primaryKeys: string[],
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Promise<string> {
  return invoke('build_update_sql', { table, primaryKeys, oldRow, newRow });
}

export async function listHistory(limit?: number): Promise<QueryHistoryItem[]> {
  return invoke('list_history', { limit });
}

export async function clearHistory(): Promise<boolean> {
  return invoke('clear_history');
}

// ============================================================================
// Table Operations
// ============================================================================

export async function getTableSchema(
  id: string,
  password: string,
  database: string,
  table: string
): Promise<TableColumn[]> {
  return invoke('get_table_schema', { id, password, database, table });
}

export async function getTableData(options: {
  id: string;
  password: string;
  database: string;
  table: string;
  pageSize?: number;
  page?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  where?: string;
}): Promise<QueryResult> {
  return invoke('get_table_data', options);
}

export async function commitTable(options: {
  id: string;
  password: string;
  database: string;
  table: string;
  rows: CommitRow[];
}): Promise<QueryResult> {
  return invoke('commit_table', options);
}

export async function getTableDetail(
  id: string,
  password: string,
  database: string,
  table: string
): Promise<TableDetail> {
  return invoke('get_table_detail', { id, password, database, table });
}

export async function alterTable(options: {
  id: string;
  password: string;
  database: string;
  table: string;
  edits: FieldEdit[];
  extras?: AlterExtras;
}): Promise<QueryResult> {
  return invoke('alter_table', options);
}

// ============================================================================
// Redis Operations
// ============================================================================

export async function redisListDatabases(id: string, password?: string): Promise<number[]> {
  return invoke('redis_list_databases', { id, password });
}

export async function redisListKeys(options: {
  id: string;
  password?: string;
  database?: number;
  pattern?: string;
  cursor?: number;
  count?: number;
}): Promise<ListKeysResult> {
  return invoke('redis_list_keys', options);
}

export async function redisDescribeKey(
  id: string,
  password: string,
  database: number,
  key: string
): Promise<RedisKeyInfo> {
  return invoke('redis_describe_key', { id, password, database, key });
}

export async function redisGetValue(
  id: string,
  password: string,
  database: number,
  key: string,
  type: string
): Promise<RedisKeyValue> {
  return invoke('redis_get_value', { id, password, database, key, keyType: type });
}

export async function redisSetValue(options: {
  id: string;
  password: string;
  database: number;
  key: string;
  type: string;
  data: Record<string, unknown>;
  ttlSec?: number;
}): Promise<boolean> {
  return invoke('redis_set_value', options);
}

export async function redisExpire(
  id: string,
  password: string,
  database: number,
  key: string,
  ttlSec: number
): Promise<boolean> {
  return invoke('redis_expire', { id, password, database, key, ttlSec });
}

export async function redisPersist(
  id: string,
  password: string,
  database: number,
  key: string
): Promise<boolean> {
  return invoke('redis_persist', { id, password, database, key });
}

export async function redisRename(
  id: string,
  password: string,
  database: number,
  oldName: string,
  newName: string
): Promise<boolean> {
  return invoke('redis_rename', { id, password, database, oldName, newName });
}

export async function redisDelete(
  id: string,
  password: string,
  database: number,
  key: string
): Promise<number> {
  return invoke('redis_delete', { id, password, database, key });
}

export async function redisRunCommand(
  id: string,
  password: string,
  database: number,
  command: string,
  args: string[]
): Promise<unknown> {
  return invoke('redis_run_command', { id, password, database, command, args });
}

// ============================================================================
// Import/Export
// ============================================================================

export async function dumpDatabase(
  id: string,
  password: string,
  database: string
): Promise<string> {
  return invoke('dump_database', { id, password, database });
}

export async function exportCsv(contents: string): Promise<string | null> {
  return invoke('export_csv', { contents });
}

export async function exportSql(contents: string): Promise<string | null> {
  return invoke('export_sql', { contents });
}

// ============================================================================
// Application
// ============================================================================

export async function getVersion(): Promise<string> {
  return invoke('get_version');
}

// ============================================================================
// Type Definitions (must match Rust backend)
// ============================================================================

interface BuildConfigInput {
  id?: string;
  name: string;
  kind: 'mysql' | 'oracle' | 'redis';
  host: string;
  port: number;
  username: string;
  database?: string;
  serviceName?: string;
  sid?: string;
  tns?: string;
  charset?: string;
  timeoutMs?: number;
  redis?: RedisConfig;
  group?: string;
  color?: string;
}

interface RedisConfig {
  mode: 'single' | 'sentinel' | 'cluster';
  db: number;
  username?: string;
  password?: string;
  passwordCipher?: string;
  sentinelName?: string;
  sentinelNodes?: string[];
  clusterNodes?: string[];
}

interface CommitRow {
  op: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  pk?: Record<string, unknown>;
}

interface FieldEdit {
  originalName?: string;
  op: 'add' | 'drop' | 'modify' | 'change';
  newName?: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  defaultIsNull: boolean;
  comment: string;
  isPrimary: boolean;
}

interface AlterExtras {
  dropPrimary: string[];
}

// Re-export types from types.ts
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
};
