# syntax=docker/dockerfile:1.7
#
# Admin SPA as a static nginx image — an alternative to Cloudflare Pages (the
# default host, see docs/13-deployment.md §3). Build from the repository root:
#
#   docker build -f apps/admin/Dockerfile \
#     --build-arg API_URL=https://api.codify.app/api -t codify-admin .
#   docker run -p 8080:8080 codify-admin
#
# nginx: SPA fallback, gzip, immutable caching for hashed bundles, and the
# security headers/CSP from docs/14 §5 (rendered by infra/web/security-headers.mjs).

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM node:${NODE_VERSION}-slim AS build
ARG PNPM_VERSION
ARG API_URL=https://api.codify.app/api
ARG CDN_ORIGIN=https://cdn.codify.app
ARG CLERK_ORIGIN=
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true PUPPETEER_SKIP_DOWNLOAD=true \
    CDN_ORIGIN=${CDN_ORIGIN} CLERK_ORIGIN=${CLERK_ORIGIN}
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN bash infra/web/build-frontend.sh admin "${API_URL}" nginx

# The tag is pinned in the NGINX_IMAGE build arg above.
# hadolint ignore=DL3006
FROM ${NGINX_IMAGE} AS runtime
COPY infra/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/dist/apps/admin/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/dist/apps/admin/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
