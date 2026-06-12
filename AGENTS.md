# QuizGPT Agent Guide

## Purpose

This file defines how agents should work inside this repository.

The goal is to make precise, minimal, project-aware changes to QuizGPT without introducing unrelated behavior, speculative refactors, or noisy edits.

## Project Scope

QuizGPT is a full-stack TypeScript application with:

- `backend/`: Express API, business logic, PostgreSQL access, generation orchestration
- `frontend/`: React + Vite admin UI and guest-facing quiz flows

Agents must treat this repository as self-contained. Do not infer rules from external projects, shared prompts, or other codebases unless the user explicitly asks for that.

## Core Rules

- Implement only what the user asked for.
- Do not add extra features, refactors, abstractions, or cleanup unless explicitly requested.
- Keep edits local and reversible.
- Preserve the existing architecture and naming style unless the user asks for a redesign.
- Prefer modifying existing files over creating new ones, unless a new file is clearly required.
- If a requested change would require a migration, new dependency, major structural change, or external service change, call that out explicitly before doing it.

## How To Navigate This Project

### Backend

Main backend areas:

- `backend/src/index.ts`
  - Express app entrypoint
  - routes and request validation
  - async job endpoints and orchestration
  - static frontend serving
- `backend/src/llm.ts`
  - quiz generation/regeneration logic
  - structured output handling
  - output sanitization and answer shuffling
- `backend/src/context.ts`
  - source ingestion and retrieval context building
  - document parsing, GitHub source handling, chunking
- `backend/src/scoring.ts`
  - attempt normalization and scoring logic
- `backend/src/settings.ts`
  - runtime settings loading/saving
  - secret masking and encryption handling
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
- generation flow
- scoring
- settings/config behavior
- source ingestion

### Frontend

Main frontend areas:

- `frontend/src/App.tsx`
  - app routing
- `frontend/src/context.tsx`
  - shared quizzes/groups state and reload hooks
- `frontend/src/api.ts`
  - fetch wrapper for API calls
- `frontend/src/helpers.ts`
  - shared frontend utilities
- `frontend/src/components/`
  - `Sidebar.tsx`: navigation and quiz/group switching
  - `RegenerateDialog.tsx`: regenerate flows, job polling UI, progress dialog
  - `ShareDialog.tsx`: share creation flow
  - `Layout.tsx`, `Icon.tsx`: layout and icon primitives
- `frontend/src/pages/`
  - `CreateQuizPage.tsx`: single quiz creation
  - `GroupQuizWizardPage.tsx`: group proposal/generation flow
  - `QuizPage.tsx`: quiz-taking flow, local draft persistence, submit/retake/shuffle
  - `SettingsPage.tsx`: runtime settings UI
  - `SharesPage.tsx`, `GuestQuizPage.tsx`, `ResultsPage.tsx`, `ReviewPage.tsx`

Use the frontend when the request affects:

- user interaction
- navigation
- dialogs and forms
- local browser state
- progress/status rendering
- settings screens

### Tests

Existing unit tests live next to the code they validate:

- backend: `backend/src/*.test.ts`
- frontend: `frontend/src/**/*.test.ts(x)`
- frontend test setup: `frontend/src/test/setup.ts`

## Working Method

Before editing:

1. Identify the exact behavior being changed.
2. Find the narrowest file(s) responsible for that behavior.
3. Understand whether the change is backend, frontend, or both.
4. Avoid broad edits across unrelated modules.

When editing:

- Prefer the smallest coherent change that satisfies the request.
- Reuse existing helpers and patterns before introducing new ones.
- Keep business logic out of presentational UI when the project already separates it.
- Do not silently change unrelated behavior while touching a file.

When the request is ambiguous:

- Choose the most conservative interpretation.
- If a critical product decision is missing, ask instead of guessing.

## Testing Policy

This repository has a real unit test setup. Use it.

### Required after code changes

After any modification, fix, or feature work, run the relevant unit tests.

At minimum:

- backend-only change: run backend unit tests
- frontend-only change: run frontend unit tests
- cross-cutting change: run both

When the change is broad or risky, also run the full project test command.

Commands:

- `npm test`
- `npm run test --workspace backend`
- `npm run test --workspace frontend`
- `npm run build`

### When to add or update unit tests

If the requested change modifies behavior, fix logic, or adds a feature, update or add unit tests for that behavior.

Do not add tests for purely mechanical edits that do not change behavior, such as:

- text copy tweaks with no logic change
- purely visual class changes with no behavioral impact
- comment-only edits

### Test quality standard

Tests must be meaningful:

- assert real outcomes, not implementation trivia
- cover success paths and important failure/edge paths where relevant
- avoid fake assertions that only exercise rendering without validating behavior
- prefer deterministic tests over overly mocked ones

Do not unit test external LLM/provider correctness. Assume external providers may return valid outputs; test this codebase’s handling, validation, persistence, UI state transitions, and error handling.

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

Keep the explanation concise and technical.

## Golden Rule

If it was not requested, do not do it.

If it may be useful but is not required, propose it separately and wait for approval.
