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

## Source-grounded generation strategy (large docs/repos)

When you pass `sourceText`, uploaded docs, or `githubRepoUrl`, backend does:

1. Extract and normalize text.
2. Chunk corpus.
3. Lexical pre-filter for candidate pruning.
4. **Remote embeddings retrieval** (provider API), not local embedding models.
5. Rank by semantic similarity + lexical prior.
6. Send only top chunks to the LLM (`MAX_RETRIEVED_*` budgets).

This avoids context explosion on big repositories.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port |
| `PUBLIC_URL` | Yes | `http://localhost:3000` | Public app URL injected via runtime `/config.js` |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `LLM_API_STYLE` | No | `openai` | `openai`, `anthropic`, `openai_compatible` |
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | LLM provider base URL |
| `LLM_API_KEY` | Yes for generation | empty | LLM API key |
| `LLM_MODEL` | Yes | `gpt-4o` | LLM model ID |
| `LLM_MAX_TOKENS` | No | `2000` | Max output tokens |
| `LLM_TEMPERATURE` | No | `0.7` | Sampling temperature |
| `ANTHROPIC_VERSION` | Anthropic only | `2023-06-01` | `anthropic-version` header |
| `EMBEDDING_API_STYLE` | No | `same_as_llm` | `same_as_llm`, `openai`, `anthropic`, `openai_compatible` |
| `EMBEDDING_BASE_URL` | No | empty | Optional embeddings base URL override |
| `EMBEDDING_API_KEY` | No | empty | Optional embeddings API key override |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | Embedding model ID |
| `MAX_EMBEDDING_CANDIDATES` | No | `220` | Max chunk candidates to embed |
| `EMBEDDING_BATCH_SIZE` | No | `64` | Batch size per embeddings request |
| `GITHUB_TOKEN` | Optional | empty | Improves GitHub API rate limits/private access |
| `MAX_RETRIEVED_CHUNKS` | No | `16` | Top chunks sent to LLM |
| `MAX_RETRIEVED_CHARS` | No | `28000` | Character budget sent to LLM |

## Provider examples

### OpenAI (LLM + embeddings)

```env
LLM_API_STYLE=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
EMBEDDING_API_STYLE=same_as_llm
EMBEDDING_MODEL=text-embedding-3-small
```

### OpenAI-compatible (Ollama / LM Studio / gateways)

```env
LLM_API_STYLE=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3:32b
EMBEDDING_API_STYLE=same_as_llm
EMBEDDING_MODEL=nomic-embed-text
```

### Anthropic LLM + external embeddings endpoint

Anthropic docs currently state they do not provide native embedding models; use a separate embeddings provider.

```env
LLM_API_STYLE=anthropic
LLM_BASE_URL=https://api.anthropic.com
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VERSION=2023-06-01

EMBEDDING_API_STYLE=openai_compatible
EMBEDDING_BASE_URL=https://<embedding-provider>/v1
EMBEDDING_API_KEY=<embedding-key>
EMBEDDING_MODEL=voyage-3.5
```

## Notes

- If you want LiteLLM, connect it as external endpoint via `LLM_BASE_URL` / `EMBEDDING_BASE_URL`.
- For very large/private GitHub repos, set `GITHUB_TOKEN`.
