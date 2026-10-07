# syntax=docker/dockerfile:1.7
#
# Codify API image (NestJS). Build from the repository root:
#
#   docker build -f apps/api/Dockerfile -t codify-api .                 # runtime (default)
#   docker build -f apps/api/Dockerfile --target migrate -t codify-api-migrate .
#
# Runtime:   docker run -e DATABASE_URL=... -p 3000:3000 codify-api
# Migrate:   docker run -e DATABASE_URL=... codify-api prisma migrate deploy
#            (or the `migrate` target, whose default command is exactly that).
# Coolify:   set the service's *Pre-deployment command* to `prisma migrate deploy`
#            so migrations run inside the freshly built image before traffic
#            switches (see infra/coolify/README.md).
#
# Stages: base → deps (pnpm fetch + install from the lockfile) → build
# (prisma generate, nx build api, runtime manifest) → prod-deps (production-only
# node_modules for the bundle) → release (node:22-slim, non-root) → migrate | runtime.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0

# ── base: node + pnpm ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NX_IGNORE_UNSUPPORTED_TS_SETUP=true \
    PUPPETEER_SKIP_DOWNLOAD=true
# openssl: Prisma's schema engine (migrate) links against libssl.
# Debian security updates are wanted here, so packages are not version-pinned.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ── deps: full workspace install, cached on the lockfile alone ───────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

# ── build: prisma client + webpack bundle + runtime manifest ─────────────────
FROM deps AS build
RUN pnpm prisma:generate \
 && pnpm exec nx run api:build --parallel=1 \
 && node infra/docker/api-runtime-manifest.mjs apps/api/dist

# ── prod-deps: production node_modules for the bundle only ───────────────────
# `node-linker=hoisted` gives a flat, npm-style tree so the generated Prisma
# client (node_modules/.prisma/client) can resolve its own runtime deps
# (@prisma/client-runtime-utils) from the top level.
FROM base AS prod-deps
WORKDIR /app
COPY --from=build /repo/apps/api/dist/package.json /repo/apps/api/dist/pnpm-lock.yaml ./
COPY --from=build /repo/prisma ./prisma
COPY --from=build /repo/prisma.config.ts ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --config.node-linker=hoisted \
 && ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma

# ── release: minimal runtime, non-root ───────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS release
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    PATH=/app/node_modules/.bin:$PATH
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
# The bundle plus anything webpack emitted next to it (source map, assets/).
# The build stage's package.json/lockfile are already in place from prod-deps.
COPY --from=build --chown=node:node /repo/apps/api/dist/ ./
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

# ── migrate: one-shot `prisma migrate deploy` (Coolify pre-deploy / CI) ──────
FROM release AS migrate
CMD ["prisma", "migrate", "deploy"]

# ── runtime (default target): the API server ─────────────────────────────────
FROM release AS runtime
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1),()=>process.exit(1))"]
CMD ["node", "main.js"]
