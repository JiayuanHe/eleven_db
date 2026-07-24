import { useEffect, useMemo, useRef, useState } from 'react';
import type { TableColumn as ColDef } from '../../shared/types';

/**
 * 轻量结果表（V0.1）：固定表头 + 1000 行内 in-memory 渲染。
 * V0.5 升级：react-window 虚拟滚动。
 *
 * 功能（V0.2+）：
 * - 行编辑（双击 cell）
 * - 行选中 / 标记删除
 * - 插入待提交行（顶部）
 * - 列头点击排序
 * - 列宽拖动
 * - 列隐藏
 * - 当前视图搜索（所有列模糊匹配）
 */

export interface CellChange {
  rowIndex: number;
  column: string;
  newValue: unknown;
  oldValue: unknown;
}

export type PendingOp = 'insert' | 'update' | 'delete';

export interface PendingRow {
  rowIndex: number;
  op: PendingOp;
  data: Record<string, unknown>;
}

interface Props {
  columns: ColDef[];
  rows: Record<string, unknown>[];
  loading?: boolean;
  error?: string;
  primaryKeys?: string[];
  changes?: Map<number, CellChange[]>;
  onCellChange?: (rowIndex: number, column: string, newValue: unknown) => void;
  onExportCsv?: () => void;
  selected?: Set<number>;
  onSelectRow?: (rowIndex: number, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  pendingDelete?: Set<number>;
  pendingInserts?: PendingRow[];
  onPendingInsertCell?: (rowIndex: number, column: string, newValue: unknown) => void;
  editing?: boolean;
  sortable?: boolean;
}

const DEFAULT_COL_WIDTH = 160;   // 默认列宽
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 600;

export function ResultTable(props: Props): JSX.Element {
  const {
    columns,
    rows,
    loading,
    error,
    changes,
    primaryKeys,
    onCellChange,
    selected,
    onSelectRow,
    onSelectAll,
    pendingInserts,
    onPendingInsertCell,
    editing,
  } = props;

  const pkSet = useMemo(() => new Set(primaryKeys ?? []), [primaryKeys]);
  const inserts = pendingInserts ?? [];
  const sortable = props.sortable !== false;

  // ---------- 排序 ----------
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const cycleSort = (colName: string) => {
    setSort((prev) => {
      if (!prev || prev.col !== colName) return { col: colName, dir: 'asc' };
      if (prev.dir === 'asc') return { col: colName, dir: 'desc' };
      return null;
    });
  };

  // ---------- 列宽（持久化在内存）----------
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const setColWidth = (colName: string, w: number) => {
    setColWidths((prev) => ({ ...prev, [colName]: w }));
  };
  const getColWidth = (c: ColDef) => colWidths[c.name] ?? DEFAULT_COL_WIDTH;

  // ---------- 列隐藏 ----------
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const toggleHide = (colName: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  };
  const showAllCols = () => setHiddenCols(new Set());
  const [showColMenu, setShowColMenu] = useState(false);

  // 列头右键菜单
  const [ctxCol, setCtxCol] = useState<string | null>(null);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);

  // ---------- 当前视图搜索 ----------
  const [search, setSearch] = useState('');
  const searchLower = search.trim().toLowerCase();
  const visibleCols = useMemo(() => columns.filter((c) => !hiddenCols.has(c.name)), [columns, hiddenCols]);
  const searchedRows = useMemo(() => {
    if (!searchLower) return rows;
    return rows.filter((r) =>
      visibleCols.some((c) => {
        const v = r[c.name];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(searchLower);
      }),
    );
  }, [rows, searchLower, visibleCols]);

  const allSelected = searchedRows.length > 0 && selected && selected.size === searchedRows.length;
  const sortedRows = useMemo(() => {
    if (!sort) return searchedRows;
    const { col, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...searchedRows].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
      if (typeof av === 'string' && typeof bv === 'string') {
        const an = Number(av);
        const bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') {
          return (an - bn) * mul;
        }
        return av.localeCompare(bv) * mul;
      }
      return String(av).localeCompare(String(bv)) * mul;
    });
  }, [searchedRows, sort]);

  // ---------- 本地编辑 ----------
  const [localEdit, setLocalEdit] = useState<{ rowIndex: number; column: string; value: string } | null>(null);
  const [localInsertEdit, setLocalInsertEdit] = useState<{ rowIndex: number; column: string; value: string } | null>(null);

  const commitLocalEdit = (rowIndex: number, column: string, value: string) => {
    const raw = value === '' ? null : value;
    onCellChange?.(rowIndex, column, raw);
    setLocalEdit(null);
  };
  const commitLocalInsertEdit = (rowIndex: number, column: string, value: string) => {
    const raw = value === '' ? null : value;
    onPendingInsertCell?.(rowIndex, column, raw);
    setLocalInsertEdit(null);
  };
  const isLocalEditing = (rowIndex: number, column: string) =>
    localEdit?.rowIndex === rowIndex && localEdit?.column === column;
  const isLocalInsertEditing = (rowIndex: number, column: string) =>
    localInsertEdit?.rowIndex === rowIndex && localInsertEdit?.column === column;

  // ---------- 列宽拖动 ----------
  // 拖动时直接操作 <col> 元素的 style.width，不触发 React re-render；
  // dragStateRef.current 保存中间状态，mouseup 时才同步到 React state。
  // 用 ref 映射列名 → <col> 元素 + <th> 元素。
  const colRefs = useRef<Map<string, HTMLTableColElement>>(new Map());
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const dragStateRef = useRef<{
    colName: string;
    startX: number;
    startW: number;
  } | null>(null);

  const startColDrag = (colName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = getColWidth(columns.find((c) => c.name === colName)!);
    dragStateRef.current = { colName, startX: e.clientX, startW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dx = e.clientX - s.startX;
      const newW = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, s.startW + dx));
      // 直接修改 DOM 元素，避免 re-render 跳动
      const colEl = colRefs.current.get(s.colName);
      const thEl = thRefs.current.get(s.colName);
      if (colEl) colEl.style.width = `${newW}px`;
      if (thEl) thEl.style.width = `${newW}px`;
    };
    const onUp = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }
      // 同步最终宽度到 React state
      const dx = e.clientX - s.startX;
      const newW = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, s.startW + dx));
      setColWidth(s.colName, newW);
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="empty">执行中…</div>;
  if (error) return <pre className="error">{error}</pre>;
  if (rows.length === 0 && inserts.length === 0) return <div className="empty">无数据</div>;

  return (
    <div className="result-table">
      {/* 工具栏：搜索 + 列管理 */}
      <div className="result-table-toolbar">
        <div className="rt-search">
          <input
            placeholder="搜索当前视图（任意列模糊匹配）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="ghost xs" onClick={() => setSearch('')} title="清空搜索">×</button>
          )}
        </div>
        <span className="muted small rt-count">
          {search ? `${searchedRows.length} / ${rows.length} 行` : `${rows.length} 行`}
        </span>
        <div className="rt-col-menu-wrap">
          <button
            className="ghost small"
            onClick={() => setShowColMenu((s) => !s)}
            title="列管理"
          >
            列 ▾
          </button>
          {showColMenu && (
            <div className="rt-col-menu" onClick={(e) => e.stopPropagation()}>
              <div className="rt-col-menu-head">
                <span className="muted small">显示 / 隐藏列</span>
                {hiddenCols.size > 0 && (
                  <button className="ghost xs" onClick={showAllCols}>全部显示</button>
                )}
              </div>
              {columns.map((c) => (
                <label key={c.name} className="rt-col-item">
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(c.name)}
                    onChange={() => toggleHide(c.name)}
                  />
                  <span>{c.name}</span>
                  {pkSet.has(c.name) && <span className="muted small">[PK]</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="result-scroll">
        <table>
          <colgroup>
            {visibleCols.map((c) => (
              <col
                key={c.name}
                ref={(el) => {
                  if (el) colRefs.current.set(c.name, el);
                  else colRefs.current.delete(c.name);
                }}
                style={{ width: getColWidth(c) }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="select-col" style={{ width: 36 }} />
              {visibleCols.map((c) => {
                const isSorted = sort?.col === c.name;
                const sortDir = isSorted ? sort!.dir : null;
                const cls = [
                  pkSet.has(c.name) ? 'pk' : '',
                  sortable ? 'sortable' : '',
                  isSorted ? `sorted-${sortDir}` : '',
                  hiddenCols.has(c.name) ? 'hidden' : '',
                ].filter(Boolean).join(' ');
                return (
                  <th
                    key={c.name}
                    ref={(el) => {
                      if (el) thRefs.current.set(c.name, el);
                      else thRefs.current.delete(c.name);
                    }}
                    className={cls}
                    style={{ width: getColWidth(c) }}
                    onClick={sortable ? () => cycleSort(c.name) : undefined}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxCol(c.name);
                      setCtxPos({ x: e.clientX, y: e.clientY });
                    }}
                    title={sortable ? '点击排序 / 右键菜单' : undefined}
                  >
                    <span className="th-name">{c.name}</span>
                    {sortable && (
                      <span className="sort-ind" aria-hidden>
                        <span className={'arrow up' + (isSorted && sortDir === 'asc' ? ' active' : '')}>▲</span>
                        <span className={'arrow down' + (isSorted && sortDir === 'desc' ? ' active' : '')}>▼</span>
                      </span>
                    )}
                    {/* 列宽拖动 handle */}
                    <span
                      className="col-resize"
                      onMouseDown={(e) => startColDrag(c.name, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* pending insert 行 */}
            {inserts.map((ins) => (
              <tr key={`insert-${ins.rowIndex}`} className="insert-row">
                <td className="select-col">
                  <span className="badge-insert" title="待新增">+</span>
                </td>
                {visibleCols.map((c) => {
                  const v = ins.data[c.name];
                  if (editing && isLocalInsertEditing(ins.rowIndex, c.name)) {
                    return (
                      <td key={c.name}>
                        <input
                          className="cell-input"
                          autoFocus
                          defaultValue={v === undefined || v === null ? '' : String(v)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitLocalInsertEdit(ins.rowIndex, c.name, (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') setLocalInsertEdit(null);
                          }}
                          onBlur={(e) => commitLocalInsertEdit(ins.rowIndex, c.name, e.target.value)}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.name}
                      onClick={editing ? () => setLocalInsertEdit({ rowIndex: ins.rowIndex, column: c.name, value: v === undefined || v === null ? '' : String(v) }) : undefined}
                      style={editing ? { cursor: 'text' } : undefined}
                      className={pkSet.has(c.name) ? 'pk' : ''}
                    >
                      {v === undefined || v === null ? (
                        <span className="muted small">点击编辑</span>
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {sortedRows.map((row, i) => {
              const rowChanges = changes?.get(i);
              const dirtyCols = new Set(rowChanges?.map((ch) => ch.column) ?? []);
              const isSelected = selected?.has(i) ?? false;
              const isPendingDelete = props.pendingDelete?.has(i) ?? false;
              const rowCls = [
                dirtyCols.size > 0 ? 'row-edited' : '',
                isSelected ? 'selected' : '',
                isPendingDelete ? 'row-pending-delete' : '',
              ].filter(Boolean).join(' ');
              return (
                <tr key={i} className={rowCls}>
                  <td className="select-col">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onSelectRow?.(i, e.target.checked)}
                    />
                  </td>
                  {visibleCols.map((c) => {
                    const newVal = dirtyCols.has(c.name)
                      ? rowChanges!.find((ch) => ch.column === c.name)!.newValue
                      : row[c.name];
                    const isDirty = dirtyCols.has(c.name);
                    if (editing && isLocalEditing(i, c.name)) {
                      return (
                        <td key={c.name} className={isDirty ? 'cell-dirty' : ''}>
                          <input
                            className="cell-input"
                            autoFocus
                            defaultValue={newVal === null ? '' : String(newVal)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitLocalEdit(i, c.name, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setLocalEdit(null);
                            }}
                            onBlur={(e) => commitLocalEdit(i, c.name, e.target.value)}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c.name}
                        className={isDirty ? 'cell-dirty' : ''}
                        onClick={editing ? () => setLocalEdit({ rowIndex: i, column: c.name, value: newVal === null ? '' : String(newVal) }) : undefined}
                        style={editing ? { cursor: 'text' } : undefined}
                      >
                        {newVal === null || newVal === undefined ? (
                          <span className="null">NULL</span>
                        ) : (
                          String(newVal)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {searchLower && searchedRows.length === 0 && rows.length > 0 && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="empty" style={{ padding: 20 }}>
                  无匹配 "{search}" 的行（{rows.length} 行原始数据）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 列头右键菜单 */}
      {ctxCol && ctxPos && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => { setCtxCol(null); setCtxPos(null); }}
            onContextMenu={(e) => { e.preventDefault(); setCtxCol(null); setCtxPos(null); }}
          />
          <div
            className="ctx-menu"
            style={{ left: ctxPos.x, top: ctxPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ctx-menu-header">[{ctxCol}]</div>
            <button
              className="ctx-item"
              onClick={() => { toggleHide(ctxCol); setCtxCol(null); }}
            >
              {hiddenCols.has(ctxCol) ? '显示该列' : '隐藏该列'}
            </button>
            {hiddenCols.size > 0 && (
              <button
                className="ctx-item"
                onClick={() => { showAllCols(); setCtxCol(null); }}
              >
                显示所有列
              </button>
            )}
            <button
              className="ctx-item"
              onClick={() => { setColWidth(ctxCol, DEFAULT_COL_WIDTH); setCtxCol(null); }}
            >
              重置列宽
            </button>
          </div>
        </>
      )}
    </div>
  );
}