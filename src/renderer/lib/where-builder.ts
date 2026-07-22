/**
 * 把多条"字段 + 运算符 + 输入值"组合成 WHERE 子句，支持 AND / OR。
 *
 * 提供常用的内置"模板"——让用户能一键选。
 */

export type Op =
  | '='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'IN'
  | 'BETWEEN';

export interface WhereClause {
  column: string;
  op: Op;
  value: string;
}

export type Combinator = 'AND' | 'OR';

export const OPERATORS: Op[] = [
  '=', '<>', '>', '>=', '<', '<=',
  'LIKE', 'NOT LIKE',
  'IS NULL', 'IS NOT NULL',
  'IN', 'BETWEEN',
];

export const COMBINATORS: Combinator[] = ['AND', 'OR'];

/**
 * 默认推荐条件：按列类型适配。
 */
export function defaultSuggestions(column: { name: string; type: string; nullable: boolean }): string[] {
  const { name, type, nullable } = column;
  const t = type.toLowerCase();
  const isNumeric = /int|decimal|numeric|float|double|real/.test(t);
  const isText = /char|text|varchar|enum/.test(t);

  const out: string[] = [];
  if (nullable) out.push(`${name} IS NULL`, `${name} IS NOT NULL`);
  if (isNumeric) {
    out.push(`${name} > 0`, `${name} = 0`, `${name} BETWEEN 1 AND 100`);
  }
  if (isText) {
    out.push(`${name} LIKE '%${name}%'`, `${name} <> ''`);
  }
  if (out.length === 0) {
    out.push(`${name} = ''`, `${name} IS NOT NULL`);
  }
  return out;
}

/**
 * 把一条 WhereClause 转成 SQL 片段。
 * - 不再自动加引号——由用户按需输入（数字不需要引号，字符串要 ''）
 */
export function buildWhere(c: WhereClause): string {
  const col = `\`${c.column}\``;
  const v = c.value;
  switch (c.op) {
    case 'IS NULL':
    case 'IS NOT NULL':
      return `${col} ${c.op}`;
    case 'LIKE':
    case 'NOT LIKE':
      return `${col} ${c.op} ${v}`;
    case 'IN':
      return `${col} IN (${v})`;
    case 'BETWEEN':
      return `${col} BETWEEN ${v}`;
    default:
      return `${col} ${c.op} ${v}`;
  }
}

/**
 * 把一组条件按 combinator 串起来，外层加括号避免与高级 WHERE 串接时优先级出错。
 * combinator 默认 AND。
 */
export function combine(clauses: WhereClause[], combinator: Combinator = 'AND'): string {
  const parts = clauses
    .map((c) => buildWhere(c))
    .filter((s) => s && s.trim().length > 0);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `(${parts.join(` ${combinator} `)})`;
}

/**
 * 多条件结果 + 高级 WHERE 串接：默认 AND，串接时加括号保护。
 */
export function withAdvanced(combined: string, advanced: string): string {
  const a = advanced.trim();
  const c = combined.trim();
  if (!a && !c) return '';
  if (!a) return c;
  if (!c) return a;
  return `${c} AND (${a})`;
}