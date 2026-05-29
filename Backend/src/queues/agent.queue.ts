import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const agentQueue = new Queue('agent-queue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
