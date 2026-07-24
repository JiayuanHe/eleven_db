import { useEffect, useState } from 'react';
import type { ConnectionConfig } from '../../shared/types';
import { call, toast } from '../lib/api';

export type ConnectionStatus = 'unknown' | 'connecting' | 'ok' | 'error';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onEdit: (cfg: ConnectionConfig) => void;
  refreshKey: number;
  statuses: Record<string, ConnectionStatus>;
}

const HIDDEN_KEY = 'eleven.hiddenConnections';

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveHidden(s: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* ignore */
  }
}

export function ConnectionTree(props: Props): JSX.Element {
  const [list, setList] = useState<ConnectionConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden());
  const [showHidden, setShowHidden] = useState(false);
  /** 右键菜单 */
  const [ctx, setCtx] = useState<{ cfg: ConnectionConfig; x: number; y: number } | null>(null);

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

  // 点击空白关闭右键菜单
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctx]);

  const visibleList = list.filter((c) => !hidden.has(c.id));
  const hiddenList = list.filter((c) => hidden.has(c.id));

  const toggleHide = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(next);
      return next;
    });
  };

  const unhideAll = () => {
    setHidden(new Set());
    saveHidden(new Set());
    setShowHidden(false);
    toast.push('已恢复所有隐藏连接', 'success');
  };

  const handleCtxMenu = (cfg: ConnectionConfig, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ cfg, x: e.clientX, y: e.clientY });
  };

  const renderRow = (c: ConnectionConfig, isHiddenRow = false) => {
    const status = props.statuses[c.id] ?? 'unknown';
    const statusLabel =
      status === 'ok' ? '通' :
      status === 'connecting' ? '…' :
      status === 'error' ? '未通' :
      '';
    return (
      <div
        key={c.id}
        className={`tree-row ${props.activeId === c.id ? 'active' : ''} ${isHiddenRow ? 'tree-row-hidden' : ''}`}
        onClick={() => props.onSelect(c.id)}
        onContextMenu={(e) => handleCtxMenu(c, e)}
        title={`${c.host}:${c.port}`}
      >
        <span className={`dot status-${status}`} />
        <span className="name">{c.name}</span>
        {statusLabel && (
          <span className={`status-label status-${status}`}>{statusLabel}</span>
        )}
      </div>
    );
  };

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
          <>
            {visibleList.map((c) => renderRow(c))}
            {hiddenList.length > 0 && (
              <div className="tree-hidden-section">
                <div
                  className="tree-hidden-toggle"
                  onClick={() => setShowHidden((s) => !s)}
                  title="已隐藏的连接"
                >
                  <span className="caret">{showHidden ? '▾' : '▸'}</span>
                  <span>已隐藏 ({hiddenList.length})</span>
                  <button
                    className="ghost xs"
                    onClick={(e) => { e.stopPropagation(); unhideAll(); }}
                    title="恢复所有隐藏连接"
                  >
                    全部恢复
                  </button>
                </div>
                {showHidden && hiddenList.map((c) => renderRow(c, true))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 右键菜单 */}
      {ctx && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtx(null); }}
          />
          <div
            className="ctx-menu"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ctx-menu-header">{ctx.cfg.name}</div>
            <button
              className="ctx-item"
              onClick={() => { props.onEdit(ctx.cfg); setCtx(null); }}
            >
              编辑
            </button>
            <button
              className="ctx-item"
              onClick={async () => {
                await call(window.api.conn.duplicate(ctx.cfg.id));
                await load();
                setCtx(null);
                toast.push('已复制连接', 'success');
              }}
            >
              复制
            </button>
            <button
              className="ctx-item"
              onClick={() => { toggleHide(ctx.cfg.id); setCtx(null); }}
            >
              {hidden.has(ctx.cfg.id) ? '取消隐藏' : '隐藏'}
            </button>
            <button
              className="ctx-item"
              onClick={async () => {
                if (!confirm(`测试连接 "${ctx.cfg.name}"？`)) {
                  setCtx(null);
                  return;
                }
                setCtx(null);
                try {
                  await call(window.api.conn.test(ctx.cfg, ctx.cfg.passwordCipher ? undefined : undefined));
                  toast.push('连接成功', 'success');
                } catch (e) {
                  toast.push('连接失败：' + (e as Error).message, 'error');
                }
              }}
            >
              测试连接
            </button>
            <button
              className="ctx-item danger"
              onClick={async () => {
                if (!confirm(`删除连接 "${ctx.cfg.name}"？`)) {
                  setCtx(null);
                  return;
                }
                await call(window.api.conn.remove(ctx.cfg.id));
                await load();
                setCtx(null);
                toast.push('已删除', 'success');
              }}
            >
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}