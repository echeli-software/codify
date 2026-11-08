# Judge0 1.13.1 + the runtimes docs/12 §4 targets: Node.js 22 LTS (JavaScript,
# and TypeScript via Node's built-in type stripping) and Python 3.12.
#
# The stock judge0/judge0:1.13.1 image only ships Node 12.14 (id 63),
# TypeScript 3.7 (id 74) and Python 3.8 (id 71); ids 92-94 exist only on the
# hosted ce.judge0.com. This image adds three languages with ids the API
# uses by default (apps/api/src/app/exercises/judge0.executor.ts):
#
#   222  JavaScript (Node.js 22)
#   223  TypeScript (Node.js 22, --experimental-strip-types)
#   312  Python (3.12)
#
# Judge0 re-seeds its `languages` table from db/languages/*.rb on every
# server start (scripts/server → rails db:seed), so the languages are added
# to the seed files rather than inserted with SQL.
#
# Build on the Judge0 host (see ../README.md):
#   docker build -t codify/judge0:1.13.1-node22-py312 infra/judge0/image
ARG JUDGE0_VERSION=1.13.1
FROM judge0/judge0:${JUDGE0_VERSION}

ARG NODE_VERSION=22.23.4
ARG PYTHON_VERSION=3.12.8

USER root

# judge0/compilers is Debian buster (EOL): use the archive mirror.
RUN sed -i -e 's|deb.debian.org|archive.debian.org|g' \
      -e '/security.debian.org/d' -e '/buster-updates/d' /etc/apt/sources.list && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install -y --no-install-recommends \
      xz-utils zlib1g-dev libffi-dev libssl-dev libbz2-dev liblzma-dev && \
    rm -rf /var/lib/apt/lists/*

# Node.js 22 (official binaries, checksum-verified).
RUN set -eux; \
    cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
    mkdir -p /usr/local/node-22; \
    tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local/node-22 --strip-components=1; \
    rm -f node-v*.tar.xz SHASUMS256.txt; \
    /usr/local/node-22/bin/node --version

# Python 3.12 from source (same approach as judge0/compilers).
RUN set -eux; \
    cd /tmp; \
    curl -fsSLO "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz"; \
    tar -xzf "Python-${PYTHON_VERSION}.tgz"; \
    cd "Python-${PYTHON_VERSION}"; \
    ./configure --prefix=/usr/local/python-3.12 --without-ensurepip; \
    make -j"$(nproc)"; \
    make install; \
    cd /tmp && rm -rf Python-*; \
    /usr/local/python-3.12/bin/python3 --version

COPY codify-languages.rb /api/db/languages/codify.rb
RUN grep -q "languages/codify" /api/db/seeds.rb || \
    sed -i "s|^require_relative 'languages/active'|require_relative 'languages/active'\nrequire_relative 'languages/codify'|" /api/db/seeds.rb && \
    grep -q "languages/codify" /api/db/seeds.rb

USER judge0
