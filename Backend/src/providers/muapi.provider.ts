import axios from 'axios';
import { IGenerationProvider } from './base.provider';
import { VideoGenerationParams, GenerationResult } from '../types';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const MUAPI_BASE = 'https://api.muapi.ai/api/v1';

// Credit costs per model
const MODEL_COSTS: Record<string, number> = {
  // Image models
  'flux-dev': 3,
  'flux-schnell': 2,
  'stable-diffusion-3': 3,
  'ideogram-v2': 3,
  // Video models
  'kling-v1': 10,
  'kling-v1-5': 15,
  'kling-v1-i2v': 12,
  'wan2-1-t2v-480p': 8,
  'wan2-1-t2v-720p': 12,
  'wan2-1-i2v-480p': 10,
  'stable-video-diffusion': 8,
  'veo2': 20,
  default: 10,
};

// Muapi endpoint per generation type
const MODE_ENDPOINTS: Record<string, string> = {
  text2image: '/images/generations',
  text2video: '/video/generations',
  image2video: '/video/generations',
  default: '/video/generations',
};

export class MuapiProvider implements IGenerationProvider {
  name = 'muapi';

  private get headers() {
    return {
      Authorization: `Bearer ${config.providers.muapiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async estimateCost(params: VideoGenerationParams): Promise<number> {
    const model = params.model || 'kling-v1';
    return MODEL_COSTS[model] ?? MODEL_COSTS.default;
  }

  async generateVideo(params: VideoGenerationParams): Promise<GenerationResult> {
    try {
      const model = params.model || 'kling-v1';
      const generationType = (params.generationType as string) || 'text2video';
      const endpoint = MODE_ENDPOINTS[generationType] || MODE_ENDPOINTS.default;

      // Build request body based on generation type
      let requestBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
      };

      if (generationType === 'text2image') {
        requestBody = {
          ...requestBody,
          width: params.width || 1024,
          height: params.height || 1024,
          steps: params.steps || 28,
          n: 1,
        };
      } else {
        // Video generation
        requestBody = {
          ...requestBody,
          duration: params.duration || 5,
          aspect_ratio: params.aspectRatio || '16:9',
          ...(params.referenceImageUrl && { image: params.referenceImageUrl }),
        };
      }

      logger.info(`Muapi: submitting ${generationType}`, {
        model,
        prompt: params.prompt.slice(0, 60),
      });

      const response = await axios.post(
        `${MUAPI_BASE}${endpoint}`,
        requestBody,
        { headers: this.headers, timeout: 30000 }
      );

      const requestId =
        response.data?.id ||
        response.data?.request_id ||
        response.data?.data?.[0]?.id;

      if (!requestId) {
        throw new Error('No request_id in Muapi response');
      }

      logger.info(`Muapi: job submitted`, { requestId, type: generationType });

      return {
        success: true,
        providerJobId: String(requestId),
        actualCost: await this.estimateCost(params),
      };
    } catch (err: any) {
      logger.error(`Muapi: submission failed`, { error: err.response?.data || err.message });
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  }

  async checkStatus(providerJobId: string) {
    try {
      // Try video endpoint first, then image
      let response;
      try {
        response = await axios.get(
          `${MUAPI_BASE}/video/generations/${providerJobId}`,
          { headers: this.headers, timeout: 10000 }
        );
      } catch {
        response = await axios.get(
          `${MUAPI_BASE}/images/generations/${providerJobId}`,
          { headers: this.headers, timeout: 10000 }
        );
      }

      const data = response.data;
      const status = (data?.status || '').toLowerCase();

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        // Handle both image and video output formats
        const outputUrl =
          data?.output?.[0] ||
          data?.video_url ||
          data?.url ||
          data?.data?.[0]?.url;

        return { status: 'completed' as const, progress: 100, outputUrl };
      }

      if (status === 'failed' || status === 'error') {
        return { status: 'failed' as const, error: data?.error || 'Generation failed' };
      }

      const progress = data?.progress || 50;
      return { status: 'processing' as const, progress };
    } catch (err: any) {
      logger.error(`Muapi: status check failed`, { providerJobId, error: err.message });
      return { status: 'failed' as const, error: err.message };
    }
  }
}

export const muapiProvider = new MuapiProvider();
