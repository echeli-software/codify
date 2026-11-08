#!/usr/bin/env bash
# Weekly encrypted Postgres dump → Cloudflare R2 (docs/13 §11).
#
#   pg_dump (custom format) | age (public-key encryption) | R2 (S3 API)
#
# The dump is encrypted before it leaves the host; only the age private key
# (1Password, never on any server) can read it. Objects older than
# BACKUP_RETENTION_DAYS are pruned after a successful upload.
#
# Env (see backup.env.example — values live in /etc/codify/backup.env, mode 600):
#   DATABASE_URL           postgres:// URL (read-only role is enough)
#   AGE_RECIPIENTS         one or more age public keys (age1…), space separated
#   R2_ACCOUNT_ID          Cloudflare account id (endpoint host)
#   R2_BACKUP_BUCKET       e.g. codify-backups
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 API token scoped to that bucket
#   BACKUP_PREFIX          e.g. prod / staging (object key prefix)
#   BACKUP_RETENTION_DAYS  default 90
#   BACKUP_HEARTBEAT_URL   optional; GET on success (dead-man's-switch alerting)
#   S3_ENDPOINT_URL        optional override (tests / other S3 providers)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AGE_RECIPIENTS:?AGE_RECIPIENTS is required (age public key)}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"
: "${BACKUP_PREFIX:?BACKUP_PREFIX is required (e.g. prod)}"
retention_days="${BACKUP_RETENTION_DAYS:-90}"
endpoint="${S3_ENDPOINT_URL:-}"
if [ -z "$endpoint" ]; then
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
  endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

log() { printf '%s pg-backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="${BACKUP_PREFIX}/db-${BACKUP_PREFIX}-${stamp}.dump.age"
uri="s3://${R2_BACKUP_BUCKET}/${key}"

recipients=()
for r in $AGE_RECIPIENTS; do
  case "$r" in age1*) recipients+=(-r "$r") ;; *) log "AGE_RECIPIENTS entry is not an age public key"; exit 2 ;; esac
done

log "dumping → ${uri}"
# pipefail: a pg_dump or age failure aborts before anything is pruned, and
# the partial object is removed so it can't be mistaken for a backup.
if ! pg_dump --format=custom --compress=6 --no-owner --no-privileges "$DATABASE_URL" \
  | age "${recipients[@]}" \
  | aws s3 cp - "$uri" --endpoint-url "$endpoint" --only-show-errors; then
  log "dump/upload failed — removing partial ${key}"
  aws s3 rm "$uri" --endpoint-url "$endpoint" --only-show-errors || true
  exit 1
fi

size="$(aws s3api head-object --bucket "$R2_BACKUP_BUCKET" --key "$key" \
  --endpoint-url "$endpoint" --query ContentLength --output text)"
if ! [ "${size:-0}" -gt 1024 ] 2>/dev/null; then
  log "uploaded object is suspiciously small (${size:-?} bytes) — not pruning"
  exit 1
fi
log "uploaded ${size} bytes"

# Prune dumps older than the retention window (this prefix only).
cutoff="$(date -u -d "-${retention_days} days" +%Y%m%dT%H%M%SZ)"
aws s3api list-objects-v2 --bucket "$R2_BACKUP_BUCKET" --prefix "${BACKUP_PREFIX}/db-" \
  --endpoint-url "$endpoint" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | while read -r old; do
    [ -n "$old" ] && [ "$old" != "None" ] || continue
    ts="${old##*-}"; ts="${ts%.dump.age}"
    if [[ "$ts" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$ts" < "$cutoff" ]]; then
      log "pruning ${old}"
      aws s3 rm "s3://${R2_BACKUP_BUCKET}/${old}" --endpoint-url "$endpoint" --only-show-errors
    fi
  done

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_HEARTBEAT_URL" >/dev/null || log "heartbeat ping failed"
fi
log "done"
