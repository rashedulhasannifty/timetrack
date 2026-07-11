# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f infra/worker.Dockerfile .

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
# Headless — no port. sharp's native binary is preserved by copying node_modules as-is.
CMD ["node", "dist/main.js"]
