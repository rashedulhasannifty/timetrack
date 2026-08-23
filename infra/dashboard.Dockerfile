# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f infra/dashboard.Dockerfile .
#
# The build stage below is byte-identical in api/worker/dashboard.Dockerfile. deploy.yml
# builds all three in ONE job precisely so steps 2 and 3 hit the builder's LOCAL cache for
# it — if these three copies drift apart, that optimization silently stops working and the
# deploy build time roughly triples. Change one, change all three.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifests and lockfile BEFORE the source, so `pnpm install` is its own layer keyed on the
# lockfile rather than on every file in the repo. Previously `COPY . .` came first and
# install+build were one RUN, so a one-line source change re-resolved and re-downloaded the
# entire dependency tree — install is by far the slowest step here and it was never cached
# across commits.
#
# It also had a second, worse effect: the installed tree was freshly written on every build,
# so the runtime node_modules layer below never matched what the deploy host already had and
# each deploy re-downloaded the lot. That is what filled the disk.
#
# HUSKY=0: the root `prepare` script runs husky, and .husky/ is deliberately not in this
# layer. Git hooks are a developer concern and there is no repository here to install into.
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
RUN pnpm install --frozen-lockfile

COPY . .
# Build-time only: packages/db/prisma.config.ts resolves env('DATABASE_URL') when the Prisma
# CLI loads it. `prisma generate` never connects — the var only has to resolve. The repo-root
# .env is (correctly) excluded by .dockerignore, so without this the build fails with
# PrismaConfigEnvError. This stage is discarded; the real URL is injected at runtime via
# env_file and never leaks from here into the runtime image.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
# turbo builds packages before apps (^build); prisma generate runs in @timetrack/db build.
RUN pnpm build

# `output: standalone` (next.config.ts) already emits a self-contained server with only the
# modules the app actually reaches — 44MB against the ~490MB installed tree — so there is no
# `pnpm deploy` step here; the trace has done the pruning. .next/static is NOT part of the
# standalone output and must be carried over separately.
#
# Normalise mtimes so an unchanged build yields a byte-identical layer, and the deploy host
# recognises what it already has instead of re-downloading it. -h touches the symlink itself,
# never its target.
RUN find /repo/apps/dashboard/.next/standalone /repo/apps/dashboard/.next/static \
      -exec touch -h -t 197001010000.00 {} +

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
# Docker sets HOSTNAME to the container id, and the standalone server binds to whatever
# HOSTNAME says — it would try to bind a name that resolves to nothing and be unreachable
# from the proxy. Pin it. (`next start` never read this, so the old image did not need it.)
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
# Traced deps first and alone: this is the layer that stays put across a code-only deploy.
COPY --from=build /repo/apps/dashboard/.next/standalone/node_modules ./node_modules
COPY --from=build /repo/apps/dashboard/.next/standalone/apps ./apps
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
EXPOSE 3000
# API_URL is read server-side at runtime (never baked into the client bundle).
CMD ["node", "apps/dashboard/server.js"]
