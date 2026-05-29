import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardIdeasParams {
  niche: string;
  platform?: string;
  style?: string;
}

export interface BlueprintParams {
  creatorType: string;       // "fitness creator", "tech reviewer", etc.
  currentFollowers?: number;
  platforms?: string[];
  goals?: string;
}

export interface BlueprintResult {
  nicheStrategy: string;
  contentPillars: string[];
  monetizationPlan: string;
  viralHooks: string[];
  postingSchedule: string;
  videoConcepts: string[];
  growthRoadmap: string;
  rawMarkdown: string;
}

export interface DashboardIdeasResult {
  contentIdeas: string[];
  trendingSuggestions: string[];
  growthTips: string[];
  viralAngles: string[];
}

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

export class OpenAIProvider {
  name = 'openai';

  private get headers() {
    return {
      Authorization: `Bearer ${config.providers.openaiKey}`,
      'Content-Type': 'application/json',
    };
  }

  // Core chat completion — used internally by all methods
  private async chat(
    systemPrompt: string,
    userPrompt: string,
    model = 'gpt-4o',
    maxTokens = 1500
  ): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
        },
        { headers: this.headers, timeout: 30000 }
      );

      return response.data.choices[0]?.message?.content || '';
    } catch (err: any) {
      logger.error('OpenAI chat error', { error: err.response?.data || err.message });
      throw new Error(err.response?.data?.error?.message || 'OpenAI request failed');
    }
  }

  // ── Dashboard: Content Ideas + Recommendations ──────────────────────────────
  async generateDashboardIdeas(params: DashboardIdeasParams): Promise<DashboardIdeasResult> {
    const system = `You are an expert social media strategist and content coach.
You help creators grow their audience with data-driven, viral content strategies.
Always respond in valid JSON only. No markdown, no explanation, just JSON.`;

    const user = `Generate content recommendations for a ${params.niche} creator
on ${params.platform || 'YouTube/Instagram/TikTok'}.
Style preference: ${params.style || 'educational + entertaining'}.

Return this exact JSON structure:
{
  "contentIdeas": ["idea1", "idea2", "idea3", "idea4", "idea5"],
  "trendingSuggestions": ["trend1", "trend2", "trend3"],
  "growthTips": ["tip1", "tip2", "tip3"],
  "viralAngles": ["angle1", "angle2", "angle3"]
}`;

    const raw = await this.chat(system, user, 'gpt-4o', 800);

    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean) as DashboardIdeasResult;
    } catch {
      // Fallback if JSON parse fails
      return {
        contentIdeas: ['Could not parse ideas. Try again.'],
        trendingSuggestions: [],
        growthTips: [],
        viralAngles: [],
      };
    }
  }

  // ── Creator Blueprint ────────────────────────────────────────────────────────
  async generateBlueprint(params: BlueprintParams): Promise<BlueprintResult> {
    const system = `You are a world-class creator growth strategist and business consultant.
You create detailed, actionable growth blueprints for content creators.
Be specific, practical, and data-driven.
Always respond in valid JSON only. No markdown formatting outside JSON strings.`;

    const user = `Create a complete creator growth blueprint for:
Creator Type: ${params.creatorType}
Current Followers: ${params.currentFollowers || 'just starting'}
Platforms: ${params.platforms?.join(', ') || 'YouTube, Instagram, TikTok'}
Goals: ${params.goals || 'grow to 100k followers and monetize'}

Return this exact JSON:
{
  "nicheStrategy": "detailed paragraph about niche positioning",
  "contentPillars": ["pillar1", "pillar2", "pillar3", "pillar4"],
  "monetizationPlan": "detailed monetization strategy paragraph",
  "viralHooks": ["hook1", "hook2", "hook3", "hook4", "hook5"],
  "postingSchedule": "detailed posting schedule description",
  "videoConcepts": ["concept1", "concept2", "concept3", "concept4", "concept5"],
  "growthRoadmap": "step by step 90-day roadmap paragraph",
  "rawMarkdown": "full blueprint in readable markdown format"
}`;

    const raw = await this.chat(system, user, 'gpt-4o', 2000);

    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean) as BlueprintResult;
    } catch {
      return {
        nicheStrategy: raw,
        contentPillars: [],
        monetizationPlan: '',
        viralHooks: [],
        postingSchedule: '',
        videoConcepts: [],
        growthRoadmap: '',
        rawMarkdown: raw,
      };
    }
  }

  // ── Niche Analysis ───────────────────────────────────────────────────────────
  async analyzeNiche(niche: string): Promise<string> {
    const system = `You are a content niche analyst. Be concise and actionable.`;
    const user = `Analyze the "${niche}" creator niche in 3 sections:
1. Market opportunity and competition level
2. Top 3 content formats that work best
3. Monetization potential

Keep it under 200 words total. Plain text, no markdown.`;

    return this.chat(system, user, 'gpt-4o-mini', 400);
  }

  // ── Viral Hook Generator ─────────────────────────────────────────────────────
  async generateViralHooks(topic: string, count = 5): Promise<string[]> {
    const system = `You are a viral content hook writer. Generate scroll-stopping hooks.
Return only a JSON array of strings. No other text.`;

    const user = `Generate ${count} viral video hooks for the topic: "${topic}"
Return format: ["hook1", "hook2", "hook3"]`;

    const raw = await this.chat(system, user, 'gpt-4o-mini', 300);
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch {
      return [raw];
    }
  }

  // ── Script Generator (for Studio use) ───────────────────────────────────────
  async generateVideoScript(idea: string, duration = 60, style = 'engaging'): Promise<string> {
    const system = `You are a professional video scriptwriter.
Write scripts that are engaging, well-paced, and optimized for the specified duration.`;

    const user = `Write a ${duration}-second video script for: "${idea}"
Style: ${style}
Include: hook, main content, call to action.
Format as a clean script with [SCENE] markers.`;

    return this.chat(system, user, 'gpt-4o', 1000);
  }

  // ── AI Chat Assistant ────────────────────────────────────────────────────────
  async creatorAssistantChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): Promise<string> {
    const system = `You are an AI assistant specialized in helping content creators.
You help with: content strategy, video ideas, growth tactics, monetization, scripting, and analytics.
Be concise, friendly, and actionable. Keep responses under 150 words unless asked for more detail.`;

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          max_tokens: 500,
          messages: [
            { role: 'system', content: system },
            ...messages,
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
        },
        { headers: this.headers, timeout: 20000 }
      );

      return response.data.choices[0]?.message?.content || '';
    } catch (err: any) {
      throw new Error(err.response?.data?.error?.message || 'OpenAI chat failed');
    }
  }

  // Cost estimation (OpenAI is cheap for text — flat rate)
  estimateCost(feature: string): number {
    const costs: Record<string, number> = {
      dashboard_ideas: 1,
      blueprint: 3,
      niche_analysis: 1,
      viral_hooks: 1,
      script: 2,
      chat: 0.5,
    };
    return costs[feature] ?? 1;
  }
}

export const openaiProvider = new OpenAIProvider();
