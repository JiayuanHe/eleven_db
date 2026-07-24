import { useEffect, useState } from 'react';
import type { ConnectionConfig } from '../../shared/types';
import { call, toast } from '../lib/api';

/**
 * 存储过程 / 函数详情弹窗
 * - 自动执行 SHOW CREATE PROCEDURE/FUNCTION
 * - 展示完整 DDL（参数、返回值、函数体等）
 * - 提供"复制 DDL"按钮
 */

interface Props {
  conn: ConnectionConfig;
  database: string;
  name: string;
  kind: 'procedure' | 'function';
  onClose: () => void;
}

export function RoutineDetailModal(props: Props): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [ddl, setDdl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sql =
      props.kind === 'procedure'
        ? `SHOW CREATE PROCEDURE \`${props.database}\`.\`${props.name}\``
        : `SHOW CREATE FUNCTION \`${props.database}\`.\`${props.name}\``;
    setLoading(true);
    setErr(null);
    setDdl('');
    call<{ rows: Record<string, unknown>[]; columns: { name: string }[] }>(
      window.api.sql.execute(props.conn.id, sql),
    )
      .then((r) => {
        if (!r.rows || r.rows.length === 0) {
          setErr('未返回结果（可能权限不足或 routine 不存在）');
          return;
        }
        // SHOW CREATE PROCEDURE 返回的字段可能是 'Create Procedure' / 'Create Function' / 'character_set_client' ...
        // 取最长的那个字段作为 DDL
        const row = r.rows[0];
        let best = '';
        for (const v of Object.values(row)) {
          const s = String(v ?? '');
          if (s.length > best.length) best = s;
        }
        if (!best) {
          setErr('无法解析 DDL');
          return;
        }
        setDdl(best);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.database, props.name, props.kind]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      toast.push('已复制 DDL', 'success');
    } catch {
      toast.push('复制失败', 'error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxHeight: '85vh' }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span className="muted">{props.database}.</span>
            <strong>{props.name}</strong>
            <span
              className="badge"
              style={{
                marginLeft: 8,
                background: props.kind === 'procedure' ? '#c084fc' : '#f59e0b',
                color: '#fff',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 999,
              }}
            >
              {props.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ghost small" onClick={copy} disabled={!ddl}>
              复制 DDL
            </button>
            <button className="ghost small" onClick={props.onClose}>关闭</button>
          </div>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="empty">加载中…</div>
          ) : err ? (
            <pre className="error">{err}</pre>
          ) : (
            <pre className="ddl-block">{ddl}</pre>
          )}
        </div>
      </div>
    </div>
  );
}