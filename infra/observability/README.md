# Observability

docs/13 §12 calls for logs + metrics in Grafana Cloud, errors in Sentry and
external uptime probes. This directory holds the host agent; the in-app parts
(pino, Sentry SDK, the drift job) live in the API/apps.

## Grafana Alloy (logs + metrics)

[`alloy/config.alloy`](./alloy/config.alloy) runs on **every droplet** via
[`docker-compose.yml`](./docker-compose.yml) (outside Coolify, so it keeps
shipping during deploys). It replaces the Vector agent mentioned in docs/13:
one binary for both logs and metrics.

| Signal            | Source                                                                    | Destination                                                  | Labels                                                                       |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Container logs    | Docker socket (all containers: api, worker, redis, Coolify proxy, Judge0) | Grafana Cloud Loki                                           | `env`, `host`, `container`, `service`, `coolify_resource`, `stream`, `level` |
| pino JSON fields  | `level` (numeric → name), `msg`, `context`, `req.id`                      | Loki (`level` label; `req_id`/`context` structured metadata) |                                                                              |
| Host metrics      | `prometheus.exporter.unix` (CPU, memory, disk, network)                   | Grafana Cloud Prometheus                                     | `env`, `instance`                                                            |
| Container metrics | `prometheus.exporter.cadvisor`                                            | Grafana Cloud Prometheus                                     | `env`, `instance`, `name`                                                    |

`/api/health` request logs are dropped before shipping.

Setup on each host:

```bash
sudo mkdir -p /opt/observability && sudo chown deploy: /opt/observability
scp -r infra/observability/* infra/observability/.env.example deploy@<host>:/opt/observability/
ssh deploy@<host>
cd /opt/observability && cp .env.example .env && $EDITOR .env   # CODIFY_ENV=prod|staging, Grafana Cloud URLs/ids/token
docker compose up -d && docker compose logs -f alloy
```

Validate config changes locally with `alloy fmt` / `alloy validate config.alloy`
(the committed file passes both, Alloy v1.10).

### Dashboards & alerts (create in Grafana Cloud)

Mapping docs/13 §12 to data sources:

| Alert (docs/13)               | Query basis                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API p99 > 1 s for 5 min       | pino-http `responseTime` in Loki: `quantile_over_time(0.99, {service="api"} \| json \| unwrap responseTime [5m])` |
| 5xx rate > 1 % for 5 min      | Loki `res.statusCode >= 500` ratio                                                                                |
| Judge0 queue depth > 100      | API metric/log emitted by the submissions worker                                                                  |
| DB CPU > 80 % for 10 min      | DigitalOcean Managed DB alert policy (DO console)                                                                 |
| Free disk < 15 %              | `node_filesystem_avail_bytes / node_filesystem_size_bytes`                                                        |
| Gamification ledger drift ≠ 0 | the API's nightly drift job result (log line / metric), see below                                                 |

**Drift check.** The API runs the ledger drift check nightly as a scheduled
job (platform workstream) and logs/records the result; alert on any non-zero
drift. Operators can run the same check by hand against any database with
`DATABASE_URL=… node tools/scripts/drift-check.mjs` (exit 1 on drift).

## Sentry (errors)

| Project          | DSN goes to                                   | Notes                                                                                |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `codify-api`     | Coolify `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT`) | `@sentry/node`; release = image tag                                                  |
| `codify-student` | build-time define in the student app          | `@sentry/angular`; CSP already allows `*.ingest.sentry.io` / `*.ingest.us.sentry.io` |
| `codify-admin`   | build-time define in the admin app            | same                                                                                 |

- `release.yml` uploads frontend source maps when the `SENTRY_AUTH_TOKEN`
  secret and `SENTRY_ORG` variable exist **and** the build emits `*.map`
  files; it deletes the maps before publishing so they never reach Pages.
- Scrub PII: send user id only (docs/14 §17); keep `sendDefaultPii: false`.
- Free tier quotas: set per-project rate limits in Sentry to avoid surprise overages.

## Uptime

BetterStack (or UptimeRobot) monitors, 1-minute interval, from at least two regions:

- `https://api.codify.app/api/health` — keyword `"status":"ok"`
- `https://codify.app/` — status 200
- `https://admin.codify.app/` — status 200
- staging equivalents at 5-minute intervals
