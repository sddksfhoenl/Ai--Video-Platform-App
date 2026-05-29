import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { jobsService } from '../services/jobs.service';
import { AuthRequest } from '../types';
import { JobType, JobStatus } from '@prisma/client';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

// POST /api/v1/jobs/agent — create an AI Agent job
router.post('/agent', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      prompt: z.string().min(10).max(2000),
      model: z.string().optional(),
      duration: z.number().min(3).max(60).optional(),
      style: z.string().optional(),
    });

    const params = schema.parse(req.body);
    const result = await jobsService.createAgentJob(req.user!.id, params);

    res.status(202).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({
        success: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Please top up your wallet' },
      });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'JOB_CREATE_FAILED', message: err.message } });
  }
});

// POST /api/v1/jobs/vimax — create a ViMax job
router.post('/vimax', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      type: z.enum(['idea2video', 'script2video']).default('idea2video'),
      prompt: z.string().min(10).max(5000),
      style: z.enum(['Cartoon', 'Realistic', 'Cinematic', 'Anime']).optional(),
      requirements: z.string().max(1000).optional(),
    });

    const params = schema.parse(req.body);
    const result = await jobsService.createVimaxJob(req.user!.id, params);

    res.status(202).json({ success: true, data: result });
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({
        success: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Please top up your wallet' },
      });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'JOB_CREATE_FAILED', message: err.message } });
  }
});

// GET /api/v1/jobs/:id — get single job status
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const job = await jobsService.getJob(req.params.id, req.user!.id);
    if (!job) {
      res.status(404).json({ success: false, error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } });
      return;
    }
    res.json({
      success: true,
      data: {
        id: job.id,
        type: job.type,
        status: job.status,
        provider: job.provider,
        prompt: job.prompt,
        progress: job.progress,
        stageLog: job.stageLog,
        outputUrl: job.outputUrl,
        estimatedCost: job.estimatedCost ? parseFloat(job.estimatedCost.toString()) : null,
        actualCost: job.actualCost ? parseFloat(job.actualCost.toString()) : null,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
  }
});

// GET /api/v1/jobs?type=AGENT&status=COMPLETED&page=1&limit=20
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const type = req.query.type as JobType | undefined;
    const status = req.query.status as JobStatus | undefined;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');

    const result = await jobsService.getUserJobs(req.user!.id, type, status, page, limit);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: err.message } });
  }
});

// DELETE /api/v1/jobs/:id — cancel a queued job
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await jobsService.cancelJob(req.params.id, req.user!.id);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: { code: 'CANCEL_FAILED', message: err.message } });
  }
});

export default router;
