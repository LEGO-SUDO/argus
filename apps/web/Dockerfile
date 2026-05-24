# syntax=docker/dockerfile:1.7
# ============================================================================
# Web Dockerfile — Next.js 15 standalone build.
#
# Stage 1 (deps):     resolve the workspace slice needed for `web` only.
# Stage 2 (builder):  install deps + build packages + next build (standalone).
# Stage 3 (runner):   minimal runtime; copies .next/standalone + .next/static + public.
# ============================================================================

ARG NODE_VERSION=20-alpine

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

RUN pnpm install --frozen-lockfile --filter @argus/web... --filter @argus/contracts

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/contracts packages/contracts

# Build the contracts package first (the web app's transpilePackages still
# needs the dist for type resolution at build time).
RUN pnpm --filter @argus/contracts build
# Next standalone build.
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.mjs `rewrites()` is evaluated at BUILD time for standalone
# output and the resolved URLs get baked into .next/routes-manifest.json
# — so we MUST set INTERNAL_API_URL here in the builder env, not just at
# runtime in compose. Default to the compose service name; can be
# overridden via --build-arg for other deployment targets.
ARG INTERNAL_API_URL=http://api:4000
ENV INTERNAL_API_URL=${INTERNAL_API_URL}
RUN pnpm --filter @argus/web build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat tini wget
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Next standalone layout: .next/standalone is a self-contained Node app that
# expects .next/static alongside it. public/ is optional (we don't ship static
# assets in Phase A — brand mark + fonts are runtime); omit the copy rather
# than fail the build.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
