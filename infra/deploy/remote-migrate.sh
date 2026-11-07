#!/usr/bin/env bash
# Run `prisma migrate deploy` from the API image *on the app droplet*, which is
# the only host the managed database trusts (infra/terraform, docs/13 §1/§10).
# The DATABASE_URL travels over SSH stdin — never on a command line or in logs.
#
#   SSH_HOST=… SSH_USER=deploy SSH_PRIVATE_KEY=… SSH_KNOWN_HOSTS=… \
#   DATABASE_URL=… IMAGE=ghcr.io/org/codify-api@sha256:… infra/deploy/remote-migrate.sh
#
# The droplet must be logged in to GHCR (`docker login ghcr.io` as the deploy
# user with a read:packages token — infra/README.md step 6).
set -euo pipefail

: "${SSH_HOST:?}" "${SSH_PRIVATE_KEY:?}" "${SSH_KNOWN_HOSTS:?}" "${DATABASE_URL:?}" "${IMAGE:?}"
SSH_USER="${SSH_USER:-deploy}"

key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$key_dir/id"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$key_dir/known_hosts"
chmod 600 "$key_dir/id" "$key_dir/known_hosts"

ssh_opts=(-i "$key_dir/id" -o "UserKnownHostsFile=$key_dir/known_hosts" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20)

# shellcheck disable=SC2016  # expanded remotely
remote='set -eu
IFS= read -r DATABASE_URL || true
export DATABASE_URL
test -n "$DATABASE_URL"
docker pull --quiet "$1" >/dev/null
docker run --rm --env DATABASE_URL "$1" prisma migrate deploy'

printf '%s\n' "$DATABASE_URL" | ssh "${ssh_opts[@]}" "$SSH_USER@$SSH_HOST" sh -c "$(printf '%q' "$remote")" migrate "$IMAGE"
