/**
 * 多栏布局的宽度管理。
 * - 持久化到 localStorage
 * - 通过 CSS 变量驱动列宽
 */
import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'eleven.layout';

export interface LayoutSizes {
  /** 0 = 隐藏连接栏 */
  sidebar: number;
  /** schema 列宽度（包含表名搜索 + 树） */
  schema: number;
}

const DEFAULTS: LayoutSizes = { sidebar: 200, schema: 220 };

function load(): LayoutSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return {
        sidebar: clamp(typeof obj.sidebar === 'number' ? obj.sidebar : DEFAULTS.sidebar, 0, 360),
        schema: clamp(typeof obj.schema === 'number' ? obj.schema : DEFAULTS.schema, 140, 480),
      };
    }
  } catch (_) {}
  return DEFAULTS;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function useLayout(): {
  sizes: LayoutSizes;
  setSidebar: (w: number) => void;
  toggleSidebar: () => void;
  setSchema: (w: number) => void;
} {
  const [sizes, setSizes] = useState<LayoutSizes>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch (_) {}
  }, [sizes]);

  const setSidebar = useCallback((w: number) => {
    setSizes((s) => ({ ...s, sidebar: clamp(w, 0, 360) }));
  }, []);

  const setSchema = useCallback((w: number) => {
    setSizes((s) => ({ ...s, schema: clamp(w, 140, 480) }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSizes((s) => ({ ...s, sidebar: s.sidebar > 0 ? 0 : DEFAULTS.sidebar }));
  }, []);

  return { sizes, setSidebar, setSchema, toggleSidebar };
}