/**
 * 脚本收藏管理（前端 localStorage 存储）
 * - 每个脚本：{ id, name, sql, createdAt, updatedAt }
 * - 跨连接共享（不绑定 conn.id）
 */

export interface Script {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'eleven.scripts';

function loadAll(): Script[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function saveAll(list: Script[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

let cache: Script[] | null = null;

function getAll(): Script[] {
  if (cache === null) cache = loadAll();
  return cache;
}

function setAll(list: Script[]): void {
  cache = list;
  saveAll(list);
}

export const ScriptStore = {
  list(): Script[] {
    return getAll().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(id: string): Script | null {
    return getAll().find((s) => s.id === id) ?? null;
  },
  create(name: string, sql: string): Script {
    const now = Date.now();
    const s: Script = {
      id: `s${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || '未命名脚本',
      sql,
      createdAt: now,
      updatedAt: now,
    };
    setAll([s, ...getAll()]);
    return s;
  },
  update(id: string, patch: Partial<Pick<Script, 'name' | 'sql'>>): Script | null {
    const list = getAll();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const updated: Script = { ...list[idx], ...patch, updatedAt: Date.now() };
    list[idx] = updated;
    setAll(list);
    return updated;
  },
  remove(id: string): void {
    setAll(getAll().filter((s) => s.id !== id));
  },
  /** 暴露一个订阅：外部组件可以在数据变化时得到通知 */
  subscribe(listener: () => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        cache = null;
        listener();
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  },
};
