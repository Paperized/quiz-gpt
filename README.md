# learn-gpt

learn-gpt is a self-hostable full-stack web app that generates quizzes from natural language prompts using an LLM. Generated quizzes are stored in PostgreSQL and can be retaken without calling the LLM again. The app includes attempt history and score metrics.

## Stack choice

- Backend: TypeScript + Express + `pg`
- Frontend: React + Vite + TypeScript
- DB: PostgreSQL with SQL migrations auto-applied at backend startup

This stack keeps the codebase small, explicit, and easy to self-host.

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 16+
- Optional: Docker + Docker Compose

## Local development (without Docker)

1. Copy env file:

```bash
cp .env.example .env
```

2. Set `.env` values (`DATABASE_URL` and LLM config are required).
3. Install dependencies:

```bash
npm install
```

4. Run backend + frontend:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend/API: `http://localhost:3000`

## Docker deployment

```bash
docker compose up --build
```

The app is available at `http://localhost:3000`.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port |
| `PUBLIC_URL` | Yes | `http://localhost:3000` | Public app URL exposed via runtime `/config.js` |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `LLM_API_STYLE` | No | `openai` | `openai` for OpenAI-compatible `/chat/completions`, `anthropic` for Anthropic-compatible `/v1/messages` |
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | Provider base URL |
| `LLM_API_KEY` | Yes for generation | empty | Provider API key |
| `LLM_MODEL` | Yes | `gpt-4o` | Model ID |
| `LLM_MAX_TOKENS` | No | `2000` | Max tokens for generation |
| `LLM_TEMPERATURE` | No | `0.7` | Sampling temperature |
| `ANTHROPIC_VERSION` | Only with `LLM_API_STYLE=anthropic` | `2023-06-01` | `anthropic-version` request header |

## Provider examples

### OpenAI-compatible (OpenAI / Ollama / LM Studio / Groq-like endpoints)

```env
LLM_API_STYLE=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

### Anthropic-compatible (Claude-style Messages API)

```env
LLM_API_STYLE=anthropic
LLM_BASE_URL=https://api.anthropic.com
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VERSION=2023-06-01
```

### Anthropic-compatible endpoint with Qwen-style models

If your provider exposes an Anthropic-compatible Messages API (for example with models like `qwen3.7-max`), use:

```env
LLM_API_STYLE=anthropic
LLM_BASE_URL=https://<your-provider-base-url>
LLM_API_KEY=<your-key>
LLM_MODEL=qwen3.7-max
ANTHROPIC_VERSION=2023-06-01
```

## Optional multi-provider libraries

If you want routing/fallback and lower-cost model orchestration instead of manual provider calls, common options are:

- **AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`)
- **LiteLLM** (proxy/gateway style for many providers)

Current project keeps direct HTTP integration for minimal runtime dependencies.
