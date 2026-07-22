import { useEffect, useState } from 'react';
import type { ConnectionConfig, SchemaObject } from '../../shared/types';
import { ConnectionTree, ConnectionStatus } from '../components/ConnectionTree';
import { ConnectionEditor } from '../components/ConnectionEditor';
import { SchemaTree } from '../components/SchemaTree';
import { ResizeHandle } from '../components/ResizeHandle';
import { SqlConsole } from './SqlConsole';
import { TableBrowser } from './TableBrowser';
import { RedisBrowser } from './RedisBrowser';
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
  const [status, setStatus] = useState<string>('就绪');
  const [theme, toggleTheme] = useTheme();
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
  const newSqlTab = (initialSql?: string) => {
    const id = String(Date.now());
    setTabs((ts) => [...ts, { id, kind: 'sql', title: `查询 ${ts.length}`, initialSql }]);
    setActiveTabId(id);
  };
  const [dropdownOpen, setDropdownOpen] = useState<'left' | 'right' | 'others' | 'all' | null>(null);

  const closeTab = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id !== id));
    if (activeTabId === id) setActiveTabId(tabs[0]?.id ?? '');
  };
  const closeLeftTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx <= 0) return;
    setTabs((ts) => ts.slice(idx));
    setActiveTabId(id);
    setDropdownOpen(null);
  };
  const closeRightTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0 || idx >= tabs.length - 1) return;
    setTabs((ts) => ts.slice(0, idx + 1));
    setDropdownOpen(null);
  };
  const closeOtherTabs = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id === id));
    setActiveTabId(id);
    setDropdownOpen(null);
  };
  const closeAllTabs = () => {
    const newId = String(Date.now());
    setTabs([{ id: newId, kind: 'sql', title: '查询 1' }]);
    setActiveTabId(newId);
    setDropdownOpen(null);
  };

  const showSidebar = layout.sizes.sidebar > 0;

  return (
    <div
      className="app"
      onClick={() => { if (dropdownOpen) setDropdownOpen(null); }}
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
            ? `${conn.name} · ${conn.host}:${conn.port} · ${conn.kind.toUpperCase()}`
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
            onClick={() => toggleTheme()}
          >
            {theme === 'light' ? '☀ 亮色' : '☾ 暗色'}
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
                  setDropdownOpen(null);
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
            <div className="tab-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
              <button className="ghost xs" onClick={() => setDropdownOpen(dropdownOpen ? null : 'all')}>⋮</button>
              {dropdownOpen && (
                <div className="tab-dropdown">
                  <button className="ctx-item" onClick={() => { closeLeftTabs(activeTabId); }}>关闭左侧所有标签</button>
                  <button className="ctx-item" onClick={() => { closeRightTabs(activeTabId); }}>关闭右侧所有标签</button>
                  <button className="ctx-item" onClick={() => { closeOtherTabs(activeTabId); }}>关闭其他标签</button>
                  <button className="ctx-item danger" onClick={() => { closeAllTabs(); }}>关闭所有标签</button>
                </div>
              )}
            </div>
            <button className="ghost xs" onClick={() => newSqlTab()}>+ 查询</button>
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
        <span className="muted">V1 · MySQL + Redis</span>
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
    </div>
  );
}