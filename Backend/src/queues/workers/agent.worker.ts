import { Worker, Job } from 'bullmq';
import { redis } from '../../config/redis';
import { prisma } from '../../config/database';
import { muapiProvider } from '../../providers/muapi.provider';
import { walletService } from '../../services/wallet.service';
import { storageService } from '../../services/storage.service';
import { broadcastJobUpdate } from '../../utils/websocket';
import { logger } from '../../utils/logger';
import { JobStatus } from '@prisma/client';

interface AgentJobData {
  jobId: string;
  userId: string;
  params: {
    prompt: string;
    model?: string;
    duration?: number;
    style?: string;
    [key: string]: unknown;
  };
}

export const agentWorker = new Worker<AgentJobData>(
  'agent-queue',
  async (job: Job<AgentJobData>) => {
    const { jobId, userId, params } = job.data;
    logger.info(`Agent worker: processing job`, { jobId });

    // ── Helper: send progress update ──────────────────────────────────────────
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
      // ── 1. Mark as PROCESSING ──────────────────────────────────────────────
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.PROCESSING },
      });
      await updateProgress(5, 'starting', 'Initializing generation...');

      // ── 2. Submit to Muapi ─────────────────────────────────────────────────
      await updateProgress(10, 'submitting', 'Submitting to AI provider...');
      const result = await muapiProvider.generateVideo(params);

      if (!result.success || !result.providerJobId) {
        throw new Error(result.error || 'Provider submission failed');
      }

      await updateProgress(20, 'queued', 'Job accepted by provider, waiting for processing...');

      // ── 3. Poll provider until complete ───────────────────────────────────
      let finalOutputUrl: string | undefined;
      const maxPolls = 60; // 60 × 10s = 10 minutes max
      const pollInterval = 10000;

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, pollInterval));

        const status = await muapiProvider.checkStatus(result.providerJobId!);

        if (status.status === 'completed' && status.outputUrl) {
          finalOutputUrl = status.outputUrl;
          break;
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'Provider job failed');
        }

        // Map provider progress (20–85% range)
        const mappedProgress = 20 + Math.min((status.progress || 0) * 0.65, 65);
        await updateProgress(
          Math.round(mappedProgress),
          'generating',
          `Generating video... ${status.progress || 0}%`
        );
      }

      if (!finalOutputUrl) {
        throw new Error('Generation timed out after 10 minutes');
      }

      // ── 4. Upload to our S3 ────────────────────────────────────────────────
      await updateProgress(88, 'uploading', 'Saving video to storage...');
      const { key, url } = await storageService.uploadFromUrl(finalOutputUrl, 'outputs');

      // ── 5. Finalize billing ────────────────────────────────────────────────
      const actualCost = result.actualCost || 10;
      await walletService.finalizeJobBilling(userId, jobId, actualCost);

      // ── 6. Mark COMPLETED ──────────────────────────────────────────────────
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
      logger.info(`Agent job completed`, { jobId });

    } catch (err: any) {
      logger.error(`Agent job failed`, { jobId, error: err.message });

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          errorMessage: err.message,
        },
      });

      // Refund credits on failure
      await walletService.refundJob(userId, jobId);

      broadcastJobUpdate(jobId, { type: 'failed', data: { error: err.message } });

      throw err; // Re-throw so BullMQ knows to retry
    }
  },
  {
    connection: redis,
    concurrency: 3,
  }
);

agentWorker.on('failed', (job, err) => {
  logger.error(`Agent worker: job permanently failed`, {
    jobId: job?.data?.jobId,
    error: err.message,
  });
});
