# QuizGPT

QuizGPT is a self-hostable multi-user full-stack web app that generates quizzes from natural language prompts. Quizzes and attempts are persisted in PostgreSQL, quizzes can be retaken without re-calling the LLM, and the app supports source-grounded generation from uploaded documents and GitHub repositories.

It is designed for authenticated teams, not only for a single local operator.
The current app includes:

- email/password auth and optional OIDC/SSO auth
- roles: `super_admin`, `admin`, `user`
- multi-user administration
- system and private providers/models with per-user access assignment
- quiz groups, regenerate flows, guest share links, review/results screens, admin and profile pages

In practice:

- users can create and manage their own quizzes and private resources
- admins can manage users and create shared system resources
- guest users can only access public share links, never the authenticated UI

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

2. Configure `.env` (`DATABASE_URL` is required). For local non-Docker DB, change `DATABASE_URL` host from `db` to your local host (e.g. `localhost`).
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
4. **Remote embeddings retrieval** through the embedding model configured in the app.
5. Rank by semantic similarity + lexical prior.
6. Send only top chunks to the LLM using the app's built-in retrieval budgets.

This avoids context explosion on big repositories.

## Logging

Server logs are JSON lines controlled by `LOG_LEVEL`. They include startup config, generation inputs summarized by size/preview, provider/model settings, retrieval counts, attempts, and clear error messages without stack traces.

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
| `GITHUB_TOKEN` | Optional | empty | Improves GitHub API rate limits/private access |

## Models and providers

QuizGPT no longer reads global LLM or embedding credentials from environment variables.
Generation and retrieval are configured inside the app:

- create one or more providers in the admin UI
- create LLM and embedding models linked to those providers
- assign access to the right users
- choose the default LLM and optional default embedding model from the app
- optionally override the selected models directly from the quiz generation pages

What this means operationally:

- if a user has no accessible default LLM and does not select one explicitly, quiz generation fails
- embeddings are used only when an embedding model is selected or configured as default
- retrieval budgets and batching are app defaults, not deploy-time env knobs

Common setups:

- OpenAI: create an `openai` provider with `https://api.openai.com/v1`, then create an LLM model such as `gpt-4o` and, if desired, an embedding model such as `text-embedding-3-small`.
- OpenAI-compatible: create an `openai_compatible` provider pointing to Ollama, LM Studio, LiteLLM, vLLM, OpenRouter, or another compatible gateway, then create the matching LLM and embedding models in the UI.
- Anthropic: create an `anthropic` provider for the Claude model you want, and if you need retrieval also create a separate embedding provider/model because Anthropic embeddings are not assumed by the app.

## Sharing quizzes

You can share any quiz with friends or colleagues without giving them access to your QuizGPT instance. From a quiz page, click the **Share** icon to generate a unique link. Optionally set a maximum number of attempts and an expiry date.

The guest experience is fully self-contained: the shared link loads a fullscreen quiz page that requires no login and does not use quiz-generation credentials. Answers are evaluated server-side against the already-generated questions stored in the database. Guest free-text answers are stored but treated as incorrect, with no AI evaluation or explanation returned.

All active share links and their attempt counts are visible under **Shares** in the sidebar, where you can also revoke them at any time.

Guest attempts are also visible to the quiz owner in **Results** and can be opened from the review screen just like regular attempts. This means owners can audit both their own attempts and guest attempts on the quizzes they created.

## Access control and security

QuizGPT supports two authentication methods that can coexist:

### OpenID Connect (SSO)

QuizGPT acts as an OIDC Relying Party. Any OIDC-compliant provider works (Authelia, Authentik, Keycloak, Okta, Google, Azure AD, …).

**Minimum setup:**

1. Create a client in your OIDC provider with redirect URI `https://<your-domain>/api/auth/callback/oidc`
2. Create three groups: **`quiz_super_admin`**, **`quiz_admin`**, and **`quiz_user`**
3. Assign each authorized user to one of the groups
4. Set the `OIDC_*` environment variables (see below)

Users not in one of the three groups will see an "Access Denied" page.

Important behavior of the current backend:

- the app expects the `groups` claim to exist and contain one of the three QuizGPT groups
- the first user to enter the system, whether via email or OIDC, is promoted to **super admin**
- `PUBLIC_URL` and `OIDC_REDIRECT_URI` must match the externally reachable URL exactly
- secure auth cookies are enabled automatically when `PUBLIC_URL` starts with `https`

Group mapping:

| OIDC group | QuizGPT role |
|---|---|
| `quiz_super_admin` | super_admin |
| `quiz_admin` | admin |
| `quiz_user` | user |

The app expects these claims:

- `sub`
- `email`
- optionally `name` or `preferred_username`
- `groups`

Enable the `groups` scope in your OIDC provider, or otherwise ensure the ID token contains a `groups` claim.

```bash
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=quiz-gpt
OIDC_CLIENT_SECRET=xxx
OIDC_REDIRECT_URI=https://quiz.example.com/api/auth/callback/oidc
OIDC_SCOPE=openid profile email groups
```

#### Authentik

For Authentik:

1. Create an OAuth2/OpenID Provider + Application for QuizGPT.
2. Set the redirect URI to `https://<your-domain>/api/auth/callback/oidc`.
3. Ensure the token exposes `sub`, `email`, and a `groups` claim.
4. Map users into groups named exactly:
   - `quiz_super_admin`
   - `quiz_admin`
   - `quiz_user`

What usually matters most in Authentik is not only creating groups, but making sure those group values are actually emitted into the `groups` claim seen by QuizGPT.

#### Keycloak

For Keycloak:

1. Create a confidential client for QuizGPT.
2. Configure the valid redirect URI to `https://<your-domain>/api/auth/callback/oidc`.
3. Add a mapper that exposes user group membership as a `groups` claim.
4. Make sure users land in one of:
   - `quiz_super_admin`
   - `quiz_admin`
   - `quiz_user`

If you use realm roles or client roles internally, add a mapping layer so the final claim still matches the exact group names expected by QuizGPT.

#### Authelia

For Authelia:

1. Configure an OIDC client for QuizGPT.
2. Use the same callback URL as above.
3. Ensure `sub`, `email`, and `groups` are exposed to the client.
4. Ensure the `groups` claim contains one of:
   - `quiz_super_admin`
   - `quiz_admin`
   - `quiz_user`

If Authelia uses different internal group names, translate them before they reach QuizGPT. The backend currently reads the `groups` claim literally.

#### OIDC troubleshooting checklist

Before blaming the app, verify:

- `PUBLIC_URL` is correct and public-facing
- `OIDC_REDIRECT_URI` exactly matches the provider config
- the ID token includes `sub` and `email`
- the ID token includes a `groups` claim
- one allowed QuizGPT group is actually present
- the app is behind HTTPS if you expect secure cookies in production

### Email registration (default)

Enabled by default. Users register with email + password. Set `DISABLE_EMAIL_REGISTER=true` to disable.

```bash
DISABLE_EMAIL_REGISTER=true
```

### Roles

| Role | Permissions |
|------|-------------|
| `super_admin` | First user created. Everything an admin can do, plus cannot be deleted or demoted by anyone, including themselves. |
| `admin` | Manage users, providers and models, manage shared system resources, access admin surfaces |
| `user` | Manage own quizzes/groups/attempts, own private providers/models, and system providers/models explicitly assigned to them |

### Resource scoping

The app currently distinguishes between:

- **private providers/models**
  - owned by one user
  - visible and editable only by that owner
- **system providers/models**
  - created for shared use
  - managed by admins
  - assignable to specific non-admin users

This means a non-admin user should only see:

- their own private models/providers
- shared system models/providers assigned to them

### Public access (guest shares)

Public share links (`/public/s/:token`) and static assets remain unauthenticated. The OIDC middleware only protects `/api/*` routes (excluding `/api/auth/*` and `/api/health`).

## Notes

- If you want LiteLLM, expose it as an `openai_compatible` provider inside the app.
- For very large/private GitHub repos, set `GITHUB_TOKEN`.
- On every push to `main`, GitHub Actions builds and publishes the app image to `ghcr.io/paperized/quiz-gpt`.
- The default `SETTINGS_ENCRYPTION_KEY` in `.env.example` is public — always replace it with your own before deploying: `openssl rand -hex 32`.
