import rateLimit from 'express-rate-limit';

// Strict limiter for AI generation endpoints (costs money)
export const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many generation requests. Limit: 20 per hour.',
    },
  },
});

// Medium limiter for OpenAI text endpoints
export const openaiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many AI requests. Limit: 15 per minute.',
    },
  },
});

// Loose limiter for read endpoints
export const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
  },
});
