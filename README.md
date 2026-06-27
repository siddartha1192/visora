# Visora

**AI-enabled platform for visual content posting and scheduling.**

Visora orchestrates, generates, enhances, discovers, and schedules multi-platform
social-media image posts through an **agentic LangGraph pipeline**. Phase 1 ships
five image workflows behind both a polished web studio and a secured REST API.

> 📐 Full design rationale lives in [plans/architecture-blueprint.md](plans/architecture-blueprint.md).

---

## The five workflows

| # | Workflow | Input | Agent path |
|---|----------|-------|------------|
| 1 | **Direct Pass-Through** | uploaded photo | passthrough → optimize → publish |
| 2 | **Pure AI Generation** | text prompt | refine → DALL·E 3 → optimize → publish |
| 3 | **AI Enhancement** | image + instructions | edit/inpaint → optimize → publish |
| 4 | **Stock Discovery** | prompt | keyword-extract → Pexels/Unsplash → select → optimize → publish |
| 5 | **Web Scraper** | URL + context | render(Playwright) → extract → LLM-pick → optimize → publish |

All five **converge** on a shared `optimize → caption → (schedule gate) → publish → persist`
tail. Adding a sixth workflow = one subgraph node + one registry entry.

---

## Architecture at a glance

```
Web (Next.js)  ─┐
                ├─▶  API (Fastify, stateless)  ──enqueue──▶  Queue (BullMQ/Redis)
External client ─┘         │                                        │
                          creates Post draft + Job                  ▼
                                                         Worker (LangGraph runtime)
                                                         Router → Subgraph → Optimize
                                                                → Publish → Persist
                                                                │
                            OpenAI · Cloudinary · S3 · Pexels/Unsplash · Playwright
                                                                │
                                          MongoDB — Users · Posts · Assets · Jobs · AgentLogs
```

- **Two-process split:** the API never runs the graph — it validates + enqueues and
  returns `202`. The worker owns all LLM/media work. Scale them independently.
- **Hexagonal integrations:** nodes depend on *ports* (`ImageGenerator`,
  `MediaOptimizer`, `ObjectStore`, `StockProvider`, `WebScraper`, `Publisher`).
  Concrete adapters are wired only in [`config/container.ts`](apps/api/src/config/container.ts).
- **Graceful stubs:** every capability degrades to a deterministic stub when its
  credentials are absent — so the full pipeline runs locally with **zero paid keys**.
- **Observability spine:** every node writes an `AgentLog` (status, timing, provider
  usage); replay by `threadId` to see exactly what each agent did.

---

## Monorepo layout

```
visora/
├── packages/shared/   @visora/shared — types, zod schemas, enums, platform specs
├── apps/api/          Fastify API + BullMQ worker + LangGraph orchestration
├── apps/web/          Next.js (App Router) studio with Tailwind + shadcn-style UI
├── infra/             docker-compose: mongo, redis, localstack(s3)
└── plans/             architecture blueprint
```

---

## Getting started

### Prerequisites
- Node ≥ 20, **pnpm** ≥ 9
- Docker (for Mongo + Redis), or your own Mongo/Redis instances

### 1. Install
```bash
pnpm install
```

### 2. Start infra
```bash
pnpm infra:up        # mongo + redis + localstack
```

### 3. Configure env
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# All provider keys are optional — leave blank to use stubs.
```

### 4. Run (three terminals, or `pnpm dev` for all)
```bash
pnpm dev:api         # API on :4000
pnpm dev:worker      # background worker
pnpm dev:web         # studio on :3000
```

Open http://localhost:3000 → **Compose** to run any workflow end-to-end.

---

## REST API (programmatic / hybrid delivery)

Authenticate with a JWT (`Authorization: Bearer …`) or a workspace API key
(`x-api-key: vsk_<keyId>.<secret>`). Same handlers, same pipeline.

```bash
# Register (returns tokens)
curl -X POST localhost:4000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@co.com","password":"supersecret","name":"You"}'

# Fire workflow #2 (AI generation), publish instantly
curl -X POST localhost:4000/v1/posts \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "workflow":"ai_generate",
    "prompt":"cinematic matte-black espresso machine on marble",
    "targets":[{"platform":"instagram","accountId":"000000000000000000000000"}],
    "schedule":{"mode":"instant","timezone":"UTC"}
  }'
```

Poll `GET /v1/posts/:id` to watch the status move `queued → processing → published`.

---

## Enabling real providers

Set the relevant keys in `apps/api/.env` and restart the worker — the container
swaps stubs for real adapters automatically:

| Capability | Env | Adapter |
|---|---|---|
| Image gen/edit | `OPENAI_API_KEY` | DALL·E 3 |
| Optimize/resize | `CLOUDINARY_URL` | Cloudinary |
| Object storage | `AWS_ACCESS_KEY_ID` / `…SECRET` | S3 (or localstack) |
| Stock | `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | Pexels / Unsplash |
| Scraping | `ENABLE_PLAYWRIGHT=true` (run `npx playwright install`) | Playwright |
| Publishing | per-platform OAuth (stubbed in Phase 1) | Instagram/Facebook/X/LinkedIn |

---

## Phase-1 scope notes
- **Images only** — video is intentionally excluded.
- Social **publishers are stubbed** (simulate success) pending OAuth wiring; the
  `Publisher` port + Publish node are production-shaped already.
- Asset-library listing + API-key minting UIs are placeholders over a complete
  backend data model.
