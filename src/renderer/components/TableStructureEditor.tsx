import { useMemo, useState } from 'react';
import type {
  ConnectionConfig,
  FieldEdit,
  TableDetail,
  TableFieldDetail,
} from '../../shared/types';
import { call, toast } from '../lib/api';

/**
 * 图形化编辑表结构：
 * - 字段列表：可增、删、改（不改名/改名）
 * - 每行：原名 / 新名 / 类型 / NULL / 主键 / 默认值 / 注释 / 删除
 * - 顶部按钮：新增字段、保存、生成 SQL 预览
 *
 * 生成 ALTER 流程：
 *   1. 与原始 detail.fields 对比，得到 ops (add/drop/modify/change)
 *   2. 传给主进程的 table.alter（事务执行）
 */

interface Props {
  conn: ConnectionConfig;
  database: string;
  table: string;
  detail: TableDetail;
  onClose: () => void;
  onApplied: () => void;
}

/** 行编辑模型 */
interface RowDraft {
  /** 行内唯一 id，渲染用 */
  key: string;
  /** 原始字段名（null 表示新增） */
  originalName: string | null;
  /** 当前状态 */
  state: TableFieldDetail & { _deleted?: boolean; _isNew?: boolean };
}

const COMMON_TYPES = [
  'INT',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'DECIMAL(10,2)',
  'VARCHAR(64)',
  'VARCHAR(255)',
  'TEXT',
  'LONGTEXT',
  'DATETIME',
  'TIMESTAMP',
  'DATE',
  'TIME',
  'JSON',
  'BOOLEAN',
];

let KEY_COUNTER = 0;
const nextKey = (): string => `r${++KEY_COUNTER}`;

export function TableStructureEditor(props: Props): JSX.Element {
  const [rows, setRows] = useState<RowDraft[]>(() =>
    props.detail.fields.map((f) => ({
      key: nextKey(),
      originalName: f.name,
      state: { ...f },
    })),
  );
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const newRows = useMemo(() => rows.filter((r) => r.state._isNew), [rows]);
  const deletedNames = useMemo(
    () => rows.filter((r) => r.state._deleted).map((r) => r.originalName!).filter(Boolean),
    [rows],
  );
  const changedRows = useMemo(() => {
    const orig = new Map(props.detail.fields.map((f) => [f.name, f]));
    const isDirty = (r: RowDraft): boolean => {
      if (r.state._isNew || r.state._deleted) return false;
      const o = orig.get(r.originalName!);
      if (!o) return false;
      return (
        o.rawType !== r.state.rawType ||
        o.nullable !== r.state.nullable ||
        o.isPrimary !== r.state.isPrimary ||
        o.comment !== r.state.comment ||
        o.defaultIsNull !== r.state.defaultIsNull ||
        (o.defaultValue ?? null) !== (r.state.defaultValue ?? null) ||
        o.name !== r.state.name
      );
    };
    return rows.filter((r) => isDirty(r));
  }, [rows, props.detail.fields]);

  const valid = useMemo(() => {
    if (rows.some((r) => r.state._deleted || r.state._isNew)) {
      // add / drop 期间，主键的“是否变化”交给用户自己调整
    }
    // 检查是否有字段没填名字
    for (const r of rows) {
      if (!r.state.name.trim()) {
        return { ok: false, msg: `字段名不能为空：第 ${rows.indexOf(r) + 1} 行` };
      }
    }
    // 检查重复名
    const names = rows.filter((r) => !r.state._deleted).map((r) => r.state.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return { ok: false, msg: `字段名重复：${dup}` };
    // 类型不能空
    for (const r of rows) {
      if (!r.state._deleted && !r.state.rawType.trim()) {
        return { ok: false, msg: `类型不能为空：${r.state.name}` };
      }
    }
    // 多主键提示
    const pkCount = rows.filter((r) => !r.state._deleted && r.state.isPrimary).length;
    if (pkCount > 1) {
      return { ok: false, msg: '当前仅支持单字段主键；请只勾选一个主键' };
    }
    return { ok: true, msg: '' };
  }, [rows]);

  const updateRow = (key: string, patch: Partial<TableFieldDetail>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, state: { ...r.state, ...patch } } : r)));
  };

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      {
        key: nextKey(),
        originalName: null,
        state: {
          name: '',
          rawType: 'VARCHAR(255)',
          nullable: true,
          defaultValue: null,
          defaultIsNull: true,
          comment: '',
          isPrimary: false,
          _isNew: true,
        },
      },
    ]);
  };

  const toggleDelete = (key: string) => {
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, state: { ...r.state, _deleted: !r.state._deleted } } : r)),
    );
  };

  const buildEdits = (): { edits: FieldEdit[]; dropPkNames: string[] } => {
    const edits: FieldEdit[] = [];
    const orig = new Map(props.detail.fields.map((f) => [f.name, f]));

    /** 判断一行是否真正变了 */
    const isDirty = (r: RowDraft): boolean => {
      if (r.state._isNew || r.state._deleted) return true;
      const o = orig.get(r.originalName!);
      if (!o) return false;
      return (
        o.rawType !== r.state.rawType ||
        o.nullable !== r.state.nullable ||
        o.isPrimary !== r.state.isPrimary ||
        o.comment !== r.state.comment ||
        o.defaultIsNull !== r.state.defaultIsNull ||
        (o.defaultValue ?? null) !== (r.state.defaultValue ?? null) ||
        o.name !== r.state.name
      );
    };

    // 1) 删除
    for (const r of rows) {
      if (r.state._deleted && r.originalName) {
        edits.push({
          op: 'drop',
          originalName: r.originalName,
          newName: '',
          type: '',
          nullable: true,
          defaultValue: null,
          defaultIsNull: false,
          comment: '',
          isPrimary: false,
        });
      }
    }

    // 2) 修改（改名用 change；其他用 modify；仅当字段真正变化时才生成语句）
    for (const r of rows) {
      if (r.state._deleted || r.state._isNew) continue;
      const o = orig.get(r.originalName!);
      if (!o) continue;
      if (!isDirty(r)) continue; // 没变化，跳过
      const renamed = o.name !== r.state.name;
      edits.push({
        op: renamed ? 'change' : 'modify',
        originalName: o.name,
        newName: r.state.name,
        type: r.state.rawType,
        nullable: r.state.nullable,
        defaultValue: r.state.defaultValue,
        defaultIsNull: r.state.defaultIsNull,
        comment: r.state.comment,
        isPrimary: r.state.isPrimary,
      });
    }

    // 3) 新增
    for (const r of rows) {
      if (!r.state._isNew || r.state._deleted) continue;
      edits.push({
        op: 'add',
        originalName: '',
        newName: r.state.name,
        type: r.state.rawType,
        nullable: r.state.nullable,
        defaultValue: r.state.defaultValue,
        defaultIsNull: r.state.defaultIsNull,
        comment: r.state.comment,
        isPrimary: r.state.isPrimary,
      });
    }

    // 4) 主键 drop 判断：如果原表有主键字段，且未标记删除，但该字段 isPrimary 现在是 false，
    //    或者用户新增了 isPrimary 字段 → 后面会在 ADD 里带 PRIMARY KEY；
    //    删除主键需要单独 DROP PRIMARY KEY。
    //    ⚠ 但如果 PK 字段是被"删除"的，DROP COLUMN 会隐式移去主键，不需要额外 DROP PRIMARY KEY。
    const dropPkNames: string[] = [];
    const originalPkNames = props.detail.fields.filter((f) => f.isPrimary).map((f) => f.name);
    if (originalPkNames.length > 0) {
      for (const pkName of originalPkNames) {
        const row = rows.find((r) => r.originalName === pkName);
        const isDeleted = row?.state._deleted;
        const stillPk = row && !row.state._deleted && row.state.isPrimary;
        if (!stillPk && !isDeleted) {
          dropPkNames.push(pkName);
        }
      }
    }

    return { edits, dropPkNames };
  };

  const previewSql = (): string => {
    const { edits, dropPkNames } = buildEdits();
    const fullName = `\`${props.database}\`.\`${props.table}\``;
    const lines: string[] = [];
    if (dropPkNames.length) lines.push(`ALTER TABLE ${fullName} DROP PRIMARY KEY;`);
    for (const e of edits) {
      if (e.op === 'drop') {
        lines.push(`ALTER TABLE ${fullName} DROP COLUMN \`${e.originalName}\`;`);
      } else if (e.op === 'add') {
        const def = buildDefClause(e);
        const isPk = e.isPrimary ? ' PRIMARY KEY' : '';
        lines.push(`ALTER TABLE ${fullName} ADD COLUMN \`${e.newName}\` ${def}${isPk};`);
      } else if (e.op === 'modify') {
        const def = buildDefClause(e);
        lines.push(`ALTER TABLE ${fullName} MODIFY COLUMN \`${e.originalName}\` ${def};`);
      } else if (e.op === 'change') {
        const def = buildDefClause(e);
        lines.push(`ALTER TABLE ${fullName} CHANGE COLUMN \`${e.originalName}\` \`${e.newName}\` ${def};`);
      }
    }
    return lines.join('\n') || '-- 无变更';
  };

  const onApply = async () => {
    if (!valid.ok) return toast.push(valid.msg, 'error');
    if (!confirm(`确定要把以下变更应用到 ${props.database}.${props.table} ？\n\n${previewSql()}`)) {
      return;
    }
    setBusy(true);
    try {
      const { edits, dropPkNames } = buildEdits();
      await call(
        window.api.table.alter({
          id: props.conn.id,
          database: props.database,
          table: props.table,
          edits,
          extras: { dropPrimary: dropPkNames },
        }),
      );
      toast.push(
        `表结构已更新（新增 ${newRows.length}，删除 ${deletedNames.length}，修改 ${changedRows.length}）`,
        'success',
      );
      props.onApplied();
    } catch (e) {
      toast.push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tse-editor">
      <div className="tse-toolbar">
        <button className="primary small" onClick={addRow}>+ 新增字段</button>
        <button
          className="small"
          onClick={() => setShowPreview((s) => !s)}
          disabled={!valid.ok}
        >
          {showPreview ? '隐藏 SQL 预览' : '查看 SQL 预览'}
        </button>
        <span className="spacer" />
        <span className="muted small">
          改动：新增 {newRows.length} / 删除 {deletedNames.length} / 修改 {changedRows.length}
        </span>
        <button className="ghost small" onClick={props.onClose} disabled={busy}>取消</button>
        <button
          className="primary"
          onClick={onApply}
          disabled={busy || !valid.ok || (newRows.length + deletedNames.length + changedRows.length === 0)}
        >
          {busy ? '保存中…' : '保存并应用'}
        </button>
      </div>

      {!valid.ok && (
        <div className="tse-warn">⚠ {valid.msg}</div>
      )}

      {showPreview && (
        <pre className="tse-preview">{previewSql()}</pre>
      )}

      <div className="tse-grid-wrap">
        <table className="tse-grid">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th style={{ width: 160 }}>字段名</th>
              <th style={{ width: 180 }}>类型</th>
              <th style={{ width: 60 }}>NULL</th>
              <th style={{ width: 60 }}>主键</th>
              <th style={{ width: 140 }}>默认值</th>
              <th>注释</th>
              <th style={{ width: 70 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.key}
                className={
                  r.state._deleted
                    ? 'tse-row-deleted'
                    : r.state._isNew
                      ? 'tse-row-new'
                      : isRowDirty(r, props.detail)
                        ? 'tse-row-dirty'
                        : ''
                }
              >
                <td className="muted">{i + 1}</td>
                <td>
                  <input
                    value={r.state.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    disabled={r.state._deleted}
                    placeholder="字段名"
                  />
                </td>
                <td>
                  <input
                    list="tse-types"
                    value={r.state.rawType}
                    onChange={(e) => updateRow(r.key, { rawType: e.target.value })}
                    disabled={r.state._deleted}
                    placeholder="VARCHAR(255)"
                  />
                  <datalist id="tse-types">
                    {COMMON_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.state.nullable}
                    onChange={(e) => updateRow(r.key, { nullable: e.target.checked })}
                    disabled={r.state._deleted || r.state.isPrimary}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.state.isPrimary}
                    onChange={(e) => updateRow(r.key, { isPrimary: e.target.checked })}
                    disabled={r.state._deleted}
                  />
                </td>
                <td>
                  <DefaultValueCell row={r} updateRow={updateRow} />
                </td>
                <td>
                  <input
                    value={r.state.comment}
                    onChange={(e) => updateRow(r.key, { comment: e.target.value })}
                    disabled={r.state._deleted}
                    placeholder="字段注释"
                  />
                </td>
                <td>
                  <button
                    className={`ghost small ${r.state._deleted ? 'danger-ghost' : ''}`}
                    onClick={() => toggleDelete(r.key)}
                    title={r.state._deleted ? '撤销删除' : '标记为删除'}
                  >
                    {r.state._deleted ? '↺ 撤销' : '× 删除'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DefaultValueCell({
  row,
  updateRow,
}: {
  row: RowDraft;
  updateRow: (key: string, patch: Partial<TableFieldDetail>) => void;
}): JSX.Element {
  if (row.state._deleted) return <span className="muted">—</span>;
  const isNull = row.state.defaultIsNull;
  const v = row.state.defaultValue ?? '';
  return (
    <div className="tse-default">
      <label>
        <input
          type="radio"
          name={`def-${row.key}`}
          checked={isNull}
          onChange={() => updateRow(row.key, { defaultIsNull: true, defaultValue: 'NULL' })}
          disabled={row.state.isPrimary}
        />{' '}
        NULL
      </label>
      <label>
        <input
          type="radio"
          name={`def-${row.key}`}
          checked={!isNull}
          onChange={() => updateRow(row.key, { defaultIsNull: false })}
          disabled={row.state.isPrimary}
        />{' '}
        值
      </label>
      {!isNull && (
        <input
          value={v}
          onChange={(e) => updateRow(row.key, { defaultValue: e.target.value })}
          placeholder="0 / CURRENT_TIMESTAMP / 'foo'"
          disabled={row.state.isPrimary}
          style={{ width: '100%', marginTop: 2 }}
        />
      )}
    </div>
  );
}

function isRowDirty(r: RowDraft, detail: TableDetail): boolean {
  if (r.state._isNew || r.state._deleted) return false;
  const o = detail.fields.find((f) => f.name === r.originalName);
  if (!o) return false;
  return (
    o.rawType !== r.state.rawType ||
    o.nullable !== r.state.nullable ||
    o.isPrimary !== r.state.isPrimary ||
    o.comment !== r.state.comment ||
    o.defaultIsNull !== r.state.defaultIsNull ||
    (o.defaultValue ?? null) !== (r.state.defaultValue ?? null) ||
    o.name !== r.state.name
  );
}

/** 字段定义子句（前端预览用，与主进程一致） */
function buildDefClause(e: FieldEdit): string {
  const t = e.type.trim();
  const nullClause = e.nullable ? 'NULL' : 'NOT NULL';
  let defClause = '';
  if (e.defaultIsNull) {
    defClause = ' DEFAULT NULL';
  } else if (e.defaultValue) {
    const v = e.defaultValue.trim();
    const isNumeric = /^-?\d+(\.\d+)?$/.test(v);
    const isKeyword = /^(CURRENT_TIMESTAMP|NOW\(\)|UUID\(\)|CURRENT_DATE|TRUE|FALSE)$/i.test(v);
    defClause = isNumeric || isKeyword
      ? ` DEFAULT ${v}`
      : ` DEFAULT '${v.replace(/'/g, "''")}'`;
  }
  const commentClause = e.comment ? ` COMMENT '${e.comment.replace(/'/g, "''")}'` : '';
  return `${t} ${nullClause}${defClause}${commentClause}`.trim();
}