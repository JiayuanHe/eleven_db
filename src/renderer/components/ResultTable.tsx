import { useMemo, useState } from 'react';
import type { TableColumn as ColDef } from '../../shared/types';

/**
 * 轻量结果表（V0.1）：固定表头 + 1000 行内 in-memory 渲染。
 * V0.5 升级：react-window 虚拟滚动。
 *
 * 编辑能力（V0.2 新增）：
 * - 双击单元格 → 编辑
 * - 行首 checkbox → 多选
 * - 新增行：渲染在最上方（pending insert），全部 cell 为空、可双击填值
 * - 删除行：勾选 + 工具栏删除；提交时变 op:'delete'
 *
 * Pending 变更通过 props 传入，组件无状态。
 */

export interface CellChange {
  rowIndex: number;
  column: string;
  newValue: unknown;
  oldValue: unknown;
}

export type PendingOp = 'insert' | 'update' | 'delete';

export interface PendingRow {
  /** 在结果表里的视觉行号（用于编辑回调） */
  rowIndex: number;
  /** 操作类型：insert（行内容是全新）/ update（基于现有行）/ delete（仅保留 PK） */
  op: PendingOp;
  /** 当前内容：insert/update 包含所有字段，delete 仅 PK */
  data: Record<string, unknown>;
}

interface Props {
  columns: ColDef[];
  rows: Record<string, unknown>[];
  loading?: boolean;
  error?: string;
  /** 主键字段 */
  primaryKeys?: string[];
  /** 已有单元格的编辑 */
  changes?: Map<number, CellChange[]>;
  onCellChange?: (rowIndex: number, column: string, newValue: unknown) => void;
  onExportCsv?: () => void;
  /** 选中行（删除用） */
  selected?: Set<number>;
  onSelectRow?: (rowIndex: number, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  /** 新增 / 待插入行（顶部） */
  pendingInserts?: PendingRow[];
  onPendingInsertCell?: (rowIndex: number, column: string, newValue: unknown) => void;
  /** 编辑模式：单元格渲染为 input，可直接修改后提交 */
  editing?: boolean;
}

export function ResultTable(props: Props): JSX.Element {
  const {
    columns,
    rows,
    loading,
    error,
    changes,
    primaryKeys,
    onCellChange,
    onExportCsv,
    selected,
    onSelectRow,
    onSelectAll,
    pendingInserts,
    onPendingInsertCell,
    editing,
  } = props;

  const pkSet = useMemo(() => new Set(primaryKeys ?? []), [primaryKeys]);
  const inserts = pendingInserts ?? [];
  const allSelected = rows.length > 0 && selected && selected.size === rows.length;

  // 当前正在内联编辑的单元格
  const [localEdit, setLocalEdit] = useState<{ rowIndex: number; column: string; value: string } | null>(null);
  // 新增行的内联编辑状态
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

  if (loading) return <div className="empty">执行中…</div>;
  if (error) return <pre className="error">{error}</pre>;
  if (rows.length === 0 && inserts.length === 0) return <div className="empty">无数据</div>;

  return (
    <div className="result-table">
      <div className="result-scroll">
        <table>
          <thead>
            <tr>
              <th className="select-col">
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  onChange={(e) => onSelectAll?.(e.target.checked)}
                  title="全选 / 全不选"
                />
              </th>
              {columns.map((c) => (
                <th key={c.name} className={pkSet.has(c.name) ? 'pk' : ''}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* pending insert 行 */}
            {inserts.map((ins) => (
              <tr key={`insert-${ins.rowIndex}`} className="insert-row">
                <td className="select-col">
                  <span className="badge-insert" title="待新增">+</span>
                </td>
                {columns.map((c) => {
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

            {rows.map((row, i) => {
              const rowChanges = changes?.get(i);
              const dirtyCols = new Set(rowChanges?.map((ch) => ch.column) ?? []);
              const isSelected = selected?.has(i) ?? false;
              return (
                <tr
                  key={i}
                  className={`${dirtyCols.size > 0 ? 'dirty' : ''} ${isSelected ? 'selected' : ''}`}
                >
                  <td className="select-col">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onSelectRow?.(i, e.target.checked)}
                    />
                  </td>
                  {columns.map((c) => {
                    const newVal = dirtyCols.has(c.name)
                      ? rowChanges!.find((ch) => ch.column === c.name)!.newValue
                      : row[c.name];

                    if (editing && isLocalEditing(i, c.name)) {
                      return (
                        <td key={c.name}>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}