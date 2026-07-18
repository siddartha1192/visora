# Visora — Architecture & System Design Blueprint

> AI-enabled platform for visual content posting and scheduling.
> Phase 1 scope: **image workflows only** (no video).

---

## 1. System Design Blueprint

### 1.1 Guiding Principles
- **Decoupled by layer:** HTTP (routes/controllers) → orchestration (LangGraph) → domain services (provider-agnostic) → integration adapters (OpenAI, Cloudinary, S3, Pexels). No layer reaches past its neighbor.
- **Provider abstraction:** Every third-party capability sits behind an interface (`ImageGenerator`, `MediaOptimizer`, `StockProvider`, `ObjectStore`, `Publisher`). Swapping DALL·E 3 for Stability, or Cloudinary for ImageKit, is a one-file adapter change — the graph never knows.
- **The graph is the brain, services are the hands:** LangGraph nodes contain *control flow and state transitions only*. They call injected services; they never `import openai` directly.
- **Everything async & resumable:** A scheduled post and an instant post hit the *same* graph; the only difference is *when* the worker dequeues it. State is persisted so a crashed run resumes from its last checkpoint.

### 1.2 High-Level Topology

```
                ┌──────────────────────────────────────────────┐
   React SPA ──▶│  API Gateway (Fastify)                        │
   External  ──▶│  • Auth (JWT) • RBAC • Rate-limit • Validation│
   API client   │  • Controllers (thin)                        │
                └───────────────┬──────────────────────────────┘
                                │ creates Job + Post(draft)
                                ▼
                ┌──────────────────────────────────────────────┐
                │  Job Queue (BullMQ / Redis)                   │
                │  • instant  → enqueue now                     │
                │  • scheduled→ delayed job @ runAt             │
                └───────────────┬──────────────────────────────┘
                                ▼
                ┌──────────────────────────────────────────────┐
                │  Worker Process (separate from API)           │
                │  ┌────────────────────────────────────────┐  │
                │  │  LangGraph Runtime                       │  │
                │  │  Router → Workflow Subgraph → Optimize   │  │
                │  │         → Publish → Persist              │  │
                │  │  Checkpointer: MongoDB                   │  │
                │  └────────────────────────────────────────┘  │
                └───┬───────────┬───────────┬───────────┬──────┘
                    ▼           ▼           ▼           ▼
                 OpenAI     Cloudinary   AWS S3    Pexels/Unsplash
                (DALL·E 3)  (resize)    (assets)   Scraper(Playwright)
                    │
                    ▼
                MongoDB  ◀── Users · Posts · AgentLogs · Jobs · Assets
```

### 1.3 Two-Process Split (critical for scalability)
- **API process** — stateless, horizontally scalable behind a load balancer. Validates, authenticates, writes the `Post` draft + enqueues a `Job`. Returns `202 Accepted` immediately. **Never** runs the graph inline.
- **Worker process(es)** — pull from the queue, run the LangGraph execution, own all provider calls. Scale independently based on queue depth.

This split is what makes "Hybrid Delivery" clean: the UI and the external REST API both just create Jobs. One pipeline, two entrypoints.

### 1.4 Cross-Cutting Concerns
| Concern | Approach |
|---|---|
| **Auth** | JWT access + refresh; API keys (hashed) for programmatic clients, scoped per workspace |
| **Idempotency** | `Idempotency-Key` header on POST → dedupe job creation |
| **Secrets** | env-injected, never in DB; `zod`-validated config module at boot |
| **Observability** | Structured logs (pino), every node writes an `AgentLog` step; OpenTelemetry traces spanning route→queue→graph |
| **Resilience** | Per-provider retry w/ backoff, circuit breaker, BullMQ DLQ for poisoned jobs |
| **Cost control** | Token/credit accounting per workspace written to `AgentLog`; pre-flight budget check node |

---

## 2. MongoDB Data Models

Multi-tenant via a `Workspace` boundary.

### 2.1 `users`
```
User {
  _id
  email            (unique, lowercased)
  passwordHash     (argon2)
  name
  avatarUrl?
  workspaces: [{ workspaceId, role: 'owner'|'admin'|'editor'|'viewer' }]
  defaultWorkspaceId
  status: 'active'|'invited'|'suspended'
  lastLoginAt
  createdAt, updatedAt
}
```

### 2.2 `workspaces`
```
Workspace {
  _id
  name
  ownerId → User
  apiKeys: [{ keyId, hashedKey, label, scopes[], lastUsedAt, revoked }]
  socialAccounts: [{
    platform: 'instagram'|'facebook'|'x'|'linkedin',
    handle, externalAccountId,
    accessTokenRef,        // pointer to secret store, NOT the token
    tokenExpiresAt, status
  }]
  plan, creditBalance
  createdAt, updatedAt
}
```

### 2.3 `assets`
```
Asset {
  _id
  workspaceId
  kind: 'upload'|'ai_generated'|'stock'|'scraped'|'enhanced'
  origin: {
    source: 'user'|'dalle3'|'pexels'|'unsplash'|'scrape',
    sourceUrl?, prompt?, providerMeta?
  }
  s3: { bucket, key, region }
  mime, width, height, bytes, checksum
  variants: [{ platform, aspectRatio, cloudinaryUrl, s3Key, width, height }]
  createdByJobId?
  createdAt
}
```

### 2.4 `posts`
```
Post {
  _id
  workspaceId
  authorId → User
  workflow: 'passthrough'|'ai_generate'|'ai_enhance'|'stock_discovery'|'scrape'
  status: 'draft'|'queued'|'processing'|'ready'|'scheduled'
          |'publishing'|'published'|'failed'|'cancelled'
  input: { prompt?, instructions?, sourceUrl?, uploadedAssetId?, context? }
  caption: { text, hashtags[], generated: bool }
  targets: [{
    platform, accountId,
    assetVariantId?,
    status: 'pending'|'published'|'failed',
    externalPostId?, permalink?, error?
  }]
  primaryAssetId? → Asset
  schedule: { mode: 'instant'|'scheduled', runAt?, timezone, publishedAt? }
  jobId? → Job
  metrics?: { likes, comments, fetchedAt }
  createdAt, updatedAt
}
```

### 2.5 `jobs`
```
Job {
  _id
  workspaceId, postId
  type: 'process_post'
  state: 'pending'|'active'|'completed'|'failed'|'delayed'
  bullJobId
  runAt, attempts, maxAttempts
  checkpointId?
  lastError?
  createdAt, updatedAt
}
```

### 2.6 `agentlogs`
```
AgentLog {
  _id
  workspaceId, postId, jobId
  threadId
  node: 'router'|'generation'|'enhancement'|'stock'|'scraping'
        |'optimization'|'caption'|'publish'|'persist'
  sequence
  status: 'started'|'succeeded'|'failed'|'skipped'
  input:  (redacted/truncated snapshot)
  output: (redacted/truncated snapshot)
  provider?: { name, model, requestId }
  usage?: { promptTokens, completionTokens, imagesGenerated, costUsd }
  durationMs
  error?: { message, code, stack? }
  createdAt
}
```

**Key indexes:** `posts {workspaceId, status, 'schedule.runAt'}`, `agentlogs {threadId, sequence}`, `agentlogs {postId, createdAt}`, `assets {workspaceId, kind}`, `users {email}` unique, `jobs {state, runAt}`.

---

## 3. LangGraph State Topology

### 3.1 Shared State
```ts
GraphState {
  workspaceId, postId, jobId, threadId
  workflow: WorkflowType
  input: { prompt?, instructions?, sourceUrl?, uploadedAssetId?, context? }
  targets: PlatformTarget[]
  rawAsset?:        { s3Key, mime, width, height }
  candidateAssets?: Asset[]
  processedAsset?:  { s3Key }
  variants?:        PlatformVariant[]
  caption?:         { text, hashtags[] }
  errors: NodeError[]
  usage:  UsageAccumulator
  status: GraphStatus
}
```

State is a set of **reducer-merged channels** — each node returns a partial patch; LangGraph merges. Errors and usage use *append* reducers.

### 3.2 Graph Shape — Router + Pluggable Subgraphs

```
            ┌─────────┐
   START ──▶│ ingest  │  (load Post, validate, budget pre-check)
            └────┬────┘
                 ▼
            ┌─────────┐   conditional edge on state.workflow
            │ ROUTER  │──────────────┬──────────────┬─────────────┬──────────────┐
            └─────────┘   passthrough│  ai_generate │  ai_enhance │ stock        │ scrape
                 ▼                   ▼              ▼             ▼              ▼
          ┌────────────┐     ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
          │ Passthrough│     │ Generation │ │ Enhancement│ │   Stock    │ │  Scraping  │
          └─────┬──────┘     └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
                └──────────────────┴───────┬──────┴─────────────┴──────────────┘
                                           ▼   (rawAsset/processedAsset exists)
                                   ┌────────────────┐
                                   │  OPTIMIZATION  │  Cloudinary per-target resize → variants
                                   └───────┬────────┘
                                           ▼
                                   ┌────────────────┐
                                   │    CAPTION     │  optional LLM caption/hashtags
                                   └───────┬────────┘
                                           ▼
                                   ┌────────────────┐
                                   │  schedule gate │  instant → publish / scheduled → END(ready)
                                   └───────┬────────┘
                                  instant  ▼
                                   ┌────────────────┐
                                   │    PUBLISH     │  fan-out per target (parallel)
                                   └───────┬────────┘
                                           ▼
                                   ┌────────────────┐
                                   │    PERSIST     │  finalize Post + variants
                                   └───────┬────────┘
                                           ▼  END
```

### 3.3 Per-Workflow Flow
1. **Direct Pass-Through:** `ingest → router → passthrough → optimization → caption? → publish/schedule → persist`
2. **Pure AI Generation:** `… router → generation[ promptRefine → dalle.generate → s3.store ] → optimization → …`
3. **AI Enhancement:** `… router → enhancement[ loadSource → vision.analyze → dalle.edit/inpaint → s3.store ] → optimization → …`
4. **Stock Discovery:** `… router → stock[ keywordExtract(LLM) → pexels/unsplash.search → rank/select → download → s3.store ] → optimization → …`
5. **Web Scraper:** `… router → scraping[ fetch(Playwright) → extractImages → filterByContext(LLM) → pick → download → s3.store ] → optimization → …`

All five **converge** on Optimization → Caption → Publish → Persist. New workflows = new subgraph + one router edge.

### 3.4 Durability & Control
- **Checkpointer:** MongoDB-backed `BaseCheckpointSaver`, `threadId = jobId`.
- **Human-in-the-loop ready:** `interrupt()` before Publish.
- **Retries:** node-level try/catch → `AgentLog{failed}` → throw → BullMQ retry resumes at checkpoint.
- **Fan-out publish:** `Send` API for parallel per-platform publishing; partial failures per `target`.

---

## 4. Folder Structure

### 4.1 Monorepo (pnpm workspaces)
```
visora/
├── pnpm-workspace.yaml
├── packages/shared/          # shared TS types + zod schemas + constants
├── apps/api/                 # backend
├── apps/web/                 # frontend
└── infra/docker-compose.yml  # mongo, redis, localstack(s3)
```

### 4.2 Backend — `apps/api/`
```
apps/api/src/
├── index.ts                 # API process bootstrap
├── worker.ts                # Worker process bootstrap (separate entry)
├── config/                  # env + zod validation, DI container
├── http/
│   ├── server.ts
│   ├── middleware/          # auth, rbac, rateLimit, idempotency, errorHandler
│   ├── routes/              # auth, posts, assets, workflows, webhooks
│   └── controllers/         # thin
├── modules/                 # domain services (provider-agnostic)
│   ├── posts/  assets/  scheduling/  workspaces/
├── orchestration/           # LangGraph
│   ├── graph.ts  state.ts  router.ts  registry.ts
│   ├── checkpointer/
│   ├── subgraphs/           # generation, enhancement, stock, scraping, passthrough
│   └── nodes/               # optimization, caption, publish, persist
├── integrations/            # adapters behind interfaces
│   ├── interfaces/          # ports
│   ├── llm/ media/ storage/ stock/ scraping/ publishers/
├── queue/                   # bullmq setup, processors, DLQ
├── db/models/               # mongoose models
├── lib/                     # logger, errors, retry, result
└── observability/
```

**Decoupling rule:** `http/` → `modules/`; `modules/` & `nodes/` → `integrations/interfaces/` (ports) only. Concrete adapters wired solely in `config/` DI container.

### 4.3 Frontend — `apps/web/` (Next.js App Router + shadcn/ui)
```
apps/web/src/
├── app/
│   ├── (auth)/login, register
│   ├── (dashboard)/compose, calendar, library, posts, settings
│   └── api/                 # BFF route handlers
├── components/ui/           # shadcn primitives
├── components/compose/      # WorkflowPicker, PromptInput, ImageDropzone, StockGrid, ...
├── features/                # per-domain hooks + api clients
├── lib/  stores/  styles/
```

---

## Key Stack Decisions
| Decision | Choice | Rationale |
|---|---|---|
| Queue | BullMQ + Redis | Native delayed jobs = scheduling engine; robust retries/DLQ |
| Frontend | Next.js App Router | SSR/BFF for secure sessions + enterprise perf |
| Repo | pnpm monorepo + `shared` | FE/BE share zod types, no drift |
| Tenancy | Workspace from day 1 | Enterprise = teams |
| Scraping | Playwright | Rendered-DOM image extraction |

---

## Build Sequence (Phase 1)
1. Monorepo scaffold (pnpm, tsconfig base, shared package)
2. `shared`: types, enums, zod schemas, platform specs
3. Backend foundation: config, db connection, mongoose models, logger, errors
4. Integration ports + adapters (stubbed where keys absent)
5. Orchestration: state, nodes, subgraphs, router, graph, checkpointer
6. Queue + worker process
7. HTTP layer: auth, middleware, controllers, routes
8. Frontend: Next.js + shadcn, compose studio, calendar, posts, library, settings
9. infra docker-compose + env examples + READMEs
