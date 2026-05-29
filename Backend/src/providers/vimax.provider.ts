import axios from 'axios';
import { IGenerationProvider } from './base.provider';
import { VideoGenerationParams, GenerationResult } from '../types';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export class VimaxProvider implements IGenerationProvider {
  name = 'vimax';

  private get baseUrl() {
    return config.providers.vimaxServiceUrl;
  }

  async estimateCost(params: VideoGenerationParams): Promise<number> {
    // ViMax cost depends on number of scenes
    // Base cost: 20 credits per generation
    return 20;
  }

  async generateVideo(params: VideoGenerationParams): Promise<GenerationResult> {
    try {
      const endpoint = params.type === 'script2video'
        ? '/generate/script2video'
        : '/generate/idea2video';

      logger.info(`ViMax: submitting job`, { type: params.type });

      const response = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {
          content: params.prompt,
          style: params.style || 'Realistic',
          requirements: params.requirements || '',
        },
        { timeout: 30000 } // 30s timeout just for submission
      );

      const jobId = response.data?.job_id;
      if (!jobId) throw new Error('No job_id from ViMax service');

      return {
        success: true,
        providerJobId: jobId,
        actualCost: await this.estimateCost(params),
      };
    } catch (err: any) {
      logger.error(`ViMax: submission failed`, { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async checkStatus(providerJobId: string) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/jobs/${providerJobId}/status`,
        { timeout: 10000 }
      );

      const data = response.data;
      const status = data?.status;

      if (status === 'completed') {
        return {
          status: 'completed' as const,
          progress: 100,
          outputUrl: data.output_url,
        };
      }

      if (status === 'failed') {
        return { status: 'failed' as const, error: data.error || 'ViMax job failed' };
      }

      return {
        status: 'processing' as const,
        progress: data.progress || 30,
      };
    } catch (err: any) {
      return { status: 'failed' as const, error: err.message };
    }
  }
}

export const vimaxProvider = new VimaxProvider();
