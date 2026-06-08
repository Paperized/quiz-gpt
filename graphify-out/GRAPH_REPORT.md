# Graph Report - .  (2026-06-01)

## Corpus Check
- Corpus is ~18,119 words - fits in a single context window. You may not need a graph.

## Summary
- 246 nodes · 316 edges · 27 communities (18 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.85)
- Token cost: 12,600 input · 2,900 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend Core (AST)|Backend Core (AST)]]
- [[_COMMUNITY_Backend Core Services|Backend Core Services]]
- [[_COMMUNITY_Context Builder (AST)|Context Builder (AST)]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_Backend Dev Dependencies|Backend Dev Dependencies]]
- [[_COMMUNITY_Root Package & Scripts|Root Package & Scripts]]
- [[_COMMUNITY_AI SDK Dependencies|AI SDK Dependencies]]
- [[_COMMUNITY_Frontend TypeScript Config|Frontend TypeScript Config]]
- [[_COMMUNITY_React App Component (AST)|React App Component (AST)]]
- [[_COMMUNITY_Embeddings Module (AST)|Embeddings Module (AST)]]
- [[_COMMUNITY_Frontend Domain Types|Frontend Domain Types]]
- [[_COMMUNITY_Backend TypeScript Config|Backend TypeScript Config]]
- [[_COMMUNITY_Frontend API Client|Frontend API Client]]
- [[_COMMUNITY_Docker Deployment Stack|Docker Deployment Stack]]
- [[_COMMUNITY_OpenCode Config|OpenCode Config]]
- [[_COMMUNITY_OpenCode Plugin Deps|OpenCode Plugin Deps]]
- [[_COMMUNITY_Package Manifests|Package Manifests]]
- [[_COMMUNITY_Vite Env Types|Vite Env Types]]
- [[_COMMUNITY_OpenCode Settings|OpenCode Settings]]
- [[_COMMUNITY_Graphify Plugin Node|Graphify Plugin Node]]
- [[_COMMUNITY_Frontend Package|Frontend Package]]
- [[_COMMUNITY_Project README|Project README]]
- [[_COMMUNITY_Frontend TS Config Node|Frontend TS Config Node]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 11 edges
2. `buildSourceContext()` - 10 edges
3. `generateQuizFromLLM` - 10 edges
4. `compilerOptions` - 9 edges
5. `scripts` - 9 edges
6. `Config (Zod-validated env)` - 9 edges
7. `requestEmbeddings()` - 8 edges
8. `Express App (HTTP Server)` - 8 edges
9. `req() HTTP Helper` - 8 edges
10. `config` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Vite Configuration` --uses--> `Backend Served index.html (built)`  [EXTRACTED]
  frontend/vite.config.ts → backend/public/index.html
- `Backend Served index.html (built)` --uses--> `Runtime Config Script (config.js)`  [EXTRACTED]
  backend/public/index.html → frontend/public/config.js
- `GitHub Actions Docker Publish Workflow` --uses--> `App Service (Docker)`  [INFERRED]
  .github/workflows/docker-publish.yml → docker-compose.yml
- `DB Migration 001 Init` --semantically_similar_to--> `Quiz Interface`  [INFERRED] [semantically similar]
  backend/migrations/001_init.sql → backend/src/types.ts
- `DB Migration 001 Init` --semantically_similar_to--> `Attempt Interface`  [INFERRED] [semantically similar]
  backend/migrations/001_init.sql → backend/src/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Quiz Generation Pipeline** — index_expressApp, llm_generateQuizFromLLM, context_buildSourceContext, embeddings_embedTexts [INFERRED 0.90]
- **Global Config Consumers** — config_config, logger_logger, embeddings_requestEmbeddings, llm_generateQuizFromLLM [EXTRACTED 1.00]
- **RAG Retrieval Chain** — context_buildRetrievedContext, embeddings_embedTexts, embeddings_rankByEmbeddingSimilarity [EXTRACTED 1.00]
- **Frontend Build to Backend Static Pipeline** — vite_config, backend_public_index_html, service_app [INFERRED 0.85]
- **Runtime Config Injection Chain** — config_js, vite_env_dts, app_window_config [EXTRACTED 1.00]
- **Quiz Domain Data Model** — app_quiz_type, app_quizsettings, app_quizquestion [EXTRACTED 1.00]

## Communities (27 total, 9 thin omitted)

### Community 0 - "Backend Core (AST)"
Cohesion: 0.07
Nodes (33): config, configSchema, SourceInputs, __dirname, pool, runMigrations(), apiLimiter, app (+25 more)

### Community 1 - "Backend Core Services"
Cohesion: 0.16
Nodes (24): Config (Zod-validated env), SourceInputs Type, buildRetrievedContext, buildSourceContext, extractTextFromBuffer, fetchGitHubRepoDocuments, PostgreSQL Pool, runMigrations (+16 more)

### Community 2 - "Context Builder (AST)"
Cohesion: 0.19
Nodes (19): buildRetrievedContext(), buildSourceContext(), excludedPathParts, extractTextFromBuffer(), fetchGitHubRepoDocuments(), fileExtension(), isAllowedRepoPath(), isProbablyText() (+11 more)

### Community 3 - "Frontend Dependencies"
Cohesion: 0.12
Nodes (16): dependencies, react, react-dom, devDependencies, @types/react, @types/react-dom, typescript, vite (+8 more)

### Community 4 - "Backend Dev Dependencies"
Cohesion: 0.12
Nodes (15): devDependencies, tsx, @types/express, @types/multer, @types/node, @types/pg, typescript, name (+7 more)

### Community 5 - "Root Package & Scripts"
Cohesion: 0.12
Nodes (15): devDependencies, npm-run-all, name, private, scripts, build, dev, dev:backend (+7 more)

### Community 6 - "AI SDK Dependencies"
Cohesion: 0.15
Nodes (13): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/openai-compatible, @cedrugs/pdf-parse, express, express-rate-limit (+5 more)

### Community 7 - "Frontend TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, resolveJsonModule (+4 more)

### Community 8 - "React App Component (AST)"
Cohesion: 0.17
Nodes (8): App(), AttemptHistory, defaultSettings, Metrics, Quiz, QuizQuestion, QuizSettings, runtimePublicUrl

### Community 9 - "Embeddings Module (AST)"
Cohesion: 0.26
Nodes (11): buildEndpoint(), buildHeaders(), EmbeddingResponse, embedTexts(), normalizeBaseUrl(), requestEmbeddings(), resolveEmbeddingApiKey(), resolveEmbeddingBaseUrl() (+3 more)

### Community 10 - "Frontend Domain Types"
Cohesion: 0.19
Nodes (13): AttemptHistory Type, Metrics Type, Quiz Type (frontend), QuizQuestion Type (frontend), QuizSettings Type (frontend), App Component (React), window.__APP_CONFIG__ Runtime Config, Backend Served index.html (built) (+5 more)

### Community 11 - "Backend TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+2 more)

### Community 12 - "Frontend API Client"
Cohesion: 0.25
Nodes (7): POST /api/attempts, POST /api/quizzes/generate, GET /api/results/history, GET /api/results/metrics, generateQuiz(), loadQuizzes(), req() HTTP Helper

### Community 13 - "Docker Deployment Stack"
Cohesion: 0.60
Nodes (5): Docker Compose (Dev/Local Build), Docker Compose (Production), GitHub Actions Docker Publish Workflow, App Service (Docker), PostgreSQL Service (Docker)

## Knowledge Gaps
- **128 isolated node(s):** `$schema`, `plugin`, `@opencode-ai/plugin`, `name`, `version` (+123 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `AI SDK Dependencies` to `Backend Dev Dependencies`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `config` connect `Backend Core (AST)` to `Embeddings Module (AST)`, `Context Builder (AST)`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `$schema`, `plugin`, `@opencode-ai/plugin` to the rest of the system?**
  _128 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend Core (AST)` be split into smaller, more focused modules?**
  _Cohesion score 0.07198228128460686 - nodes in this community are weakly interconnected._
- **Should `Frontend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Backend Dev Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Root Package & Scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._