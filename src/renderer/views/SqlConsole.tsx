import { useEffect, useState } from 'react';
import type { ConnectionConfig, QueryResult } from '../../shared/types';
import { call, toast } from '../lib/api';
import { SqlEditor } from '../components/SqlEditor';
import { ResultTable } from '../components/ResultTable';
import { toCsv } from '../lib/csv';

/**
 * SQL 编辑器视图：
 * - 多 Tab 暂存，每个 Tab 独立保存状态
 * - Ctrl/Cmd + Enter 执行
 * - 结果展示 ResultTable
 */

interface Tab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  elapsedMs: number;
}

interface Props {
  conn: ConnectionConfig;
  /** 首个 Tab 的预填 SQL（从右键菜单 "生成 SELECT 模板" 等传入） */
  initialSql?: string;
}

export function SqlConsole(props: Props): JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const init = props.initialSql ?? '';
    return [{ id: '1', title: '查询 1', sql: init, result: null, loading: false, error: null, elapsedMs: 0 }];
  });
  const [activeId, setActiveId] = useState('1');

  const active = tabs.find((t) => t.id === activeId)!;

  const setTabState = (id: string, patch: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const newTab = () => {
    const id = String(Date.now());
    setTabs((ts) => [
      ...ts,
      { id, title: `查询 ${ts.length + 1}`, sql: '', result: null, loading: false, error: null, elapsedMs: 0 },
    ]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(tabs[0]?.id ?? '');
  };

  const run = async (id: string, sql: string) => {
    if (!sql.trim()) return;
    setTabState(id, { loading: true, error: null });
    try {
      const r = await call<QueryResult>(window.api.sql.execute(props.conn.id, sql));
      setTabState(id, { result: r, loading: false, elapsedMs: r.elapsedMs });
    } catch (e) {
      setTabState(id, { error: (e as Error).message, loading: false });
    }
  };

  const exportCsv = async (t: Tab) => {
    if (!t.result) return;
    const headers = t.result.columns.map((c: { name: string }) => c.name);
    const csv = toCsv(headers, t.result.rows);
    const file = await call<string | false>(window.api.exportCsv(`${t.title}.csv`, csv));
    if (file) toast.push(`已导出 ${file}`, 'success');
  };

  useEffect(() => {
    // 切换连接时清空（避免展示错连结果）
    setTabs([{ id: '1', title: '查询 1', sql: '', result: null, loading: false, error: null, elapsedMs: 0 }]);
    setActiveId('1');
  }, [props.conn.id]);

  return (
    <div className="sql-console">
      <div className="tab-bar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
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
        <button className="ghost xs" onClick={newTab}>+</button>
      </div>
      <div className="editor-area">
        <SqlEditor
          value={active.sql}
          onChange={(v) => setTabState(activeId, { sql: v })}
          onRun={() => run(activeId, active.sql)}
        />
      </div>
      <div className="result-area">
        <div className="result-toolbar">
          <button
            className="primary"
            onClick={() => run(activeId, active.sql)}
            disabled={active.loading || !active.sql.trim()}
          >
            执行 (Ctrl/Cmd+Enter)
          </button>
          {active.result && (
            <span>
              {active.result.rows.length} 行 / {active.elapsedMs} ms
            </span>
          )}
          <button onClick={() => active && exportCsv(active)}>导出 CSV</button>
        </div>
        {active.error ? (
          <pre className="error">{active.error}</pre>
        ) : active.result ? (
          <ResultTable
            columns={active.result.columns as any}
            rows={active.result.rows}
          />
        ) : (
          <div className="empty">输入 SQL 并执行</div>
        )}
      </div>
    </div>
  );
}