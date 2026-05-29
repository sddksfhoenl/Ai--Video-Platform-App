import dotenv from 'dotenv';
dotenv.config();

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  database: {
    url: require_env('DATABASE_URL'),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  supabase: {
    url: require_env('SUPABASE_URL'),
    anonKey: require_env('SUPABASE_ANON_KEY'),
    jwtSecret: require_env('SUPABASE_JWT_SECRET'),
  },

  s3: {
    bucketName: require_env('S3_BUCKET_NAME'),
    region: process.env.S3_REGION || 'ap-south-1',
    accessKeyId: require_env('S3_ACCESS_KEY_ID'),
    secretAccessKey: require_env('S3_SECRET_ACCESS_KEY'),
    endpoint: process.env.S3_ENDPOINT,
  },

  razorpay: {
    keyId: require_env('RAZORPAY_KEY_ID'),
    keySecret: require_env('RAZORPAY_KEY_SECRET'),
    webhookSecret: require_env('RAZORPAY_WEBHOOK_SECRET'),
  },

  providers: {
    openaiKey: require_env('OPENAI_API_KEY'),           // ← NEW
    muapiKey: require_env('MUAPI_API_KEY'),
    googleAiKey: require_env('GOOGLE_AI_API_KEY'),
    openrouterKey: process.env.OPENROUTER_API_KEY || '',
    vimaxServiceUrl: process.env.VIMAX_SERVICE_URL || 'http://localhost:8000',
  },

  platform: {
    feePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '5'),
    creditsPerInr: parseFloat(process.env.CREDITS_PER_INR || '1'),
  },
};
