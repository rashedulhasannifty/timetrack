# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f infra/worker.Dockerfile .

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Build-time only: packages/db/prisma.config.ts resolves env('DATABASE_URL') when the Prisma
# CLI loads it. `prisma generate` never connects — the var only has to resolve. The repo-root
# .env is (correctly) excluded by .dockerignore, so without this the build fails with
# PrismaConfigEnvError. This stage is discarded; the real URL is injected at runtime via
# env_file and never leaks from here into the runtime image.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
# Headless — no port. sharp's native binary is preserved by copying node_modules as-is.
CMD ["node", "dist/main.js"]
