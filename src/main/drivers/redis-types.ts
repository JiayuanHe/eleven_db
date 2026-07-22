/**
 * Redis 驱动抽象 —— 与 SQL 驱动的 ConnectionDriver 接口并列。
 *
 * Redis 没有 table/column 概念，所以不复用 ConnectionDriver。
 * 模型：connection → db(idx) → key(string) → value(typed) → TTL。
 */

import type { ConnectionConfig } from '../../shared/types';

export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'unknown';

export interface RedisKeyInfo {
  /** key 名 */
  name: string;
  /** 类型（已统一类型串） */
  type: RedisKeyType;
  /** TTL 秒；-2 = 不存在；-1 = 永不过期；正数 = 剩余秒 */
  ttl: number;
  /** 内部编码（如 'raw'/'int'/'hashtable'）；V1 仅作展示 */
  encoding?: string;
  /** 大小（列表/集合的元素数）；非容器类 key 是 1 */
  size?: number;
}

export interface RedisKeyValue {
  key: string;
  type: RedisKeyType;
  /** 各类型的原始值（V1 全部转为 string[]，结构化字段单独存） */
  stringValue?: string;
  hashValue?: Array<[string, string]>;
  listValue?: string[];
  setValue?: string[];
  zsetValue?: Array<{ member: string; score: number }>;
  /** Stream entries: [id, fields[]] */
  streamValue?: Array<{ id: string; fields: Array<[string, string]> }>;
}

export interface ListKeysOptions {
  database: number;
  /** glob pattern, 例 'user:*' 'session:*' */
  pattern?: string;
  /** SCAN COUNT (默认 200) */
  count?: number;
  /** 0-based 游标；递归 SCAN 用，首屏传 0 */
  cursor?: number;
}

export interface ListKeysResult {
  /** key 列表（不含类型 / TTL —— 详情要单独按 key 拉） */
  keys: string[];
  /** 下次 SCAN 游标，0 表示结束 */
  nextCursor: number;
}

/**
 * V1 Redis 驱动。
 *
 * ioredis 在 single / sentinel / cluster 三种模式下 API 一致，省去分别适配。
 */
export interface RedisKeyDriver {
  readonly kind: ConnectionConfig['kind'];

  connect(): Promise<void>;
  close(): Promise<void>;
  isAlive(): boolean;

  /** 列出所有 logical db（用于 schema 树第一层）。cluster 模式返回 [0] */
  listDatabases(): Promise<number[]>;

  /** 改当前 db（单机 / sentinel 有效）。cluster 模式忽略。 */
  selectDatabase(db: number): Promise<void>;
  currentDatabase(): number;

  /** SCAN 一页 key（V1 默认 200 上限；UI 反复调用直到 cursor=0） */
  listKeys(options: ListKeysOptions): Promise<ListKeysResult>;

  /** 单个 key 的类型 + TTL + size */
  describeKey(db: number, key: string): Promise<RedisKeyInfo>;

  /** 读完整值（按类型拉） */
  getValue(db: number, key: string, type: RedisKeyType): Promise<RedisKeyValue>;

  /**
   * 写值。
   * - string: data = { stringValue }
   * - hash  : data = { hashValue: [[k,v],...] }
   * - list/set/zset 同理
   * ttlSec: undefined = 不改 TTL；0 = 永不过期；正数 = N 秒
   */
  setValue(
    db: number,
    key: string,
    type: RedisKeyType,
    data: Omit<RedisKeyValue, 'key' | 'type'>,
    ttlSec?: number,
  ): Promise<void>;

  /** 设置 TTL（毫秒级也可） */
  expireKey(db: number, key: string, ttlSec: number): Promise<void>;
  /** 取消 TTL */
  persistKey(db: number, key: string): Promise<void>;

  /** 重命名 key */
  renameKey(db: number, oldName: string, newName: string): Promise<void>;

  /** 删除单个 key */
  deleteKey(db: number, key: string): Promise<number>;

  /** V1 简易 CLI：执行任意命令，限制不允许 CONFIG/SHUTDOWN 等危险操作。 */
  runCommand(db: number, command: string, args: string[]): Promise<unknown>;
}