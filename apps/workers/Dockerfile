# syntax=docker/dockerfile:1.7
# ============================================================================
# Workers Dockerfile — multi-stage pnpm build.
#
# Stage 1 (deps):     resolve the workspace slice needed for `workers` only.
# Stage 2 (builder):  install workspace deps + run nest build + prisma generate.
# Stage 3 (runner):   slim runtime; copies only dist + node_modules + prisma client.
# ============================================================================

ARG NODE_VERSION=20-alpine

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
# Enable pnpm via corepack so the lockfile is honored.
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# Copy only the files needed for `pnpm install` to maximize cache hits.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/workers/package.json apps/workers/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db/prisma packages/db/prisma

RUN pnpm install --frozen-lockfile --filter @argus/workers... --filter @argus/db

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/workers apps/workers
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/sdk packages/sdk

# Generate Prisma client, build workspace packages, then build workers.
# Packages must be built first because per-app tsconfigs override paths to
# {} — tsc resolves @argus/* via node_modules → package.json main → dist/.
RUN pnpm --filter @argus/db exec prisma generate
RUN pnpm --filter @argus/contracts build
RUN pnpm --filter @argus/sdk build
RUN pnpm --filter @argus/db build
RUN pnpm --filter @argus/workers build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl tini
ENV NODE_ENV=production
ENV PORT=3002

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/workers/node_modules ./apps/workers/node_modules
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist
COPY --from=builder /app/apps/workers/package.json ./apps/workers/package.json
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/sdk ./packages/sdk
# Workspace symlink farm: pnpm puts per-workspace symlinks in the package's
# own node_modules pointing at the central node_modules — copy those too.
COPY --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/sdk/node_modules ./packages/sdk/node_modules

EXPOSE 3002
# tini for proper PID-1 signal forwarding so SIGTERM reaches Node.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/workers/dist/main.js"]
