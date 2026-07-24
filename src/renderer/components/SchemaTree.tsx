import { useEffect, useMemo, useState } from 'react';
import type { SchemaObject, ConnectionConfig } from '../../shared/types';
import { call, toast } from '../lib/api';
import { SchemaIcon } from './SchemaIcon';
import { groupRedisKeys, makeBreadcrumb, RedisKeyNode } from '../lib/redis-tree';
import { TableDetailModal } from './TableDetailModal';
import { ScriptStore, Script } from '../lib/scripts';

/**
 * 中间一列：
 * - kind='mysql'：database → table/view 树；右键 DDL 模板
 * - kind='redis'：db0..db15 → keys 按 ':' 分层 → 双击叶子进 RedisBrowser
 *
 * Redis 树形浏览：
 * - 一级 db 节点展开 → 拉一页 key（SCAN，按当前 query 过滤）
 * - 拉到的 key 列表按 ':' 切成多层文件夹 + 叶子
 * - 文件夹可继续展开，但层级 lazy 渲染（一次性 groupRedisKeys 后整树展示）
 *
 * 双击叶子：
 * - mysql: props.onSelectTable(db, table)  → TableBrowser
 * - redis: props.onSelectRedisKey(dbIdx, fullKey) → RedisBrowser
 */

type Props =
  | {
      connection: ConnectionConfig;
      kind: 'mysql';
      onSelectTable: (db: string, table: string) => void;
      onInsertSqlTemplate?: (sql: string) => void;
      /** 打开表详情/编辑弹窗；mode='view' | 'edit' */
      onShowTableDetail?: (db: string, table: string, mode?: 'view' | 'edit') => void;
      /** 导出表 (CSV) */
      onExportTable?: (db: string, table: string) => void;
      /** 导入 CSV 到表 */
      onImportTable?: (db: string, table: string) => void;
      /** 导出整个数据库 (SQL) */
      onExportDatabase?: (db: string) => void;
      /** 导入 SQL 文件到数据库 */
      onImportDatabase?: (db: string) => void;
      /** 查看存储过程 / 函数详情（弹出 SHOW CREATE DDL） */
      onShowRoutineDetail?: (db: string, name: string, kind: 'procedure' | 'function') => void;
    }
  | {
      connection: ConnectionConfig;
      kind: 'redis';
      onSelectRedisKey: (db: number, key: string) => void;
    };

interface ContextMenu {
  x: number;
  y: number;
  db: string;
  obj: SchemaObject;
}

interface FolderState {
  /** 是否展开 */
  open: boolean;
}

export function SchemaTree(props: Props): JSX.Element {
  const [databases, setDatabases] = useState<SchemaObject[]>([]);
  const [tables, setTables] = useState<Record<string, SchemaObject[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [ctx, setCtx] = useState<ContextMenu | null>(null);

  // Redis 特有：每个 db 下挂的 key 列表（pattern 搜索结果）
  const [redisKeys, setRedisKeys] = useState<Record<string, string[]>>({});
  const [redisCursor, setRedisCursor] = useState<Record<string, number>>({});
  const [redisLoading, setRedisLoading] = useState<Record<string, boolean>>({});
  // Redis 文件夹展开状态：dbLabel:folderPath → 展开/折叠
  const [folderOpen, setFolderOpen] = useState<Record<string, FolderState>>({});

  const reloadDatabases = async () => {
    try {
      const list = await call<SchemaObject[]>(
        window.api.conn.listObjects(props.connection.id),
      );
      setDatabases(list);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (!props.connection.id) {
      setDatabases([]);
      setTables({});
      setRedisKeys({});
      return;
    }
    reloadDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.connection.id]);

  const toggleDb = async (dbLabel: string) => {
    const willExpand = !expanded[dbLabel];
    setExpanded((e) => ({ ...e, [dbLabel]: willExpand }));

    if (props.kind === 'mysql') {
      if (willExpand && !tables[dbLabel]) {
        try {
          const list = await call<SchemaObject[]>(
            window.api.conn.listObjects(props.connection.id, dbLabel),
          );
          setTables((t) => ({ ...t, [dbLabel]: list }));
        } catch (e) {
          setErr((e as Error).message);
        }
      }
    } else {
      // redis
      if (willExpand) {
        await scanRedisDb(dbLabel, /* reset */ true);
      }
    }
  };

  /** Redis: 用 SCAN 拉一页 keys（pattern 已带搜索词） */
  const scanRedisDb = async (dbLabel: string, reset: boolean) => {
    const db = Number(dbLabel.replace(/^db/, ''));
    if (Number.isNaN(db)) return;
    const pattern = query.trim() ? `*${query.trim()}*` : '*';
    const startCursor = reset ? 0 : (redisCursor[dbLabel] ?? 0);
    if (startCursor === 0 && reset) {
      setRedisKeys((m) => ({ ...m, [dbLabel]: [] }));
      setFolderOpen({}); // 重新拉数据时折叠状态也清空
    }
    setRedisLoading((m) => ({ ...m, [dbLabel]: true }));
    try {
      const r = await call<{ keys: string[]; nextCursor: number }>(
        window.api.redis.listKeys({
          id: props.connection.id,
          database: db,
          pattern,
          cursor: startCursor,
          count: 500, // 一次拉多一点，减少 SCAN 次数
        }),
      );
      setRedisKeys((m) => ({
        ...m,
        [dbLabel]: [...(m[dbLabel] ?? []), ...r.keys],
      }));
      setRedisCursor((m) => ({ ...m, [dbLabel]: r.nextCursor }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRedisLoading((m) => ({ ...m, [dbLabel]: false }));
    }
  };

  // 搜索词变化：刷新所有展开的 db
  useEffect(() => {
    if (props.kind !== 'redis') return;
    for (const db of databases) {
      if (expanded[db.name]) scanRedisDb(db.name, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 把每个 db 的扁平 keys 列表转成树
  const redisTrees = useMemo<Record<string, RedisKeyNode[]>>(() => {
    if (props.kind !== 'redis') return {};
    const out: Record<string, RedisKeyNode[]> = {};
    for (const [dbLabel, keys] of Object.entries(redisKeys)) {
      out[dbLabel] = groupRedisKeys(keys);
    }
    return out;
  }, [redisKeys, props.kind]);

  const toggleFolder = (dbLabel: string, prefix: string) => {
    const k = `${dbLabel}::${prefix}`;
    setFolderOpen((s) => ({
      ...s,
      [k]: { open: !(s[k]?.open ?? false) },
    }));
  };

  // MySQL: 搜索在现有 tables 内过滤
  const filteredTables = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Record<string, SchemaObject[]> = {};
    for (const db of databases) {
      const all = tables[db.name] ?? [];
      out[db.name] = q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;
    }
    return out;
  }, [databases, tables, query]);

  if (!props.connection.id) {
    return <div className="schema-empty">选择左侧连接</div>;
  }
  if (err) return <div className="schema-empty error">⚠ {err}</div>;

  const isSearching = query.trim().length > 0;

  const buildSqlTemplate = (db: string, obj: SchemaObject, kind: string): string => {
    const fullName = `\`${db}\`.\`${obj.name}\``;
    switch (kind) {
      case 'select':
        return `SELECT * FROM ${fullName} LIMIT 100;`;
      case 'show-create':
        return `SHOW CREATE TABLE ${fullName};`;
      case 'drop':
        return `-- ⚠ 危险操作：删除整张表（含数据）\nDROP TABLE ${fullName};`;
      case 'truncate':
        return `-- ⚠ 危险操作：清空表数据（保留结构）\nTRUNCATE TABLE ${fullName};`;
      case 'count':
        return `SELECT COUNT(*) AS row_count FROM ${fullName};`;
      default:
        return '';
    }
  };

  /**
   * 递归渲染 Redis 文件树。
   * 展开/折叠按 prefix 路径段；同 prefix 共享 folderOpen 状态。
   * 叶子统一用 'key' 图标（跟文件夹视觉区分）；类型 chip 在右侧 RedisBrowser 展示。
   */
  const renderRedisNode = (
    dbLabel: string,
    node: RedisKeyNode,
    depth: number,
  ): JSX.Element => {
    if (node.isLeaf) {
      return (
        <div
          key={`leaf-${dbLabel}-${node.fullName}`}
          className="redis-leaf"
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() =>
            (props as any).onSelectRedisKey(Number(dbLabel.replace(/^db/, '')), node.fullName)
          }
          onDoubleClick={() =>
            (props as any).onSelectRedisKey(Number(dbLabel.replace(/^db/, '')), node.fullName)
          }
          title={node.fullName}
        >
          <SchemaIcon kind="key" className="icon-redis-key" />
          <span className="redis-leaf-name">{node.name}</span>
        </div>
      );
    }
    const key = `${dbLabel}::${node.fullName}`;
    const isOpen = folderOpen[key]?.open ?? false;
    const childCount = node.children?.length ?? 0;
    return (
      <div key={`folder-${dbLabel}-${node.fullName}`}>
        <div
          className="redis-folder"
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => toggleFolder(dbLabel, node.fullName)}
        >
          <span className={`caret ${isOpen ? 'open' : ''}`}>▸</span>
          <SchemaIcon kind="folder" className="icon-folder" />
          <span className="redis-folder-name">{node.name}</span>
          <span className="badge">{childCount}</span>
        </div>
        {isOpen && node.children && (
          <div className="children">
            {node.children.map((c) => renderRedisNode(dbLabel, c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="schema-tree">
      <div className="schema-search">
        <input
          placeholder={
            props.kind === 'redis'
              ? '搜索 key（按 glob，自动加 * 通配；如 user 匹配 user:foo）'
              : '搜索表名…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {databases.map((db) => {
        const isOpen = isSearching || expanded[db.name];
        const filtered = props.kind === 'mysql' ? filteredTables[db.name] ?? [] : null;
        // mysql: 搜索无匹配时不显示该 db
        if (props.kind === 'mysql' && isSearching && (filtered?.length ?? 0) === 0) return null;
        return (
          <div key={db.name} className="schema-node">
            <div
              className="db"
              onClick={() => toggleDb(db.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, db: db.name, obj: { name: db.name, type: 'table' } });
              }}
            >
              <span className={`caret ${isOpen ? 'open' : ''}`}>▸</span>
              <SchemaIcon kind="db" className="icon-db" />
              {db.name}
              {props.kind === 'mysql' && isSearching && filtered && (
                <span className="badge">{filtered.length}</span>
              )}
              {props.kind === 'redis' && isOpen && redisTrees[db.name] && (
                <span className="badge">
                  {countAllKeys(redisTrees[db.name])}
                </span>
              )}
            </div>

            {isOpen && (
              <div className="children">
                {props.kind === 'mysql' && filtered && (
                  filtered.length === 0 ? (
                    <div className="schema-empty small">无匹配表</div>
                  ) : (
                    <>
                      {(() => {
                        // 按类型分组：表 / 视图 / 存储过程 / 函数
                        const tables = filtered.filter((o) => o.type === 'table');
                        const views = filtered.filter((o) => o.type === 'view');
                        const procs = filtered.filter((o) => o.type === 'procedure');
                        const funcs = filtered.filter((o) => o.type === 'function');
                        const renderItem = (obj: typeof tables[number]) => {
                          // 点击行为根据类型区分
                          const isTableLike = obj.type === 'table' || obj.type === 'view';
                          const handleClick = () => {
                            if (isTableLike) {
                              (props as any).onSelectTable(db.name, obj.name);
                            } else {
                              // procedure / function → 调用 onShowRoutineDetail
                              (props as any).onShowRoutineDetail?.(db.name, obj.name, obj.type);
                            }
                          };
                          return (
                            <div
                              key={`${db.name}.${obj.name}`}
                              className="table"
                              onClick={handleClick}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setCtx({ x: e.clientX, y: e.clientY, db: db.name, obj });
                              }}
                              title={obj.name}
                            >
                              <SchemaIcon
                                kind={
                                  obj.type === 'view' ? 'view' :
                                  obj.type === 'procedure' ? 'procedure' :
                                  obj.type === 'function' ? 'function' :
                                  'table'
                                }
                                className={`icon-${obj.type}`}
                              />
                              {obj.name}
                            </div>
                          );
                        };
                        return (
                          <>
                            <GroupFolder
                              kind="table"
                              title="表"
                              count={tables.length}
                              defaultOpen
                            >
                              {tables.length === 0 ? (
                                <div className="schema-empty small">（无）</div>
                              ) : (
                                tables.map(renderItem)
                              )}
                            </GroupFolder>
                            <GroupFolder
                              kind="view"
                              title="视图"
                              count={views.length}
                              defaultOpen={false}
                            >
                              {views.length === 0 ? (
                                <div className="schema-empty small">（无）</div>
                              ) : (
                                views.map(renderItem)
                              )}
                            </GroupFolder>
                            <GroupFolder
                              kind="procedure"
                              title="存储过程"
                              count={procs.length}
                              defaultOpen={false}
                            >
                              {procs.length === 0 ? (
                                <div className="schema-empty small">（无）</div>
                              ) : (
                                procs.map(renderItem)
                              )}
                            </GroupFolder>
                            <GroupFolder
                              kind="function"
                              title="函数"
                              count={funcs.length}
                              defaultOpen={false}
                            >
                              {funcs.length === 0 ? (
                                <div className="schema-empty small">（无）</div>
                              ) : (
                                funcs.map(renderItem)
                              )}
                            </GroupFolder>
                          </>
                        );
                      })()}
                    </>
                  )
                )}

                {/* 脚本区：跨连接共享，从 localStorage 读取 */}
                {props.kind === 'mysql' && <ScriptFolder onRun={(sql) => props.onInsertSqlTemplate?.(sql)} />}

                {props.kind === 'redis' && (
                  <>
                    {redisLoading[db.name] && (redisKeys[db.name] ?? []).length === 0 ? (
                      <div className="schema-empty small">加载中…</div>
                    ) : (redisTrees[db.name] ?? []).length === 0 ? (
                      <div className="schema-empty small">无匹配 key</div>
                    ) : (
                      redisTrees[db.name].map((n) => renderRedisNode(db.name, n, 0))
                    )}
                    {redisLoading[db.name] && (redisKeys[db.name] ?? []).length > 0 && (
                      <div className="schema-empty small">继续扫描中…</div>
                    )}
                    {(redisCursor[db.name] ?? 0) > 0 && !redisLoading[db.name] && (
                      <button
                        className="ghost small load-more"
                        onClick={() => scanRedisDb(db.name, false)}
                      >
                        加载更多…
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {ctx && props.kind === 'mysql' && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className="ctx-menu"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ctx-menu-header">[{ctx.db}] {ctx.obj.name}</div>
            {ctx.obj.type === 'table' && ctx.obj.name === ctx.db ? (
              // 数据库节点右键
              <>
                <button className="ctx-item" onClick={() => { props.onExportDatabase?.(ctx.db); setCtx(null); }}>
                  导出整个数据库 (SQL)
                </button>
                <button className="ctx-item" onClick={() => { props.onImportDatabase?.(ctx.db); setCtx(null); }}>
                  导入 SQL 文件
                </button>
              </>
            ) : ctx.obj.type === 'procedure' || ctx.obj.type === 'function' ? (
              // 存储过程 / 函数右键
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const ddl = `SHOW CREATE ${ctx.obj.type === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} \`${ctx.db}\`.\`${ctx.obj.name}\`;`;
                    props.onInsertSqlTemplate?.(ddl);
                    setCtx(null);
                  }}
                >
                  生成 SHOW CREATE 模板
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    const call = ctx.obj.type === 'procedure'
                      ? `CALL \`${ctx.db}\`.\`${ctx.obj.name}\`();`
                      : `SELECT \`${ctx.db}\`.\`${ctx.obj.name}\`();`;
                    props.onInsertSqlTemplate?.(call);
                    setCtx(null);
                  }}
                >
                  生成调用模板
                </button>
              </>
            ) : (
              // 表节点右键
              <>
                <button className="ctx-item" onClick={() => { props.onInsertSqlTemplate?.(buildSqlTemplate(ctx.db, ctx.obj, 'select')); setCtx(null); }}>
                  生成 SELECT 模板
                </button>
                <button className="ctx-item" onClick={() => { props.onInsertSqlTemplate?.(buildSqlTemplate(ctx.db, ctx.obj, 'count')); setCtx(null); }}>
                  生成 COUNT(*) 模板
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    props.onShowTableDetail?.(ctx.db, ctx.obj.name, 'view');
                    setCtx(null);
                  }}
                >
                  查看表详情
                </button>
                <button
                  className="ctx-item"
                  onClick={() => {
                    props.onShowTableDetail?.(ctx.db, ctx.obj.name, 'edit');
                    setCtx(null);
                  }}
                >
                  编辑表结构
                </button>
                <button className="ctx-item" onClick={() => { props.onExportTable?.(ctx.db, ctx.obj.name); setCtx(null); }}>
                  导出表 (CSV)
                </button>
                <button className="ctx-item" onClick={() => { props.onImportTable?.(ctx.db, ctx.obj.name); setCtx(null); }}>
                  导入 CSV 到表
                </button>
                <button className="ctx-item" onClick={() => { props.onInsertSqlTemplate?.(buildSqlTemplate(ctx.db, ctx.obj, 'truncate')); setCtx(null); }}>
                  清空表 (TRUNCATE 模板)
                </button>
                <button className="ctx-item danger" onClick={() => { props.onInsertSqlTemplate?.(buildSqlTemplate(ctx.db, ctx.obj, 'drop')); setCtx(null); }}>
                  删除表 (DROP 模板 ⚠)
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 统计整棵树下叶子数 */
function countAllKeys(nodes: RedisKeyNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.isLeaf) n++;
    else if (node.children) n += countAllKeys(node.children);
  }
  return n;
}

/**
 * 分组文件夹：按类型（表/视图/存储过程/函数）分组展示
 * 独立可折叠，默认表打开，其他折叠
 */
function GroupFolder(props: {
  kind: 'table' | 'view' | 'procedure' | 'function';
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <div className="schema-group">
      <div
        className="schema-group-header"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        <SchemaIcon kind={props.kind} className={`icon-${props.kind}`} />
        <span className="schema-group-title">{props.title}</span>
        <span className="badge">{props.count}</span>
      </div>
      {open && <div className="schema-group-body">{props.children}</div>}
    </div>
  );
}

/**
 * 脚本文件夹：渲染在每个数据库下方
 * 跨连接共享，存储在 localStorage
 */
function ScriptFolder(props: { onRun: (sql: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [scripts, setScripts] = useState<Script[]>(() => ScriptStore.list());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = () => setScripts(ScriptStore.list());
  // 监听 localStorage 变化
  useEffect(() => ScriptStore.subscribe(refresh), []);

  return (
    <div className="schema-script-section">
      <div
        className="schema-script-header"
        onClick={() => setOpen((o) => !o)}
        title="点击展开 / 折叠脚本"
      >
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        <SchemaIcon kind="script" className="icon-script" />
        <span>脚本</span>
        <span className="badge">{scripts.length}</span>
        {open && (
          <button
            className="ghost xs"
            style={{ marginLeft: 'auto' }}
            onClick={(e) => {
              e.stopPropagation();
              const name = window.prompt('脚本名称：', '');
              if (!name) return;
              ScriptStore.create(name, '');
              refresh();
              toast.push('已创建脚本', 'success');
            }}
          >
            + 新建
          </button>
        )}
      </div>
      {open && (
        <div className="schema-script-list">
          {scripts.length === 0 ? (
            <div className="schema-empty small">暂无脚本。点 + 新建 或在 SQL 控制台"保存为脚本"</div>
          ) : (
            scripts.map((s) => (
              <div
                key={s.id}
                className="schema-script-row"
                onClick={() => props.onRun(s.sql)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingId(s.id);
                  setEditName(s.name);
                }}
                title={s.sql.slice(0, 80)}
              >
                <SchemaIcon kind="script" className="icon-script-mini" />
                {editingId === s.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => {
                      if (editName.trim()) ScriptStore.update(s.id, { name: editName.trim() });
                      setEditingId(null);
                      refresh();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="name">{s.name}</span>
                )}
                {editingId === s.id && (
                  <button
                    className="ghost xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除脚本 "${s.name}"？`)) {
                        ScriptStore.remove(s.id);
                        setEditingId(null);
                        refresh();
                        toast.push('已删除', 'success');
                      }
                    }}
                  >
                    删除
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}