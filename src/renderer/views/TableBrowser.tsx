import { useEffect, useMemo, useState } from 'react';
import type { ConnectionConfig, QueryResult, TableColumn } from '../../shared/types';
import { call, toast } from '../lib/api';
import { ResultTable, CellChange, PendingRow } from '../components/ResultTable';
import { PaginationIcon } from '../components/PaginationIcon';
import { ReviewDialog, ReviewSqlItem } from '../components/ReviewDialog';
import { toCsv } from '../lib/csv';
import {
  OPERATORS,
  Op,
  WhereClause,
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [orderBy, setOrderBy] = useState('');
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

  /**
   * 当所有筛选条件都被清空（activeClauseCount === 0）但面板仍展开时，
   * 自动收起面板。点击筛选按钮或底部"+ 添加条件"会重新展开。
   */
  useEffect(() => {
    if (showConditions && activeClauseCount === 0 && clauses.every((c) => c.column === '' && c.value === '')) {
      setShowConditions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClauseCount]);

  const composedWhere = useMemo(() => {
    const valid = clauses.filter((c) => {
      if (!c.column) return false;
      if (c.op === 'IS NULL' || c.op === 'IS NOT NULL') return true;
      return c.value.trim().length > 0;
    });
    // 多条件默认全部以 AND 连接。OR 请使用高级 WHERE。
    const combined = combine(valid, 'AND');
    return withAdvanced(combined, advanced);
  }, [clauses, advanced]);

  // 待删除行集合（点击“删除”后累积，保留到 reload）
  // 区分原因：用户可能勾选后点击“删除”→ 状态变 pendingDelete；勾选取消后 selected 变，
  //           但 pendingDelete 仍保留删除意图。
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(new Set());

  // 待提交总变更数
  const pendingCount = changes.size + pendingInserts.length + pendingDelete.size;

  const reload = async (overrideWhere?: string) => {
    setLoading(true);
    setErr(null);
    setChanges(new Map());
    setSelected(new Set());
    setPendingInserts([]);
    setPendingDelete(new Set());
    try {
      const cols = await call<TableColumn[]>(
        window.api.table.schema(props.conn.id, props.database, props.table),
      );
      setSchema(cols);
      const whereFinal = overrideWhere !== undefined ? overrideWhere : composedWhere;
      const orderByFinal = orderBy.trim() || undefined;
      const r = await call<QueryResult>(
        window.api.table.data({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          page,
          pageSize,
          where: whereFinal,
          orderBy: orderByFinal,
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
    setAdvanced('');
    setOrderBy('');
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.database, props.table, props.conn.id]);

  useEffect(() => {
    if (!schema.length) return;
    setPage(1);
    reload(composedWhere);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clauses, advanced]);

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
  // selected = 复选框当前状态（双向 toggle，UI 同步）
  // pendingDelete = 待删除行集合（点击“删除”后累积，保留到 reload）—— 定义在前面
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

  /**
   * “删除”按钮：把当前勾选行加入 pendingDelete（累积语义）
   * 取消勾选不影响 pendingDelete；只有 reload 或退出表才清除
   */
  const onMarkDelete = () => {
    if (selected.size === 0) {
      toast.push('请先勾选要删除的行', 'info');
      return;
    }
    if (pks.length === 0) {
      toast.push('该表无主键，无法安全生成 DELETE', 'error');
      return;
    }
    setPendingDelete((prev) => {
      const next = new Set(prev);
      for (const i of selected) next.add(i);
      return next;
    });
    setSelected(new Set());
    toast.push(`已标记 ${selected.size} 行待删除（勾选框已清空，标记会保留到刷新）`, 'info');
  };

  /**
   * 显式撤销某个待删除标记（用于在 reload 前撤销某个特定删除）
   */
  const unmarkDelete = (rowIndex: number) => {
    setPendingDelete((prev) => {
      const next = new Set(prev);
      next.delete(rowIndex);
      return next;
    });
  };

  /**
   * 清除所有待删除
   */
  const clearPendingDelete = () => setPendingDelete(new Set());

  // ---------- 提交 ----------
  /**
   * 从 pendingInserts / changes / selected 构建 CommitRow[] 和对应的 SQL 预览
   */
  const buildReview = (): { rows: any[]; items: ReviewSqlItem[] } | null => {
    const rows: any[] = [];
    const items: ReviewSqlItem[] = [];
    const fullName = `\`${props.database}\`.\`${props.table}\``;

    // 1) INSERT
    for (const ins of pendingInserts) {
      const cols = Object.keys(ins.data);
      if (cols.length === 0) {
        // 跳过完全空的插入行
        continue;
      }
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const vals = cols.map((c) => {
        const v = ins.data[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        if (typeof v === 'boolean') return v ? '1' : '0';
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      rows.push({ op: 'insert', data: ins.data });
      items.push({
        op: 'INSERT',
        sql: `INSERT INTO ${fullName} (${colList}) VALUES\n  (${vals.join(', ')});`,
      });
    }

    // 2) UPDATE
    if (changes.size > 0 && pks.length === 0) {
      toast.push('该表无主键，无法安全生成 UPDATE', 'error');
      return null;
    }
    if (changes.size > 0 && !result) return null;
    for (const [rowIndex, arr] of changes) {
      if (!result) continue;
      const original = result.rows[rowIndex];
      const data: Record<string, unknown> = {};
      for (const ch of arr) data[ch.column] = ch.newValue;
      const pk = Object.fromEntries(pks.map((k) => [k, original[k]]));

      const setSql = Object.keys(data)
        .map((c) => `  \`${c}\` = ${sqlValue(data[c])}`)
        .join(',\n');
      const whereSql = Object.keys(pk)
        .map((c) => `  \`${c}\` = ${sqlValue(pk[c])}`)
        .join(' AND ');
      const sql = `UPDATE ${fullName}\nSET\n${setSql}\nWHERE ${whereSql};`;

      rows.push({ op: 'update', data, pk });
      items.push({ op: 'UPDATE', sql });
    }

    // 3) DELETE（基于 pendingDelete，积累语义，勾选取消不影响）
    if (pendingDelete.size > 0 && pks.length === 0) {
      toast.push('该表无主键，无法安全生成 DELETE', 'error');
      return null;
    }
    if (pendingDelete.size > 0 && !result) return null;
    for (const idx of pendingDelete) {
      if (!result) continue;
      if (idx >= result.rows.length) continue; // 安全检查
      const original = result.rows[idx];
      const pk = Object.fromEntries(pks.map((k) => [k, original[k]]));
      const whereSql = Object.keys(pk)
        .map((c) => `  \`${c}\` = ${sqlValue(pk[c])}`)
        .join(' AND ');
      const sql = `DELETE FROM ${fullName}\nWHERE ${whereSql};`;

      rows.push({ op: 'delete', data: {}, pk });
      items.push({ op: 'DELETE', sql });
    }

    return { rows, items };
  };

  /** Review 对话框：显示所有即将执行的 SQL */
  const [review, setReview] = useState<{ items: ReviewSqlItem[]; rows: any[] } | null>(null);
  const [committing, setCommitting] = useState(false);

  const onCommit = () => {
    if (pendingCount === 0) return toast.push('没有变更', 'info');
    const r = buildReview();
    if (!r) return;
    if (r.rows.length === 0) return toast.push('没有可提交的变更', 'info');
    setReview({ items: r.items, rows: r.rows });
  };

  /** 用户在 Review 对话框点击"确认执行" */
  const onConfirmCommit = async () => {
    if (!review) return;
    setCommitting(true);
    try {
      await call(
        window.api.table.commit({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          rows: review.rows,
        }),
      );
      const parts: string[] = [];
      if (pendingInserts.length) parts.push(`新增 ${pendingInserts.length}`);
      if (changes.size) parts.push(`更新 ${changes.size}`);
      if (selected.size) parts.push(`删除 ${selected.size}`);
      toast.push(`已提交：${parts.join('、')}`, 'success');
      setReview(null);
      reload();
    } catch (e) {
      toast.push((e as Error).message, 'error');
    } finally {
      setCommitting(false);
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
    // 已被 onMarkDelete 取代，保留仅为兼容。
  };

  // ---------- 条件区 handler ----------
  const addRow = () => setRowGroups((rs) => [...rs, [{ column: '', op: '=', value: '' }]]);
  const removeRow = (rowIdx: number) =>
    setRowGroups((rs) => {
      const next = rs.filter((_, i) => i !== rowIdx);
      // 至少保留一行
      if (next.length === 0) next.push([{ column: '', op: '=', value: '' }]);
      return next;
    });
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
        // 保留至少一个空行（避免全删后让面板看起来没东西）
        .filter((row, i, arr) => row.length > 0 || (arr.length === 1 && i === 0)),
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
          onClick={onMarkDelete}
          disabled={selected.size === 0}
          className="danger-ghost"
          title="把当前勾选行标记为待删除（即使取消勾选也保留）"
        >
          删除 ({selected.size})
        </button>
        {pendingDelete.size > 0 && (
          <button
            onClick={clearPendingDelete}
            className="danger-ghost"
            title="清空所有待删除标记"
          >
            清除删除 ({pendingDelete.size})
          </button>
        )}
        <div className="export-wrap" style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowExportMenu((v) => !v); }}>导出 ▾</button>
          {showExportMenu && (
            <div className="export-dropdown" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setShowExportMenu(false); onExport('page'); }}>导出当前页</button>
              <button onClick={() => { setShowExportMenu(false); onExport('all'); }}>导出全部数据</button>
            </div>
          )}
        </div>
        <button
          className={`toggle-btn ${showAdvanced ? 'active' : ''}`}
          onClick={() => setShowAdvanced((s) => !s)}
          title="手写 WHERE / ORDER BY"
        >
          高级 {showAdvanced ? '▾' : '▸'}
        </button>

        <button
          className={`toggle-btn ${showConditions ? 'active' : ''}`}
          onClick={() => {
            setShowConditions((s) => {
              if (s) return false;
              // 从关闭 → 打开：保证至少有一行
              if (rowGroups.length === 0) {
                addRow();
              } else {
                // 最后一行如果是空的，不额外加；否则加一个新空行
                const last = rowGroups[rowGroups.length - 1];
                const lastActive = last.some(
                  (c) => c.column && c.value.trim().length > 0,
                );
                if (lastActive) addRow();
              }
              return true;
            });
          }}
          title="点击展开筛选条件构建器"
        >
          筛选 {showConditions ? '▾' : '▸'}
          {activeClauseCount > 0 && (
            <span className="badge">{activeClauseCount}</span>
          )}
        </button>

        {showAdvanced && (
          <div className="filter-advanced">
            <div className="adv-row">
              <span className="adv-label">WHERE</span>
              <input
                placeholder="例如 status = 'active' AND created_at > '2025-01-01'"
                value={advanced}
                onChange={(e) => setAdvanced(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') reload();
                }}
              />
            </div>
            <div className="adv-row">
              <span className="adv-label">ORDER BY</span>
              <input
                placeholder="例如 id DESC 或 name ASC, created_at DESC"
                value={orderBy}
                onChange={(e) => setOrderBy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') reload();
                }}
              />
            </div>
          </div>
        )}

        {showConditions && (
          <div className="filter-conditions">
            <div className="cond-body">
              {rowGroups.map((row, rowIdx) => (
                <div key={rowIdx} className="cond-row">
                  {row.map((cl, itemIdx) => (
                    <span key={itemIdx} className="cond-item">
                      <input
                        className="col-field"
                        list={`col-list-${rowIdx}-${itemIdx}`}
                        placeholder="请选字段"
                        value={cl.column}
                        onChange={(e) =>
                          updateItem(rowIdx, itemIdx, { column: e.target.value, value: '' })
                        }
                        title="字段（可直接输入搜索）"
                      />
                      <datalist id={`col-list-${rowIdx}-${itemIdx}`}>
                        {schema.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </datalist>
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
                      <button
                        className="ghost small col-del"
                        title="删除该条件"
                        onClick={() => removeItem(rowIdx, itemIdx)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {rowGroups.length > 1 && (
                    <button
                      className="ghost small row-del"
                      title="删除整行"
                      onClick={() => removeRow(rowIdx)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="cond-footer">
              <button
                className="cond-add-btn"
                title="在末尾添加一条新条件"
                onClick={() => {
                  // 始终在 rowGroups 最后一行末尾加一个空条件
                  if (rowGroups.length === 0) {
                    addRow();
                  } else {
                    addItemToRow(rowGroups.length - 1);
                  }
                }}
              >
                + 添加条件
              </button>
            </div>
          </div>
        )}
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

      {review && (
        <ReviewDialog
          database={props.database}
          table={props.table}
          items={review.items}
          busy={committing}
          onCancel={() => setReview(null)}
          onConfirm={onConfirmCommit}
        />
      )}
    </div>
  );
}

/** 将 JS 值转成 SQL 字面量 */
function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}