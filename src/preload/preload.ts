import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  ConnectionConfig,
  IpcResult,
  QueryHistoryItem,
  QueryResult,
  SchemaObject,
  TableColumn,
} from '../shared/types';

/**
 * contextBridge：把 IPC 包装成有类型的 window.api.* 暴露给渲染层。
 * 渲染层不允许直接访问 Node/Electron API。
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>;

const api = {
  conn: {
    list: () => invoke<ConnectionConfig[]>(IPC.conn.list),
    get: (id: string) => invoke<ConnectionConfig>(IPC.conn.get, id),
    create: (input: any, password?: string, savePassword = true, redisPassword?: string, saveRedisPassword = true) =>
      invoke<ConnectionConfig>(IPC.conn.create, { input, password, savePassword, redisPassword, saveRedisPassword }),
    update: (cfg: any, password?: string, savePassword = true, redisPassword?: string, saveRedisPassword = true) =>
      invoke<ConnectionConfig>(IPC.conn.update, { cfg, password, savePassword, redisPassword, saveRedisPassword }),
    remove: (id: string) => invoke<boolean>(IPC.conn.remove, id),
    duplicate: (id: string) => invoke<ConnectionConfig>(IPC.conn.duplicate, id),
    test: (input: any, password?: string, redisPassword?: string) =>
      invoke<{ ok: boolean; latencyMs: number }>(IPC.conn.test, { input, password, redisPassword }),
    resolve: (id: string, password?: string) =>
      invoke<{ kind: string; isAlive: boolean }>(IPC.conn.resolve, { id, password }),
    listObjects: (id: string, database?: string, password?: string, redisPassword?: string) =>
      invoke<SchemaObject[]>(IPC.conn.listObjects, { id, database, password, redisPassword }),
  },
  sql: {
    execute: (id: string, sql: string, password?: string) =>
      invoke<QueryResult>(IPC.sql.execute, { id, password, sql }),
    buildUpdate: (args: {
      table: string;
      primaryKeys: string[];
      oldRow: Record<string, unknown>;
      newRow: Record<string, unknown>;
    }) => invoke<string>(IPC.sql.buildUpdate, args),
    history: {
      list: (limit?: number) => invoke<QueryHistoryItem[]>(IPC.sql.history.list, limit),
      clear: () => invoke<boolean>(IPC.sql.history.clear),
    },
  },
  table: {
    schema: (id: string, database: string, table: string, password?: string) =>
      invoke<TableColumn[]>(IPC.table.schema, { id, password, database, table }),
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
    }) => invoke<QueryResult>(IPC.table.data, args),
    commit: (args: {
      id: string;
      database: string;
      table: string;
      rows: any[];
      password?: string;
    }) => invoke<QueryResult>(IPC.table.commit, args),
  },
  redis: {
    listDatabases: (id: string, password?: string) =>
      invoke<number[]>(IPC.redis.listDatabases, { id, password }),
    listKeys: (args: { id: string; database: number; pattern?: string; cursor?: number; count?: number; password?: string }) =>
      invoke<{ keys: string[]; nextCursor: number }>(IPC.redis.listKeys, args),
    describeKey: (id: string, database: number, key: string, password?: string) =>
      invoke<{ name: string; type: string; ttl: number; encoding?: string; size?: number }>(IPC.redis.describeKey, { id, database, key, password }),
    getValue: (id: string, database: number, key: string, type: string, password?: string) =>
      invoke<{
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
    }) => invoke<boolean>(IPC.redis.setValue, args),
    expire: (id: string, database: number, key: string, ttlSec: number, password?: string) =>
      invoke<boolean>(IPC.redis.expire, { id, database, key, ttlSec, password }),
    persist: (id: string, database: number, key: string, password?: string) =>
      invoke<boolean>(IPC.redis.persist, { id, database, key, password }),
    rename: (id: string, database: number, oldName: string, newName: string, password?: string) =>
      invoke<boolean>(IPC.redis.rename, { id, database, oldName, newName, password }),
    del: (id: string, database: number, key: string, password?: string) =>
      invoke<number>(IPC.redis.del, { id, database, key, password }),
    runCommand: (id: string, database: number, command: string, args: string[], password?: string) =>
      invoke<unknown>(IPC.redis.runCommand, { id, database, command, args, password }),
  },
  exportCsv: (defaultName: string, csv: string) =>
    invoke<string | false>(IPC.export.csv, { defaultName, csv }),
  app: {
    version: () => invoke<string>(IPC.app.version),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElevenApi = typeof api;