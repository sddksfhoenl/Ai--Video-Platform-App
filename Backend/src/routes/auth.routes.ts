import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { walletService } from '../services/wallet.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { AuthRequest } from '../types';
import { z } from 'zod';

const router = Router();

// POST /api/v1/auth/sync-user
// Called after Supabase login to create/sync user in our DB + create wallet
router.post('/sync-user', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id, email } = req.user!;
    const { displayName, avatarUrl } = req.body;

    // Upsert user
    const user = await prisma.user.upsert({
      where: { id },
      create: { id, email, displayName, avatarUrl },
      update: { email, displayName, avatarUrl },
    });

    // Create wallet if it doesn't exist
    const wallet = await walletService.getOrCreateWallet(id);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        wallet: {
          balance: parseFloat(wallet.balance.toString()),
          currency: wallet.currency,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: err.message },
    });
  }
});

// GET /api/v1/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { wallet: true },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        wallet: user.wallet
          ? { balance: parseFloat(user.wallet.balance.toString()), currency: user.wallet.currency }
          : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message },
    });
  }
});

export default router;
