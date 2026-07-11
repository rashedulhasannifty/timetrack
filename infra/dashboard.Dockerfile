# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f infra/dashboard.Dockerfile .

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
WORKDIR /repo/apps/dashboard
EXPOSE 3000
# API_URL is read server-side at runtime (never baked into the client bundle).
CMD ["node_modules/.bin/next", "start"]
