# syntax=docker/dockerfile:1.7
#
# Selfship platform images (self-hosting). One build, four targets:
#   docker build --target api     -t selfship-api .
#   docker build --target worker  -t selfship-worker .
#   docker build --target web     -t selfship-web .
#   docker build --target migrate -t selfship-migrate .
# docker-compose.yml builds them for you; see docs/self-hosting.md.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ── Build everything once ──────────────────────────────────────────────────
FROM base AS build
# Toolchain for native modules (argon2) in case no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# The web app proxies /api/* to the API; the address is fixed at build time.
ARG API_URL=http://api:4000
ENV API_URL=${API_URL} NEXT_OUTPUT=standalone
RUN pnpm turbo run build --filter=@selfship/api --filter=@selfship/worker --filter=@selfship/web
# Self-contained copies of the API and worker with production dependencies only.
RUN pnpm --filter=@selfship/api deploy --legacy --prod /out/api \
  && pnpm --filter=@selfship/worker deploy --legacy --prod /out/worker \
  && pnpm --filter=@selfship/db deploy --legacy /out/db

# ── API ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api .
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ── Worker ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker .
USER node
CMD ["node", "dist/main.js"]

# ── Web (Next.js standalone server) ────────────────────────────────────────
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ── Database migrations (runs once, then exits) ────────────────────────────
# Only the db package with the Prisma CLI, the schema and the migrations.
FROM node:22-bookworm-slim AS migrate
WORKDIR /app
COPY --from=build --chown=node:node /out/db .
COPY --from=build --chown=node:node /repo/packages/db/prisma ./prisma
COPY --from=build --chown=node:node /repo/packages/db/prisma.config.ts ./prisma.config.ts
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
