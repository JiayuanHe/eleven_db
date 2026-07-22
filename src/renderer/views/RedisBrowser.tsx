import { useEffect, useMemo, useState } from 'react';
import type { ConnectionConfig } from '../../shared/types';
import { call, toast } from '../lib/api';
import { toCsv } from '../lib/csv';

/**
 * Redis 浏览器：键列表 + 值查看/编辑 + TTL + 简易 CLI 命令行。
 *
 * 设计：
 * - 上方：db + key 名 + 类型 chip + TTL 编辑 + 操作（删除 / 重命名）
 * - 中部：按类型适配的编辑器（String/Hash/List/Set/ZSet）
 * - 底部：状态栏 + CLI 命令行（执行任意 Redis 命令，安全黑名单由主进程把关）
 */

interface Props {
  conn: ConnectionConfig;
  db: number;
  /** Redis key 名（不能用 `key`，那是 React 保留 prop） */
  keyName: string;
}

type KeyInfo = {
  name: string;
  type: string;
  ttl: number;
  encoding?: string;
  size?: number;
};

type ValueData = {
  stringValue?: string;
  hashValue?: Array<[string, string]>;
  listValue?: string[];
  setValue?: string[];
  zsetValue?: Array<{ member: string; score: number }>;
  streamValue?: Array<{ id: string; fields: Array<[string, string]> }>;
};

const TYPE_LABEL: Record<string, string> = {
  string: 'String',
  hash: 'Hash',
  list: 'List',
  set: 'Set',
  zset: 'ZSet',
  stream: 'Stream',
  unknown: 'Unknown',
};

export function RedisBrowser(props: Props): JSX.Element {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [data, setData] = useState<ValueData>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ttlInput, setTtlInput] = useState<string>('');
  const [dirty, setDirty] = useState(false);

  // CLI
  const [cmdText, setCmdText] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cliOut, setCliOut] = useState<string>('');

  const reload = async () => {
    setLoading(true);
    setErr(null);
    setDirty(false);
    try {
      const i = await call<KeyInfo>(window.api.redis.describeKey(props.conn.id, props.db, props.keyName));
      setInfo(i);
      setTtlInput(i.ttl < 0 ? '' : String(i.ttl));
      const v = await call<ValueData & { key: string; type: string }>(
        window.api.redis.getValue(props.conn.id, props.db, props.keyName, i.type),
      );
      const { key: _, type: __, ...rest } = v;
      void _; void __;
      setData(rest);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.db, props.keyName, props.conn.id]);

  const onCommitValue = async () => {
    if (!info) return;
    try {
      await call(window.api.redis.setValue({
        id: props.conn.id,
        database: props.db,
        key: props.keyName,
        type: info.type,
        data,
      }));
      toast.push('已保存', 'success');
      setDirty(false);
      reload();
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };

  const onSetTtl = async () => {
    if (!ttlInput.trim()) {
      // 空 = 永不过期
      try {
        await call(window.api.redis.persist(props.conn.id, props.db, props.keyName));
        toast.push('TTL 已清除', 'success');
        reload();
      } catch (e) { toast.push((e as Error).message, 'error'); }
      return;
    }
    const n = Number(ttlInput);
    if (!Number.isFinite(n) || n < 0) return toast.push('TTL 必须是 ≥0 的数字', 'error');
    try {
      await call(window.api.redis.expire(props.conn.id, props.db, props.keyName, n));
      toast.push('TTL 已设置', 'success');
      reload();
    } catch (e) { toast.push((e as Error).message, 'error'); }
  };

  const onDelete = async () => {
    if (!confirm(`删除 key "${props.keyName}"?`)) return;
    try {
      await call(window.api.redis.del(props.conn.id, props.db, props.keyName));
      toast.push('已删除', 'success');
    } catch (e) { toast.push((e as Error).message, 'error'); }
  };

  const onRename = async () => {
    const next = window.prompt('新 key 名', props.keyName);
    if (!next || next === props.keyName) return;
    try {
      await call(window.api.redis.rename(props.conn.id, props.db, props.keyName, next));
      toast.push('已重命名', 'success');
    } catch (e) { toast.push((e as Error).message, 'error'); }
  };

  const runCli = async () => {
    const text = cmdText.trim();
    if (!text) return;
    // 简易分词：按空格；支持 "GET foo" / "SET k v" 这种
    const parts = text.split(/\s+/);
    const cmd = parts.shift()!;
    const args = parts;
    setCmdHistory((h) => [text, ...h].slice(0, 50));
    try {
      const r = await call<unknown>(
        window.api.redis.runCommand(props.conn.id, props.db, cmd, args),
      );
      setCliOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setCliOut(`(error) ${(e as Error).message}`);
    }
  };

  // ---------- 类型化编辑器 ----------
  const typeEditor = useMemo(() => {
    if (!info) return null;
    switch (info.type) {
      case 'string':
        return <StringEditor value={data.stringValue ?? ''} onChange={(v) => { setData({ stringValue: v }); setDirty(true); }} />;
      case 'hash': {
        const rows = data.hashValue ?? [];
        return (
          <div className="redis-list">
            {rows.map(([k, v], i) => (
              <div key={i} className="redis-list-row">
                <input value={k} onChange={(e) => {
                  const next = [...rows]; next[i] = [e.target.value, v]; setData({ hashValue: next }); setDirty(true);
                }} />
                <input value={v} onChange={(e) => {
                  const next = [...rows]; next[i] = [k, e.target.value]; setData({ hashValue: next }); setDirty(true);
                }} />
                <button className="ghost small" onClick={() => {
                  setData({ hashValue: rows.filter((_, j) => j !== i) }); setDirty(true);
                }}>×</button>
              </div>
            ))}
            <button className="ghost small" onClick={() => {
              setData({ hashValue: [...rows, ['new-key', 'value']] }); setDirty(true);
            }}>+ 字段</button>
          </div>
        );
      }
      case 'list': {
        const rows = data.listValue ?? [];
        return (
          <div className="redis-list">
            {rows.map((v, i) => (
              <div key={i} className="redis-list-row">
                <span className="idx">{i}</span>
                <input value={v} onChange={(e) => {
                  const next = [...rows]; next[i] = e.target.value; setData({ listValue: next }); setDirty(true);
                }} />
                <button className="ghost small" onClick={() => {
                  setData({ listValue: rows.filter((_, j) => j !== i) }); setDirty(true);
                }}>×</button>
              </div>
            ))}
            <button className="ghost small" onClick={() => {
              setData({ listValue: [...rows, ''] }); setDirty(true);
            }}>+ 元素</button>
          </div>
        );
      }
      case 'set': {
        const rows = data.setValue ?? [];
        return (
          <div className="redis-list">
            {rows.map((v, i) => (
              <div key={i} className="redis-list-row">
                <input value={v} onChange={(e) => {
                  const next = [...rows]; next[i] = e.target.value; setData({ setValue: next }); setDirty(true);
                }} />
                <button className="ghost small" onClick={() => {
                  setData({ setValue: rows.filter((_, j) => j !== i) }); setDirty(true);
                }}>×</button>
              </div>
            ))}
            <button className="ghost small" onClick={() => {
              setData({ setValue: [...rows, ''] }); setDirty(true);
            }}>+ 成员</button>
          </div>
        );
      }
      case 'zset': {
        const rows = data.zsetValue ?? [];
        return (
          <div className="redis-list">
            {rows.map((m, i) => (
              <div key={i} className="redis-list-row">
                <span className="idx">{m.score}</span>
                <input value={m.member} onChange={(e) => {
                  const next = [...rows]; next[i] = { score: m.score, member: e.target.value }; setData({ zsetValue: next }); setDirty(true);
                }} />
                <input
                  type="number"
                  value={m.score}
                  onChange={(e) => {
                    const next = [...rows]; next[i] = { score: Number(e.target.value), member: m.member }; setData({ zsetValue: next }); setDirty(true);
                  }}
                  style={{ width: 80 }}
                />
                <button className="ghost small" onClick={() => {
                  setData({ zsetValue: rows.filter((_, j) => j !== i) }); setDirty(true);
                }}>×</button>
              </div>
            ))}
            <button className="ghost small" onClick={() => {
              setData({ zsetValue: [...rows, { score: 0, member: 'new' }] }); setDirty(true);
            }}>+ 成员</button>
          </div>
        );
      }
      case 'stream': {
        const rows = data.streamValue ?? [];
        return (
          <div className="redis-stream">
            <div className="muted small" style={{ marginBottom: 8 }}>
              Stream（前 {rows.length} 条；V1.1 暂只读）
            </div>
            {rows.length === 0 ? (
              <div className="empty">空 stream</div>
            ) : (
              rows.map((entry, i) => (
                <div key={i} className="redis-stream-entry">
                  <div className="redis-stream-id">{entry.id}</div>
                  {entry.fields.map(([k, v], j) => (
                    <div key={j} className="redis-stream-field">
                      <span className="redis-stream-key">{k}</span>
                      <span className="redis-stream-val">{v}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        );
      }
      case 'unknown':
        // 未知类型：直接显示 raw bytes (无法解析)
        return (
          <div className="empty">
            该类型（{info.type}）暂不可视化编辑，请用底部 CLI 命令操作
          </div>
        );
      default:
        return <div className="empty">未知类型 ({info.type})</div>;
    }
  }, [info, data]);

  return (
    <div className="redis-browser">
      <div className="rb-toolbar">
        <h3>db{props.db} · {props.keyName}</h3>
        {info && (
          <>
            <span className={`rb-type type-${info.type}`}>{TYPE_LABEL[info.type] ?? info.type}</span>
            <span className="muted small">
              TTL:
              <input
                className="ttl-input"
                value={ttlInput}
                onChange={(e) => setTtlInput(e.target.value)}
                placeholder="-1=永不过期"
              />
              <button className="ghost small" onClick={onSetTtl}>应用</button>
            </span>
            <span className="muted small">size={info.size ?? 1}</span>
            <button onClick={onCommitValue} disabled={!dirty} className="primary">
              {dirty ? '保存' : '未改动'}
            </button>
            <button onClick={onRename}>重命名</button>
            <button onClick={onDelete} className="danger-ghost">删除</button>
            <button onClick={reload}>刷新</button>
          </>
        )}
      </div>

      {err ? (
        <pre className="error">{err}</pre>
      ) : loading ? (
        <div className="empty">加载中…</div>
      ) : (
        <div className="rb-editor">{typeEditor}</div>
      )}

      {/* CLI */}
      <div className="rb-cli">
        <div className="rb-cli-head">简易 CLI（主进程已禁用 CONFIG/SHUTDOWN/FLUSHDB 等危险命令）</div>
        <div className="rb-cli-row">
          <span className="prompt">db{props.db}&gt;</span>
          <input
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runCli(); }}
            placeholder='GET foo   或   KEYS user:*   或   HGETALL myhash'
            spellCheck={false}
          />
          <button className="ghost" onClick={runCli}>执行</button>
        </div>
        {cmdHistory.length > 0 && (
          <details className="rb-cli-history">
            <summary>历史（{cmdHistory.length}）</summary>
            {cmdHistory.map((h, i) => (
              <div key={i} className="rb-cli-hist-row" onClick={() => setCmdText(h)}>{h}</div>
            ))}
          </details>
        )}
        {cliOut && <pre className="rb-cli-out">{cliOut}</pre>}
      </div>
    </div>
  );
}

/**
 * String 编辑器：自动 detect JSON
 * - JSON: 高亮 + 校验，给出 tree view（简化）
 * - Plain: textarea
 */
function StringEditor({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [mode, setMode] = useState<'auto' | 'raw'>('auto');
  const trimmed = value.trim();
  const looksLikeJson = mode === 'auto' && (trimmed.startsWith('{') || trimmed.startsWith('['));

  if (looksLikeJson) {
    let parsed: unknown = null;
    let parseErr: string | null = null;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      parseErr = (e as Error).message;
    }
    return (
      <div className="redis-json">
        <div className="redis-json-bar">
          <span className="redis-json-label">JSON</span>
          {parseErr ? (
            <span className="muted small">⚠ {parseErr}</span>
          ) : (
            <span className="muted small">✓ 合法</span>
          )}
          <button className="ghost xs" onClick={() => setMode('raw')}>切到原始</button>
        </div>
        <pre className="redis-json-pre">
          {parsed === null ? value : JSON.stringify(parsed, null, 2)}
        </pre>
        {/* 编辑模式：允许用户直接改 raw 文本，再保存 */}
        <textarea
          className="redis-val-textarea"
          style={{ minHeight: 100, marginTop: 6 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div>
      {mode === 'auto' && trimmed.startsWith('"') && trimmed.endsWith('"') && (
        <div className="muted small" style={{ marginBottom: 4 }}>
          检测到 JSON 字符串（双引号包裹）—— 可点击"切到 JSON"
        </div>
      )}
      {mode === 'auto' && !looksLikeJson && (trimmed.startsWith('{') || trimmed.startsWith('[')) && (
        <div className="muted small" style={{ marginBottom: 4 }}>
          内容看起来是 JSON，但解析失败，请检查格式
        </div>
      )}
      <textarea
        className="redis-val-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}