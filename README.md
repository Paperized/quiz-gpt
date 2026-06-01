# learn-gpt

learn-gpt is a self-hostable full-stack web app that generates quizzes from natural language prompts. Quizzes and attempts are persisted in PostgreSQL, and quizzes can be retaken without re-calling the LLM. The app supports source-grounded generation from uploaded documents and GitHub repositories.

## Stack choice

- Backend: TypeScript + Express + `pg` + Vercel AI SDK (`ai`)
- Frontend: React + Vite + TypeScript
- DB: PostgreSQL with SQL migrations auto-applied at backend startup

Why this stack: small operational surface, explicit SQL control, and provider abstraction without custom LLM boilerplate.

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

2. Configure `.env` (`DATABASE_URL` + LLM variables are required).
3. Install deps:

```bash
npm install
```

4. Start backend + frontend:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend/API: `http://localhost:3000`

## Docker deployment

```bash
docker compose up --build
```

App is served at `http://localhost:3000`.

## Source-grounded quiz generation (documents + GitHub)

In quiz creation you can provide:

- `sourceText` (manual notes / pasted docs)
- `documents` upload (`.pdf`, `.docx`, markdown/text/code files)
- `githubRepoUrl` (public repo URL)

The backend uses a retrieval strategy to avoid context overflow:

1. Ingest and normalize text from inputs.
2. Split text into chunks.
3. Rank chunks by topic/settings relevance + path priority (README/docs/src weighting).
4. Send only top chunks to the model (`MAX_RETRIEVED_CHUNKS`, `MAX_RETRIEVED_CHARS`).

This supports large repositories/doc sets without dumping all content into one prompt.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port |
| `PUBLIC_URL` | Yes | `http://localhost:3000` | Public app URL injected via runtime `/config.js` |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `LLM_API_STYLE` | No | `openai` | `openai`, `anthropic`, `openai_compatible` |
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | Provider base URL |
| `LLM_API_KEY` | Yes for generation | empty | Provider API key |
| `LLM_MODEL` | Yes | `gpt-4o` | Model ID |
| `LLM_MAX_TOKENS` | No | `2000` | Max model output tokens |
| `LLM_TEMPERATURE` | No | `0.7` | Sampling temperature |
| `ANTHROPIC_VERSION` | Anthropic only | `2023-06-01` | `anthropic-version` header |
| `GITHUB_TOKEN` | Optional | empty | Improves GitHub API rate limits/private access if allowed |
| `MAX_RETRIEVED_CHUNKS` | No | `16` | Max retrieved chunks sent to model |
| `MAX_RETRIEVED_CHARS` | No | `28000` | Max characters sent from retrieved context |

## Provider examples

### OpenAI (official)

```env
LLM_API_STYLE=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

### OpenAI-compatible providers (Ollama / LM Studio / gateways)

```env
LLM_API_STYLE=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.1
```

### Anthropic-compatible (Claude or compatible endpoints)

```env
LLM_API_STYLE=anthropic
LLM_BASE_URL=https://api.anthropic.com
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VERSION=2023-06-01
```

### Anthropic-compatible endpoint with models like `qwen3.7-max`

```env
LLM_API_STYLE=anthropic
LLM_BASE_URL=https://<provider-anthropic-endpoint>
LLM_API_KEY=<provider-key>
LLM_MODEL=qwen3.7-max
ANTHROPIC_VERSION=2023-06-01
```

## Notes

- If you want LiteLLM, connect it as external endpoint via `LLM_BASE_URL` + `LLM_API_KEY` (no internal gateway dependency needed).
- For very large/private GitHub repos, set `GITHUB_TOKEN` to avoid strict unauthenticated rate limits.
