import { VideoGenerationParams, GenerationResult } from '../types';

export interface IGenerationProvider {
  name: string;
  estimateCost(params: VideoGenerationParams): Promise<number>;
  generateVideo(params: VideoGenerationParams): Promise<GenerationResult>;
  checkStatus(providerJobId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    outputUrl?: string;
    error?: string;
  }>;
}
