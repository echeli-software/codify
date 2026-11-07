#!/usr/bin/env bash
# Post-deploy smoke: wait until <api-url>/health reports {status: ok, database: up}.
#
#   infra/deploy/smoke.sh https://api.staging.codify.app/api [timeout-seconds]
set -euo pipefail

api_url="${1:?usage: smoke.sh <api-url> [timeout-seconds]}"
timeout="${2:-300}"
deadline=$((SECONDS + timeout))

while [ "$SECONDS" -lt "$deadline" ]; do
  if body="$(curl -fsS --max-time 10 "${api_url%/}/health" 2>/dev/null)"; then
    status="$(printf '%s' "$body" | jq -r '.status // empty')"
    database="$(printf '%s' "$body" | jq -r '.database // empty')"
    if [ "$status" = "ok" ] && [ "$database" = "up" ]; then
      echo "✅ ${api_url}/health → ${body}"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        # shellcheck disable=SC2016 # backticks are Markdown
        printf '### Smoke ✅\n`GET %s/health` → `%s`\n' "${api_url%/}" "$body" >> "$GITHUB_STEP_SUMMARY"
      fi
      exit 0
    fi
    echo "…not ready yet: ${body}"
  else
    echo "…${api_url}/health unreachable"
  fi
  sleep 10
done

echo "::error::${api_url}/health did not report ok within ${timeout}s"
exit 1
