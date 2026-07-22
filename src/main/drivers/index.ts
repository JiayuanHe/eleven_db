import type { ConnectionConfig } from '../../shared/types';
import type { ConnectionDriver } from './types';
import { MysqlDriver } from './mysql';

/**
 * SQL Driver 工厂：仅适用于 mysql / oracle 等关系型数据库。
 * Redis 走另一个工厂 createRedisDriver（接口不同），由 connection-manager 派发。
 */
export function createDriver(cfg: ConnectionConfig, password: string): ConnectionDriver {
  switch (cfg.kind) {
    case 'mysql':
      return new MysqlDriver(cfg, password);
    case 'oracle':
      throw new Error('Oracle 驱动尚未实现（V0.5 计划）');
    case 'redis':
      throw new Error('Redis 走 openRedis() / createRedisDriver()，不要走 SQL 工厂');
    default:
      const _: never = cfg.kind;
      void _;
      throw new Error('未知数据库类型');
  }
}