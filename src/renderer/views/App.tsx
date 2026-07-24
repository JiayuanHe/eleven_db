import { useEffect, useState } from 'react';
import type { ConnectionConfig, QueryResult, SchemaObject } from '../../shared/types';
import { ConnectionTree, ConnectionStatus } from '../components/ConnectionTree';
import { ConnectionEditor } from '../components/ConnectionEditor';
import { SchemaTree } from '../components/SchemaTree';
import { ResizeHandle } from '../components/ResizeHandle';
import { SqlConsole } from './SqlConsole';
import { TableBrowser } from './TableBrowser';
import { RedisBrowser } from './RedisBrowser';
import { TableDetailModal } from '../components/TableDetailModal';
import { SplashScreen } from '../components/SplashScreen';
import { toast, call } from '../lib/api';
import { useTheme } from '../lib/theme';
import { useLayout } from '../lib/layout';

/**
 * 顶层布局 —— V1：MySQL + Redis + (预留 Oracle)
 *
 * 顶栏 [Eleven DB] [◀/▶ 隐藏连接] [☀/☾]
 * 左  ┌──────────────────────────────────┐
 *      │ 连接树 │ Schema 树 │ 主工作区   │
 *      └──────────────────────────────────┘
 * 底栏 [状态 / 版本]
 */

interface WorkTab {
  id: string;
  kind: 'sql' | 'table' | 'redis';
  /** MySQL 表视图 */
  database?: string;
  table?: string;
  /** Redis 键视图 */
  redisDb?: number;
  redisKey?: string;
  title: string;
  initialSql?: string;
}

export function App(): JSX.Element {
  const [conn, setConn] = useState<ConnectionConfig | null>(null);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tabs, setTabs] = useState<WorkTab[]>([
    { id: 'welcome', kind: 'sql', title: '欢迎' },
  ]);
  const [activeTabId, setActiveTabId] = useState('welcome');
  /** 表详情弹窗（查看/编辑结构） */
  const [detailTarget, setDetailTarget] = useState<
    { db: string; table: string; mode: 'view' | 'edit' } | null
  >(null);
  const [status, setStatus] = useState<string>('就绪');
  const [theme, , setTheme] = useTheme();
  const layout = useLayout();
  const [connStatuses, setConnStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [ctx, setCtx] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const setConnStatus = (id: string, s: ConnectionStatus) => {
    setConnStatuses((m) => (m[id] === s ? m : { ...m, [id]: s }));
  };

  useEffect(() => {
    toast.subscribe((msg, kind) => {
      setStatus(`${kind === 'error' ? '⚠ ' : ''}${msg}`);
      setTimeout(() => setStatus('就绪'), 3500);
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;

  const openTableTab = (database: string, table: string) => {
    const id = `${database}.${table}.${Date.now()}`;
    setTabs((ts) => [...ts, { id, kind: 'table', database, table, title: `${database}.${table}` }]);
    setActiveTabId(id);
  };
  const openRedisKeyTab = (redisDb: number, redisKey: string) => {
    const id = `db${redisDb}:${redisKey}.${Date.now()}`;
    setTabs((ts) => [
      ...ts,
      { id, kind: 'redis', redisDb, redisKey, title: `db${redisDb}:${redisKey}` },
    ]);
    setActiveTabId(id);
  };
  /**
   * 导出表为 CSV：通过表浏览器内部的工具函数
   * 这里复用 table.data 全量拉取 + CSV 序列化 + 保存对话框
   */
  const exportTableCsv = async (database: string, table: string) => {
    if (!conn) return;
    try {
      const r = await call<QueryResult>(
        window.api.table.exportAll({
          id: conn.id,
          database,
          table,
        }),
      );
      const headers = r.columns.map((c: { name: string }) => c.name);
      const { toCsv } = await import('../lib/csv');
      const csv = toCsv(headers, r.rows);
      const file = await call<string | false>(window.api.exportCsv(`${table}.csv`, csv));
      if (file) toast.push(`已导出 ${r.rows.length.toLocaleString()} 行至 ${file}`, 'success');
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };
  /**
   * 导入 CSV 到表：弹出文件选择 → 解析 → 生成 INSERT
   */
  const importTableCsv = async (database: string, table: string) => {
    if (!conn) return;
    const path = await call<string | false>(window.api.pickFile('csv'));
    if (!path) return;
    try {
      const raw = await call<string>(window.api.readFile(path));
      // 去掉 BOM
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const { parseCsv } = await import('../lib/csv');
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) {
        toast.push('CSV 为空', 'info');
        return;
      }
      const cols = parsed.headers.map((c) => `\`${c}\``).join(', ');
      const batchSize = 100;
      const totalBatches = Math.ceil(parsed.rows.length / batchSize);
      const confirmed = window.confirm(
        `即将向 ${database}.${table} 插入 ${parsed.rows.length.toLocaleString()} 行 (${totalBatches} 个批次)。\n确定吗？`,
      );
      if (!confirmed) return;
      let inserted = 0;
      for (let i = 0; i < parsed.rows.length; i += batchSize) {
        const batch = parsed.rows.slice(i, i + batchSize);
        const valuesSql = batch
          .map((row) => {
            const vals = parsed.headers
              .map((_, j) => {
                const v = row[j];
                if (v === '' || v === undefined || v === null) return 'NULL';
                const numTrim = v.trim();
                if (/^-?\d+(\.\d+)?$/.test(numTrim)) return numTrim;
                return `'${String(v).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
              })
              .join(', ');
            return `(${vals})`;
          })
          .join(', ');
        const sql = `INSERT INTO \`${database}\`.\`${table}\` (${cols}) VALUES ${valuesSql};`;
        await call<QueryResult>(window.api.sql.execute(conn.id, sql));
        inserted += batch.length;
      }
      toast.push(`已导入 ${inserted.toLocaleString()} 行到 ${database}.${table}`, 'success');
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };
  /**
   * 导出整个数据库为 SQL 转储
   */
  const exportDatabase = async (database: string) => {
    if (!conn) return;
    const confirmed = window.confirm(
      `即将导出数据库 ${database} 为 SQL 转储文件。\n如果库很大可能需要一些时间。\n确定吗？`,
    );
    if (!confirmed) return;
    try {
      const sql = await call<string>(
        window.api.dumpDatabase({ id: conn.id, database }),
      );
      const file = await call<string | false>(
        window.api.exportSql(`${database}_dump.sql`, sql),
      );
      if (file) toast.push(`已导出 ${database} 到 ${file}`, 'success');
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };
  /**
   * 导入 SQL 文件到数据库
   */
  const importDatabase = async (database: string) => {
    if (!conn) return;
    const path = await call<string | false>(window.api.pickFile('sql'));
    if (!path) return;
    const confirmed = window.confirm(
      `即将执行 SQL 文件中的语句到 ${database}。\n⚠ 高危操作：可能修改/删除大量数据。\n确定吗？`,
    );
    if (!confirmed) return;
    try {
      const sql = await call<string>(window.api.readFile(path));
      const result = await call<{ executed: number }>(
        window.api.execSql({ id: conn.id, sql }),
      );
      toast.push(`已执行 ${result.executed} 条语句到 ${database}`, 'success');
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };
  const newSqlTab = (initialSql?: string) => {
    const id = String(Date.now());
    setTabs((ts) => [...ts, { id, kind: 'sql', title: `查询 ${ts.length}`, initialSql }]);
    setActiveTabId(id);
  };
  /** 打开表详情/编辑弹窗 */
  const openTableDetail = (db: string, table: string, mode: 'view' | 'edit' = 'view') => {
    setDetailTarget({ db, table, mode });
  };
  

  const closeTab = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id !== id));
    if (activeTabId === id) setActiveTabId(tabs[0]?.id ?? '');
  };
  const closeLeftTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx <= 0) return;
    setTabs((ts) => ts.slice(idx));
    setActiveTabId(id);
  };
  const closeRightTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0 || idx >= tabs.length - 1) return;
    setTabs((ts) => ts.slice(0, idx + 1));
  };
  const closeOtherTabs = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id === id));
    setActiveTabId(id);
  };
  const closeAllTabs = () => {
    const newId = String(Date.now());
    setTabs([{ id: newId, kind: 'sql', title: '查询 1' }]);
    setActiveTabId(newId);
  };

  const showSidebar = layout.sizes.sidebar > 0;

  return (
    <div
      className="app"
      style={
        {
          '--col-sidebar': `${layout.sizes.sidebar}px`,
          '--col-schema': `${layout.sizes.schema}px`,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <span className="logo">Eleven DB</span>
        <span className="conn-name">
          {conn
            ? `${conn.name} · ${conn.kind.toUpperCase()}`
            : '未选择连接'}
        </span>
        <span className="spacer" />
        <button
          className="ghost small"
          onClick={layout.toggleSidebar}
          title={showSidebar ? '隐藏连接栏' : '显示连接栏'}
        >
          {showSidebar ? '◀ 隐藏连接' : '▶ 显示连接'}
        </button>
        <div className="theme-toggle" role="group" aria-label="主题切换">
          <button
            className={theme === 'light' ? 'active' : ''}
            onClick={() => setTheme('light')}
            title="浅色主题"
          >
            ☀
          </button>
          <button
            className={theme === 'dark' ? 'active' : ''}
            onClick={() => setTheme('dark')}
            title="深色主题"
          >
            ☾
          </button>
        </div>
      </header>

      <div
        className="layout"
        style={
          {
            gridTemplateColumns: showSidebar
              ? `${layout.sizes.sidebar}px 4px ${layout.sizes.schema}px 4px 1fr`
              : `${layout.sizes.schema}px 4px 1fr`,
          } as React.CSSProperties
        }
      >
        {showSidebar && (
          <>
            <aside className="sidebar">
              <ConnectionTree
                activeId={conn?.id ?? null}
                onSelect={async (id) => {
                  const cfg = await call<ConnectionConfig>(window.api.conn.get(id));
                  setConn(cfg);
                  setConnStatus(id, 'connecting');
                  const ping = await call<SchemaObject[]>(window.api.conn.listObjects(id));
                  setConnStatus(id, Array.isArray(ping) ? 'ok' : 'error');
                }}
                onEdit={(c) => setEditing(c)}
                refreshKey={refreshKey}
                statuses={connStatuses}
              />
            </aside>
            <ResizeHandle
              size={layout.sizes.sidebar}
              min={140}
              max={360}
              direction="horizontal"
              onResize={layout.setSidebar}
              onResizeEnd={layout.setSidebar}
            />
          </>
        )}

        <aside className="schema">
          {conn ? (
            conn.kind === 'mysql' ? (
              <SchemaTree
                connection={conn}
                kind="mysql"
                onSelectTable={openTableTab}
                onInsertSqlTemplate={(sql) => newSqlTab(sql)}
                onShowTableDetail={(db, table, mode) => openTableDetail(db, table, mode)}
                onExportTable={exportTableCsv}
                onImportTable={importTableCsv}
                onExportDatabase={exportDatabase}
                onImportDatabase={importDatabase}
              />
            ) : conn.kind === 'redis' ? (
              <SchemaTree
                connection={conn}
                kind="redis"
                onSelectRedisKey={openRedisKeyTab}
              />
            ) : (
              <div className="schema-empty">{conn.kind} 暂未实现</div>
            )
          ) : (
            <div className="schema-empty">选择左侧连接</div>
          )}
        </aside>
        <ResizeHandle
          size={layout.sizes.schema}
          min={140}
          max={480}
          direction="horizontal"
          onResize={layout.setSchema}
          onResizeEnd={layout.setSchema}
        />

        <main className="workarea">
          <div className="worktabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`worktab ${t.id === activeTabId ? 'active' : ''}`}
                onClick={() => setActiveTabId(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtx({ x: e.clientX, y: e.clientY, tabId: t.id });
                }}
              >
                <span>{t.title}</span>
                {tabs.length > 1 && (
                  <button
                    className="ghost xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            <button className="worktabs-add" onClick={() => newSqlTab()}>查询</button>
          </div>

          <div className="workbody">
            {!conn ? (
              <div className="welcome">从左侧选择一个连接开始</div>
            ) : activeTab.kind === 'sql' ? (
              <SqlConsole conn={conn} initialSql={activeTab.initialSql} key={activeTab.id} />
            ) : activeTab.kind === 'table' && activeTab.database && activeTab.table ? (
              <TableBrowser conn={conn} database={activeTab.database} table={activeTab.table} />
            ) : activeTab.kind === 'redis' && activeTab.redisDb !== undefined && activeTab.redisKey !== undefined ? (
              <RedisBrowser conn={conn} db={activeTab.redisDb} keyName={activeTab.redisKey} />
            ) : null}
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span>{status}</span>
      </footer>

      {ctx && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtx(null)} />
          <div
            className="ctx-menu"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {tabs.length > 1 && (
              <button className="ctx-item" onClick={() => { closeTab(ctx.tabId); setCtx(null); }}>
                关闭
              </button>
            )}
            <button className="ctx-item" onClick={() => { closeLeftTabs(ctx.tabId); setCtx(null); }}>
              关闭左侧所有标签
            </button>
            <button className="ctx-item" onClick={() => { closeRightTabs(ctx.tabId); setCtx(null); }}>
              关闭右侧所有标签
            </button>
            <button className="ctx-item" onClick={() => { closeOtherTabs(ctx.tabId); setCtx(null); }}>
              关闭其他标签
            </button>
            <button className="ctx-item danger" onClick={() => { closeAllTabs(); setCtx(null); }}>
              关闭所有标签
            </button>
          </div>
        </>
      )}

      {editing && (
        <ConnectionEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRefreshKey((k) => k + 1);
            if (conn && conn.id === updated.id) {
              setConn(updated);
            }
            setConnStatus(updated.id, 'connecting');
            window.api.conn.listObjects(updated.id).then((r) => {
              setConnStatus(updated.id, r.ok ? 'ok' : 'error');
            });
          }}
          onTested={(ok) => {
            if (editing) setConnStatus(editing.id, ok ? 'ok' : 'error');
          }}
        />
      )}

      {detailTarget && conn && (
        <TableDetailModal
          key={`${detailTarget.db}.${detailTarget.table}.${detailTarget.mode}`}
          conn={conn}
          database={detailTarget.db}
          table={detailTarget.table}
          startInEditMode={detailTarget.mode === 'edit'}
          onClose={() => {
            setDetailTarget(null);
            // 表结构可能变，刷新一下 schema 树
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <SplashScreen />
    </div>
  );
}