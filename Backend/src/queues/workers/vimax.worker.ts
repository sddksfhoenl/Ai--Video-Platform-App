import { Worker, Job } from 'bullmq';
import { redis } from '../../config/redis';
import { prisma } from '../../config/database';
import { vimaxProvider } from '../../providers/vimax.provider';
import { walletService } from '../../services/wallet.service';
import { storageService } from '../../services/storage.service';
import { broadcastJobUpdate } from '../../utils/websocket';
import { logger } from '../../utils/logger';
import { JobStatus } from '@prisma/client';


interface VimaxJobData {
  jobId: string;
  userId: string;
  params: {
    prompt: string;
    type?: 'idea2video' | 'script2video';
    style?: string;
    requirements?: string;
    [key: string]: unknown;
  };
}

// ViMax stage messages to show users during the pipeline
const VIMAX_STAGES = [
  { progress: 10, stage: 'script',     message: 'Generating script from your idea...' },
  { progress: 25, stage: 'storyboard', message: 'Planning scenes and storyboard...' },
  { progress: 45, stage: 'images',     message: 'Generating scene images...' },
  { progress: 70, stage: 'video',      message: 'Rendering video from scenes...' },
  { progress: 90, stage: 'finalizing', message: 'Finalizing your video...' },
];

export const vimaxWorker = new Worker<VimaxJobData>(
  'vimax-queue',
  async (job: Job<VimaxJobData>) => {
    const { jobId, userId, params } = job.data;
    logger.info(`ViMax worker: processing job`, { jobId });

    const updateProgress = async (progress: number, stage: string, message: string) => {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          progress,
          stageLog: {
            push: { stage, message, progress, timestamp: new Date().toISOString() },
          },
        },
      });
      broadcastJobUpdate(jobId, { type: 'progress', data: { progress, stage, message } });
    };

    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.PROCESSING },
      });
      await updateProgress(5, 'starting', 'Starting ViMax pipeline...');

      // Submit to ViMax service
      const result = await vimaxProvider.generateVideo(params);
      if (!result.success || !result.providerJobId) {
        throw new Error(result.error || 'ViMax submission failed');
      }

      // ViMax jobs take 5–15 minutes — poll with staged progress messages
      let stageIndex = 0;
      let finalOutputUrl: string | undefined;
      const maxPolls = 90; // 90 × 10s = 15 minutes max

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 10000));

        const status = await vimaxProvider.checkStatus(result.providerJobId!);

        if (status.status === 'completed' && status.outputUrl) {
          finalOutputUrl = status.outputUrl;
          break;
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'ViMax job failed');
        }

        // Advance through stage messages over time
        const progressPct = (i / maxPolls) * 100;
        const nextStage = VIMAX_STAGES[stageIndex];
        if (nextStage && progressPct >= (stageIndex / VIMAX_STAGES.length) * 100) {
          await updateProgress(nextStage.progress, nextStage.stage, nextStage.message);
          stageIndex = Math.min(stageIndex + 1, VIMAX_STAGES.length - 1);
        }
      }

      if (!finalOutputUrl) {
        throw new Error('ViMax generation timed out after 15 minutes');
      }

      await updateProgress(92, 'uploading', 'Saving video to storage...');
      const { url } = await storageService.uploadFromUrl(finalOutputUrl, 'outputs/vimax');

      const actualCost = result.actualCost || 20;
      await walletService.finalizeJobBilling(userId, jobId, actualCost);

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          outputUrl: url,
          actualCost,
          progress: 100,
        },
      });

      broadcastJobUpdate(jobId, { type: 'completed', data: { outputUrl: url } });
      logger.info(`ViMax job completed`, { jobId });

    } catch (err: any) {
      logger.error(`ViMax job failed`, { jobId, error: err.message });

      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, errorMessage: err.message },
      });

      await walletService.refundJob(userId, jobId);
      broadcastJobUpdate(jobId, { type: 'failed', data: { error: err.message } });
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 1, // ViMax is heavy, run one at a time locally
  }
);

vimaxWorker.on('failed', (job, err) => {
  logger.error(`ViMax worker: job permanently failed`, {
    jobId: job?.data?.jobId,
    error: err.message,
  });
});
