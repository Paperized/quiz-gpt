# QuizGPT Agent Guide

## Purpose

This file defines how agents should work inside this repository.

The goal is to make precise, minimal, project-aware changes to QuizGPT without introducing unrelated behavior, speculative refactors, or noisy edits.

## Project Scope

QuizGPT is a full-stack TypeScript application with:

- `backend/`: Express API, PostgreSQL access, auth, multi-user/admin features, quiz generation orchestration, provider/model management
- `frontend/`: React + Vite authenticated admin UI plus guest/public quiz flows

This is not a single-user toy app anymore.

The current product includes:

- email auth and optional OIDC auth
- roles: `super_admin`, `admin`, `user`
- multi-user administration
- private and system-scoped providers/models with per-user access grants
- quiz groups, regenerate flows, guest shares, attempt review, results, profile, admin and model management screens

Agents must treat this repository as self-contained. Do not infer rules from external projects, shared prompts, or other codebases unless the user explicitly asks for that.

## Core Rules

- Implement only what the user asked for.
- Do not add extra features, refactors, abstractions, or cleanup unless explicitly requested.
- Keep edits local and reversible.
- Preserve the existing architecture and naming style unless the user asks for a redesign.
- Prefer modifying existing files over creating new ones, unless a new file is clearly required.
- If a requested change would require a migration, new dependency, major structural change, or external service change, call that out explicitly before doing it.

## Current Product Model

### Authentication and Roles

- Auth can be email/password, OIDC, or both.
- `DISABLE_EMAIL_REGISTER=true` disables self-service email registration.
- The first user in the system is promoted to `super_admin`.
- Protected frontend routes are enforced by `ProtectedRoute`.
- Backend access checks are enforced in route modules, not only in the frontend.

### Multi-User Data Boundaries

- Users can own private models/providers.
- Admins can create system models/providers.
- System models/providers can be assigned to specific users through access tables.
- Non-admin users must only see and operate on:
  - their own private resources
  - system resources explicitly assigned to them
- Admin pages expose user, provider and model management flows.

### Public and Guest Flows

- Public guest quiz access lives under `/public/s/:token`.
- Guest attempt flows must not leak private answer metadata before submission.
- Review/results/share behavior is distinct from authenticated author/admin behavior.

## How To Navigate This Project

### Backend

Main backend areas:

- `backend/src/index.ts`
  - Express app entrypoint
  - route mounting
  - request schemas
  - generation job endpoints
  - static frontend serving
- `backend/src/auth.ts`
  - JWT auth cookie
  - password hashing
  - auth middleware
  - bootstrap of first user as `super_admin`
- `backend/src/auth-oidc.ts`
  - OIDC discovery
  - login URL generation
  - callback handling
  - role mapping from OIDC groups
- `backend/src/routes-auth.ts`
  - auth status
  - register/login/logout
  - `/me`
  - OIDC entry/callback endpoints
- `backend/src/routes-users.ts`
  - admin-only user management
  - role updates
  - delete protections
- `backend/src/routes-models.ts`
  - model CRUD
  - system/private scoping
  - access grants
  - default model selection
  - model connectivity test endpoints
- `backend/src/routes-providers.ts`
  - provider CRUD
  - system/private scoping
  - access grants
  - provider connectivity test endpoints
  - remote model listing
- `backend/src/llm.ts`
  - quiz generation/regeneration logic
  - structured output handling
  - output sanitization and answer shuffling
- `backend/src/context.ts`
  - source ingestion and retrieval context building
  - document parsing
  - GitHub source handling
  - chunking/ranking
- `backend/src/scoring.ts`
  - answer normalization
  - multi-select scoring
  - free-text evaluation aggregation
- `backend/src/model-config.ts`
  - default model resolution
  - provider-backed model resolution
- `backend/src/db.ts`
  - PostgreSQL pool and migrations
- `backend/src/config.ts`
  - env parsing and defaults
- `backend/src/logger.ts`
  - structured logging helpers
- `backend/src/types.ts`
  - backend domain types

Use the backend when the request affects:

- API behavior
- persistence
- auth/session behavior
- authorization and role checks
- provider/model visibility or sharing
- generation flow
- scoring
- settings/config behavior
- source ingestion

### Frontend

Main frontend areas:

- `frontend/src/App.tsx`
  - app routing
  - public vs auth vs protected app entry
- `frontend/src/auth.tsx`
  - auth bootstrap
  - login/register/logout calls
  - status and current user state
- `frontend/src/context.tsx`
  - shared quizzes/groups state
  - reload hooks
- `frontend/src/api.ts`
  - fetch wrapper for API calls
- `frontend/src/helpers.ts`
  - shared frontend utilities
  - default quiz settings
  - sidebar collapsed-state persistence
- `frontend/src/components/`
  - `ProtectedRoute.tsx`: route guarding by auth state and role
  - `Sidebar.tsx`: navigation and quiz/group switching
  - `RegenerateDialog.tsx`: regenerate flows and job polling UI
  - `ShareDialog.tsx`: share creation flow
  - `DifficultyControl.tsx`, `QuestionTypeSelect.tsx`: core form controls
  - `Layout.tsx`, `Icon.tsx`: layout and icon primitives
- `frontend/src/pages/`
  - `LoginPage.tsx`, `RegisterPage.tsx`: auth entry
  - `CreateQuizPage.tsx`: single quiz creation
  - `GroupQuizWizardPage.tsx`: group proposal + generation two-phase flow
  - `QuizPage.tsx`: quiz-taking flow, local draft persistence, submit/retake/shuffle
  - `ReviewPage.tsx`, `ResultsPage.tsx`: attempt review and aggregates
  - `SharesPage.tsx`, `GuestQuizPage.tsx`: guest/public sharing flows
  - `ProfilePage.tsx`: current user profile
  - `ModelsPage.tsx`: model selection/config surfaces
  - `AdminPage.tsx`: users/providers/models admin UI

Use the frontend when the request affects:

- user interaction
- routing and route protection
- auth screens
- dialogs and forms
- local browser state
- progress/status rendering
- admin management flows
- guest/public quiz behavior

## OIDC Integration

OIDC is optional and must match the backend behavior that exists today.

### Required Backend Configuration

The backend reads these environment variables:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`
- `OIDC_SCOPE`
- `PUBLIC_URL`

Current expectations in code:

- login entrypoint: `/api/auth/login/oidc`
- callback endpoint: `/api/auth/callback/oidc`
- `PUBLIC_URL` must match the externally reachable base URL
- auth cookies are marked `secure` when `PUBLIC_URL` starts with `https`
- the ID token / OIDC claims must provide:
  - `sub`
  - `email`
  - optionally `name` or `preferred_username`
  - `groups`

Role mapping is hardcoded to the following group names:

- `quiz_super_admin`
- `quiz_admin`
- `quiz_user`

If none of those groups is present, access is denied.

Important note:

- the first authenticated user is still promoted to `super_admin` by backend bootstrap logic, regardless of provider

### Authentik

For Authentik:

- create an OIDC provider/application for QuizGPT
- set the redirect URI to the project callback URL
- ensure the token exposes `email`, `sub`, and a `groups` claim
- add group mappings so users land in one of:
  - `quiz_super_admin`
  - `quiz_admin`
  - `quiz_user`

In practice, this usually means:

- assign users to Authentik groups with those exact names, or
- map Authentik groups into a `groups` claim with those exact values

### Keycloak

For Keycloak:

- create a confidential client for QuizGPT
- configure the redirect URI to `/api/auth/callback/oidc`
- ensure standard claims expose `sub` and `email`
- add a mapper so group membership is emitted into a `groups` claim
- make sure the values in that claim include one of:
  - `quiz_super_admin`
  - `quiz_admin`
  - `quiz_user`

Do not rely on frontend-only role assumptions.
The backend currently reads `groups` literally.

### Authelia

For Authelia:

- configure an OIDC client for QuizGPT
- use the same callback URL as above
- ensure the user identity exposes `sub` and `email`
- ensure group membership is included in the `groups` claim
- map users into one of the required QuizGPT groups:
  - `quiz_super_admin`
  - `quiz_admin`
  - `quiz_user`

If Authelia is configured with different internal group names, add a mapping layer so the final claim seen by QuizGPT still matches those exact values.

### What To Check Before Blaming The App

If OIDC login fails, verify these first:

- `PUBLIC_URL` is correct and externally reachable
- `OIDC_REDIRECT_URI` exactly matches the provider-side callback config
- the provider returns `sub` and `email`
- the provider returns a `groups` claim
- at least one allowed QuizGPT group is present
- TLS/HTTPS and reverse proxy setup are consistent with secure cookie behavior

## Tests

Existing tests live next to the code they validate:

- backend: `backend/src/*.test.ts`
- frontend: `frontend/src/**/*.test.ts(x)`
- frontend test setup: `frontend/src/test/setup.ts`

## Working Method

Before editing:

1. Identify the exact behavior being changed.
2. Find the narrowest file(s) responsible for that behavior.
3. Understand whether the change is backend, frontend, or both.
4. Check whether the behavior has auth, role, owner, or access-grant implications.
5. Avoid broad edits across unrelated modules.

When editing:

- Prefer the smallest coherent change that satisfies the request.
- Reuse existing helpers and patterns before introducing new ones.
- Keep business logic out of presentational UI when the project already separates it.
- Do not silently change unrelated behavior while touching a file.

When the request is ambiguous:

- Choose the most conservative interpretation.
- If a critical product decision is missing, ask instead of guessing.

## Testing Policy

This repository has a real test setup. Use it.

### Required after code changes

After any modification, fix, or feature work, run the relevant tests.

At minimum:

- backend-only change: run backend unit tests
- frontend-only change: run frontend unit tests
- cross-cutting change: run both

When the change is broad or risky, also run the full build.

Commands:

- `npm test`
- `npm run test --workspace backend`
- `npm run test --workspace frontend`
- `npm run build`

### Unit Tests Are Not Optional For Behavior Changes

If a change affects behavior, auth, validation, authorization, generation flow, state transitions, or user-visible outcomes, update or add tests for it.

Do not leave tests stale after changing behavior.
If an existing test no longer matches the real feature, fix the test or replace it with a better one.

### What Good Tests Look Like In This Repo

Tests must validate the real behavior of the current module, not a hand-copied approximation.

Prefer:

- testing the actual exported function, hook, component, or router behavior
- asserting outcomes, status codes, payloads, side effects, and navigation
- covering both success and failure/edge branches
- covering auth and authorization boundaries:
  - unauthenticated
  - wrong role
  - wrong owner
  - missing access grant
  - protected/system resource rules
- deterministic mocks around DB, fetch, auth, encryption, and navigation

Avoid:

- copying a `zod` schema into the test file and validating the copy instead of the real route behavior
- “render-only” tests that do not assert meaningful outcomes
- tests that prove implementation trivia but not business behavior
- skipping tests just because the UI change looks small when the behavior changed underneath

### Backend Test Guidance

When testing backend routes:

- prefer testing the real router/module behavior
- validate status codes, response payloads, and side effects
- include security cases for role/owner/access checks where applicable
- verify negative paths as carefully as happy paths

In this repository, route tests may use mocked `req`/`res` objects and call the router handler directly.
Do not assume you must open a real HTTP listener.

### Frontend Test Guidance

When testing frontend flows:

- assert what the user can do and see
- verify navigation, disabled states, validation messages, and async state transitions
- cover job-completion/error flows for generation-related screens
- cover route-protection behavior for auth and admin-only pages
- cover multi-step flows such as group proposal/review/generation end-to-end at component level when practical

### External Providers

Do not unit test external LLM/provider correctness.
Assume providers may return valid or invalid responses.
Test this codebase’s handling, validation, persistence, access control, and UI reactions.

## Build and Validation

Do not stop at code edits when validation is possible.

Use the existing commands:

- `npm test`
- `npm run build`
- `npm run dev`

If a change affects Docker-served behavior and the user is working against the local containerized app, rebuild/restart the container only when needed for that request.

## Change Boundaries

Do not automatically:

- add dependencies
- add migrations
- rewrite large components
- move files around
- create new architectural layers
- change API contracts broadly

unless the user explicitly asked for it or the change is strictly necessary to implement the requested behavior.

## Communication Expectations

When reporting work:

- state what changed
- mention the main files touched
- report what you actually validated
- mention if tests or build could not be run
- if tests were updated, say what behavior is now protected

Keep the explanation concise and technical.

## Golden Rule

If it was not requested, do not do it.

If it may be useful but is not required, propose it separately and wait for approval.
