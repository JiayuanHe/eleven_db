/** 简易 CSV 导出。V0.5 替换为 papaparse。 */

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = headers.map((h) => escape(h)).join(',');
  const body = rows
    .map((r) => headers.map((h) => escape(r[h])).join(','))
    .join('\n');
  return head + '\n' + body;
}