# QuizGPT

QuizGPT is a self-hostable full-stack web app that generates quizzes from natural language prompts. Quizzes and attempts are persisted in PostgreSQL, and quizzes can be retaken without re-calling the LLM. The app supports source-grounded generation from uploaded documents and GitHub repositories.

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

2. Configure `.env` (`DATABASE_URL` + LLM variables are required). For local non-Docker DB, change `DATABASE_URL` host from `db` to your local host (e.g. `localhost`).
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

The compose setup reads variables from `.env` (no hardcoded app secrets in compose files).

1. Copy env:

```bash
cp .env.example .env
```

2. Choose mode:

### Run from GHCR image (default compose)

```bash
docker compose pull
docker compose up -d
```

### Run from local build (dev compose)

```bash
docker compose -f docker-compose.dev.yml up --build
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

## Logging

Server logs are JSON lines controlled by `LOG_LEVEL`. They include startup config (without secrets), generation inputs summarized by size/preview, provider/model settings, retrieval counts, attempts, and clear error messages without stack traces.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Yes | - | AES-256-GCM key for encrypting API keys stored via the Settings UI. A default is provided in `.env.example` — **change it before deploying**. Generate a new one with: `openssl rand -hex 32` |
| `PORT` | No | `3000` | Backend HTTP port |
| `PUBLIC_URL` | Yes | `http://localhost:3000` | Public app URL injected via runtime `/config.js` |
| `LOG_LEVEL` | No | `info` | JSON log level: `debug`, `info`, `warn`, `error` |
| `JWT_SECRET` | Recommended | auto-generated | Static JWT signing key (set to persist sessions across restarts). Generate: `openssl rand -hex 64` |
| `JWT_EXPIRY` | No | `7d` | JWT session duration |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window for API routes |
| `RATE_LIMIT_MAX_REQUESTS` | No | `300` | Max API requests per window |
| `GENERATE_RATE_LIMIT_MAX_REQUESTS` | No | `20` | Max quiz generation requests per window |
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

## Sharing quizzes

You can share any quiz with friends or colleagues without giving them access to your QuizGPT instance. From a quiz page, click the **Share** icon to generate a unique link. Optionally set a maximum number of attempts and an expiry date.

The guest experience is fully self-contained: the shared link loads a fullscreen quiz page that requires no login, does not interact with the LLM, and does not consume any API tokens. Answers are evaluated server-side against the already-generated questions stored in the database.

All active share links and their attempt counts are visible under **Shares** in the sidebar, where you can also revoke them at any time.

## Access control and security

QuizGPT supports two authentication methods that can coexist:

### OpenID Connect (SSO)

QuizGPT acts as an OIDC Relying Party. Any OIDC-compliant provider works (Authelia, Authentik, Keycloak, Okta, Google, Azure AD, …).

**Setup:**

1. Create a client in your OIDC provider with redirect URI `https://<your-domain>/api/auth/callback/oidc`
2. Create three groups: **`quiz_super_admin`**, **`quiz_admin`**, and **`quiz_user`**
3. Assign each authorized user to one of the groups
4. Set the `OIDC_*` environment variables (see below)

Users not in one of the three groups will see an "Access Denied" page. The first user to log in (OIDC or email) is automatically promoted to **super admin** — a role that cannot be modified or deleted by anyone, including themselves.

Group mapping:

| OIDC group | QuizGPT role |
|---|---|
| `quiz_super_admin` | super_admin |
| `quiz_admin` | admin |
| `quiz_user` | user |

Enable the `groups` scope in your OIDC provider. The app expects the claim `groups` in the ID token.

```bash
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=quiz-gpt
OIDC_CLIENT_SECRET=xxx
OIDC_REDIRECT_URI=https://quiz.example.com/api/auth/callback/oidc
OIDC_SCOPE=openid profile email groups
```

### Email registration (default)

Enabled by default. Users register with email + password. Set `DISABLE_EMAIL_REGISTER=true` to disable.

```bash
DISABLE_EMAIL_REGISTER=true
```

### Roles

| Role | Permissions |
|------|-------------|
| `super_admin` | First user created. Everything an admin can do, plus cannot be deleted or demoted by anyone (including themselves). Only one exists. |
| `admin` | See all quizzes/attempts/groups, manage users, manage system models, edit settings |
| `user` | See own quizzes/attempts/groups, manage own BYOD models, see system models assigned to them |

### Public access (guest shares)

Public share links (`/public/s/:token`) and static assets remain unauthenticated. The OIDC middleware only protects `/api/*` routes (excluding `/api/auth/*` and `/api/health`).

## Notes

- If you want LiteLLM, connect it as external endpoint via `LLM_BASE_URL` / `EMBEDDING_BASE_URL`.
- For very large/private GitHub repos, set `GITHUB_TOKEN`.
- On every push to `main`, GitHub Actions builds and publishes the app image to `ghcr.io/paperized/quiz-gpt`.
- The default `SETTINGS_ENCRYPTION_KEY` in `.env.example` is public — always replace it with your own before deploying: `openssl rand -hex 32`.
