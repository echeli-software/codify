#!/usr/bin/env bash
# Trigger a Coolify deployment through its deploy webhook and (optionally) wait
# for it to finish.
#
#   COOLIFY_WEBHOOK_URL="https://coolify.example/api/v1/deploy?uuid=<api>,<worker>&force=false" \
#   COOLIFY_TOKEN=… infra/deploy/coolify-deploy.sh
#
# COOLIFY_WEBHOOK_URL is the "Deploy Webhook" shown on the resource's
# Webhooks tab (comma-separate several resource uuids to deploy api + worker
# together). COOLIFY_TOKEN is a Coolify API token with the `deploy` scope.
set -euo pipefail

: "${COOLIFY_WEBHOOK_URL:?}" "${COOLIFY_TOKEN:?}"

response="$(curl -fsS --retry 3 --retry-all-errors --max-time 60 \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
  "${COOLIFY_WEBHOOK_URL}")"
echo "Coolify accepted the deployment: ${response}"

# Coolify ≥ 4.0.0-beta.3xx answers with {"deployments":[{"deployment_uuid":…}]}.
# Poll each one until it leaves the queue when the API exposes it.
base="${COOLIFY_WEBHOOK_URL%%/api/v1/*}"
uuids="$(printf '%s' "$response" | jq -r '.deployments[]?.deployment_uuid // empty' 2>/dev/null || true)"
for uuid in $uuids; do
  for _ in $(seq 1 90); do
    status="$(curl -fsS --max-time 20 -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
      "${base}/api/v1/deployments/${uuid}" | jq -r '.status // "unknown"' || echo unknown)"
    case "$status" in
      finished) echo "deployment ${uuid}: finished"; break ;;
      failed | cancelled*) echo "::error::Coolify deployment ${uuid} ${status}"; exit 1 ;;
      *) sleep 10 ;;
    esac
  done
done
