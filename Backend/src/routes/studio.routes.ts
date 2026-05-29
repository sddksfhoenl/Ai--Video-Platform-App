import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { jobsService } from '../services/jobs.service';
import { AuthRequest } from '../types';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

// Studio generation modes
const STUDIO_MODES = ['text2image', 'text2video', 'image2video', 'idea2video', 'script2video'] as const;
type StudioMode = typeof STUDIO_MODES[number];

// Cost per mode in credits
const MODE_COSTS: Record<StudioMode, number> = {
  text2image: 3,
  text2video: 10,
  image2video: 12,
  idea2video: 20,   // ViMax
  script2video: 20, // ViMax
};

// Model options per mode (from Muapi.ai catalog)
const MODE_MODELS: Record<StudioMode, string[]> = {
  text2image: ['flux-dev', 'flux-schnell', 'stable-diffusion-3', 'ideogram-v2'],
  text2video: ['kling-v1', 'kling-v1-5', 'wan2-1-t2v-480p', 'wan2-1-t2v-720p'],
  image2video: ['kling-v1-i2v', 'wan2-1-i2v-480p', 'stable-video-diffusion'],
  idea2video: ['vimax'],
  script2video: ['vimax'],
};

// POST /api/v1/studio/generate
// Unified endpoint for all studio modes
router.post('/generate', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      mode: z.enum(STUDIO_MODES),
      prompt: z.string().min(3).max(2000),
      model: z.string().optional(),
      // Image generation params
      width: z.number().optional(),
      height: z.number().optional(),
      steps: z.number().optional(),
      // Video generation params
      duration: z.number().min(3).max(60).optional(),
      aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
      // ViMax specific
      style: z.enum(['Cartoon', 'Realistic', 'Cinematic', 'Anime']).optional(),
      requirements: z.string().max(1000).optional(),
      // Reference image for image2video
      referenceImageUrl: z.string().url().optional(),
    });

    const params = schema.parse(req.body);
    const { mode } = params;

    // Determine provider + route accordingly
    if (mode === 'idea2video' || mode === 'script2video') {
      // Route to ViMax
      const result = await jobsService.createVimaxJob(req.user!.id, {
        ...params,
        type: mode,
      });
      res.status(202).json({ success: true, data: { ...result, mode, provider: 'vimax' } });
    } else {
      // Route to Muapi
      const defaultModel = MODE_MODELS[mode][0];
      const result = await jobsService.createAgentJob(req.user!.id, {
        ...params,
        model: params.model || defaultModel,
        generationType: mode,
      });
      res.status(202).json({ success: true, data: { ...result, mode, provider: 'muapi' } });
    }
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({
        success: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Please top up your wallet' },
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: { code: 'GENERATE_FAILED', message: err.message },
    });
  }
});

// GET /api/v1/studio/models
// Returns available models grouped by mode — used by mobile app model selector
router.get('/models', async (_req, res: Response) => {
  res.json({
    success: true,
    data: {
      modes: STUDIO_MODES,
      models: MODE_MODELS,
      costs: MODE_COSTS,
    },
  });
});

// GET /api/v1/studio/history?mode=text2video&page=1
// Studio generation history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const skip = (page - 1) * limit;

    const { prisma } = await import('../config/database');

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          provider: true,
          model: true,
          prompt: true,
          progress: true,
          outputUrl: true,
          parameters: true,
          actualCost: true,
          createdAt: true,
        },
      }),
      prisma.job.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({ success: true, data: { jobs, total, page, limit } });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message },
    });
  }
});

export default router;
