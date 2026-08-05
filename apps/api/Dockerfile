# syntax=docker/dockerfile:1
#
# Builds @visora/api. Build context MUST be the repo root (pnpm workspace):
#   docker build -f apps/api/Dockerfile -t visora-api .
#
# The same image serves both processes described in the README's two-process
# split — override the command to run the worker instead of the HTTP server:
#   docker run visora-api                    # API server (dist/index.js)
#   docker run visora-api node dist/worker.js # BullMQ worker
#
# Uses glibc (bookworm-slim, not alpine): argon2 only ships prebuilt binaries
# for linux-x64 glibc, and alpine/musl would force a from-source rebuild.

FROM node:20-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ── Install full workspace deps (needed to compile TypeScript) ──────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

# ── Compile shared + api ─────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @visora/shared build && pnpm --filter @visora/api build

# ── Install production-only deps (api + its workspace deps) ─────────────────
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter @visora/api...

# ── Runtime ───────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app /app
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
# local-disk storage and the file log transport mkdir these under cwd at
# import time, regardless of env — pre-create + chown so the non-root user
# can write them (S3/log-shipping replace both in real production use).
RUN mkdir -p uploads logs && chown -R node:node uploads logs
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
