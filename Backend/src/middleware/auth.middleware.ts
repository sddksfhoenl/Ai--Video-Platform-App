import { Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthRequest } from '../types';
import { config } from '../config/env';

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Authorization header required' },
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
      });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email || '',
    };

    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Authentication error' },
    });
  }
}
