/// <reference types="vite/client" />

// Type definitions for Eleven DB API (works with both Electron and Tauri)

interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ConnectionConfig {
  id: string;
  name: string;
  kind: 'mysql' | 'oracle' | 'redis';
  host: string;
  port: number;
  username: string;
  passwordCipher?: string;
  database?: string;
  serviceName?: string;
  sid?: string;
  tns?: string;
  charset?: string;
  timeoutMs?: number;
  redis?: RedisConfig;
  ssh?: SshConfig;
  group?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
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

interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

interface SchemaObject {
  name: string;
  type: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'index' | 'database';
  schema?: string;
}

interface TableColumn {
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  isPrimary: boolean;
  defaultValue?: string;
  comment?: string;
}

interface TableDetail {
  database: string;
  table: string;
  ddl: string;
  fields: TableFieldDetail[];
  tableComment: string;
  engine?: string;
  charset?: string;
  autoIncrement?: number;
}

interface TableFieldDetail {
  name: string;
  rawType: string;
  nullable: boolean;
  defaultValue: string | null;
  defaultIsNull: boolean;
  comment: string;
  isPrimary: boolean;
}

interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  elapsedMs: number;
  insertId?: number;
}

interface QueryHistoryItem {
  id: string;
  connectionId: string;
  sql: string;
  elapsedMs: number;
  rows: number;
  executedAt: number;
  success: boolean;
  error?: string;
}

interface RedisKeyInfo {
  name: string;
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'unknown';
  ttl: number;
  size?: number;
}

interface RedisKeyValue {
  key: string;
  type: string;
  stringValue?: string;
  hashValue?: Array<[string, string]>;
  listValue?: string[];
  setValue?: string[];
  zsetValue?: Array<{ member: string; score: number }>;
  streamValue?: Array<{ id: string; fields: Array<[string, string]> }>;
}

interface ListKeysResult {
  keys: string[];
  nextCursor: number;
}

interface TestResult {
  ok: boolean;
  latencyMs?: number;
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

// API interface matching preload.ts
interface ElevenApi {
  conn: {
    list: () => Promise<IpcResult<ConnectionConfig[]>>;
    get: (id: string) => Promise<IpcResult<ConnectionConfig>>;
    create: (input: any, password?: string, savePassword?: boolean, redisPassword?: string, saveRedisPassword?: boolean) => Promise<IpcResult<ConnectionConfig>>;
    update: (cfg: any, password?: string, savePassword?: boolean, redisPassword?: string, saveRedisPassword?: boolean) => Promise<IpcResult<ConnectionConfig>>;
    remove: (id: string) => Promise<IpcResult<boolean>>;
    duplicate: (id: string) => Promise<IpcResult<ConnectionConfig>>;
    test: (input: any, password?: string, redisPassword?: string) => Promise<IpcResult<{ ok: boolean; latencyMs: number }>>;
    resolve: (id: string, password?: string) => Promise<IpcResult<{ kind: string; isAlive: boolean }>>;
    listObjects: (id: string, database?: string, password?: string, redisPassword?: string) => Promise<IpcResult<SchemaObject[]>>;
  };
  sql: {
    execute: (id: string, sql: string, password?: string) => Promise<IpcResult<QueryResult>>;
    buildUpdate: (args: { table: string; primaryKeys: string[]; oldRow: Record<string, unknown>; newRow: Record<string, unknown> }) => Promise<IpcResult<string>>;
    history: {
      list: (limit?: number) => Promise<IpcResult<QueryHistoryItem[]>>;
      clear: () => Promise<IpcResult<boolean>>;
    };
  };
  table: {
    schema: (id: string, database: string, table: string, password?: string) => Promise<IpcResult<TableColumn[]>>;
    data: (args: { id: string; database: string; table: string; page?: number; pageSize?: number; orderBy?: string; orderDir?: 'ASC' | 'DESC'; where?: string; password?: string }) => Promise<IpcResult<QueryResult>>;
    commit: (args: { id: string; database: string; table: string; rows: CommitRow[]; password?: string }) => Promise<IpcResult<QueryResult>>;
    exportAll: (args: { id: string; database: string; table: string; where?: string; password?: string }) => Promise<IpcResult<QueryResult>>;
    detail: (id: string, database: string, table: string, password?: string) => Promise<IpcResult<TableDetail>>;
    alter: (args: { id: string; database: string; table: string; edits: FieldEdit[]; extras?: AlterExtras; password?: string }) => Promise<IpcResult<QueryResult>>;
  };
  redis: {
    listDatabases: (id: string, password?: string) => Promise<IpcResult<number[]>>;
    listKeys: (args: { id: string; database: number; pattern?: string; cursor?: number; count?: number; password?: string }) => Promise<IpcResult<{ keys: string[]; nextCursor: number }>>;
    describeKey: (id: string, database: number, key: string, password?: string) => Promise<IpcResult<{ name: string; type: string; ttl: number; encoding?: string; size?: number }>>;
    getValue: (id: string, database: number, key: string, type: string, password?: string) => Promise<IpcResult<RedisKeyValue>>;
    setValue: (args: { id: string; database: number; key: string; type: string; data: any; ttlSec?: number; password?: string }) => Promise<IpcResult<boolean>>;
    expire: (id: string, database: number, key: string, ttlSec: number, password?: string) => Promise<IpcResult<boolean>>;
    persist: (id: string, database: number, key: string, password?: string) => Promise<IpcResult<boolean>>;
    rename: (id: string, database: number, oldName: string, newName: string, password?: string) => Promise<IpcResult<boolean>>;
    del: (id: string, database: number, key: string, password?: string) => Promise<IpcResult<number>>;
    runCommand: (id: string, database: number, command: string, args: string[], password?: string) => Promise<IpcResult<unknown>>;
  };
  exportCsv: (defaultName: string, csv: string) => Promise<IpcResult<string | false>>;
  exportSql: (defaultName: string, sql: string) => Promise<IpcResult<string | false>>;
  pickFile: (ext: 'csv' | 'sql') => Promise<IpcResult<string | false>>;
  readFile: (path: string) => Promise<IpcResult<string>>;
  dumpDatabase: (args: { id: string; database: string; password?: string }) => Promise<IpcResult<string>>;
  execSql: (args: { id: string; sql: string; password?: string }) => Promise<IpcResult<{ executed: number }>>;
  app: {
    version: () => Promise<IpcResult<string>>;
  };
}

declare global {
  interface Window {
    api: ElevenApi;
  }
}

export {};
