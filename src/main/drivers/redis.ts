import Redis, { Cluster } from 'ioredis';
import type { ConnectionConfig } from '../../shared/types';
import type {
  ListKeysOptions,
  ListKeysResult,
  RedisKeyDriver,
  RedisKeyType,
  RedisKeyValue,
  RedisKeyInfo,
} from './redis-types';

/**
 * V1 Redis 驱动 —— single + sentinel + cluster 三种模式共用一个类。
 *
 * 安全护栏：
 * - runCommand 拒绝 CONFIG/SHUTDOWN/BGSAVE/SAVE/FLUSHDB/FLUSHALL/DEBUG 等危险命令
 * - 所有 timeoutMs 在 ioredis connectTimeout 上统一；事件循环不阻塞
 *
 * 实现要点：
 * - 单 / 哨兵：client 是 Redis 实例，方法签名直接对齐 ioredis
 * - 集 群：client 是 Cluster 实例，zrangeWithScores / select 等扩展方法只在 Cluster 上
 *   用 `c as any` 兜底，因为 ioredis 类型把 Cluster 和 Redis 分叉了
 *
 * 密码解密放在外面（main/connection-manager）做，driver 只接明文。
 */
export class RedisDriver implements RedisKeyDriver {
  readonly kind = 'redis' as const;
  private client: Redis | Cluster | null = null;
  private isCluster = false;
  private currentDb = 0;

  constructor(
    private readonly cfg: ConnectionConfig,
    private readonly password: string,
  ) {
    if (!cfg.redis) throw new Error('Redis 连接缺少 redis 配置块');
  }

  // ---------- 构造 ioredis 实例 ----------
  private buildClient(): { client: Redis | Cluster; isCluster: boolean } {
    const redis = this.cfg.redis!;
    const baseOpts = {
      connectTimeout: this.cfg.timeoutMs ?? 5000,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: () => null,
      lazyConnect: true,
    } as const;

    if (redis.mode === 'single') {
      return {
        client: new Redis({
          ...baseOpts,
          host: this.cfg.host,
          port: this.cfg.port,
          db: redis.db,
          username: redis.username,
          password: redis.password || undefined,
        }),
        isCluster: false,
      };
    }
    if (redis.mode === 'sentinel') {
      if (!redis.sentinelNodes?.length || !redis.sentinelName) {
        throw new Error('Sentinel 模式需要至少一个 sentinel 节点和 master 名称');
      }
      return {
        client: new Redis({
          ...baseOpts,
          sentinels: redis.sentinelNodes.map((hp) => {
            const [host, portStr] = hp.split(':');
            return { host: host.trim(), port: Number(portStr) || 26379 };
          }),
          name: redis.sentinelName,
          db: redis.db,
          username: redis.username,
          password: redis.password || undefined,
        }),
        isCluster: false,
      };
    }
    // cluster
    if (!redis.clusterNodes?.length) {
      throw new Error('Cluster 模式需要至少一个节点');
    }
    return {
      client: new Cluster(
        redis.clusterNodes.map((hp) => {
          const [host, portStr] = hp.split(':');
          return { host: host.trim(), port: Number(portStr) || 6379 };
        }),
        {
          redisOptions: {
            username: redis.username,
            password: redis.password || undefined,
            connectTimeout: this.cfg.timeoutMs ?? 5000,
            maxRetriesPerRequest: 2,
          },
        },
      ),
      isCluster: true,
    };
  }

  // ---------- Driver 接口 ----------
  async connect(): Promise<void> {
    if (this.client) return;
    const { client, isCluster } = this.buildClient();
    // ioredis 在 lazyConnect=true 时才会真正连接
    await client.connect();
    // 探活
    await (client as any).ping();
    this.client = client;
    this.isCluster = isCluster;
    this.currentDb = this.cfg.redis!.db;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await (this.client as any).quit();
      } catch (_) {
        try { this.client.disconnect(); } catch (_) {}
      }
      this.client = null;
      this.isCluster = false;
    }
  }

  isAlive(): boolean {
    return this.client !== null && (this.client as any).status === 'ready';
  }

  async listDatabases(): Promise<number[]> {
    if (this.isCluster) return [0];
    return Array.from({ length: 16 }, (_, i) => i);
  }

  async selectDatabase(db: number): Promise<void> {
    if (this.isCluster) {
      this.currentDb = 0;
      return;
    }
    const c = this.client;
    if (!c) return;
    if (typeof (c as any).select === 'function') {
      await (c as any).select(db);
    }
    this.currentDb = db;
  }

  currentDatabase(): number {
    return this.currentDb;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    const c = this.client as any;
    const pattern = options.pattern || '*';
    const count = options.count ?? 200;
    const cursor = String(options.cursor ?? 0);
    if (options.database !== this.currentDb) await this.selectDatabase(options.database);

    const [nextCursor, batch] = await c.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    return {
      keys: (batch as string[]) ?? [],
      nextCursor: Number(nextCursor),
    };
  }

  async describeKey(db: number, key: string): Promise<RedisKeyInfo> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    const c = this.client as any;
    const [type, ttlRes] = await Promise.all([
      c.type(key) as Promise<string>,
      c.ttl(key) as Promise<number>,
    ]);
    const t = normalizeType(type);
    const info: RedisKeyInfo = { name: key, type: t, ttl: ttlRes };
    if (t === 'list' || t === 'set' || t === 'zset' || t === 'hash') {
      info.size = await c.scard(key).catch(() => c.llen(key));
    } else {
      info.size = 1;
    }
    return info;
  }

  async getValue(db: number, key: string, type: RedisKeyType): Promise<RedisKeyValue> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    const c = this.client as any;
    const out: RedisKeyValue = { key, type };
    switch (type) {
      case 'string': {
        out.stringValue = (await c.get(key)) ?? '';
        break;
      }
      case 'hash': {
        const obj = (await c.hgetall(key)) as Record<string, string>;
        out.hashValue = Object.keys(obj).map((k) => [k, obj[k]]);
        break;
      }
      case 'list': {
        const arr = (await c.lrange(key, 0, -1)) as string[];
        out.listValue = arr;
        break;
      }
      case 'set': {
        const arr = (await c.smembers(key)) as string[];
        out.setValue = arr;
        break;
      }
      case 'zset': {
        // Cluster 实例和 Redis 都支持 zrangeWithScores（从 Redis 5.x 起）
        const arr = (await c.zrangeWithScores(key, 0, -1)) as Array<{ value: string; score: number }>;
        out.zsetValue = arr.map((m) => ({ member: m.value, score: m.score }));
        break;
      }
      case 'stream': {
        // XRANGE - + COUNT 200，UI 显示前 200 条
        const arr = (await c.xrange(key, '-', '+', 'COUNT', 200)) as Array<
          [string, string[]]
        >;
        out.streamValue = arr.map(([id, kv]) => ({ id, fields: chunkKv(kv) }));
        break;
      }
      case 'unknown':
        break;
    }
    return out;
  }

  async setValue(
    db: number,
    key: string,
    type: RedisKeyType,
    data: Omit<RedisKeyValue, 'key' | 'type'>,
    ttlSec?: number,
  ): Promise<void> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    const c = this.client as any;
    const pipeline = c.pipeline();
    switch (type) {
      case 'string':
        pipeline.set(key, data.stringValue ?? '');
        break;
      case 'hash':
        pipeline.del(key);
        if (data.hashValue && data.hashValue.length > 0) {
          const flat: string[] = [];
          for (const [k, v] of data.hashValue) flat.push(k, v);
          pipeline.hset(key, ...(flat as [string, string]));
        }
        break;
      case 'list':
        pipeline.del(key);
        if (data.listValue && data.listValue.length > 0) {
          pipeline.rpush(key, ...(data.listValue as string[]));
        }
        break;
      case 'set':
        pipeline.del(key);
        if (data.setValue && data.setValue.length > 0) {
          pipeline.sadd(key, ...(data.setValue as string[]));
        }
        break;
      case 'zset':
        pipeline.del(key);
        if (data.zsetValue && data.zsetValue.length > 0) {
          for (const m of data.zsetValue) pipeline.zadd(key, m.score, m.member);
        }
        break;
      case 'stream':
      case 'unknown':
        throw new Error(`暂不支持该类型 (${type}) 的批量写入`);
    }
    if (ttlSec !== undefined) {
      if (ttlSec > 0) pipeline.expire(key, ttlSec);
      else pipeline.persist(key);
    }
    const results = await pipeline.exec();
    if (!results) throw new Error('Redis pipeline 执行失败');
    for (const [err] of results as Array<[Error | null, unknown]>) {
      if (err) throw err;
    }
  }

  async expireKey(db: number, key: string, ttlSec: number): Promise<void> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    await (this.client as any).expire(key, ttlSec);
  }

  async persistKey(db: number, key: string): Promise<void> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    await (this.client as any).persist(key);
  }

  async renameKey(db: number, oldName: string, newName: string): Promise<void> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    await (this.client as any).rename(oldName, newName);
  }

  async deleteKey(db: number, key: string): Promise<number> {
    if (db !== this.currentDb) await this.selectDatabase(db);
    return (this.client as any).del(key);
  }

  async runCommand(db: number, command: string, args: string[]): Promise<unknown> {
    const cmd = command.toLowerCase();
    if (DENIED_COMMANDS.has(cmd)) {
      throw new Error(`安全策略：禁止执行 ${cmd} 命令`);
    }
    if (db !== this.currentDb) await this.selectDatabase(db);
    const c = this.client as any;
    const fn = c[cmd];
    if (typeof fn !== 'function') throw new Error(`未知命令：${cmd}`);
    return await fn.apply(c, args);
  }
}

const DENIED_COMMANDS = new Set([
  'shutdown', 'bgrewriteaof', 'bgwriteaof',
  'bgsave', 'save', 'flushall', 'flushdb',
  'config', 'debug', 'monitor', 'sync', 'slaveof', 'replicaof',
  'cluster', 'script', 'eval', 'evalsha', 'keys',
]);

function normalizeType(t: string): RedisKeyType {
  const s = t.toLowerCase();
  if (s === 'string' || s === 'hash' || s === 'list' || s === 'set' || s === 'zset' || s === 'stream') {
    return s;
  }
  return 'unknown';
}

/** 把 flat k/v 数组切成 [k,v] 对 */
function chunkKv(flat: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1] ?? '']);
  return out;
}