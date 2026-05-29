import { prisma } from '../config/database';
import { JobType, JobStatus } from '@prisma/client';
import { walletService } from './wallet.service';
import { agentQueue } from '../queues/agent.queue';
import { vimaxQueue } from '../queues/vimax.queue';
import { muapiProvider } from '../providers/muapi.provider';
import { vimaxProvider } from '../providers/vimax.provider';
import { logger } from '../utils/logger';
import { VideoGenerationParams } from '../types';

export class JobsService {

  // Create an AI Agent job (uses Muapi)
  async createAgentJob(userId: string, params: VideoGenerationParams) {
    const estimatedCost = await muapiProvider.estimateCost(params);

    // Hold credits
    await walletService.holdCredits(userId, 'temp', estimatedCost);

    // Create job record
    const job = await prisma.job.create({
      data: {
        userId,
        type: JobType.AGENT,
        status: JobStatus.QUEUED,
        provider: 'muapi',
        model: params.model || 'kling-v1',
        prompt: params.prompt,
        parameters: params as any,
        estimatedCost,
      },
    });

    // Update the transaction's jobId now that we have the real job id
    await prisma.transaction.updateMany({
      where: { userId, jobId: 'temp', status: 'PENDING' },
      data: { jobId: job.id },
    });

    // Push to BullMQ
    const bullJob = await agentQueue.add('generate-video', {
      jobId: job.id,
      userId,
      params,
    });

    // Store BullMQ job id
    await prisma.job.update({
      where: { id: job.id },
      data: { bullJobId: bullJob.id?.toString() },
    });

    logger.info(`Agent job created`, { jobId: job.id, userId });
    return { jobId: job.id, status: 'QUEUED', estimatedCost };
  }

  // Create a ViMax job
  async createVimaxJob(userId: string, params: VideoGenerationParams) {
    const estimatedCost = await vimaxProvider.estimateCost(params);

    await walletService.holdCredits(userId, 'temp', estimatedCost);

    const job = await prisma.job.create({
      data: {
        userId,
        type: JobType.VIMAX,
        status: JobStatus.QUEUED,
        provider: 'vimax',
        prompt: params.prompt,
        parameters: params as any,
        estimatedCost,
      },
    });

    await prisma.transaction.updateMany({
      where: { userId, jobId: 'temp', status: 'PENDING' },
      data: { jobId: job.id },
    });

    const bullJob = await vimaxQueue.add('generate-vimax', {
      jobId: job.id,
      userId,
      params,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: { bullJobId: bullJob.id?.toString() },
    });

    logger.info(`ViMax job created`, { jobId: job.id, userId });
    return { jobId: job.id, status: 'QUEUED', estimatedCost };
  }

  async getJob(jobId: string, userId: string) {
    return prisma.job.findFirst({
      where: { id: jobId, userId }, // userId check prevents others from seeing your jobs
    });
  }

  async getUserJobs(userId: string, type?: JobType, status?: JobStatus, page = 1, limit = 20) {
    const where = {
      userId,
      ...(type && { type }),
      ...(status && { status }),
    };
    const skip = (page - 1) * limit;
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.job.count({ where }),
    ]);
    return { jobs, total, page, limit };
  }

  async cancelJob(jobId: string, userId: string) {
    const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new Error('Job not found');
    if (job.status !== 'QUEUED') throw new Error('Only QUEUED jobs can be cancelled');

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLED },
    });

    // Refund held credits
    await walletService.refundJob(userId, jobId);
    return { success: true };
  }
}

export const jobsService = new JobsService();
