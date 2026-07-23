/**
 * ConnectionDriver —— 不同数据库类型的可替换抽象。
 *
 * V0.1：仅 MysqlDriver。
 * V0.5：加 OracleDriver。
 * V1.0：加 RedisDriver。
 */

import type {
  ConnectionConfig,
  AlterExtras,
  FieldEdit,
  QueryResult,
  SchemaObject,
  TableColumn,
  TableDetail,
} from '../../shared/types';

export interface ListObjectsOptions {
  /** 限定 schema/database；缺省则列出全部（MySQL: 无 schema，每个 db 走一遍） */
  database?: string;
}

export interface FetchDataOptions {
  database?: string;
  table: string;
  /** 默认 1000 */
  pageSize?: number;
  /** 1-based */
  page?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  /** 形如 status = 'active'，V0.1 仅支持简单比较，留扩展位 */
  where?: string;
}

export interface CommitRow {
  /** 'insert' | 'update' | 'delete' */
  op: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  /** update/delete 用，主键字段 */
  pk?: Record<string, unknown>;
}

export interface CommitOptions {
  database?: string;
  table: string;
  rows: CommitRow[];
}

/**
 * 单次连接 = 一个 ConnectionDriver 实例。
 * 主进程持有连接池，IPC 调用按 connectionId 索引。
 */
export interface ConnectionDriver {
  readonly kind: ConnectionConfig['kind'];

  connect(): Promise<void>;
  close(): Promise<void>;
  isAlive(): boolean;

  listObjects(options?: ListObjectsOptions): Promise<SchemaObject[]>;

  getTableSchema(database: string, table: string): Promise<TableColumn[]>;

  /**
   * 获取表详情：SHOW CREATE TABLE 原文 + 完整字段信息。
   * V0.1 仅 MySQL 实现。
   */
  getTableDetail(database: string, table: string): Promise<TableDetail>;

  /**
   * 根据 FieldEdit[] 生成并执行 ALTER TABLE 语句。
   * V0.1 仅 MySQL 实现；按顺序依次执行，最后一起 commit。
   */
  applyAlter(
    database: string,
    table: string,
    edits: FieldEdit[],
    extras?: AlterExtras,
  ): Promise<QueryResult>;

  fetchData(options: FetchDataOptions): Promise<QueryResult>;

  /** 导出全部数据（无分页） */
  fetchAll(options: { database?: string; table: string; where?: string }): Promise<QueryResult>;

  /** 执行任意 SQL；多条以 ; 分隔时按条返回（影响行数取最后一条） */
  execute(sql: string): Promise<QueryResult>;

  /** 网格编辑提交 */
  commit(options: CommitOptions): Promise<QueryResult>;
}
