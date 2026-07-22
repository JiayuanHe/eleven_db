/**
 * 轻量 SQL 格式化器 — V0.1 MVP。
 * 仅处理：关键词大写 + 换行缩进。
 * 不做复杂 AST 解析，多层嵌套和子查询保持简单缩进。
 */

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'FULL',
  'ON', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'TRIGGER', 'DATABASE',
  'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'IFNULL', 'COALESCE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IN', 'EXISTS', 'BETWEEN',
  'LIKE', 'IS', 'NULL', 'ASC', 'DESC', 'UNION', 'ALL', 'LIMIT',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'DEFAULT',
  'AUTO_INCREMENT', 'ENGINE', 'CHARSET', 'COLLATE', 'VIRTUAL', 'STORED',
  'IF', 'ELSIF', 'LOOP', 'LEAVE', 'ITERATE', 'REPEAT', 'UNTIL', 'WHILE',
  'PROCEDURE', 'FUNCTION', 'BEGIN', 'DECLARE', 'OUT', 'INOUT',
  'CALL', 'GRANT', 'REVOKE',
]);

/** 格式化一段 SQL，返回格式化后的字符串 */
export function formatSql(sql: string): string {
  // 1. 清理空白
  let s = sql.replace(/\r\n/g, '\n').trim();
  if (!s) return '';

  // 2. 按分号拆分多语句（保留分号 + 换行）
  const stmts = s.split(/;(\s*\n*)/);
  const parts: string[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i].trim();
    if (!stmt) continue;
    parts.push(formatOne(stmt));
  }
  return parts.join(';\n\n');
}

function formatOne(sql: string): string {
  const upper = (s: string) => s;

  // 把字符串字面量保护起来（避免破坏引号内的内容）
  const placeholders: string[] = [];
  const protect = (s: string, rx: RegExp, tag: string) =>
    s.replace(rx, (m) => { placeholders.push(m); return `__PH${placeholders.length - 1}_${tag}__`; });

  let s = sql;
  s = protect(s, /'([^'\\]|\\.)*'/g, 'SQ');
  s = protect(s, /"([^"\\]|\\.)*"/g, 'DQ');
  s = protect(s, /`([^`\\]|\\.)*`/g, 'BT');
  s = protect(s, /--[^\n]*/g, 'CM');
  s = protect(s, /\/\*[\s\S]*?\*\//g, 'BC');

  // 关键词大写（不处理已保护的部分）
  s = s.replace(/\b(SELECT|FROM|WHERE|AND|OR|NOT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|INNER|LEFT|RIGHT|OUTER|CROSS|FULL|ON|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|TRIGGER|DATABASE|DISTINCT|COUNT|SUM|AVG|MIN|MAX|IFNULL|COALESCE|CASE|WHEN|THEN|ELSE|END|IN|EXISTS|BETWEEN|LIKE|IS|NULL|ASC|DESC|UNION|ALL|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|UNIQUE|DEFAULT|AUTO_INCREMENT|ENGINE|CHARSET|COLLATE|VIRTUAL|STORED|IF|ELSIF|LOOP|LEAVE|ITERATE|REPEAT|UNTIL|WHILE|PROCEDURE|FUNCTION|BEGIN|DECLARE|OUT|INOUT|CALL|GRANT|REVOKE)\b/gi,
    (m) => m.toUpperCase());

  // 还原保护内容
  for (let i = 0; i < placeholders.length; i++) {
    s = s.replace(`__PH${i}_SQ__`, placeholders[i]);
    s = s.replace(`__PH${i}_DQ__`, placeholders[i]);
    s = s.replace(`__PH${i}_BT__`, placeholders[i]);
    s = s.replace(`__PH${i}_CM__`, placeholders[i]);
    s = s.replace(`__PH${i}_BC__`, placeholders[i]);
  }

  // 换行 + 缩进
  const indent = (level: number) => '  '.repeat(level);
  const lines: string[] = [];
  let depth = 0;

  // 主要 clause 换行
  const majorBreaks = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'SET', 'VALUES', 'INTO'];
  const minorBreaks = ['AND', 'OR'];

  const tokens = s.split(/(\s+(?:AND|OR)\s+|\s*,\s*|\s+(?:SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|SET|VALUES|INSERT|UPDATE|DELETE|JOIN|INNER|LEFT|RIGHT|OUTER|CROSS|FULL|ON|AND|OR|ORDER BY|GROUP BY|LIMIT)\s+)/gi);

  let first = true;
  let pendingLine = '';

  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;

    const upper = t.toUpperCase();
    const isMajor = majorBreaks.some((k) => upper === k.toUpperCase());
    const isMinor = minorBreaks.some((k) => upper === k);

    if (isMajor && !first) {
      if (pendingLine) { lines.push(indent(depth) + pendingLine); pendingLine = ''; }
      depth = upper === 'WHERE' || upper === 'SET' || upper === 'VALUES' || upper === 'ON' ? depth : depth;
      lines.push(indent(depth) + t);
      depth = upper === 'SELECT' || upper === 'WHERE' || upper === 'SET' || upper === 'VALUES' || upper === 'ON' ? depth + 1 : depth;
      first = true;
    } else if (isMinor) {
      if (pendingLine) lines.push(indent(depth) + pendingLine + ' ' + t);
      else lines.push(indent(depth) + t);
      pendingLine = '';
      first = false;
    } else if (t === ',') {
      pendingLine = pendingLine ? pendingLine + ',' : t;
    } else if (t === '(') {
      pendingLine = (pendingLine ? pendingLine + ' ' : '') + '(';
      depth++;
    } else if (t === ')') {
      depth = Math.max(0, depth - 1);
      pendingLine = (pendingLine ? pendingLine + ' ' : '') + ')';
    } else {
      pendingLine = (pendingLine ? pendingLine + ' ' : '') + t;
      first = false;
    }
  }
  if (pendingLine.trim()) lines.push(indent(depth) + pendingLine);

  return lines.join('\n');
}
