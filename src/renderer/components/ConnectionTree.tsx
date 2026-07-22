import { useEffect, useState } from 'react';
import type { ConnectionConfig } from '../../shared/types';
import { call } from '../lib/api';

export type ConnectionStatus = 'unknown' | 'connecting' | 'ok' | 'error';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onEdit: (cfg: ConnectionConfig) => void;
  refreshKey: number;
  /** 各连接的连通状态，key = connection.id */
  statuses: Record<string, ConnectionStatus>;
}

export function ConnectionTree(props: Props): JSX.Element {
  const [list, setList] = useState<ConnectionConfig[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await call<ConnectionConfig[]>(window.api.conn.list());
      setList(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshKey]);

  return (
    <div className="connection-tree">
      <div className="tree-toolbar">
        <span className="title">连接</span>
        <button
          className="ghost"
          onClick={() => {
            props.onEdit({
              id: '',
              name: '',
              kind: 'mysql',
              host: 'localhost',
              port: 3306,
              username: 'root',
              database: '',
              charset: 'utf8mb4',
              createdAt: 0,
              updatedAt: 0,
            });
          }}
        >
          + 新建
        </button>
      </div>
      <div className="tree-list">
        {loading ? (
          <div className="muted small">加载中…</div>
        ) : list.length === 0 ? (
          <div className="muted small">还没有连接，点击 + 新建连接</div>
        ) : (
          list.map((c) => {
            const status = props.statuses[c.id] ?? 'unknown';
            // 状态对应的小标签：通、未测、未通、连不上（不显红/橙，全部走中性+绿）
            const statusLabel =
              status === 'ok' ? '通' :
              status === 'connecting' ? '…' :
              status === 'error' ? '未通' :
              ''; // unknown 不显示
            return (
              <div
                key={c.id}
                className={`tree-row ${props.activeId === c.id ? 'active' : ''}`}
                onClick={() => props.onSelect(c.id)}
                onDoubleClick={() => props.onEdit(c)}
                title={`${c.host}:${c.port}`}
              >
                <span className={`dot status-${status}`} />
                <span className="name">{c.name}</span>
                {statusLabel && (
                  <span className={`status-label status-${status}`}>{statusLabel}</span>
                )}
                <button
                  className="ghost small"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onEdit(c);
                  }}
                >
                  ✎
                </button>
                <button
                  className="ghost small"
                  title="复制"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await call(window.api.conn.duplicate(c.id));
                    load();
                  }}
                >
                  ⧉
                </button>
                <button
                  className="ghost small"
                  title="删除"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`删除连接 "${c.name}"？`)) return;
                    await call(window.api.conn.remove(c.id));
                    load();
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}