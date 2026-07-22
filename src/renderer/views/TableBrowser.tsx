import { useEffect, useMemo, useState } from 'react';
import type { ConnectionConfig, QueryResult, TableColumn } from '../../shared/types';
import { call, toast } from '../lib/api';
import { ResultTable, CellChange, PendingRow } from '../components/ResultTable';
import { PaginationIcon } from '../components/PaginationIcon';
import { toCsv } from '../lib/csv';
import {
  OPERATORS,
  COMBINATORS,
  Op,
  Combinator,
  WhereClause,
  defaultSuggestions,
  combine,
  withAdvanced,
} from '../lib/where-builder';

/**
 * 表数据视图：
 * - 顶部：表名 + 多条件组合（默认 AND）+ 高级 WHERE + 增删改按钮
 * - 中部：可编辑结果表（含待插入行、复选框）
 * - 底部：状态栏 + 提交 / 导出
 *
 * 行级 CRUD 流程：
 * - 新增：点 "+ 新增行" → 在表顶部出现空行；双击单元格填值
 * - 编辑：双击现有行的单元格 → 改值（黄底标脏）
 * - 删除：勾选行首复选框 → 点 "删除选中 (N)"
 * - 提交：点 "提交 (M)" → 批量 INSERT/UPDATE/DELETE（事务）
 */

interface Props {
  conn: ConnectionConfig;
  database: string;
  table: string;
}

let INSERT_COUNTER = -1;

export function TableBrowser(props: Props): JSX.Element {
  const [schema, setSchema] = useState<TableColumn[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [changes, setChanges] = useState<Map<number, CellChange[]>>(new Map());

  // 多条件
  const [rowGroups, setRowGroups] = useState<WhereClause[][]>([
    [{ column: '', op: '=', value: '' }],
  ]);
  const [combinator, setCombinator] = useState<Combinator>('AND');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [showConditions, setShowConditions] = useState(false);

  // CRUD 状态
  const [pendingInserts, setPendingInserts] = useState<PendingRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const pks = useMemo(() => schema.filter((c) => c.isPrimary).map((c) => c.name), [schema]);
  const clauses = useMemo(() => rowGroups.flat(), [rowGroups]);

  const activeClauseCount = useMemo(() => {
    return clauses.filter((c) => {
      if (!c.column) return false;
      if (c.op === 'IS NULL' || c.op === 'IS NOT NULL') return true;
      return c.value.trim().length > 0;
    }).length;
  }, [clauses]);

  const composedWhere = useMemo(() => {
    const valid = clauses.filter((c) => {
      if (!c.column) return false;
      if (c.op === 'IS NULL' || c.op === 'IS NOT NULL') return true;
      return c.value.trim().length > 0;
    });
    const combined = combine(valid, combinator);
    return withAdvanced(combined, advanced);
  }, [clauses, combinator, advanced]);

  // 待提交总变更数
  const pendingCount = changes.size + pendingInserts.length + selected.size;

  const reload = async (overrideWhere?: string) => {
    setLoading(true);
    setErr(null);
    setChanges(new Map());
    setSelected(new Set());
    setPendingInserts([]);
    try {
      const cols = await call<TableColumn[]>(
        window.api.table.schema(props.conn.id, props.database, props.table),
      );
      setSchema(cols);
      const whereFinal = overrideWhere !== undefined ? overrideWhere : composedWhere;
      const r = await call<QueryResult>(
        window.api.table.data({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          page,
          pageSize,
          where: whereFinal,
        }),
      );
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setChanges(new Map());
    setSelected(new Set());
    setPendingInserts([]);
    setRowGroups([[{ column: '', op: '=', value: '' }]]);
    setCombinator('AND');
    setAdvanced('');
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.database, props.table, props.conn.id]);

  useEffect(() => {
    if (!schema.length) return;
    setPage(1);
    reload(composedWhere);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clauses, combinator, advanced]);

  // ---------- 单元格编辑 ----------
  const onCellChange = (rowIndex: number, column: string, newValue: unknown) => {
    if (!result) return;
    const oldValue = result.rows[rowIndex]?.[column];
    setChanges((prev) => {
      const next = new Map(prev);
      const arr = next.get(rowIndex) ?? [];
      const existingIdx = arr.findIndex((ch) => ch.column === column);
      const newArr =
        existingIdx >= 0
          ? arr.map((ch, i) => (i === existingIdx ? { ...ch, newValue } : ch))
          : [...arr, { rowIndex, column, newValue, oldValue }];
      next.set(rowIndex, newArr);
      return next;
    });
  };

  // ---------- 新增行 ----------
  const addInsertRow = () => {
    INSERT_COUNTER -= 1;
    const rowIndex = INSERT_COUNTER;
    setPendingInserts((rows) => [...rows, { rowIndex, op: 'insert', data: {} }]);
  };
  const onPendingInsertCell = (rowIndex: number, column: string, newValue: unknown) => {
    setPendingInserts((rows) =>
      rows.map((r) => (r.rowIndex === rowIndex ? { ...r, data: { ...r.data, [column]: newValue } } : r)),
    );
  };

  // ---------- 选中 ----------
  const onSelectRow = (rowIndex: number, sel: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (sel) next.add(rowIndex); else next.delete(rowIndex);
      return next;
    });
  };
  const onSelectAll = (sel: boolean) => {
    if (!result) return;
    if (sel) setSelected(new Set(result.rows.map((_, i) => i)));
    else setSelected(new Set());
  };

  // ---------- 提交 ----------
  const onCommit = async () => {
    if (pendingCount === 0) return toast.push('没有变更', 'info');

    const rows: any[] = [];

    // 1) INSERT
    for (const ins of pendingInserts) {
      rows.push({ op: 'insert', data: ins.data });
    }

    // 2) UPDATE
    if (changes.size > 0 && pks.length === 0) {
      return toast.push('该表无主键，无法安全生成 UPDATE', 'error');
    }
    if (changes.size > 0 && !result) return;
    for (const [rowIndex, arr] of changes) {
      if (!result) continue;
      const original = result.rows[rowIndex];
      const data: Record<string, unknown> = {};
      for (const ch of arr) data[ch.column] = ch.newValue;
      rows.push({
        op: 'update',
        data,
        pk: Object.fromEntries(pks.map((k) => [k, original[k]])),
      });
    }

    // 3) DELETE
    if (selected.size > 0 && pks.length === 0) {
      return toast.push('该表无主键，无法安全生成 DELETE', 'error');
    }
    if (selected.size > 0 && !result) return;
    for (const idx of selected) {
      if (!result) continue;
      const original = result.rows[idx];
      rows.push({
        op: 'delete',
        data: {},
        pk: Object.fromEntries(pks.map((k) => [k, original[k]])),
      });
    }

    if (rows.length === 0) return;

    try {
      await call(
        window.api.table.commit({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          rows,
        }),
      );
      const parts: string[] = [];
      const insN = pendingInserts.length;
      const updN = changes.size;
      const delN = selected.size;
      if (insN) parts.push(`新增 ${insN}`);
      if (updN) parts.push(`更新 ${updN}`);
      if (delN) parts.push(`删除 ${delN}`);
      toast.push(`已提交：${parts.join('、')}`, 'success');
      reload();
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };

  const onExport = async (scope: 'page' | 'all' = 'page') => {
    if (scope === 'all') {
      const r = await call<QueryResult>(
        window.api.table.exportAll({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          where: composedWhere || undefined,
        }),
      );
      const headers = r.columns.map((c: { name: string }) => c.name);
      const csv = toCsv(headers, r.rows);
      const file = await call<string | false>(window.api.exportCsv(`${props.table}_all.csv`, csv));
      if (file) toast.push(`已导出 ${r.rows.length} 行至 ${file}`, 'success');
      return;
    }
    if (!result) return;
    const headers = result.columns.map((c: { name: string }) => c.name);
    const csv = toCsv(headers, result.rows);
    const file = await call<string | false>(window.api.exportCsv(`${props.table}.csv`, csv));
    if (file) toast.push(`已导出 ${result.rows.length} 行至 ${file}`, 'success');
  };

  const onDeleteSelected = () => {
    if (selected.size === 0) return;
    if (pks.length === 0) {
      toast.push('该表无主键，无法安全生成 DELETE', 'error');
      return;
    }
    // 选中行已收集在 selected 中，提交时会变 op:'delete'
    toast.push(`已标记 ${selected.size} 行待删除，点提交写入数据库`, 'info');
  };

  // ---------- 条件区 handler ----------
  const parseSuggestion = (s: string): WhereClause | null => {
    const m = s.match(/^([`\w]+)\s+(IS NULL|IS NOT NULL|LIKE|NOT LIKE|=|<>|>=|<=|>|<|IN|BETWEEN)\s*(.*)$/);
    if (!m) return null;
    return {
      column: m[1].replace(/`/g, ''),
      op: m[2] as Op,
      value: m[3] ?? '',
    };
  };
  const addRow = () => setRowGroups((rs) => [...rs, [{ column: '', op: '=', value: '' }]]);
  const removeRow = (rowIdx: number) =>
    setRowGroups((rs) => rs.filter((_, i) => i !== rowIdx));
  const addItemToRow = (rowIdx: number) =>
    setRowGroups((rs) =>
      rs.map((row, i) =>
        i === rowIdx ? [...row, { column: '', op: '=', value: '' }] : row,
      ),
    );
  const removeItem = (rowIdx: number, itemIdx: number) =>
    setRowGroups((rs) =>
      rs
        .map((row, i) =>
          i === rowIdx ? row.filter((_, j) => j !== itemIdx) : row,
        )
        .filter((row) => row.length > 0),
    );
  const updateItem = (rowIdx: number, itemIdx: number, patch: Partial<WhereClause>) =>
    setRowGroups((rs) =>
      rs.map((row, i) =>
        i === rowIdx
          ? row.map((c, j) => (j === itemIdx ? { ...c, ...patch } : c))
          : row,
      ),
    );

  return (
    <div className="table-browser" onClick={() => setShowExportMenu(false)}>
      <div className="tb-toolbar">
        <button onClick={addInsertRow} title="插入一行新数据">
          + 新增行
        </button>
        <button
          onClick={() => setEditing((e) => !e)}
          title="开启后可直接点击单元格编辑整张表"
        >
          {editing ? '退出编辑' : '编辑'}
        </button>
        <button
          onClick={onCommit}
          disabled={pendingCount === 0}
          className="primary"
          title="把所有变更（新增 / 修改 / 删除）一次性写入数据库（事务）"
        >
          提交 ({pendingCount} 项)
        </button>
        <button onClick={() => reload(composedWhere)}>刷新</button>
        <button
          onClick={onDeleteSelected}
          disabled={selected.size === 0}
          className="danger-ghost"
          title="删除选中的行"
        >
          删除 ({selected.size})
        </button>
        <div className="export-wrap" style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowExportMenu((v) => !v); }}>导出 ▾</button>
          {showExportMenu && (
            <div className="export-dropdown" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setShowExportMenu(false); onExport('page'); }}>导出当前页</button>
              <button onClick={() => { setShowExportMenu(false); onExport('all'); }}>导出全部数据</button>
            </div>
          )}
        </div>
        <button onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? '隐藏高级' : '高级'}
        </button>

        {showAdvanced && (
          <div className="filter-advanced">
            <input
              placeholder="高级 WHERE（手写 SQL）"
              value={advanced}
              onChange={(e) => setAdvanced(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') reload();
              }}
              style={{ flex: 1 }}
            />
          </div>
        )}

        <div className="filter-conditions">
          <div className="cond-toggle">
            <button
              className="ghost small"
              onClick={() => setShowConditions((s) => !s)}
              title="展开 / 折叠筛选条件"
            >
              {showConditions ? '▼ 筛选' : '▶ 筛选'}
              {activeClauseCount > 0 && (
                <span style={{ marginLeft: 4, color: 'var(--accent)' }}>
                  · {activeClauseCount} 条
                </span>
              )}
            </button>
            {activeClauseCount > 0 && (
              <span className="summary" title={composedWhere}>
                {composedWhere}
              </span>
            )}
          </div>

          {showConditions && (
            <div className="cond-body">
              <div className="cond-row cond-header">
                <span className="cond-label">组合方式</span>
                <select
                  className="col-op"
                  value={combinator}
                  onChange={(e) => setCombinator(e.target.value as Combinator)}
                  title="行间 / 行内的组合方式"
                >
                  {COMBINATORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button className="ghost small" onClick={addRow}>+ 新行</button>
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  行内可放多条；超过 3 条建议开新行
                </span>
              </div>

              {rowGroups.map((row, rowIdx) => (
                <div key={rowIdx} className="cond-row">
                  {row.map((cl, itemIdx) => (
                    <span key={itemIdx} className="cond-item">
                      <select
                        className="col-field"
                        value={cl.column}
                        onChange={(e) =>
                          updateItem(rowIdx, itemIdx, { column: e.target.value, value: '' })
                        }
                        title="字段"
                      >
                        <option value="">— 字段 —</option>
                        {schema.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({c.type}){c.isPrimary ? ' [PK]' : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        className="col-op"
                        value={cl.op}
                        onChange={(e) =>
                          updateItem(rowIdx, itemIdx, { op: e.target.value as Op })
                        }
                        title="运算符"
                        disabled={!cl.column}
                      >
                        {OPERATORS.map((op) => (
                          <option key={op} value={op}>{op}</option>
                        ))}
                      </select>
                      <input
                        className="col-val"
                        placeholder={
                          !cl.column
                            ? '先选字段'
                            : cl.op === 'IS NULL' || cl.op === 'IS NOT NULL'
                              ? '（无需值）'
                              : cl.op === 'LIKE' || cl.op === 'NOT LIKE'
                                ? "%foo% 或 'abc'"
                                : cl.op === 'IN'
                                  ? "1, 2, 3 或 'a','b'"
                                  : cl.op === 'BETWEEN'
                                    ? '1 AND 100'
                                    : '值'
                        }
                        value={cl.value}
                        onChange={(e) =>
                          updateItem(rowIdx, itemIdx, { value: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') reload(composedWhere);
                        }}
                        disabled={!cl.column || cl.op === 'IS NULL' || cl.op === 'IS NOT NULL'}
                      />
                      {searchSuggestionFor(schema, cl) && (
                        <select
                          className="col-sug"
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const parsed = parseSuggestion(e.target.value);
                            if (parsed) updateItem(rowIdx, itemIdx, parsed);
                          }}
                          value=""
                          title="推荐条件"
                        >
                          <option value="">推荐</option>
                          {defaultSuggestions(searchSuggestionFor(schema, cl)!).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      )}
                      <button
                        className="ghost small col-del"
                        title="删除该条件"
                        onClick={() => removeItem(rowIdx, itemIdx)}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {row.length > 1 && (
                    <span className="row-connector" title="行内按上方组合方式串联">
                      {combinator}
                    </span>
                  )}

                  <button
                    className="ghost small row-add"
                    title="在当前行再加一条"
                    onClick={() => addItemToRow(rowIdx)}
                  >
                    +
                  </button>
                  <button
                    className="ghost small row-del"
                    title="删除整行"
                    onClick={() => removeRow(rowIdx)}
                    disabled={rowGroups.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {err ? (
        <pre className="error">{err}</pre>
      ) : !result ? (
        <div className="empty">加载中…</div>
      ) : (
        <ResultTable
          columns={result.columns as any}
          rows={result.rows}
          loading={loading}
          primaryKeys={pks}
          changes={changes}
          onCellChange={onCellChange}
          onExportCsv={onExport}
          selected={selected}
          onSelectRow={onSelectRow}
          onSelectAll={onSelectAll}
          pendingInserts={pendingInserts}
          onPendingInsertCell={onPendingInsertCell}
          editing={editing}
        />
      )}
      <div className="tb-statusbar">
        <span>主键：{pks.join(', ') || '无'}</span>
        <span>耗时：{result?.elapsedMs ?? 0} ms</span>

        <span className="statusbar-spacer" />

        {result && (() => {
          const totalRows = result.affectedRows ?? 0;
          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
          const safePage = Math.min(page, totalPages);
          return (
            <div className="pager">
              <select
                value={pageSize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPageSize(next);
                  setPage(1);
                  reload(composedWhere);
                }}
                title="每页行数"
                className="pager-size"
              >
                {[25, 50, 100, 200, 500].map((n) => (
                  <option key={n} value={n}>{n}/页</option>
                ))}
              </select>

              <PaginationIcon
                kind="first"
                onClick={() => { setPage(1); reload(composedWhere); }}
                disabled={safePage <= 1}
                title="首页"
              />
              <PaginationIcon
                kind="prev"
                onClick={() => { setPage((p) => Math.max(1, p - 1)); reload(composedWhere); }}
                disabled={safePage <= 1}
                title="上一页"
              />

              <span className="pager-info">
                第{' '}
                <input
                  className="pager-jump"
                  type="number"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(totalPages, Number(e.target.value) || 1));
                    setPage(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') reload(composedWhere);
                  }}
                />{' '}
                / {totalPages} 页
              </span>
              <span className="pager-total">共 {totalRows.toLocaleString()} 行</span>

              <PaginationIcon
                kind="next"
                onClick={() => { setPage((p) => p + 1); reload(composedWhere); }}
                disabled={safePage >= totalPages}
                title="下一页"
              />
              <PaginationIcon
                kind="last"
                onClick={() => { setPage(totalPages); reload(composedWhere); }}
                disabled={safePage >= totalPages}
                title="末页"
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function searchSuggestionFor(
  schema: TableColumn[],
  cl: WhereClause,
): TableColumn | null {
  return schema.find((c) => c.name === cl.column) ?? null;
}