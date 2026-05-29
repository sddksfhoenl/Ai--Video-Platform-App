import { prisma } from '../config/database';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export class WalletService {

  // Get or create wallet for user
  async getOrCreateWallet(userId: string) {
    return prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
  }

  // Get wallet with recent transactions
  async getWalletWithHistory(userId: string) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    return wallet;
  }

  // Add credits to wallet (called after Razorpay payment verified)
  async topUpWallet(userId: string, amountInr: number, razorpayId: string) {
    const credits = amountInr * config.platform.creditsPerInr;
    const platformFeeAmount = credits * (config.platform.feePercent / 100);
    const netCredits = credits - platformFeeAmount;

    const result = await prisma.$transaction(async (tx) => {
      // Add credits
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: netCredits } },
      });

      // Record TOPUP transaction
      const transaction = await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: TransactionType.TOPUP,
          amount: netCredits,
          status: TransactionStatus.COMPLETED,
          razorpayId,
          description: `Top up ₹${amountInr}`,
          metadata: {
            grossAmount: amountInr,
            platformFee: platformFeeAmount,
            netCredits,
          },
        },
      });

      // Record platform fee
      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: TransactionType.PLATFORM_FEE,
          amount: platformFeeAmount,
          status: TransactionStatus.COMPLETED,
          description: `Platform fee (${config.platform.feePercent}%)`,
          metadata: { razorpayId },
        },
      });

      return { wallet, transaction, netCredits };
    });

    logger.info(`Wallet topped up`, { userId, amountInr, netCredits });
    return result;
  }

  // Hold credits for a job (pre-deduction)
  async holdCredits(userId: string, jobId: string, estimatedCost: number) {
    return prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new Error('Wallet not found');

      const balance = parseFloat(wallet.balance.toString());
      if (balance < estimatedCost) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: estimatedCost } },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: TransactionType.JOB_DEDUCT,
          amount: estimatedCost,
          status: TransactionStatus.PENDING,
          jobId,
          description: 'Credits held for job',
        },
      });

      return transaction;
    });
  }

  // Finalize job billing (called when job completes)
  async finalizeJobBilling(userId: string, jobId: string, actualCost: number) {
    return prisma.$transaction(async (tx) => {
      // Find the pending transaction for this job
      const pendingTx = await tx.transaction.findFirst({
        where: { jobId, status: TransactionStatus.PENDING },
        include: { wallet: true },
      });

      if (!pendingTx) throw new Error('Pending transaction not found');

      const heldAmount = parseFloat(pendingTx.amount.toString());
      const refundAmount = heldAmount - actualCost;

      // Update transaction to COMPLETED with actual cost
      await tx.transaction.update({
        where: { id: pendingTx.id },
        data: {
          status: TransactionStatus.COMPLETED,
          amount: actualCost,
          description: 'Job completed',
        },
      });

      // Refund difference if we over-estimated
      if (refundAmount > 0) {
        await tx.wallet.update({
          where: { userId },
          data: { balance: { increment: refundAmount } },
        });

        await tx.transaction.create({
          data: {
            userId,
            walletId: pendingTx.walletId,
            type: TransactionType.REFUND,
            amount: refundAmount,
            status: TransactionStatus.COMPLETED,
            jobId,
            description: 'Unused credit refund',
          },
        });
      }

      logger.info(`Job billing finalized`, { userId, jobId, actualCost, refundAmount });
    });
  }

  // Full refund when job fails
  async refundJob(userId: string, jobId: string) {
    return prisma.$transaction(async (tx) => {
      const pendingTx = await tx.transaction.findFirst({
        where: { jobId, status: TransactionStatus.PENDING },
        include: { wallet: true },
      });

      if (!pendingTx) return; // Nothing to refund

      const heldAmount = parseFloat(pendingTx.amount.toString());

      await tx.transaction.update({
        where: { id: pendingTx.id },
        data: { status: TransactionStatus.REFUNDED },
      });

      await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: heldAmount } },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: pendingTx.walletId,
          type: TransactionType.REFUND,
          amount: heldAmount,
          status: TransactionStatus.COMPLETED,
          jobId,
          description: 'Job failed — full refund',
        },
      });

      logger.info(`Job refunded`, { userId, jobId, amount: heldAmount });
    });
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where: { userId } }),
    ]);
    return { transactions, total, page, limit };
  }
}

export const walletService = new WalletService();
