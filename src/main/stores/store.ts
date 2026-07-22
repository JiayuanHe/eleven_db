import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type {
  ConnectionConfig,
  QueryHistoryItem,
} from '../../shared/types';

/**
 * JSON 文件持久化。V0.1：本地 JSON 文件。
 *
 * 为什么不是 SQLite：better-sqlite3 是 native 模块，Windows 上没装 VS Build Tools
 * 的人会装不上。V0.1 数据量（≤10 个连接配置 + ≤200 条历史，每条几 KB）
 * 完全够用 JSON。
 *
 * V2.0：实现云端版本替换该文件即可，调用方不动。
 * 若真需要本地 SQL：换 sql.js（纯 WASM）或 Node 22+ 内置 node:sqlite。
 */

interface StoreShape {
  connections: Array<ConnectionConfig & {
    _passwordCipher?: string;
    _redisPasswordCipher?: string;
  }>;
  history: QueryHistoryItem[];
  recent: { connectionId: string; lastUsedAt: number }[];
}

function defaultStore(): StoreShape {
  return { connections: [], history: [], recent: [] };
}

let cache: StoreShape | null = null;
let filePath: string | null = null;

function getFilePath(): string {
  if (filePath) return filePath;
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  filePath = path.join(dir, 'eleven.json');
  return filePath;
}

function load(): StoreShape {
  if (cache) return cache;
  const p = getFilePath();
  try {
    if (!fs.existsSync(p)) {
      cache = defaultStore();
      return cache;
    }
    const raw = fs.readFileSync(p, 'utf-8');
    cache = { ...defaultStore(), ...(JSON.parse(raw) as StoreShape) };
  } catch (e) {
    // 文件损坏时兜底，不让用户整个进不去
    console.error('[store] read failed, fallback to empty', e);
    cache = defaultStore();
  }
  return cache!;
}

function persist(): void {
  if (!cache) return;
  const p = getFilePath();
  // 原子写：先写 .tmp 再 rename，避免写到一半断电
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export const connectionStore = {
  list(): ConnectionConfig[] {
    return load()
      .connections.map(stripCipher)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  get(id: string): ConnectionConfig | undefined {
    const row = load().connections.find((c) => c.id === id);
    return row ? stripCipher(row) : undefined;
  },

  /**
   * 内部用：返回含 _passwordCipher 的完整记录，主进程解密密码时用。
   */
  getRaw(id: string): (ConnectionConfig & { _passwordCipher?: string }) | undefined {
    return load().connections.find((c) => c.id === id);
  },

  create(
    cfg: ConnectionConfig,
    passwordCipher: string | undefined,
    redisPasswordCipher?: string,
  ): ConnectionConfig {
    const s = load();
    const row = {
      ...cfg,
      _passwordCipher: passwordCipher,
      _redisPasswordCipher: redisPasswordCipher,
    };
    // 不让 cfg.redis.passwordCipher 混进 cfg 对象（持久化走 _redisPasswordCipher）
    if (row.redis) {
      const { passwordCipher: _omit, ...restRedis } = row.redis;
      void _omit;
      row.redis = restRedis;
    }
    s.connections.push(row);
    persist();
    return cfg;
  },

  update(
    cfg: ConnectionConfig,
    passwordCipher: string | undefined,
    redisPasswordCipher?: string,
  ): ConnectionConfig {
    const s = load();
    const idx = s.connections.findIndex((c) => c.id === cfg.id);
    if (idx < 0) throw new Error(`Connection not found: ${cfg.id}`);
    const prev = s.connections[idx];
    s.connections[idx] = {
      ...prev,
      ...cfg,
      _passwordCipher: passwordCipher ?? prev._passwordCipher,
      _redisPasswordCipher: redisPasswordCipher ?? prev._redisPasswordCipher,
    };
    if (s.connections[idx].redis) {
      const { passwordCipher: _omit, ...restRedis } = s.connections[idx].redis!;
      void _omit;
      s.connections[idx].redis = restRedis;
    }
    persist();
    return cfg;
  },

  remove(id: string): void {
    const s = load();
    s.connections = s.connections.filter((c) => c.id !== id);
    s.recent = s.recent.filter((r) => r.connectionId !== id);
    persist();
  },

  getPasswordCipher(id: string): string | undefined {
    return load().connections.find((c) => c.id === id)?._passwordCipher;
  },

  getRedisPasswordCipher(id: string): string | undefined {
    return load().connections.find((c) => c.id === id)?._redisPasswordCipher;
  },

  touch(id: string): void {
    const s = load();
    const now = Date.now();
    s.recent = [
      { connectionId: id, lastUsedAt: now },
      ...s.recent.filter((r) => r.connectionId !== id),
    ].slice(0, 50);
    persist();
  },

  recent(limit = 10): ConnectionConfig[] {
    const s = load();
    return s.recent
      .slice(0, limit)
      .map((r) => s.connections.find((c) => c.id === r.connectionId))
      .filter((c): c is ConnectionConfig & { _passwordCipher?: string } => Boolean(c))
      .map(stripCipher);
  },
};

export const historyStore = {
  push(item: QueryHistoryItem): void {
    const s = load();
    s.history.unshift(item);
    // 限长：保留最近 200 条
    if (s.history.length > 200) s.history.length = 200;
    persist();
  },

  list(limit = 200): QueryHistoryItem[] {
    return load().history.slice(0, limit);
  },

  clear(): void {
    const s = load();
    s.history = [];
    persist();
  },
};

function stripCipher(row: ConnectionConfig & { _passwordCipher?: string }): ConnectionConfig {
  const { _passwordCipher, ...rest } = row;
  void _passwordCipher;
  return rest;
}