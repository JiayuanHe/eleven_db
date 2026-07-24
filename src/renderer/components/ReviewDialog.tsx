import { useState } from 'react';

/**
 * SQL 预览 / 确认对话框
 * 提交 INSERT/UPDATE/DELETE 前显示生成的 SQL 列表
 * 用户点击"确认执行"才会真的发到主进程
 */

export interface ReviewSqlItem {
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  sql: string;
}

interface Props {
  database: string;
  table: string;
  items: ReviewSqlItem[];
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

const OP_META: Record<ReviewSqlItem['op'], { label: string; color: string; bg: string }> = {
  INSERT: { label: '新增', color: 'var(--success)', bg: 'var(--success-soft)' },
  UPDATE: { label: '更新', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  DELETE: { label: '删除', color: 'var(--danger)', bg: 'var(--danger-soft)' },
};

export function ReviewDialog(props: Props): JSX.Element {
  const [expanded, setExpanded] = useState<{ [i: number]: boolean }>({});
  const counts: Record<ReviewSqlItem['op'], number> = {
    INSERT: 0,
    UPDATE: 0,
    DELETE: 0,
  };
  for (const it of props.items) counts[it.op]++;

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxHeight: '85vh' }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span className="muted">{props.database}.</span>
            <strong>{props.table}</strong>
            <span className="muted small" style={{ marginLeft: 8 }}>
              即将执行 {props.items.length} 条语句
            </span>
          </div>
          <button className="ghost small" onClick={props.onCancel}>取消</button>
        </div>

        {/* 顶部汇总 chip */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
          {counts.UPDATE > 0 && (
            <span className="rev-chip" style={{ background: OP_META.UPDATE.bg, color: OP_META.UPDATE.color }}>
              更新 {counts.UPDATE}
            </span>
          )}
          {counts.INSERT > 0 && (
            <span className="rev-chip" style={{ background: OP_META.INSERT.bg, color: OP_META.INSERT.color }}>
              新增 {counts.INSERT}
            </span>
          )}
          {counts.DELETE > 0 && (
            <span className="rev-chip" style={{ background: OP_META.DELETE.bg, color: OP_META.DELETE.color }}>
              删除 {counts.DELETE}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span className="muted small">点击行展开 / 收起详情</span>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {props.items.map((it, i) => {
            const meta = OP_META[it.op];
            const isOpen = expanded[i] ?? false;
            return (
              <div
                key={i}
                className="rev-row"
                onClick={() => setExpanded((p) => ({ ...p, [i]: !isOpen }))}
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <div className="rev-row-head">
                  <span
                    className="rev-tag"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="rev-sql-preview">
                    {it.sql.split('\n')[0]}
                  </span>
                  <span className="muted small rev-toggle">{isOpen ? '▾' : '▸'}</span>
                </div>
                {isOpen && (
                  <pre className="rev-sql-detail">{it.sql}</pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted small">
            ⚠ 这些操作将立即写入数据库（事务）
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={props.onCancel} disabled={props.busy}>取消</button>
            <button className="primary" onClick={props.onConfirm} disabled={props.busy}>
              {props.busy ? '执行中…' : '确认执行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}