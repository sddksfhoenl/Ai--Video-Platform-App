import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import { walletService } from '../services/wallet.service';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/v1/payments/webhook
// Razorpay calls this URL after payment succeeds/fails
// IMPORTANT: This route must NOT use authMiddleware — Razorpay calls it directly
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'] as string;

    if (!webhookSignature) {
      res.status(400).json({ error: 'Missing webhook signature' });
      return;
    }

    // Verify Razorpay webhook signature
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      logger.warn('Invalid Razorpay webhook signature');
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body.event;
    const payload = req.body.payload;

    logger.info('Razorpay webhook received', { event });

    if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const amountPaise = payment.amount; // Razorpay sends in paise
      const amountInr = amountPaise / 100;

      // Get userId from order notes
      const userId = payment.notes?.userId;

      if (!userId) {
        logger.error('No userId in payment notes', { paymentId });
        res.status(200).json({ received: true }); // Still return 200 to Razorpay
        return;
      }

      // Check if already processed (idempotency)
      const existing = await prisma.transaction.findFirst({
        where: { razorpayId: paymentId },
      });

      if (existing) {
        logger.info('Payment already processed', { paymentId });
        res.status(200).json({ received: true });
        return;
      }

      // Credit wallet
      await walletService.topUpWallet(userId, amountInr, paymentId);
      logger.info('Wallet credited via webhook', { userId, amountInr, paymentId });
    }

    if (event === 'payment.failed') {
      const payment = payload.payment.entity;
      logger.warn('Payment failed', { paymentId: payment.id, reason: payment.error_description });
      // No action needed — wallet was never credited
    }

    // Always return 200 to Razorpay so it stops retrying
    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error('Webhook error', { error: err.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /api/v1/payments/verify
// Called by mobile app AFTER Razorpay SDK payment completes
// This is the primary flow (webhook is backup)
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      amount_inr,
      user_id,
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Payment verification fields missing' },
      });
      return;
    }

    // Verify Razorpay payment signature
    const expectedSig = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Payment verification failed' },
      });
      return;
    }

    // Idempotency check
    const existing = await prisma.transaction.findFirst({
      where: { razorpayId: razorpay_payment_id },
    });

    if (existing) {
      const wallet = await walletService.getOrCreateWallet(user_id);
      res.json({
        success: true,
        data: {
          already_processed: true,
          new_balance: parseFloat(wallet.balance.toString()),
        },
      });
      return;
    }

    // Credit wallet
    const { netCredits } = await walletService.topUpWallet(
      user_id,
      amount_inr,
      razorpay_payment_id
    );

    const wallet = await walletService.getOrCreateWallet(user_id);

    res.json({
      success: true,
      data: {
        credits_added: netCredits,
        new_balance: parseFloat(wallet.balance.toString()),
        payment_id: razorpay_payment_id,
      },
    });
  } catch (err: any) {
    logger.error('Payment verify error', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'VERIFY_FAILED', message: err.message },
    });
  }
});

export default router;
