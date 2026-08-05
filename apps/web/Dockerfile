# syntax=docker/dockerfile:1
#
# Builds @visora/web. Build context MUST be the repo root (pnpm workspace):
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/v1 \
#     -t visora-web .
#
# NEXT_PUBLIC_* vars are inlined into the client bundle at BUILD time, not
# read at container startup — rebuild the image if the API's public URL
# changes between environments.

FROM node:20-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ── Install full workspace deps (needed to compile) ──────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────
FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @visora/shared build && pnpm --filter @visora/web build

# ── Runtime — Next.js standalone output (self-contained, pruned deps) ───────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# No apps/web/public directory exists yet — add a COPY line here if one is
# introduced later (Next won't copy it into standalone output automatically).

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
