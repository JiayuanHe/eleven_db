import type { ConnectionConfig } from '../../shared/types';
import { RedisDriver } from './redis';
import type { RedisKeyDriver } from './redis-types';

/** Redis 工厂：V1 三模式都在 RedisDriver 里，由 cfg.redis.mode 切换。 */
export function createRedisDriver(cfg: ConnectionConfig, password: string): RedisKeyDriver {
  if (cfg.kind !== 'redis') throw new Error('createRedisDriver 仅用于 Redis 连接');
  if (!cfg.redis) throw new Error('Redis 配置缺失 redis 块');
  return new RedisDriver(cfg, password);
}