/**
 * IPC 通道常量。集中维护，避免散落字符串。
 *
 * 命名：<domain>.<action>  ——  例 conn.create / conn.test / sql.execute
 *
 * V0.1 实现：连接管理 / SQL 执行 / 表浏览 / 表数据 / 导入导出 / 历史。
 * V0.5+：sql.* / table.* 复用即可。
 */

export const IPC = {
  conn: {
    list: 'conn.list',
    get: 'conn.get',
    create: 'conn.create',
    update: 'conn.update',
    remove: 'conn.remove',
    duplicate: 'conn.duplicate',
    test: 'conn.test',
    /** 返回解密后的完整 ConnectionConfig，主进程内使用 */
    resolve: 'conn.resolve',
    /** MySQL/Oracle：列出 schema/表/视图。Redis：列出 logical db。 */
    listObjects: 'conn.listObjects',
  },
  sql: {
    execute: 'sql.execute',
    /** 执行查询拿到的结果生成 UPDATE 草稿（V0.1：成批；V0.5：按行 diff） */
    buildUpdate: 'sql.buildUpdate',
    history: {
      list: 'sql.history.list',
      clear: 'sql.history.clear',
    },
  },
  table: {
    schema: 'table.schema',
    data: 'table.data',
    /** 批量提交编辑（INSERT/UPDATE/DELETE） */
    commit: 'table.commit',
  },
  redis: {
    /** 列 logical db（schema 树第一层） */
    listDatabases: 'redis.listDatabases',
    /** SCAN 一页 key（UI 循环到 cursor=0） */
    listKeys: 'redis.listKeys',
    /** 单 key 类型 + TTL + size */
    describeKey: 'redis.describeKey',
    /** 读值 */
    getValue: 'redis.getValue',
    /** 写值（同时可设 TTL） */
    setValue: 'redis.setValue',
    /** 设/清 TTL */
    expire: 'redis.expire',
    persist: 'redis.persist',
    /** 重命名 */
    rename: 'redis.rename',
    /** 删除 */
    del: 'redis.del',
    /** 简易 CLI */
    runCommand: 'redis.runCommand',
  },
  export: {
    csv: 'export.csv',
  },
  app: {
    version: 'app.version',
    platform: 'app.platform',
  },
} as const;

export type IpcChannels = typeof IPC;
