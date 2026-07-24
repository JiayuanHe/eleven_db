/**
 * Tauri preload script - exposes API to renderer process
 * 
 * This mirrors the Electron preload.ts interface so the frontend
 * can work with both Electron and Tauri backends.
 */

import { invoke } from '@tauri-apps/api/core';
import { IPC } from './shared/ipc';
import type {
  ConnectionConfig,
  TableColumn,
  TableDetail,
  QueryResult,
  QueryHistoryItem,
  SchemaObject,
  FieldEdit,
  AlterExtras,
} from './shared/types';

// Type for the IPC result
interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// Helper to call IPC handlers
async function call<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  try {
    const result = await invoke<T>(channel, ...args);
    return { ok: true, data: result };
  } catch (error) {
    return { 
      ok: false, 
      error: { 
        code: 'ERROR', 
        message: error instanceof Error ? error.message : String(error) 
      } 
    };
  }
}

// Build the API object matching Electron's preload API
const api = {
  conn: {
    list: () => call<ConnectionConfig[]>(IPC.conn.list),
    get: (id: string) => call<ConnectionConfig>(IPC.conn.get, id),
    create: (input: any, password?: string, savePassword = true, redisPassword?: string, saveRedisPassword = true) =>
      call<ConnectionConfig>(IPC.conn.create, { input, password, savePassword, redisPassword, saveRedisPassword }),
    update: (cfg: any, password?: string, savePassword = true, redisPassword?: string, saveRedisPassword = true) =>
      call<ConnectionConfig>(IPC.conn.update, { cfg, password, savePassword, redisPassword, saveRedisPassword }),
    remove: (id: string) => call<boolean>(IPC.conn.remove, id),
    duplicate: (id: string) => call<ConnectionConfig>(IPC.conn.duplicate, id),
    test: (input: any, password?: string, redisPassword?: string) =>
      call<{ ok: boolean; latencyMs: number }>(IPC.conn.test, { input, password, redisPassword }),
    resolve: (id: string, password?: string) =>
      call<{ kind: string; isAlive: boolean }>(IPC.conn.resolve, { id, password }),
    listObjects: (id: string, database?: string, password?: string, redisPassword?: string) =>
      call<SchemaObject[]>(IPC.conn.listObjects, { id, database, password, redisPassword }),
  },
  sql: {
    execute: (id: string, sql: string, password?: string) =>
      call<QueryResult>(IPC.sql.execute, { id, password, sql }),
    buildUpdate: (args: {
      table: string;
      primaryKeys: string[];
      oldRow: Record<string, unknown>;
      newRow: Record<string, unknown>;
    }) => call<string>(IPC.sql.buildUpdate, args),
    history: {
      list: (limit?: number) => call<QueryHistoryItem[]>(IPC.sql.history.list, limit),
      clear: () => call<boolean>(IPC.sql.history.clear),
    },
  },
  table: {
    schema: (id: string, database: string, table: string, password?: string) =>
      call<TableColumn[]>(IPC.table.schema, { id, password, database, table }),
    data: (args: {
      id: string;
      database: string;
      table: string;
      page?: number;
      pageSize?: number;
      orderBy?: string;
      orderDir?: 'ASC' | 'DESC';
      where?: string;
      password?: string;
    }) => call<QueryResult>(IPC.table.data, args),
    commit: (args: {
      id: string;
      database: string;
      table: string;
      rows: any[];
      password?: string;
    }) => call<QueryResult>(IPC.table.commit, args),
    exportAll: (args: {
      id: string;
      database: string;
      table: string;
      where?: string;
      password?: string;
    }) => call<QueryResult>(IPC.table.exportAll, args),
    detail: (id: string, database: string, table: string, password?: string) =>
      call<TableDetail>(IPC.table.detail, { id, password, database, table }),
    alter: (args: {
      id: string;
      database: string;
      table: string;
      edits: FieldEdit[];
      extras?: AlterExtras;
      password?: string;
    }) => call<QueryResult>(IPC.table.alter, args),
  },
  redis: {
    listDatabases: (id: string, password?: string) =>
      call<number[]>(IPC.redis.listDatabases, { id, password }),
    listKeys: (args: { id: string; database: number; pattern?: string; cursor?: number; count?: number; password?: string }) =>
      call<{ keys: string[]; nextCursor: number }>(IPC.redis.listKeys, args),
    describeKey: (id: string, database: number, key: string, password?: string) =>
      call<{ name: string; type: string; ttl: number; encoding?: string; size?: number }>(IPC.redis.describeKey, { id, database, key, password }),
    getValue: (id: string, database: number, key: string, type: string, password?: string) =>
      call<{
        key: string; type: string;
        stringValue?: string;
        hashValue?: Array<[string, string]>;
        listValue?: string[];
        setValue?: string[];
        zsetValue?: Array<{ member: string; score: number }>;
      }>(IPC.redis.getValue, { id, database, key, type, password }),
    setValue: (args: {
      id: string; database: number; key: string; type: string;
      data: any; ttlSec?: number; password?: string;
    }) => call<boolean>(IPC.redis.setValue, args),
    expire: (id: string, database: number, key: string, ttlSec: number, password?: string) =>
      call<boolean>(IPC.redis.expire, { id, database, key, ttlSec, password }),
    persist: (id: string, database: number, key: string, password?: string) =>
      call<boolean>(IPC.redis.persist, { id, database, key, password }),
    rename: (id: string, database: number, oldName: string, newName: string, password?: string) =>
      call<boolean>(IPC.redis.rename, { id, database, oldName, newName, password }),
    del: (id: string, database: number, key: string, password?: string) =>
      call<number>(IPC.redis.del, { id, database, key, password }),
    runCommand: (id: string, database: number, command: string, args: string[], password?: string) =>
      call<unknown>(IPC.redis.runCommand, { id, database, command, args, password }),
  },
  exportCsv: (defaultName: string, csv: string) =>
    call<string | false>(IPC.export.csv, { defaultName, csv }),
  exportSql: (defaultName: string, sql: string) =>
    call<string | false>(IPC.export.sql, { defaultName, sql }),
  pickFile: (ext: 'csv' | 'sql') =>
    call<string | false>(IPC.import.pickFile, ext),
  readFile: (path: string) =>
    call<string>(IPC.import.readFile, path),
  dumpDatabase: (args: { id: string; database: string; password?: string }) =>
    call<string>(IPC.dump.database, args),
  execSql: (args: { id: string; sql: string; password?: string }) =>
    call<{ executed: number }>(IPC.dump.execSql, args),
  app: {
    version: () => call<string>(IPC.app.version),
  },
};

// Expose to window
Object.defineProperty(window, 'api', {
  value: api,
  writable: false,
  configurable: false,
});

export type ElevenApi = typeof api;
