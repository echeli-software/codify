# Judge0 host (`vps-judge0-01`)

Self-hosted Judge0 for programming exercises (docs/12-code-execution.md,
roadmap Phase 10). The droplet, VPC and cloud firewall come from
`infra/terraform`; this directory holds what runs on the host.

| File                                     | Purpose                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docker-compose.yml`                     | Judge0 server + workers + internal Postgres/Redis, resource limits, `internal` network     |
| `judge0.conf.template`                   | Judge0 settings: auth tokens, sandbox limits (docs/12 §3), network disabled, callbacks off |
| `judge0-egress-lockdown.sh` / `.service` | `DOCKER-USER` iptables rules that drop new outbound connections from the Judge0 networks   |

## Isolation layers

| Layer                             | What it enforces                                                                                                                                     | Where                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DO cloud firewall `codify-judge0` | Inbound :2358 only from `vps-app-01` (and `vps-staging-01` when `judge0_allow_staging`); SSH from operator CIDRs; egress limited to DNS/NTP/HTTP(S)  | `infra/terraform/digitalocean.tf` |
| Bind address                      | `:2358` published on the VPC private IP only, never the public interface                                                                             | `JUDGE0_BIND_ADDR`                |
| Docker `internal` network         | db, redis and workers have no default route                                                                                                          | `docker-compose.yml`              |
| `DOCKER-USER` rules               | No NEW outbound connection from either Judge0 subnet (replies still flow)                                                                            | `judge0-egress-lockdown.sh`       |
| isolate                           | Per-submission chroot + cgroup; `ENABLE_NETWORK=false`, `ALLOW_ENABLE_NETWORK=false`; CPU 2 s, wall 5 s, 128 MB, 64 MB stack, 30 procs, 64 KB output | `judge0.conf.template`            |

**What DigitalOcean firewalls can't express:** they apply to the whole
droplet, not to containers or processes, and their egress rules must stay open
for DNS/HTTP(S) so the host can pull images and OS updates. "No egress for the
sandbox" is therefore enforced on the host by the last three layers. The
`edge` Docker network exists only so the server can publish its port; the
lockdown script blocks it from initiating connections.

## First-time setup

1. **cgroup v1.** Judge0 1.13's isolate needs the legacy cgroup hierarchy, but
   Ubuntu 22.04+ boots with cgroup v2:
   ```bash
   sudo sed -i 's/^GRUB_CMDLINE_LINUX="/GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=0 /' /etc/default/grub
   sudo update-grub && sudo reboot
   ```
2. Copy this directory to `/opt/judge0` (as `deploy`).
3. Render the config (tokens: `openssl rand -hex 32` each):
   ```bash
   cd /opt/judge0
   export JUDGE0_AUTHN_TOKEN=... JUDGE0_AUTHZ_TOKEN=... JUDGE0_DB_PASSWORD=... JUDGE0_REDIS_PASSWORD=...
   envsubst < judge0.conf.template > judge0.conf && chmod 600 judge0.conf
   ```
   Store the four values in 1Password; `JUDGE0_AUTHN_TOKEN` also goes into
   Coolify as the API's `JUDGE0_AUTH_TOKEN`.
4. Install the egress lockdown:
   ```bash
   sudo install -m 755 judge0-egress-lockdown.sh /usr/local/sbin/
   sudo install -m 644 judge0-egress-lockdown.service /etc/systemd/system/
   sudo systemctl enable --now judge0-egress-lockdown
   ```
5. Start Judge0 on the VPC address (`terraform output judge0_private_url`):
   ```bash
   echo "JUDGE0_BIND_ADDR=$(ip -4 -o addr show eth1 | awk '{print $4}' | cut -d/ -f1)" > .env
   docker compose up -d
   ```
6. From `vps-app-01`, verify:
   ```bash
   curl -s -H "X-Auth-Token: $JUDGE0_AUTH_TOKEN" http://<judge0-private-ip>:2358/about
   ```
   and from anywhere else (your laptop, the public IP) the port must time out.

## Hostile-submission checks (roadmap Phase 10 acceptance)

Run from the app host against `/submissions?wait=true` with the JS language id;
each must finish with the noted status and the host must stay healthy:

| Submission                                                                    | Expected                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `while (true) {}`                                                             | `Time Limit Exceeded` after ~2 s CPU / 5 s wall     |
| `const a = []; while (true) a.push(new Array(1e6).fill(1));`                  | `Runtime Error` / memory limit                      |
| `require('child_process').execSync(':(){ :\|:& };:', { shell: '/bin/bash' })` | process cap (30) → `Runtime Error`                  |
| `require('https').get('https://example.com', r => console.log(r.statusCode))` | network error (no route) — never a status code      |
| `console.log('x'.repeat(1e6))`                                                | output truncated / `Runtime Error` (64 KB file cap) |

## Operations

- **Upgrades:** bump `JUDGE0_VERSION`, `docker compose pull && docker compose up -d`, then run the admin "re-run reference solutions" tool (docs/12 §11).
- **Compromise:** treat the host as disposable — `terraform taint digitalocean_droplet.judge0 && terraform apply`, repeat the setup, rotate `JUDGE0_AUTH_TOKEN` in Coolify (docs/13 §14).
- **Monitoring:** Grafana Alloy (infra/observability) ships container logs + node metrics; alert on queue depth > 100 (docs/13 §12) via the API's Judge0 metrics.
