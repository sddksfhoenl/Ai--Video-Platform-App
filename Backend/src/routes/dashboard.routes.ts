import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { openaiProvider } from '../providers/openai.provider';
import { walletService } from '../services/wallet.service';
import { AuthRequest } from '../types';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

// POST /api/v1/dashboard/ideas
// Generate content ideas for the dashboard
router.post('/ideas', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      niche: z.string().min(2).max(100),
      platform: z.string().optional(),
      style: z.string().optional(),
    });

    const params = schema.parse(req.body);
    const cost = openaiProvider.estimateCost('dashboard_ideas');

    // Check balance
    const wallet = await walletService.getOrCreateWallet(req.user!.id);
    if (parseFloat(wallet.balance.toString()) < cost) {
      res.status(402).json({
        success: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough credits' },
      });
      return;
    }

    const ideas = await openaiProvider.generateDashboardIdeas(params);

    // Deduct credits (small amount for text)
    await walletService.holdCredits(req.user!.id, `dashboard_${Date.now()}`, cost);

    res.json({ success: true, data: ideas });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'IDEAS_FAILED', message: err.message },
    });
  }
});

// POST /api/v1/dashboard/hooks
// Generate viral hooks for a topic
router.post('/hooks', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      topic: z.string().min(3).max(200),
      count: z.number().min(3).max(10).optional(),
    });

    const { topic, count } = schema.parse(req.body);
    const hooks = await openaiProvider.generateViralHooks(topic, count || 5);

    res.json({ success: true, data: { hooks } });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'HOOKS_FAILED', message: err.message },
    });
  }
});

// POST /api/v1/dashboard/niche-analysis
// Analyze a creator niche
router.post('/niche-analysis', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({ niche: z.string().min(2).max(100) });
    const { niche } = schema.parse(req.body);

    const analysis = await openaiProvider.analyzeNiche(niche);
    res.json({ success: true, data: { analysis } });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'ANALYSIS_FAILED', message: err.message },
    });
  }
});

// POST /api/v1/dashboard/chat
// AI creator assistant multi-turn chat
router.post('/chat', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      message: z.string().min(1).max(1000),
      history: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          })
        )
        .max(20) // limit history to 20 messages
        .optional(),
    });

    const { message, history } = schema.parse(req.body);
    const reply = await openaiProvider.creatorAssistantChat(history || [], message);

    res.json({ success: true, data: { reply } });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'CHAT_FAILED', message: err.message },
    });
  }
});

// POST /api/v1/dashboard/script
// Generate a video script
router.post('/script', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      idea: z.string().min(5).max(500),
      duration: z.number().min(15).max(600).optional(),
      style: z.string().optional(),
    });

    const { idea, duration, style } = schema.parse(req.body);
    const script = await openaiProvider.generateVideoScript(idea, duration || 60, style || 'engaging');

    res.json({ success: true, data: { script } });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'SCRIPT_FAILED', message: err.message },
    });
  }
});

export default router;
