import { useEffect, useState } from 'react';
import type { ConnectionConfig, TableDetail } from '../../shared/types';
import { call, toast } from '../lib/api';
import { TableStructureEditor } from './TableStructureEditor';

/**
 * 表详情弹窗：
 * - 第一 tab：完整 DDL（SHOW CREATE TABLE）+ 表注释 / 引擎 / 字符集
 * - 第二 tab：字段表（不可编辑）
 * - 第三 tab：编辑表结构（跳到独立全屏组件）
 */

interface Props {
  conn: ConnectionConfig;
  database: string;
  table: string;
  onClose: () => void;
  /** 是否直接进入“编辑表结构”模式（默认 false，进字段详情） */
  startInEditMode?: boolean;
}

export function TableDetailModal(props: Props): JSX.Element {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'ddl' | 'fields' | 'edit'>('fields');
  const [editing, setEditing] = useState<boolean>(!!props.startInEditMode);

  const load = async () => {
    setErr(null);
    setDetail(null);
    try {
      const d = await call<TableDetail>(
        window.api.table.detail(props.conn.id, props.database, props.table),
      );
      setDetail(d);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.database, props.table, props.conn.id]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        style={{ width: editing ? '95vw' : 800, height: editing ? '90vh' : 'auto' }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span className="muted">{props.database}.</span>
            <strong>{props.table}</strong>
            {detail?.tableComment && (
              <span className="muted small" style={{ marginLeft: 8 }}>
                — {detail.tableComment}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!editing && (
              <button
                className="primary small"
                onClick={() => {
                  setTab('edit');
                  setEditing(true);
                }}
                title="修改字段类型/默认值/注释，或增删字段"
              >
                编辑表结构
              </button>
            )}
            <button className="ghost small" onClick={load} title="刷新">↻</button>
            <button className="ghost small" onClick={props.onClose}>关闭</button>
          </div>
        </div>

        {editing && detail ? (
          <TableStructureEditor
            conn={props.conn}
            database={props.database}
            table={props.table}
            detail={detail}
            onClose={() => {
              setEditing(false);
              setTab('fields');
            }}
            onApplied={() => {
              setEditing(false);
              setTab('fields');
              load();
            }}
          />
        ) : (
          <>
            <div className="tab-bar sub-tab-bar">
              <div
                className={`tab ${tab === 'fields' ? 'active' : ''}`}
                onClick={() => setTab('fields')}
              >
                字段 ({detail?.fields.length ?? '…'})
              </div>
              <div
                className={`tab ${tab === 'ddl' ? 'active' : ''}`}
                onClick={() => setTab('ddl')}
              >
                SHOW CREATE TABLE
              </div>
            </div>

            <div className="modal-body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {err ? (
                <pre className="error">{err}</pre>
              ) : !detail ? (
                <div className="empty">加载中…</div>
              ) : tab === 'fields' ? (
                <DetailFieldsView detail={detail} />
              ) : (
                <DetailDdlView detail={detail} />
              )}
            </div>

            {detail && (
              <div className="modal-footer">
                <span className="muted small">
                  引擎：{detail.engine ?? '-'} · 字符集：{detail.charset ?? '-'} · 自增：{detail.autoIncrement ?? '-'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DetailFieldsView({ detail }: { detail: TableDetail }): JSX.Element {
  return (
    <table className="detail-fields">
      <thead>
        <tr>
          <th style={{ width: 32 }}>#</th>
          <th>字段名</th>
          <th>类型</th>
          <th style={{ width: 60 }}>NULL</th>
          <th style={{ width: 80 }}>主键</th>
          <th>默认值</th>
          <th>注释</th>
        </tr>
      </thead>
      <tbody>
        {detail.fields.map((f, i) => (
          <tr key={f.name}>
            <td className="muted">{i + 1}</td>
            <td>
              <code>{f.name}</code>
            </td>
            <td>
              <code>{f.rawType}</code>
            </td>
            <td>{f.nullable ? 'YES' : 'NO'}</td>
            <td>{f.isPrimary ? '🔑' : ''}</td>
            <td>
              <code>
                {f.defaultIsNull ? 'NULL' : f.defaultValue ?? <span className="muted">—</span>}
              </code>
            </td>
            <td>{f.comment || <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailDdlView({ detail }: { detail: TableDetail }): JSX.Element {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail.ddl);
      toast.push('DDL 已复制', 'success');
    } catch {
      toast.push('复制失败', 'error');
    }
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="ghost small"
        style={{ position: 'absolute', top: 8, right: 8 }}
        onClick={copy}
      >
        复制
      </button>
      <pre className="ddl-block">{detail.ddl}</pre>
    </div>
  );
}