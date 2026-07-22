import { ipcMain, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { IPC } from '../shared/ipc';
import type { IpcResult } from '../shared/types';
import { connectionManager } from './connection-manager';
import { connectionStore, historyStore } from './stores/store';
import { secretStore } from './stores/secrets';

/**
 * 全部 IPC 路由集中在这里。渲染层通过 preload 暴露的有限 API 调用。
 *
 * 统一返回 IpcResult<T>：{ ok, data?, error? }。渲染层用 lib/api 统一拆包。
 */

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}
function fail(err: unknown): IpcResult<never> {
  if (err instanceof Error) {
    return { ok: false, error: { code: (err as any).code ?? 'ERR', message: err.message } };
  }
  return { ok: false, error: { code: 'ERR', message: String(err) } };
}

export function registerIpc(): void {
  // ---------- 连接管理 ----------

  ipcMain.handle(IPC.conn.list, async () => {
    try {
      return ok(connectionStore.list());
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.get, async (_e, id: string) => {
    try {
      const cfg = connectionStore.get(id);
      if (!cfg) throw new Error('连接不存在');
      // 重要：返回时不带 passwordCipher 明文，前端 UI 需要密码时调 resolve
      const { passwordCipher, ...safe } = cfg;
      void passwordCipher;
      return ok(safe);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.create, async (_e, args: {
    input: Parameters<typeof connectionManager.buildConfig>[0];
    password?: string;
    savePassword?: boolean;
    redisPassword?: string;
    saveRedisPassword?: boolean;
  }) => {
    try {
      const cfg = connectionManager.buildConfig(args.input);
      let cipher: string | undefined;
      if (args.savePassword && args.password) {
        cipher = secretStore.encrypt(args.password);
      }
      let redisCipher: string | undefined;
      if (args.saveRedisPassword && args.redisPassword) {
        redisCipher = secretStore.encrypt(args.redisPassword);
      }
      connectionStore.create(cfg, cipher, redisCipher);
      return ok(cfg);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.update, async (_e, args: {
    cfg: Parameters<typeof connectionManager.buildConfig>[0] & { id: string };
    password?: string;
    savePassword?: boolean;
    redisPassword?: string;
    saveRedisPassword?: boolean;
  }) => {
    try {
      const prev = connectionStore.get(args.cfg.id);
      if (!prev) throw new Error('连接不存在');
      const merged = connectionManager.buildConfig({ ...prev, ...args.cfg });
      let cipher: string | undefined;
      if (args.savePassword && args.password) {
        cipher = secretStore.encrypt(args.password);
      }
      let redisCipher: string | undefined;
      if (args.saveRedisPassword && args.redisPassword) {
        redisCipher = secretStore.encrypt(args.redisPassword);
      }
      // 用户没填新密码时，保留旧 cipher
      const prevCipher = cipher ? undefined : connectionStore.getPasswordCipher(args.cfg.id);
      const prevRedisCipher = redisCipher
        ? undefined
        : connectionStore.getRedisPasswordCipher(args.cfg.id);
      connectionStore.update(merged, cipher ?? prevCipher, redisCipher ?? prevRedisCipher);
      // 重连
      await connectionManager.close(args.cfg.id);
      return ok(merged);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.remove, async (_e, id: string) => {
    try {
      await connectionManager.close(id);
      connectionStore.remove(id);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.duplicate, async (_e, id: string) => {
    try {
      const prev = connectionStore.get(id);
      if (!prev) throw new Error('连接不存在');
      const prevCipher = connectionStore.getPasswordCipher(id);
      const prevRedisCipher = connectionStore.getRedisPasswordCipher(id);
      const copy = connectionManager.buildConfig({
        ...prev,
        name: `${prev.name} (副本)`,
      });
      connectionStore.create(copy, prevCipher, prevRedisCipher);
      return ok(copy);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.test, async (_e, args: {
    input: Parameters<typeof connectionManager.buildConfig>[0];
    password?: string;
    redisPassword?: string;
  }) => {
    try {
      const cfg = connectionManager.buildConfig(args.input);
      const start = Date.now();
      if (cfg.kind === 'redis') {
        const { createRedisDriver } = await import('./drivers/redis-factory');
        const driver = createRedisDriver(cfg, args.redisPassword ?? '');
        await driver.connect();
        await driver.runCommand(cfg.redis!.db, 'PING', []);
        const latencyMs = Date.now() - start;
        await driver.close();
        return ok({ ok: true, latencyMs });
      }
      // SQL 路径
      const { createDriver } = await import('./drivers');
      const driver = createDriver(cfg, args.password ?? '');
      await driver.connect();
      await driver.execute('SELECT 1');
      const latencyMs = Date.now() - start;
      await driver.close();
      return ok({ ok: true, latencyMs });
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.resolve, async (_e, args: { id: string; password?: string }) => {
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const meta = {
        kind: driver.kind,
        isAlive: driver.isAlive(),
      };
      return ok(meta);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.conn.listObjects, async (_e, args: { id: string; password?: string; database?: string; redisPassword?: string }) => {
    try {
      const raw = connectionStore.getRaw(args.id);
      if (raw?.kind === 'redis') {
        const driver = await connectionManager.openRedis(args.id, args.redisPassword);
        const dbs = await driver.listDatabases();
        // 复用 SchemaObject 形状，type='table' 占位（表示"可展开"）
        return ok(
          dbs.map((d) => ({
            name: `db${d}`,
            type: 'table' as const,
            schema: String(d),
          })),
        );
      }
      const driver = await connectionManager.open(args.id, args.password);
      const list = await driver.listObjects({ database: args.database });
      return ok(list);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------- SQL ----------

  ipcMain.handle(IPC.sql.execute, async (_e, args: { id: string; password?: string; sql: string }) => {
    const start = Date.now();
    const historyId = randomUUID();
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const result = await driver.execute(args.sql);
      historyStore.push({
        id: historyId,
        connectionId: args.id,
        sql: args.sql,
        elapsedMs: result.elapsedMs,
        rows: result.rows.length,
        success: true,
        executedAt: Date.now(),
      });
      return ok(result);
    } catch (e) {
      historyStore.push({
        id: historyId,
        connectionId: args.id,
        sql: args.sql,
        elapsedMs: Date.now() - start,
        rows: 0,
        success: false,
        error: (e as Error).message,
        executedAt: Date.now(),
      });
      return fail(e);
    }
  });

  ipcMain.handle(IPC.sql.buildUpdate, async (_e, args: { table: string; primaryKeys: string[]; oldRow: Record<string, unknown>; newRow: Record<string, unknown> }) => {
    try {
      const sets = Object.keys(args.newRow)
        .filter((k) => JSON.stringify(args.newRow[k]) !== JSON.stringify(args.oldRow[k]))
        .map((k) => `\`${k}\` = ${sqlValue(args.newRow[k])}`)
        .join(', ');
      const wheres = args.primaryKeys
        .map((k) => `\`${k}\` = ${sqlValue(args.oldRow[k])}`)
        .join(' AND ');
      const sql = `UPDATE \`${args.table}\` SET ${sets} WHERE ${wheres};`;
      return ok(sql);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.sql.history.list, async (_e, limit: number | undefined) => {
    try {
      return ok(historyStore.list(limit ?? 200));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.sql.history.clear, async () => {
    try {
      historyStore.clear();
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------- 表浏览 / 网格编辑 ----------

  ipcMain.handle(IPC.table.schema, async (_e, args: { id: string; password?: string; database: string; table: string }) => {
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const cols = await driver.getTableSchema(args.database, args.table);
      return ok(cols);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.table.data, async (_e, args: {
    id: string;
    password?: string;
    database: string;
    table: string;
    pageSize?: number;
    page?: number;
    orderBy?: string;
    orderDir?: 'ASC' | 'DESC';
    where?: string;
  }) => {
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const result = await driver.fetchData({
        database: args.database,
        table: args.table,
        pageSize: args.pageSize,
        page: args.page,
        orderBy: args.orderBy,
        orderDir: args.orderDir,
        where: args.where,
      });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.table.commit, async (_e, args: {
    id: string;
    password?: string;
    database: string;
    table: string;
    rows: import('./drivers/types').CommitRow[];
  }) => {
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const result = await driver.commit({
        database: args.database,
        table: args.table,
        rows: args.rows,
      });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.table.exportAll, async (_e, args: {
    id: string;
    password?: string;
    database: string;
    table: string;
    where?: string;
  }) => {
    try {
      const driver = await connectionManager.open(args.id, args.password);
      const result = await driver.fetchAll({ database: args.database, table: args.table, where: args.where });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------- Redis ----------

  ipcMain.handle(IPC.redis.listDatabases, async (_e, args: { id: string; password?: string }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const dbs = await driver.listDatabases();
      return ok(dbs);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.listKeys, async (_e, args: { id: string; password?: string; database: number; pattern?: string; cursor?: number; count?: number }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const result = await driver.listKeys({
        database: args.database,
        pattern: args.pattern,
        cursor: args.cursor,
        count: args.count,
      });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.describeKey, async (_e, args: { id: string; password?: string; database: number; key: string }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const info = await driver.describeKey(args.database, args.key);
      return ok(info);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.getValue, async (_e, args: { id: string; password?: string; database: number; key: string; type: import('./drivers/redis-types').RedisKeyType }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const v = await driver.getValue(args.database, args.key, args.type);
      return ok(v);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.setValue, async (_e, args: {
    id: string; password?: string;
    database: number; key: string;
    type: import('./drivers/redis-types').RedisKeyType;
    data: Omit<import('./drivers/redis-types').RedisKeyValue, 'key' | 'type'>;
    ttlSec?: number;
  }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      await driver.setValue(args.database, args.key, args.type, args.data, args.ttlSec);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.expire, async (_e, args: { id: string; password?: string; database: number; key: string; ttlSec: number }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      await driver.expireKey(args.database, args.key, args.ttlSec);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.persist, async (_e, args: { id: string; password?: string; database: number; key: string }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      await driver.persistKey(args.database, args.key);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.rename, async (_e, args: { id: string; password?: string; database: number; oldName: string; newName: string }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      await driver.renameKey(args.database, args.oldName, args.newName);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.del, async (_e, args: { id: string; password?: string; database: number; key: string }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const n = await driver.deleteKey(args.database, args.key);
      return ok(n);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle(IPC.redis.runCommand, async (_e, args: { id: string; password?: string; database: number; command: string; args: string[] }) => {
    try {
      const driver = await connectionManager.openRedis(args.id, args.password);
      const r = await driver.runCommand(args.database, args.command, args.args);
      return ok(r);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------- 导出 ----------

  ipcMain.handle(IPC.export.csv, async (_e, args: {
    defaultName: string;
    csv: string;
  }) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '导出 CSV',
        defaultPath: args.defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return ok(false);
      // 加 BOM 让 Excel 正确识别 UTF-8
      fs.writeFileSync(result.filePath, '﻿' + args.csv, 'utf-8');
      return ok(result.filePath);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------- 应用信息 ----------
  ipcMain.handle(IPC.app.version, async () => {
    try {
      return ok(process.versions.electron ?? 'unknown');
    } catch (e) {
      return fail(e);
    }
  });
}

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  // 转义单引号
  return `'${String(v).replace(/'/g, "''")}'`;
}