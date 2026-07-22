/** 渲染层包一层：统一处理 IpcResult + 错误抛出。 */

type Result = { ok: boolean; data?: any; error?: { code: string; message: string } };

export async function call<T>(p: Promise<Result>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error?.message ?? 'Unknown error');
  return r.data as T;
}

export class Toast {
  private listeners: Array<(msg: string, kind?: 'info' | 'error' | 'success') => void> = [];
  subscribe(fn: (msg: string, kind?: 'info' | 'error' | 'success') => void): void {
    this.listeners.push(fn);
  }
  push(msg: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    this.listeners.forEach((fn) => fn(msg, kind));
  }
}

export const toast = new Toast();