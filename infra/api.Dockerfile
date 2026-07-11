# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f infra/api.Dockerfile .

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# turbo builds packages before apps (^build); prisma generate runs in @timetrack/db build.
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
# Copy the whole installed workspace so pnpm's symlinked node_modules stays intact.
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# Prisma 7 has no Rust engine — nothing else to copy.
CMD ["node", "dist/main.js"]
