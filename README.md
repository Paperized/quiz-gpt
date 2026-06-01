# learn-gpt

learn-gpt is a self-hostable full-stack app that generates quizzes from natural language prompts using an OpenAI-compatible LLM API. It stores generated quizzes and attempt history in PostgreSQL, then provides reviewable results and performance metrics.

## Stack choice

- Backend: TypeScript + Express + `pg` for a small, explicit API surface and easy deployment.
- Frontend: React + Vite for fast iteration and clean component-driven UI.
- Database: PostgreSQL with SQL migrations auto-applied by backend startup.

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 16+
- (Optional) Docker + Docker Compose

## Local development (without Docker)

1. Copy env file:

```bash
cp .env.example .env
```

2. Set `DATABASE_URL` and LLM variables in `.env`.
3. Install dependencies:

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

App runs on `http://localhost:3000` and serves frontend + API from one container.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port |
| `PUBLIC_URL` | Yes | `http://localhost:3000` | Public app URL used by frontend runtime config for API base |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `LLM_API_KEY` | Yes for generation | empty | API key for selected provider |
| `LLM_MODEL` | Yes | `gpt-4o` | Model identifier |
| `LLM_MAX_TOKENS` | No | `2000` | Max completion tokens |
| `LLM_TEMPERATURE` | No | `0.7` | Sampling temperature |

## Custom LLM provider example (Ollama)

```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.1
LLM_MAX_TOKENS=2000
LLM_TEMPERATURE=0.7
```

As long as the provider supports `/v1/chat/completions`, the app can use it.
