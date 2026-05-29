import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const vimaxQueue = new Queue('vimax-queue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000, // 10s, 20s — ViMax jobs are slower
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
