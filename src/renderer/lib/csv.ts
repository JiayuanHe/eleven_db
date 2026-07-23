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

/**
 * 解析 CSV 文本。
 * 支持双引号包裹、换行符、空字段。
 * 返回：{ headers: string[], rows: string[][] }
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        records.push(row);
        row = [];
        field = '';
      } else if (ch === '\r') {
        // 忽略 \r；\n 负责切行
      } else {
        field += ch;
      }
    }
  }
  // 最后一段
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0];
  const rows = records.slice(1);
  return { headers, rows };
}