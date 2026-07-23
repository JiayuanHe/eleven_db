import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import type {
  AlterExtras,
  ConnectionConfig,
  FieldEdit,
  QueryResult,
  SchemaObject,
  TableColumn,
  TableDetail,
  TableFieldDetail,
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

  async getTableDetail(database: string, table: string): Promise<TableDetail> {
    // 1) SHOW CREATE TABLE 拿原始 DDL
    const [ddlRows] = await this.getPool().query<RowDataPacket[]>(
      `SHOW CREATE TABLE \`${database}\`.\`${table}\``,
    );
    if (!ddlRows.length) throw new Error(`表 ${database}.${table} 不存在`);
    const ddlRow = ddlRows[0] as unknown as Record<string, unknown>;
    // MySQL 返回字段名是 'Create Table'；根据驱动可能为 'Create View'
    const ddl = String(ddlRow['Create Table'] ?? Object.values(ddlRow)[1] ?? '');

    // 2) information_schema 拿完整字段信息
    const [colRows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT
         COLUMN_NAME    AS name,
         COLUMN_TYPE    AS rawType,
         IS_NULLABLE    AS nullableStr,
         COLUMN_DEFAULT AS defaultRaw,
         EXTRA          AS extra,
         COLUMN_COMMENT AS comment,
         COLUMN_KEY     AS colKey
       FROM information_schema.columns
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    );

    const fields: TableFieldDetail[] = colRows.map((r) => {
      const nullableStr = String(r.nullableStr ?? 'NO');
      const extra = String(r.extra ?? '');
      const isAutoInc = /auto_increment/i.test(extra);
      let defaultValue: string | null = null;
      let defaultIsNull = false;
      if (r.defaultRaw === null) {
        // 没有默认值时，DEFAULT NULL 会被报为 NULL；NULLABLE=NO 时会报 NULL 也是合理
        // 区分两个语义：“不设默认值”（null） vs “默认值是 NULL”（defaultIsNull=true）
        if (nullableStr === 'YES') {
          defaultIsNull = true;
          defaultValue = 'NULL';
        } else {
          defaultValue = null;
          defaultIsNull = false;
        }
      } else {
        defaultValue = String(r.defaultRaw);
        defaultIsNull = false;
      }
      return {
        name: String(r.name),
        rawType: String(r.rawType),
        nullable: nullableStr === 'YES',
        defaultValue,
        defaultIsNull,
        comment: String(r.comment ?? ''),
        isPrimary: String(r.colKey ?? '') === 'PRI',
        // 在类型字符串里拼接 auto_increment 让编辑页读得出来
        // 但默认不在 rawType 里拼，保持原样；UI 在提示中说明
      } as TableFieldDetail & { _autoInc?: boolean };
    });

    // 3) 表注释 / 引擎 / 字符集
    const [tblRows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT
         TABLE_COMMENT  AS tableComment,
         ENGINE         AS engine,
         TABLE_COLLATION AS collation
       FROM information_schema.tables
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table],
    );
    const tbl = tblRows[0];
    const tableComment = tbl ? String(tbl.tableComment ?? '') : '';
    const engine = tbl?.engine ? String(tbl.engine) : undefined;
    const collation = tbl?.collation ? String(tbl.collation) : undefined;
    const charset = collation ? collation.split('_')[0] : undefined;

    // 4) 表自增起始值
    let autoIncrement: number | undefined;
    try {
      const [aiRows] = await this.getPool().query<RowDataPacket[]>(
        `SELECT AUTO_INCREMENT AS ai FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [database, table],
      );
      if (aiRows[0]?.ai != null) autoIncrement = Number(aiRows[0].ai);
    } catch {
      /* ignore */
    }

    return {
      database,
      table,
      ddl,
      fields,
      tableComment,
      engine,
      charset,
      autoIncrement,
    };
  }

  async applyAlter(
    database: string,
    table: string,
    edits: FieldEdit[],
    extras?: AlterExtras,
  ): Promise<QueryResult> {
    const start = Date.now();
    if (!edits.length && !extras?.dropPrimary?.length) {
      return { columns: [], rows: [], elapsedMs: 0, affectedRows: 0 };
    }

    // 拆成 3 类有序操作：
    //   - drop   优先（避免字段重名冲突）
    //   - rename/change  次之
    //   - add    最后
    //   - modify 最后（要改字段名的会冲突，UI 会用 change 表达）
    const drops = edits.filter((e) => e.op === 'drop');
    const changes = edits.filter((e) => e.op === 'change');
    const modifies = edits.filter((e) => e.op === 'modify');
    const adds = edits.filter((e) => e.op === 'add');

    const fullName = `\`${database}\`.\`${table}\``;
    const stmts: string[] = [];

    // ---- DROP COLUMN ----
    for (const e of drops) {
      if (!e.originalName) throw new Error('DROP 操作必须提供原字段名');
      stmts.push(`ALTER TABLE ${fullName} DROP COLUMN \`${e.originalName}\``);
    }

    // ---- DROP PRIMARY KEY（如果原始主键被取消勾选）----
    if (extras?.dropPrimary?.length) {
      stmts.push(`ALTER TABLE ${fullName} DROP PRIMARY KEY`);
    }

    // ---- CHANGE（可能改名）----
    for (const e of changes) {
      if (!e.originalName || !e.newName) throw new Error('CHANGE 操作必须提供原字段名和新字段名');
      const def = fieldDefinitionClause(e);
      stmts.push(`ALTER TABLE ${fullName} CHANGE COLUMN \`${e.originalName}\` \`${e.newName}\` ${def}`);
    }

    // ---- MODIFY（不改名）----
    for (const e of modifies) {
      if (!e.originalName) throw new Error('MODIFY 操作必须提供字段名');
      const def = fieldDefinitionClause(e);
      stmts.push(`ALTER TABLE ${fullName} MODIFY COLUMN \`${e.originalName}\` ${def}`);
    }

    // ---- ADD ----
    for (const e of adds) {
      if (!e.newName) throw new Error('ADD 操作必须提供新字段名');
      const def = fieldDefinitionClause(e);
      const tail = e.isPrimary ? ` PRIMARY KEY` : '';
      stmts.push(`ALTER TABLE ${fullName} ADD COLUMN \`${e.newName}\` ${def}${tail}`);
    }

    const conn = await this.getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const sql of stmts) {
        await conn.query(sql);
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
      affectedRows: stmts.length,
    };
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

  async fetchAll(options: { database?: string; table: string; where?: string }): Promise<QueryResult> {
    const start = Date.now();
    const where = options.where ? `WHERE ${options.where}` : '';
    const sql = `SELECT * FROM \`${options.database ?? this.cfg.database}\`.\`${options.table}\` ${where}`;
    const [rowsRes] = await this.getPool().query<any[]>(sql);
    const flat = rowsRes as unknown as RowDataPacket[];
    const cols = flat.length > 0 ? Object.keys(flat[0]).map((k) => ({ name: k, type: '' })) : [];
    return {
      columns: cols,
      rows: flat as unknown as Record<string, unknown>[],
      elapsedMs: Date.now() - start,
      affectedRows: flat.length,
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

/**
 * 拼接字段定义子句（不含字段名）。
 * 例如:  VARCHAR(64) NOT NULL DEFAULT 'foo' COMMENT '名称'
 */
function fieldDefinitionClause(e: FieldEdit): string {
  const t = e.type.trim();
  if (!t) throw new Error('字段类型不能为空');
  const nullClause = e.nullable ? 'NULL' : 'NOT NULL';
  let defClause = '';
  if (e.defaultIsNull) {
    defClause = ' DEFAULT NULL';
  } else if (e.defaultValue !== null && e.defaultValue !== undefined && e.defaultValue !== '') {
    // 如果看起来是函数或数字，不加引号；其他一律加引号
    const v = e.defaultValue.trim();
    const isNumeric = /^-?\d+(\.\d+)?$/.test(v);
    const isKeyword = /^(CURRENT_TIMESTAMP|NOW\(\)|UUID\(\)|CURRENT_DATE|TRUE|FALSE)$/i.test(v);
    defClause = isNumeric || isKeyword
      ? ` DEFAULT ${v}`
      : ` DEFAULT '${v.replace(/'/g, "''")}'`;
  }
  const commentClause = e.comment ? ` COMMENT '${e.comment.replace(/'/g, "''")}'` : '';
  return `${t} ${nullClause}${defClause}${commentClause}`.trim();
}

/** 简易 SQL 语句切分。V0.5 可换更稳健的实现。 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));
}
