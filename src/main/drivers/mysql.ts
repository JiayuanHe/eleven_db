import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import type {
  ConnectionConfig,
  QueryResult,
  SchemaObject,
  TableColumn,
} from '../../shared/types';
import type {
  CommitOptions,
  CommitRow,
  ConnectionDriver,
  FetchDataOptions,
  ListObjectsOptions,
} from './types';

/**
 * V0.1 唯一实现的 ConnectionDriver。
 *
 * 设计要点：
 * - 每个连接 = 一个连接池（Pool）。复用 mysql2 自带连接池，避免每个查询开关连接。
 * - 字段元数据通过 information_schema 拉取，分页用 LIMIT/OFFSET。
 * - commit 阶段用事务批量执行；update/delete 必须带 pk，避免误改。
 */
export class MysqlDriver implements ConnectionDriver {
  readonly kind = 'mysql' as const;
  private pool: Pool | null = null;

  constructor(private readonly cfg: ConnectionConfig, private readonly password: string) {}

  async connect(): Promise<void> {
    if (this.pool) return;
    const opts: PoolOptions = {
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.username,
      password: this.password,
      database: this.cfg.database,
      connectionLimit: 8,
      waitForConnections: true,
      connectTimeout: this.cfg.timeoutMs ?? 8000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      // 关键：表结构里若含日期/二进制，用 string 透传，渲染层自行解析（后续可换 dateStrings/decimal support）
      dateStrings: true,
      // 解析多个结果集
      multipleStatements: false,
    };
    this.pool = mysql.createPool(opts);
    // 立刻拉一条连接探活
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  isAlive(): boolean {
    return this.pool !== null;
  }

  private getPool(): Pool {
    if (!this.pool) throw new Error('Driver not connected');
    return this.pool;
  }

  async listObjects(options: ListObjectsOptions = {}): Promise<SchemaObject[]> {
    const db = options.database ?? this.cfg.database;
    if (!db) {
      // 不指定 database 时，返回所有 db 名（用 SHOW DATABASES）
      const [rows] = await this.getPool().query<RowDataPacket[]>(
        'SHOW DATABASES',
      );
      return rows.map((r) => ({
        name: String(r.Database ?? Object.values(r)[0]),
        type: 'table' as const, // 渲染层把这种当作"数据库"容器
      }));
    }

    const out: SchemaObject[] = [];
    // tables
    const [t] = await this.getPool().query<RowDataPacket[]>(
      'SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [db],
    );
    for (const r of t) out.push({ name: r.name, type: 'table' });

    const [v] = await this.getPool().query<RowDataPacket[]>(
      'SELECT TABLE_NAME AS name FROM information_schema.views WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [db],
    );
    for (const r of v) out.push({ name: r.name, type: 'view' });

    return out;
  }

  async getTableSchema(database: string, table: string): Promise<TableColumn[]> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT
         COLUMN_NAME AS name,
         COLUMN_TYPE AS type,
         IS_NULLABLE = 'YES' AS nullable,
         COLUMN_KEY = 'PRI' AS isPrimary,
         COLUMN_DEFAULT AS defaultValue,
         COLUMN_COMMENT AS comment
       FROM information_schema.columns
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: Boolean(r.nullable) === true || r.nullable === 1 || r.nullable === '1',
      isPrimary: Boolean(r.isPrimary),
      defaultValue: r.defaultValue ?? null,
      comment: r.comment ?? '',
    }));
  }

  async fetchData(options: FetchDataOptions): Promise<QueryResult> {
    const start = Date.now();
    const limit = Math.max(1, Math.min(options.pageSize ?? 1000, 10_000));
    const page = Math.max(1, options.page ?? 1);
    const offset = (page - 1) * limit;

    const where = options.where ? `WHERE ${options.where}` : '';
    const order = options.orderBy
      ? `ORDER BY \`${options.orderBy}\` ${options.orderDir ?? 'ASC'}`
      : '';

    // 表/列名转义：LIMIT/OFFSET 必须用 ? 占位
    const sql = `SELECT * FROM \`${options.database ?? this.cfg.database}\`.\`${options.table}\` ${where} ${order} LIMIT ? OFFSET ?`;
    const [rowsRes] = await this.getPool().query<any[]>(sql, [limit, offset]);
    const [countRes] = await this.getPool().query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`${options.database ?? this.cfg.database}\`.\`${options.table}\` ${where}`,
    );

    const flat = rowsRes as unknown as RowDataPacket[];
    const cols = flat.length > 0 ? Object.keys(flat[0]).map((k) => ({ name: k, type: '' })) : [];
    return {
      columns: cols,
      rows: flat as unknown as Record<string, unknown>[],
      elapsedMs: Date.now() - start,
      affectedRows: (countRes[0]?.c as number) ?? 0,
    };
  }

  async execute(sql: string): Promise<QueryResult> {
    const start = Date.now();
    // 简化：多条语句拆开逐条执行，最后合并
    const statements = splitSqlStatements(sql);
    let last: QueryResult = {
      columns: [],
      rows: [],
      elapsedMs: 0,
      affectedRows: 0,
    };

    for (const stmt of statements) {
      const [result, fields] = await this.getPool().query(stmt);
      if (Array.isArray(result)) {
        const rows = result as unknown as RowDataPacket[];
        const cols = rows.length > 0
          ? Object.keys(rows[0]).map((k) => ({ name: k, type: '' }))
          : (fields ?? []).map((f: any) => ({ name: f.name, type: f.columnType ?? '' }));
        last = {
          columns: cols,
          rows: rows as unknown as Record<string, unknown>[],
          elapsedMs: Date.now() - start,
        };
      } else {
        const r = result as { affectedRows?: number; insertId?: number };
        last = {
          columns: [],
          rows: [],
          affectedRows: r.affectedRows ?? 0,
          insertId: r.insertId,
          elapsedMs: Date.now() - start,
        };
      }
    }
    last.elapsedMs = Date.now() - start;
    return last;
  }

  async commit(options: CommitOptions): Promise<QueryResult> {
    const start = Date.now();
    const db = `\`${options.database ?? this.cfg.database}\`.\`${options.table}\``;
    const conn = await this.getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const row of options.rows) {
        await this.applyRow(conn, db, row);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return {
      columns: [],
      rows: [],
      elapsedMs: Date.now() - start,
      affectedRows: options.rows.length,
    };
  }

  private async applyRow(
    conn: Awaited<ReturnType<Pool['getConnection']>>,
    tableName: string,
    row: CommitRow,
  ): Promise<void> {
    if (row.op === 'insert') {
      const cols = Object.keys(row.data);
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT INTO ${tableName} (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
      await conn.query(sql, cols.map((c) => normalizeValue(row.data[c])));
    } else if (row.op === 'update') {
      if (!row.pk) throw new Error('update 操作必须提供主键 pk');
      const sets = Object.keys(row.data)
        .map((c) => `\`${c}\` = ?`)
        .join(', ');
      const wheres = Object.keys(row.pk)
        .map((c) => `\`${c}\` = ?`)
        .join(' AND ');
      const sql = `UPDATE ${tableName} SET ${sets} WHERE ${wheres}`;
      const params = [
        ...Object.keys(row.data).map((c) => normalizeValue(row.data[c])),
        ...Object.keys(row.pk).map((c) => normalizeValue(row.pk![c])),
      ];
      await conn.query(sql, params);
    } else if (row.op === 'delete') {
      if (!row.pk) throw new Error('delete 操作必须提供主键 pk');
      const wheres = Object.keys(row.pk)
        .map((c) => `\`${c}\` = ?`)
        .join(' AND ');
      const sql = `DELETE FROM ${tableName} WHERE ${wheres}`;
      await conn.query(
        sql,
        Object.keys(row.pk).map((c) => normalizeValue(row.pk![c])),
      );
    }
  }
}

function normalizeValue(v: unknown): unknown {
  // NULL 显式支持：渲染层把 null 当 SQL NULL
  if (v === null || v === undefined) return null;
  return v;
}

/** 简易 SQL 语句切分。V0.5 可换更稳健的实现。 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));
}
