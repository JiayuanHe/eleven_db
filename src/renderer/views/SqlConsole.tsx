import { useEffect, useState } from 'react';
import type { ConnectionConfig, QueryResult, SchemaObject } from '../../shared/types';
import { call, toast } from '../lib/api';
import { SqlEditor } from '../components/SqlEditor';
import { ResultTable } from '../components/ResultTable';
import { toCsv } from '../lib/csv';
import { formatSql } from '../lib/sqlFormat';

/**
 * 单个 SQL 编辑器视图（无内嵌 tab）：
 * - 由外层 App 的 WorkTab 控制"多个查询 tab"
 * - 本组件只负责：编辑 + 数据库选择 + 执行 + 展示结果 + 导出/格式化
 * - Ctrl/Cmd + Enter 执行
 * - 数据库选择 + 表/列补全
 */

interface Props {
  conn: ConnectionConfig;
  /** 预填 SQL（从右键菜单 "生成 SELECT 模板" 等传入；只在首次挂载时使用） */
  initialSql?: string;
}

interface TableCompletion {
  name: string;
  columns: string[];
}

export function SqlConsole(props: Props): JSX.Element {
  // SQL 编辑器内容（受控）
  const [sql, setSql] = useState<string>(() => props.initialSql ?? '');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // 数据库选择 + 补全
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [completions, setCompletions] = useState<{ tables: TableCompletion[] }>({ tables: [] });

  // 加载数据库列表
  useEffect(() => {
    setSchemas([]);
    setSelectedDb('');
    setCompletions({ tables: [] });
    call<SchemaObject[]>(window.api.conn.listObjects(props.conn.id, undefined))
      .then((dbs) => {
        const names = dbs.map((d) => d.name);
        setSchemas(names);
        if (names.length > 0) setSelectedDb(names[0]);
      })
      .catch(() => {});
  }, [props.conn.id]);

  // 加载选中数据库的表补全
  useEffect(() => {
    if (!selectedDb) return;
    setCompletions({ tables: [] });
    call<SchemaObject[]>(window.api.conn.listObjects(props.conn.id, selectedDb)).then((tables) => {
      Promise.all(
        tables.map((t) =>
          call<any[]>(window.api.table.schema(props.conn.id, selectedDb, t.name))
            .then((cols) => ({ name: t.name, columns: cols.map((c: any) => c.name) }))
            .catch(() => ({ name: t.name, columns: [] as string[] })),
        ),
      ).then((result) => setCompletions({ tables: result }));
    }).catch(() => {});
  }, [props.conn.id, selectedDb]);

  const run = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const actualSql =
        selectedDb && selectedDb !== props.conn.database
          ? `USE \`${selectedDb}\`;\n${sql.trim()}`
          : sql.trim();
      const r = await call<QueryResult>(window.api.sql.execute(props.conn.id, actualSql));
      setResult(r);
      setElapsedMs(r.elapsedMs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    if (!result) return;
    const headers = result.columns.map((c: { name: string }) => c.name);
    const csv = toCsv(headers, result.rows);
    const file = await call<string | false>(window.api.exportCsv(`查询结果.csv`, csv));
    if (file) toast.push(`已导出 ${file}`, 'success');
  };

  return (
    <div className="sql-console">
      <div className="editor-area">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={run}
          completions={completions}
        />
      </div>
      <div className="result-area">
        <div className="result-toolbar">
          <span className="sql-db-label">库：</span>
          <select
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
          >
            {schemas.map((db) => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
          <button
            className="primary"
            onClick={run}
            disabled={loading || !sql.trim()}
          >
            {loading ? '执行中…' : '执行 (Ctrl/Cmd+Enter)'}
          </button>
          {result && (
            <span className="muted small">
              {result.rows.length.toLocaleString()} 行 · {elapsedMs} ms
            </span>
          )}
          <button onClick={exportCsv} disabled={!result}>导出 CSV</button>
          <button onClick={() => setSql(formatSql(sql))}>格式化</button>
          <button
            onClick={() => {
              if (!sql.trim()) {
                toast.push('SQL 为空', 'info');
                return;
              }
              const name = window.prompt('脚本名称：', sql.split('\n')[0].slice(0, 30) || '未命名');
              if (!name) return;
              import('../lib/scripts').then(({ ScriptStore }) => {
                const s = ScriptStore.create(name, sql);
                toast.push(`已保存脚本：${s.name}`, 'success');
              });
            }}
            disabled={!sql.trim()}
            title="把当前 SQL 保存为脚本（左侧脚本区可点击调用）"
          >
            保存为脚本
          </button>
        </div>
        {error ? (
          <pre className="error">{error}</pre>
        ) : result ? (
          <ResultTable columns={result.columns as any} rows={result.rows} />
        ) : (
          <div className="empty">输入 SQL 并执行</div>
        )}
      </div>
    </div>
  );
}