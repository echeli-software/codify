# Backup runner: pg_dump matching the managed cluster's major version
# (TF var pg_version, default 16) + age + the AWS CLI for R2's S3 API.
#   docker build -t codify/pg-backup:16 infra/backup
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-alpine
RUN apk add --no-cache age aws-cli bash coreutils curl
COPY pg-backup.sh /usr/local/bin/pg-backup
USER postgres
ENTRYPOINT ["/usr/local/bin/pg-backup"]
