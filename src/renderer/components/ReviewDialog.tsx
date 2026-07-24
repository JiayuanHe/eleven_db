/**
 * SQL 预览 / 确认对话框
 * 提交 INSERT/UPDATE/DELETE 前显示生成的 SQL 列表
 * - 每行用对应 op 的语义色背景高亮（删除红 / 更新蓝 / 新增绿）
 * - SQL 始终展开，直接看到完整语句
 * - 用户点击"确认执行"才会真的发到主进程
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

const OP_META: Record<ReviewSqlItem['op'], { label: string; color: string; bg: string; border: string }> = {
  INSERT: {
    label: '新增',
    color: 'var(--success)',
    bg: 'var(--success-soft)',
    border: 'rgba(5, 150, 105, 0.4)',
  },
  UPDATE: {
    label: '更新',
    color: 'var(--accent)',
    bg: 'var(--accent-soft)',
    border: 'rgba(37, 99, 235, 0.4)',
  },
  DELETE: {
    label: '删除',
    color: 'var(--danger)',
    bg: 'var(--danger-soft)',
    border: 'rgba(220, 38, 38, 0.4)',
  },
};

export function ReviewDialog(props: Props): JSX.Element {
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
        <div className="rev-summary">
          {counts.UPDATE > 0 && (
            <span
              className="rev-chip"
              style={{ background: OP_META.UPDATE.bg, color: OP_META.UPDATE.color, borderColor: OP_META.UPDATE.border }}
            >
              更新 {counts.UPDATE}
            </span>
          )}
          {counts.INSERT > 0 && (
            <span
              className="rev-chip"
              style={{ background: OP_META.INSERT.bg, color: OP_META.INSERT.color, borderColor: OP_META.INSERT.border }}
            >
              新增 {counts.INSERT}
            </span>
          )}
          {counts.DELETE > 0 && (
            <span
              className="rev-chip"
              style={{ background: OP_META.DELETE.bg, color: OP_META.DELETE.color, borderColor: OP_META.DELETE.border }}
            >
              删除 {counts.DELETE}
            </span>
          )}
        </div>

        <div className="modal-body rev-body">
          {props.items.map((it, i) => {
            const meta = OP_META[it.op];
            return (
              <div
                key={i}
                className={`rev-item rev-${it.op.toLowerCase()}`}
                style={{ borderLeftColor: meta.color }}
              >
                <div className="rev-item-head">
                  <span
                    className="rev-tag"
                    style={{ background: meta.bg, color: meta.color, borderColor: meta.border }}
                  >
                    {meta.label}
                  </span>
                </div>
                <pre className="rev-sql">{it.sql}</pre>
              </div>
            );
          })}
        </div>

        <div className="modal-footer rev-footer">
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