# AI Video Platform — Backend

Node.js + Express + TypeScript backend for the AI Video Generation Platform.

## Architecture

```
src/
├── app.ts                    Express entry + WebSocket
├── config/                   env, database, redis
├── routes/
│   ├── auth.routes.ts        POST /api/v1/auth/sync-user, GET /me
│   ├── wallet.routes.ts      GET|POST /api/v1/wallet/*
│   ├── jobs.routes.ts        POST /api/v1/jobs/agent|vimax, GET /:id
│   ├── upload.routes.ts      POST /api/v1/upload/asset
│   ├── dashboard.routes.ts   POST /api/v1/dashboard/ideas|hooks|chat|script
│   ├── blueprints.routes.ts  POST /api/v1/blueprints/generate, GET /history
│   └── studio.routes.ts      POST /api/v1/studio/generate, GET /models|history
├── providers/
│   ├── openai.provider.ts    Dashboard AI + Blueprints
│   ├── muapi.provider.ts     Image + Video generation
│   └── vimax.provider.ts     Idea2Video + Script2Video
├── services/
│   ├── wallet.service.ts     Credit management
│   ├── jobs.service.ts       Job creation + tracking
│   └── storage.service.ts    S3/R2 uploads
├── queues/workers/
│   ├── agent.worker.ts       Processes Muapi jobs
│   └── vimax.worker.ts       Processes ViMax jobs
└── middleware/
    ├── auth.middleware.ts     Supabase JWT verification
    ├── wallet.middleware.ts   Balance check
    └── rateLimit.middleware.ts Per-route rate limits
```

## Setup

### 1. Start infrastructure
```bash
docker-compose up -d postgres redis
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

### 4. Run migrations
```bash
npm run db:generate
npm run db:migrate
# Migration name: init (or add_chat_sessions for schema update)
```

### 5. Start dev server
```bash
npm run dev
```

### 6. Start ViMax wrapper (separate terminal)
```bash
cd ../services/ViMax
uv add fastapi uvicorn
cp ../../vimax_api_wrapper.py ./api_wrapper.py
uv run uvicorn api_wrapper:app --host 0.0.0.0 --port 8000 --reload
```

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/sync-user | Sync Supabase user to DB |
| GET | /api/v1/auth/me | Get current user + wallet |

### Wallet
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/wallet | Get balance + recent transactions |
| POST | /api/v1/wallet/topup/initiate | Create Razorpay order |
| POST | /api/v1/wallet/topup/verify | Verify payment + credit wallet |
| GET | /api/v1/wallet/transactions | Paginated transaction history |

### Studio
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/studio/generate | Generate (all modes) |
| GET | /api/v1/studio/models | Available models per mode |
| GET | /api/v1/studio/history | Generation history |

### Dashboard (OpenAI)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/dashboard/ideas | Content ideas for niche |
| POST | /api/v1/dashboard/hooks | Viral hooks for topic |
| POST | /api/v1/dashboard/niche-analysis | Niche analysis |
| POST | /api/v1/dashboard/chat | AI assistant chat |
| POST | /api/v1/dashboard/script | Video script generator |

### Blueprints (OpenAI)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/blueprints/generate | Full creator blueprint |
| GET | /api/v1/blueprints/history | Saved blueprints |
| GET | /api/v1/blueprints/:id | Single blueprint |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/jobs/:id | Job status + progress |
| GET | /api/v1/jobs | Job list with filters |
| DELETE | /api/v1/jobs/:id | Cancel queued job |

## WebSocket

Connect to track job progress in real time:
```
ws://localhost:3001/ws/jobs?token=<supabase_jwt>
```

Messages received:
```json
{ "type": "progress", "data": { "progress": 45, "stage": "generating", "message": "..." } }
{ "type": "completed", "data": { "outputUrl": "https://..." } }
{ "type": "failed", "data": { "error": "..." } }
```

## Credit Costs

| Feature | Credits |
|---------|---------|
| Dashboard ideas | 1 |
| Viral hooks | 1 |
| Niche analysis | 1 |
| AI chat message | 0.5 |
| Video script | 2 |
| Creator blueprint | 3 |
| Text to image | 3 |
| Text to video | 10 |
| Image to video | 12 |
| Idea to video (ViMax) | 20 |
| Script to video (ViMax) | 20 |
