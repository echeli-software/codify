#!/usr/bin/env bash
# Drop any NEW outbound connection originating from the Judge0 Docker networks
# (docs/12 §3: no network for sandboxes; docs/14 §9). Replies to the app
# droplet's requests (ESTABLISHED/RELATED) still flow. The `internal` network
# already has no default route; this also closes the `edge` network that only
# exists to publish :2358.
#
# Install once (runs before Docker starts containers on every boot):
#   sudo install -m 755 judge0-egress-lockdown.sh /usr/local/sbin/
#   sudo install -m 644 judge0-egress-lockdown.service /etc/systemd/system/
#   sudo systemctl enable --now judge0-egress-lockdown
set -euo pipefail

JUDGE0_SUBNETS=("172.30.0.0/24" "172.30.1.0/24")

# DOCKER-USER exists once dockerd has started at least once.
iptables -N DOCKER-USER 2>/dev/null || true

for subnet in "${JUDGE0_SUBNETS[@]}"; do
  rule=(-s "$subnet" ! -d "$subnet" -m conntrack --ctstate NEW -j DROP)
  iptables -C DOCKER-USER "${rule[@]}" 2>/dev/null || iptables -I DOCKER-USER 1 "${rule[@]}"
done

echo "judge0 egress lockdown active for ${JUDGE0_SUBNETS[*]}"
