import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { prisma } from '../config/database';
import { Decimal } from '@prisma/client/runtime/library';

// Attach wallet to request and check minimum balance
export async function walletMiddleware(minCredits: number) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;

      const wallet = await prisma.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        res.status(404).json({
          success: false,
          error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
        });
        return;
      }

      const balance = parseFloat(wallet.balance.toString());

      if (balance < minCredits) {
        res.status(402).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient wallet balance',
            details: {
              current: balance,
              required: minCredits,
              shortfall: minCredits - balance,
            },
          },
        });
        return;
      }

      // Attach wallet info to request for controllers to use
      (req as any).wallet = wallet;
      next();
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'WALLET_ERROR', message: 'Wallet check failed' },
      });
    }
  };
}
