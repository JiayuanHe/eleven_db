import { useEffect, useMemo, useState } from 'react';
import type { ConnectionConfig, RedisConfig } from '../../shared/types';
import { call, toast } from '../lib/api';

/**
 * 新建 /编辑连接弹窗。
 *
 * - MySQL：host/port/user/password/database
 * - Redis ：host/port + redis 子块（mode / db / username / password / sentinel / cluster）
 *
 * V0.5+ 加 Oracle：再开一个分支。
 */

interface Props {
  initial: ConnectionConfig | null;
  onClose: () => void;
  onSaved: (cfg: ConnectionConfig) => void;
  /** 测试连接结束后通知父组件更新绿点 */
  onTested?: (ok: boolean) => void;
}

const DEFAULT_MYSQL: Partial<ConnectionConfig> = {
  kind: 'mysql',
  host: 'localhost',
  port: 3306,
  username: 'root',
  database: '',
  charset: 'utf8mb4',
};

const DEFAULT_REDIS: Partial<ConnectionConfig> = {
  kind: 'redis',
  host: 'localhost',
  port: 6379,
  username: '',
  database: '',
  redis: {
    mode: 'single',
    db: 0,
    username: '',
  } as RedisConfig,
};

export function ConnectionEditor(props: Props): JSX.Element | null {
  const [form, setForm] = useState<ConnectionConfig>({
    id: '',
    name: '',
    ...DEFAULT_MYSQL,
    createdAt: 0,
    updatedAt: 0,
  } as ConnectionConfig);
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(true);
  // Redis 密码直接从 form.redis.password 读写 —— 避免两份 state 失同步
  const [saveRedisPassword, setSaveRedisPassword] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (props.initial) {
      // 切 kind 时用合理默认值初始化空字段
      const seed = props.initial.kind === 'redis' ? DEFAULT_REDIS : DEFAULT_MYSQL;
      setForm({ ...seed, ...props.initial } as ConnectionConfig);
    }
  }, [props.initial]);

  const isEdit = !!props.initial?.id;
  const isRedis = form.kind === 'redis';
  const isMysql = form.kind === 'mysql';

  if (!props.initial) return null;

  const update = <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const updateRedis = (patch: Partial<RedisConfig>) => {
    setForm((f) => ({ ...f, redis: { ...(f.redis ?? DEFAULT_REDIS.redis!), ...patch } }));
  };

  const onKindChange = (kind: ConnectionConfig['kind']) => {
    // 切类型时按新类型填入合理默认值，避免用户看到旧字段
    if (kind === 'redis') {
      setForm({ ...form, ...DEFAULT_REDIS, kind } as ConnectionConfig);
    } else {
      setForm({ ...form, ...DEFAULT_MYSQL, kind } as ConnectionConfig);
    }
    setPassword('');
    setTestResult(null);
  };

  const buildInput = () => ({
    name: form.name || 'test',
    kind: form.kind,
    host: form.host,
    port: Number(form.port),
    username: form.username,
    database: form.database,
    charset: form.charset,
    timeoutMs: form.timeoutMs,
    redis: form.redis,
  });

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await call(window.api.conn.test(buildInput(), password || undefined, form.redis?.password || undefined));
      setTestResult('✅ 连接成功');
      props.onTested?.(true);
    } catch (e) {
      setTestResult(`❌ ${(e as Error).message}`);
      props.onTested?.(false);
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    if (!form.name.trim()) return toast.push('请填写连接名', 'error');
    if (!form.host.trim()) return toast.push('请填写主机', 'error');
    try {
      let saved: ConnectionConfig;
      const numPort = Number(form.port);
      const numTimeout = Number(form.timeoutMs) || 8000;
      const baseInput = {
        ...buildInput(),
        port: numPort,
        timeoutMs: numTimeout,
      } as Parameters<typeof call<any>>[0] extends never ? never : any;

      if (isEdit) {
        saved = await call<ConnectionConfig>(
          window.api.conn.update(
            { ...form, port: numPort, timeoutMs: numTimeout },
            password || undefined,
            savePassword,
            form.redis?.password || undefined,
            saveRedisPassword,
          ),
        );
        toast.push('已保存', 'success');
      } else {
        saved = await call<ConnectionConfig>(
          window.api.conn.create(
            baseInput,
            password || undefined,
            savePassword,
            form.redis?.password || undefined,
            saveRedisPassword,
          ),
        );
        toast.push('已新建', 'success');
      }
      props.onSaved(saved);
      props.onClose();
    } catch (e) {
      toast.push((e as Error).message, 'error');
    }
  };

  const redisMode = form.redis?.mode ?? 'single';
  const redisModeHint = useMemo(() => {
    switch (redisMode) {
      case 'single':   return '直连一台 Redis 实例。';
      case 'sentinel': return '通过 Sentinel 自动选主，至少填一个 sentinel 节点 + master 名称。';
      case 'cluster':  return '至少填一个 cluster 节点地址（host:port），自动发现其他节点。';
    }
  }, [redisMode]);

  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{isEdit ? '编辑连接' : '新建连接'}</h3>
          <button className="ghost" onClick={props.onClose}>×</button>
        </header>

        <div className="form">
          <label>
            <span>连接名</span>
            <input value={form.name} onChange={(e) => update('name', e.target.value)} />
          </label>

          <label>
            <span>数据库类型</span>
            <select value={form.kind} onChange={(e) => onKindChange(e.target.value as any)}>
              <option value="mysql">MySQL</option>
              <option value="redis">Redis</option>
              {/* V0.5: <option value="oracle">Oracle</option> */}
            </select>
          </label>

          <div className="row">
            <label className="grow">
              <span>主机</span>
              <input value={form.host} onChange={(e) => update('host', e.target.value)} />
            </label>
            <label className="narrow">
              <span>端口</span>
              <input
                type="number"
                value={form.port}
                onChange={(e) => update('port', Number(e.target.value) as any)}
              />
            </label>
          </div>

          {/* === MySQL 字段 === */}
          {isMysql && (
            <>
              <label>
                <span>用户名</span>
                <input value={form.username} onChange={(e) => update('username', e.target.value)} />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  value={password}
                  placeholder={isEdit ? '不修改请留空' : ''}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {isEdit && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={savePassword}
                    onChange={(e) => setSavePassword(e.target.checked)}
                  />
                  <span>保存密码（系统 Keychain / DPAPI 加密）</span>
                </label>
              )}
              <label>
                <span>数据库（可留空，连接后再选）</span>
                <input
                  value={form.database ?? ''}
                  onChange={(e) => update('database', e.target.value)}
                />
              </label>
            </>
          )}

          {/* === Redis 字段 === */}
          {isRedis && (
            <>
              <label>
                <span>模式</span>
                <select
                  value={redisMode}
                  onChange={(e) => updateRedis({ mode: e.target.value as RedisConfig['mode'] })}
                >
                  <option value="single">单机 (Single)</option>
                  <option value="sentinel">哨兵 (Sentinel)</option>
                  <option value="cluster">集群 (Cluster)</option>
                </select>
              </label>

              {redisMode === 'single' && (
                <>
                  <label>
                    <span>用户名（Redis 6+ ACL，可选）</span>
                    <input
                      value={form.redis?.username ?? ''}
                      onChange={(e) => updateRedis({ username: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>密码</span>
                    <input
                      type="password"
                      value={form.redis?.password ?? ''}
                      placeholder={isEdit ? '不修改请留空' : ''}
                      onChange={(e) => updateRedis({ password: e.target.value })}
                    />
                  </label>
                  {isEdit && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={saveRedisPassword}
                        onChange={(e) => setSaveRedisPassword(e.target.checked)}
                      />
                      <span>保存密码（系统 Keychain / DPAPI 加密）</span>
                    </label>
                  )}
                  <label className="narrow">
                    <span>逻辑 DB (0-15)</span>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={form.redis?.db ?? 0}
                      onChange={(e) => updateRedis({ db: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}

              {redisMode === 'sentinel' && (
                <>
                  <label>
                    <span>Master 名称（如 mymaster）</span>
                    <input
                      value={form.redis?.sentinelName ?? ''}
                      onChange={(e) => updateRedis({ sentinelName: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Sentinel 节点（一行一个 host:port）</span>
                    <textarea
                      rows={3}
                      value={(form.redis?.sentinelNodes ?? []).join('\n')}
                      onChange={(e) =>
                        updateRedis({
                          sentinelNodes: e.target.value
                            .split(/\r?\n/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>用户名（可选）</span>
                    <input
                      value={form.redis?.username ?? ''}
                      onChange={(e) => updateRedis({ username: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>密码</span>
                    <input
                      type="password"
                      value={form.redis?.password ?? ''}
                      onChange={(e) => updateRedis({ password: e.target.value })}
                    />
                  </label>
                  <label className="narrow">
                    <span>逻辑 DB (0-15)</span>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={form.redis?.db ?? 0}
                      onChange={(e) => updateRedis({ db: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}

              {redisMode === 'cluster' && (
                <>
                  <label>
                    <span>Cluster 节点（一行一个 host:port）</span>
                    <textarea
                      rows={3}
                      placeholder="10.0.0.1:6379\n10.0.0.2:6379\n10.0.0.3:6379"
                      value={(form.redis?.clusterNodes ?? []).join('\n')}
                      onChange={(e) =>
                        updateRedis({
                          clusterNodes: e.target.value
                            .split(/\r?\n/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>用户名（可选）</span>
                    <input
                      value={form.redis?.username ?? ''}
                      onChange={(e) => updateRedis({ username: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>密码（每个节点都要支持）</span>
                    <input
                      type="password"
                      value={form.redis?.password ?? ''}
                      onChange={(e) => updateRedis({ password: e.target.value })}
                    />
                  </label>
                </>
              )}

              <div className="muted small">{redisModeHint}</div>
            </>
          )}

          {/* === 通用超时 === */}
          <label>
            <span>连接超时（毫秒）</span>
            <input
              type="number"
              value={form.timeoutMs ?? 8000}
              onChange={(e) => update('timeoutMs', Number(e.target.value) as any)}
            />
          </label>

          {testResult && <div className="test-result">{testResult}</div>}
        </div>

        <footer>
          <button onClick={onTest} disabled={testing}>{testing ? '测试中…' : '测试连接'}</button>
          <button className="primary" onClick={onSave}>保存</button>
        </footer>
      </aside>
    </div>
  );
}