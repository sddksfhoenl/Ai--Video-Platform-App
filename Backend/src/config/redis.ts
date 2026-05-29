import IORedis from 'ioredis';
import { config } from './env';

export const redis = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));
