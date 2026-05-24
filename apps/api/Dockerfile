# syntax=docker/dockerfile:1.7
# ============================================================================
# API Dockerfile — multi-stage pnpm build.
#
# Stage 1 (deps):     resolve the workspace slice needed for `api` only.
# Stage 2 (builder):  install workspace deps + run nest build + prisma generate.
# Stage 3 (runner):   slim runtime; copies only dist + node_modules + prisma client.
# ============================================================================

ARG NODE_VERSION=20-alpine

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db/prisma packages/db/prisma

RUN pnpm install --frozen-lockfile --filter @argus/api... --filter @argus/db

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/sdk packages/sdk

# Generate Prisma client, build workspace packages, then build the api.
RUN pnpm --filter @argus/db exec prisma generate
RUN pnpm --filter @argus/contracts build
RUN pnpm --filter @argus/sdk build
RUN pnpm --filter @argus/db build
RUN pnpm --filter @argus/api build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl tini wget
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/sdk ./packages/sdk
# Workspace symlink farms — pnpm puts per-workspace symlinks pointing at the
# central virtual store. Without these, `reflect-metadata` and other deps
# declared on a workspace package can't resolve from the runtime.
COPY --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/sdk/node_modules ./packages/sdk/node_modules

EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
# Run Prisma migrations against the freshly-booted Postgres BEFORE starting
# the Nest app. `--schema` points at the schema in the db package; the
# `migrate deploy` command is idempotent so repeated boots are safe.
CMD ["sh", "-c", "packages/db/node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/apps/api/src/main.js"]
