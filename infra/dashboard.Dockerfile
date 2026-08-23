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

#
# Normalise mtimes across the pruned tree. `pnpm deploy` rewrites it on every build, so the
# files carried fresh timestamps and the 448MB node_modules layer got a new digest each time
# even when not one byte of dependency content had changed — which is exactly why every deploy
# re-downloaded the whole image. With the timestamps pinned, an unchanged lockfile yields a
# byte-identical layer, the registry and the host both recognise it, and a code-only deploy
# transfers just the few MB of `dist`.
# Two files are otherwise regenerated per build and would alone defeat this: turbo's
# build log (pure noise in a runtime image) and pnpm's `prunedAt:` stamp in .modules.yaml.
# -h touches the symlink itself, never its target: pnpm's tree is mostly symlinks into .pnpm,
# and some point outside the copied subtree.
RUN pnpm --filter @timetrack/dashboard deploy --prod --legacy /prod/app \
    && find /prod/app -name '.turbo' -type d -prune -exec rm -rf {} + \
    && sed -i 's/^prunedAt: .*/prunedAt: Thu, 01 Jan 1970 00:00:00 GMT/' /prod/app/node_modules/.modules.yaml \
    && find /prod/app -exec touch -h -t 197001010000.00 {} +

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# See api.Dockerfile for why node_modules is copied as its own layer.
COPY --from=build /prod/app/node_modules ./node_modules
COPY --from=build /prod/app/package.json ./package.json
COPY --from=build /prod/app/next.config.ts ./next.config.ts
COPY --from=build /prod/app/.next ./.next
EXPOSE 3000
# API_URL is read server-side at runtime (never baked into the client bundle).
CMD ["node_modules/.bin/next", "start"]
