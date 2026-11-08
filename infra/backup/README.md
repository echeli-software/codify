# Weekly encrypted Postgres dumps → R2

docs/13 §11: on top of DigitalOcean's daily snapshots + 7-day PITR, a weekly
`pg_dump` goes to R2 with 90-day retention, encrypted with
[age](https://age-encryption.org) to a public key whose private key lives
only in 1Password.

| File                    | Purpose                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `pg-backup.sh`          | `pg_dump -Fc \| age -r <pubkey> \| aws s3 cp - s3://…` to R2, size check, prune > retention, heartbeat |
| `Dockerfile`            | `postgres:16-alpine` + age + aws-cli (pg_dump matches the cluster's major version, TF `pg_version`)    |
| `codify-pg-backup.cron` | `/etc/cron.d` entry: Sundays 03:23 UTC, runs the image with `/etc/codify/backup.env`                   |
| `backup.env.example`    | the variables (no secrets in the repo)                                                                 |

The cron file is installed by cloud-init on the app and staging droplets
(`infra/terraform/cloud-init/base.yaml.tftpl`) and does nothing until
`/etc/codify/backup.env` exists.

## One-time setup (per environment)

1. **Key pair** (on a trusted laptop, never on a server):
   `age-keygen -o codify-db-backup.key` → store the file in 1Password
   ("Codify DB backup age key"); the `# public key: age1…` line is
   `AGE_RECIPIENTS`. Add a second recipient (space separated) for a
   break-glass key if wanted.
2. **Bucket**: R2 bucket `codify-backups` (private, no public domain).
   Lifecycle rule "delete objects after 120 days" as a backstop to the
   script's 90-day prune. API token: _Object Read & Write_ on that bucket only
   → `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
3. **Database role** (read-only is enough):
   `CREATE ROLE backup LOGIN PASSWORD '…'; GRANT pg_read_all_data TO backup;`
   → `DATABASE_URL=postgresql://backup:…@<private-host>:25060/codify?sslmode=require`.
4. On the droplet (as root):
   ```bash
   install -d -m 700 /etc/codify
   install -m 600 /dev/null /etc/codify/backup.env   # then fill it from backup.env.example
   docker build -t codify/pg-backup:16 /opt/codify/infra/backup   # or pull it from GHCR
   install -m 644 /opt/codify/infra/backup/codify-pg-backup.cron /etc/cron.d/codify-pg-backup  # if cloud-init didn't
   docker run --rm --network host --env-file /etc/codify/backup.env codify/pg-backup:16   # first run by hand
   ```
5. Optional alerting: set `BACKUP_HEARTBEAT_URL` to a dead-man's-switch
   check (Grafana OnCall / healthchecks.io) expecting one ping a week.

Logs: `/var/log/codify-pg-backup.log`. A failed dump exits non-zero,
removes the partial object and prunes nothing.

## Restore (and the quarterly drill)

```bash
# 1. Pick a dump
aws s3 ls s3://codify-backups/prod/ --endpoint-url https://<account>.r2.cloudflarestorage.com
aws s3 cp s3://codify-backups/prod/db-prod-<stamp>.dump.age . --endpoint-url https://<account>.r2.cloudflarestorage.com
# 2. Decrypt with the private key from 1Password (on the operator's machine)
age -d -i codify-db-backup.key db-prod-<stamp>.dump.age > codify.dump
pg_restore --list codify.dump | head          # sanity check
# 3. Restore into a THROWAWAY database (never the live cluster)
createdb -h <throwaway-host> codify_restore
pg_restore --no-owner --no-privileges --jobs=4 -d "postgresql://…/codify_restore" codify.dump
# 4. Verify
DATABASE_URL=postgresql://…/codify_restore node tools/scripts/drift-check.mjs
psql "postgresql://…/codify_restore" -c 'select count(*) from "User"; select max("createdAt") from "AuditLog";'
# 5. Shred the plaintext dump
shred -u codify.dump
```

For a real incident, prefer DigitalOcean PITR (minutes of data loss) over a
weekly dump (up to 7 days); the dumps cover longer-term recovery and a
provider-level loss. Record each drill in the release checklist.
