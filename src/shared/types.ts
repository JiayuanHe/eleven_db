/**
 * 主进程、预加载、渲染进程之间共享的类型定义。
 * V0.1: MySQL。V1: Redis（single/sentinel/cluster）。V0.5: Oracle。
 */

export type DbKind = 'mysql' | 'oracle' | 'redis';

/**
 * Redis 专属连接配置。schema 独立，不复用 SQL 字段。
 *
 * - mode = 'single'    用 host + port
 * - mode = 'sentinel'  用 sentinelNodes[] + sentinelName
 * - mode = 'cluster'   用 clusterNodes[]
 *
 * 注：RedisConfig.password 是明文密码，仅在 driver 内部生命周期存在；
 * 持久化层用的是 ConnectionConfig.redis.passwordCipher（密文）。
 */
export interface RedisConfig {
  mode: 'single' | 'sentinel' | 'cluster';
  /** Redis logical db index (0-15, 单机/sentinel 有效) */
  db: number;
  /** Redis 6+ ACL 用户名（可选） */
  username?: string;
  /** Redis 明文密码（driver 内部用，持久化走 passwordCipher） */
  password?: string;
  /** 持久化密文（不要在前端直接读） */
  passwordCipher?: string;
  /** sentinel 模式：master name */
  sentinelName?: string;
  /** sentinel/cluster：节点列表，'host:port' 数组 */
  sentinelNodes?: string[];
  clusterNodes?: string[];
}

export interface ConnectionConfig {
  id: string;
  name: string;
  kind: DbKind;
  host: string;
  port: number;
  username: string;
  /** SQL 模式下的密码密文（MySQL/Oracle 用） */
  passwordCipher?: string;
  database?: string;
  /** Oracle: TNS / Service Name / SID */
  serviceName?: string;
  sid?: string;
  tns?: string;
  /** 通用 */
  charset?: string;
  timeoutMs?: number;
  /** Redis 专属（kind === 'redis' 时用） */
  redis?: RedisConfig;
  /** SSH 隧道（V1 计划） */
  ssh?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
  };
  /** UI 用 */
  group?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SchemaObject {
  name: string;
  type: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'index';
  schema?: string;
}

export interface TableColumn {
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  isPrimary: boolean;
  defaultValue?: string | null;
  comment?: string;
}

/** 编辑表结构时使用：包含字段的"原始信息"（完整类型/默认值表达式等） */
export interface TableFieldDetail {
  name: string;
  /** 形如 varchar(255)、int、decimal(10,2)、text 等 */
  rawType: string;
  /** 是否允许 NULL */
  nullable: boolean;
  /** 默认值表达式（已剥掉引号）；例如 0 / CURRENT_TIMESTAMP / NULL */
  defaultValue: string | null;
  /** 是否为 NULL */
  defaultIsNull: boolean;
  /** 字段注释 */
  comment: string;
  /** 是否为主键一部分 */
  isPrimary: boolean;
}

/** 表的完整元信息：用于详情/编辑 */
export interface TableDetail {
  database: string;
  table: string;
  /** SHOW CREATE TABLE 原文 */
  ddl: string;
  fields: TableFieldDetail[];
  /** 表注释 */
  tableComment: string;
  /** 表引擎（MySQL）；其他数据库可能为空 */
  engine?: string;
  /** 表字符集 */
  charset?: string;
  /** 自增起始值 */
  autoIncrement?: number;
}

/** 表结构编辑：单个字段的编辑项 */
export interface FieldEdit {
  /** 原始字段名（新增/删除为空） */
  originalName: string;
  /** 操作类型 */
  op: 'add' | 'drop' | 'modify' | 'change';
  /** 新字段名（change/rename 时必填） */
  newName: string;
  /** 完整类型字符串，例如 VARCHAR(255)、INT、DECIMAL(10,2) */
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  defaultIsNull: boolean;
  comment: string;
  isPrimary: boolean;
}

/** 表结构编辑：附加操作 */
export interface AlterExtras {
  /** 需要移除的主键字段（原始字段名列表）；空表示保留主键 */
  dropPrimary: string[];
}

export interface QueryResult {
  /** 列定义 */
  columns: { name: string; type: string }[];
  /** 数据行 */
  rows: Record<string, unknown>[];
  /** 影响的行数（DML） */
  affectedRows?: number;
  /** 执行耗时（毫秒） */
  elapsedMs: number;
  /** 自动生成的主键（INSERT） */
  insertId?: number;
}

export interface QueryHistoryItem {
  id: string;
  connectionId: string;
  sql: string;
  elapsedMs: number;
  rows: number;
  executedAt: number;
  success: boolean;
  error?: string;
}

export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}
