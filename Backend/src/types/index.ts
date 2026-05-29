import { Request } from 'express';

// Authenticated request — user is attached after JWT verification
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

// Standard API response shape
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Job stage update (stored in stageLog JSON array)
export interface StageUpdate {
  stage: string;
  message: string;
  progress: number;
  timestamp: string;
}

// WebSocket message types
export type WsMessageType = 'progress' | 'completed' | 'failed' | 'ping';

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}

// Provider generation params
export interface VideoGenerationParams {
  prompt: string;
  style?: string;
  duration?: number;
  model?: string;
  referenceImageUrl?: string;
  [key: string]: unknown;
}

export interface GenerationResult {
  success: boolean;
  outputUrl?: string;
  providerJobId?: string;
  actualCost?: number;
  error?: string;
}
