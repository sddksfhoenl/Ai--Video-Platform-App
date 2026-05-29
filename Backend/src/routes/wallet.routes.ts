import { Router, Response } from 'express';
import Razorpay from 'razorpay';
import { authMiddleware } from '../middleware/auth.middleware';
import { walletService } from '../services/wallet.service';
import { AuthRequest } from '../types';
import { config } from '../config/env';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

// GET /api/v1/wallet
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await walletService.getWalletWithHistory(req.user!.id);
    if (!wallet) {
      res.status(404).json({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
      return;
    }
    res.json({
      success: true,
      data: {
        balance: parseFloat(wallet.balance.toString()),
        currency: wallet.currency,
        recentTransactions: wallet.transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount.toString()),
          status: t.status,
          description: t.description,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message },
    });
  }
});

// POST /api/v1/wallet/topup/initiate
// Step 1: Create Razorpay order → return to mobile app
router.post('/topup/initiate', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({ amount_inr: z.number().min(10).max(100000) });
    const { amount_inr } = schema.parse(req.body);

    const order = await razorpay.orders.create({
      amount: Math.round(amount_inr * 100), // paise
      currency: 'INR',
      receipt: `topup_${req.user!.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        userId: req.user!.id,
        amount_inr: String(amount_inr),
      },
    });

    res.json({
      success: true,
      data: {
        razorpay_order_id: order.id,
        amount_inr,
        amount_paise: Math.round(amount_inr * 100),
        currency: 'INR',
        key_id: config.razorpay.keyId, // mobile SDK needs this
        user_id: req.user!.id,         // mobile needs to pass back in verify
      },
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: { code: 'ORDER_FAILED', message: err.message },
    });
  }
});

// GET /api/v1/wallet/transactions
router.get('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const result = await walletService.getTransactions(req.user!.id, page, limit);

    res.json({
      success: true,
      data: {
        ...result,
        transactions: result.transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount.toString()),
          status: t.status,
          description: t.description,
          jobId: t.jobId,
          createdAt: t.createdAt,
        })),
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
