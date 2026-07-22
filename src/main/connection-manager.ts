import { randomUUID } from 'node:crypto';
import type { ConnectionConfig, RedisConfig } from '../shared/types';
import { createDriver } from './drivers';
import type { ConnectionDriver } from './drivers/types';
import { createRedisDriver } from './drivers/redis-factory';
import type { RedisKeyDriver } from './drivers/redis-types';
import { secretStore } from './stores/secrets';
import { connectionStore } from './stores/store';
import { NotConnectedError } from './errors';

/**
 * 运行时连接池：connectionId → 已打开的 driver。
 *
 * 设计要点：
 * - 打开后 driver 在内存里复用，避免每次操作都建立连接。
 * - 应用退出时统一关闭。
 * - 单个 driver 抛错不影响其它。
 *
 * V1 Redis 支持：kind === 'redis' 走 RedisKeyDriver 池。
 */

class ConnectionManager {
  private sqlDrivers = new Map<string, ConnectionDriver>();
  private redisDrivers = new Map<string, RedisKeyDriver>();

  /** SQL 数据库（MySQL/Oracle）打开 */
  async open(id: string, password?: string): Promise<ConnectionDriver> {
    const existing = this.sqlDrivers.get(id);
    if (existing?.isAlive()) return existing;

    const raw = connectionStore.getRaw(id);
    if (!raw) throw new NotConnectedError();
    if (raw.kind === 'redis') {
      throw new Error('该连接为 Redis，请使用 openRedis()');
    }

    const { plain: pwd, redisPwd } = await resolvePasswords(raw, password);

    const driver = createDriver(raw, pwd);
    await driver.connect();
    this.sqlDrivers.set(id, driver);
    connectionStore.touch(id);
    // 顺手记录 redis 密码（即使本次不用），方便将来 edit 后 openRedis
    if (redisPwd !== undefined) {
      // 用一个 weakmap 不太合适，这里就只缓存到下次从 store 重新拿
    }
    return driver;
  }

  /** Redis 数据库打开 —— 返回独立 driver 池 */
  async openRedis(id: string, password?: string): Promise<RedisKeyDriver> {
    const existing = this.redisDrivers.get(id);
    if (existing?.isAlive()) return existing;

    const raw = connectionStore.getRaw(id);
    if (!raw) throw new NotConnectedError();
    if (raw.kind !== 'redis') {
      throw new Error('该连接不是 Redis，请使用 open()');
    }

    const { redisPwd } = await resolvePasswords(raw, password);

    const driver = createRedisDriver(raw, redisPwd ?? '');
    await driver.connect();
    this.redisDrivers.set(id, driver);
    connectionStore.touch(id);
    return driver;
  }

  /** 同时拿到一个连接的最新 Redis 密码密文（用于 IPC handler） */
  getRedisPasswordCipher(id: string): string | undefined {
    return connectionStore.getRaw(id)?.redis?.passwordCipher;
  }

  async close(id: string): Promise<void> {
    const sql = this.sqlDrivers.get(id);
    if (sql) {
      await sql.close();
      this.sqlDrivers.delete(id);
    }
    const rds = this.redisDrivers.get(id);
    if (rds) {
      await rds.close();
      this.redisDrivers.delete(id);
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([
      ...Array.from(this.sqlDrivers.keys()).map((id) => this.close(id)),
      ...Array.from(this.redisDrivers.keys()).map((id) => this.close(id)),
    ]);
  }

  has(id: string): boolean {
    return (
      (this.sqlDrivers.has(id) && this.sqlDrivers.get(id)!.isAlive()) ||
      (this.redisDrivers.has(id) && this.redisDrivers.get(id)!.isAlive())
    );
  }

  /** 用于"无需打开连接"的纯元数据操作 */
  buildConfig(input: {
    id?: string;
    name: string;
    kind: ConnectionConfig['kind'];
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
  }): ConnectionConfig {
    const now = Date.now();
    return {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      host: input.host.trim(),
      port: input.port,
      username: input.username.trim(),
      database: input.database?.trim() || undefined,
      serviceName: input.serviceName?.trim() || undefined,
      sid: input.sid?.trim() || undefined,
      tns: input.tns?.trim() || undefined,
      charset: input.charset ?? 'utf8mb4',
      timeoutMs: input.timeoutMs ?? 8000,
      redis: input.redis,
      group: input.group,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
  }
}

/** 解出 SQL 密码 + Redis 密码（分开存放） */
async function resolvePasswords(
  raw: ConnectionConfig & { _passwordCipher?: string },
  overridePwd?: string,
): Promise<{ plain: string; redisPwd: string | undefined }> {
  let plain = overridePwd ?? '';
  if (!plain && raw._passwordCipher) {
    try {
      plain = secretStore.decrypt(raw._passwordCipher);
    } catch (_) {
      // 留空字符串
    }
  }

  let redisPwd: string | undefined;
  if (raw.redis?.passwordCipher) {
    redisPwd = secretStore.decrypt(raw.redis.passwordCipher);
  }
  return { plain, redisPwd };
}

export const connectionManager = new ConnectionManager();