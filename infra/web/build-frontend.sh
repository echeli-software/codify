#!/usr/bin/env bash
# Production build of a frontend (admin | student) for a given API, plus the
# host-specific security/caching headers. Used by the static Dockerfiles and
# by the preview/staging/release workflows so every host gets the same bytes.
#
#   infra/web/build-frontend.sh <admin|student> <api-url> [pages|nginx|none]
#
# Env: CDN_ORIGIN, CLERK_ORIGIN (optional, see security-headers.mjs).
# Output: dist/apps/<app>/browser (+ _headers for pages,
#         dist/apps/<app>/security-headers.conf for nginx).
set -euo pipefail

app="${1:?usage: build-frontend.sh <admin|student> <api-url> [pages|nginx|none]}"
api_url="${2:?api url required, e.g. https://api.codify.app/api}"
format="${3:-pages}"

case "$app" in admin | student) ;; *) echo "unknown app: $app" >&2; exit 2 ;; esac

export NX_DAEMON=false NX_IGNORE_UNSUPPORTED_TS_SETUP=true

# Angular `define` values must be JS literals; Nx's argument parser strips one
# level of quotes, hence the nested '"…"'.
pnpm exec nx run "${app}:build:production" --parallel=1 \
  "--define.CODIFY_API_URL='\"${api_url}\"'"

out="dist/apps/${app}/browser"
test -f "${out}/index.html" || { echo "build produced no ${out}/index.html" >&2; exit 1; }

case "$format" in
  pages)
    node infra/web/security-headers.mjs --app="$app" --format=pages \
      --api-url="$api_url" --out="${out}/_headers"
    ;;
  nginx)
    node infra/web/security-headers.mjs --app="$app" --format=nginx \
      --api-url="$api_url" --out="dist/apps/${app}/security-headers.conf"
    ;;
  none) ;;
  *) echo "unknown format: $format" >&2; exit 2 ;;
esac
