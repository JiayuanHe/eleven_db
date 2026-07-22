/**
 * 把 Redis 扁平 key 数组转成树形结构（按 ':' 分层）。
 *
 * 例：
 *   ['oauth2:access_token:abc', 'oauth2:access_token:xyz', 'menu:role:ids:1']
 *     → oauth2/
 *         access_token/
 *             abc (leaf)
 *             xyz (leaf)
 *       menu/
 *         role/
 *           ids/
 *             1 (leaf)
 *
 * 分隔符固定为 ':'，与 Redis 行业惯例一致（其它分隔符使用极少）。
 *
 * 关键约束：Redis 服务端仍以扁平 key 存储；UI 层只做分组展示。
 * 打开叶子时使用完整路径名传给 getValue / setValue。
 */

export interface RedisKeyNode {
  /** 当前层名称（不含父级） */
  name: string;
  /** 完整 key 路径（叶子节点用） */
  fullName: string;
  /** 是否为叶子 */
  isLeaf: boolean;
  /** 子节点 */
  children?: RedisKeyNode[];
}

export const REDIS_KEY_SEPARATOR = ':';

/**
 * 把扁平 key 数组转成树。
 * 注意：单个 key 不含 ':' 也合法，仍作为叶子返回。
 */
export function groupRedisKeys(keys: string[]): RedisKeyNode[] {
  const root: Map<string, RedisKeyNode> = new Map();

  for (const k of keys) {
    if (!k) continue;
    const parts = k.split(REDIS_KEY_SEPARATOR);
    if (parts.length === 1) {
      // 直接叶子
      root.set(k, { name: k, fullName: k, isLeaf: true });
      continue;
    }
    // 第一段作为顶层 node
    const topName = parts[0];
    let top = root.get(topName);
    if (!top) {
      top = {
        name: topName,
        fullName: topName,
        isLeaf: false,
        children: [],
      };
      root.set(topName, top);
    }
    // 沿层级走
    let cur = top;
    for (let i = 1; i < parts.length - 1; i++) {
      const seg = parts[i];
      const childName = seg;
      cur.children = cur.children ?? [];
      let next = cur.children.find((c) => c.name === childName);
      if (!next) {
        next = {
          name: childName,
          fullName: parts.slice(0, i + 1).join(REDIS_KEY_SEPARATOR),
          isLeaf: false,
          children: [],
        };
        cur.children.push(next);
      }
      cur = next;
    }
    // 最后一个段为叶子
    const leafName = parts[parts.length - 1];
    cur.children = cur.children ?? [];
    cur.children.push({
      name: leafName,
      fullName: k,
      isLeaf: true,
    });
  }

  // 排序：文件夹在前，叶子在后，按名字
  const sortNodes = (ns: RedisKeyNode[]): RedisKeyNode[] => {
    ns.sort((a, b) => {
      if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1; // 文件夹先
      return a.name.localeCompare(b.name);
    });
    ns.forEach((n) => n.children && sortNodes(n.children));
    return ns;
  };

  return sortNodes(Array.from(root.values()));
}

/**
 * 把"当前路径"列表转成面包屑条目。
 * - 根路径（'db0'）→ [{ db: 0, full: '' }]
 * - 'oauth2:access_token' → [{...}, { name: 'oauth2', full: 'oauth2' }, { name: 'access_token', full: 'oauth2:access_token' }]
 */
export interface Breadcrumb {
  /** 显示名（最后一段或 db 标识） */
  name: string;
  /** 该层级对应的"完整前缀"（不含尾段）或 '' 表示根 */
  prefix: string;
}

export function makeBreadcrumb(currentPrefix: string): Breadcrumb[] {
  const parts = currentPrefix ? currentPrefix.split(REDIS_KEY_SEPARATOR) : [];
  const out: Breadcrumb[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push({ name: parts[i], prefix: parts.slice(0, i + 1).join(REDIS_KEY_SEPARATOR) });
  }
  return out;
}