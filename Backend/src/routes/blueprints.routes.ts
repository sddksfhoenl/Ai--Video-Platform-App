import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { openaiProvider } from '../providers/openai.provider';
import { walletService } from '../services/wallet.service';
import { prisma } from '../config/database';
import { AuthRequest } from '../types';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

// POST /api/v1/blueprints/generate
// Generate a full creator growth blueprint
router.post('/generate', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      creatorType: z.string().min(3).max(200),
      currentFollowers: z.number().optional(),
      platforms: z.array(z.string()).max(5).optional(),
      goals: z.string().max(500).optional(),
    });

    const params = schema.parse(req.body);
    const cost = openaiProvider.estimateCost('blueprint');

    // Check balance
    const wallet = await walletService.getOrCreateWallet(req.user!.id);
    if (parseFloat(wallet.balance.toString()) < cost) {
      res.status(402).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient credits for blueprint generation',
          details: { required: cost, current: parseFloat(wallet.balance.toString()) },
        },
      });
      return;
    }

    // Generate blueprint via OpenAI
    const blueprint = await openaiProvider.generateBlueprint(params);

    // Deduct credits
    await walletService.holdCredits(req.user!.id, `blueprint_${Date.now()}`, cost);

    // Save blueprint to DB for history
    const saved = await prisma.job.create({
      data: {
        userId: req.user!.id,
        type: 'AGENT',
        status: 'COMPLETED',
        provider: 'openai',
        model: 'gpt-4o',
        prompt: params.creatorType,
        parameters: params as any,
        actualCost: cost,
        progress: 100,
        // Store blueprint result in stageLog for retrieval
        stageLog: [
          {
            stage: 'blueprint',
            data: blueprint,
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });

    res.json({
      success: true,
      data: {
        blueprintId: saved.id,
        blueprint,
        creditsUsed: cost,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'BLUEPRINT_FAILED', message: err.message },
    });
  }
});

// GET /api/v1/blueprints/history
// Get user's saved blueprints
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '10');
    const skip = (page - 1) * limit;

    const [blueprints, total] = await Promise.all([
      prisma.job.findMany({
        where: {
          userId: req.user!.id,
          provider: 'openai',
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          prompt: true,
          parameters: true,
          stageLog: true,
          createdAt: true,
        },
      }),
      prisma.job.count({
        where: { userId: req.user!.id, provider: 'openai', status: 'COMPLETED' },
      }),
    ]);

    res.json({
      success: true,
      data: { blueprints, total, page, limit },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message },
    });
  }
});

// GET /api/v1/blueprints/:id
// Get a single blueprint by ID
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const blueprint = await prisma.job.findFirst({
      where: { id: req.params.id, userId: req.user!.id, provider: 'openai' },
    });

    if (!blueprint) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Blueprint not found' },
      });
      return;
    }

    res.json({ success: true, data: blueprint });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message },
    });
  }
});

export default router;
