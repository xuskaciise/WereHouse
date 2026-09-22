#!/bin/sh
# Entrypoint of the `transition` service in docker-compose.yml (node:20-alpine).
# Installs the pinned, lockfile-verified dependencies into a scratch directory
# and runs the transition against DATABASE_URL (the warehouse db container).
set -eu
mkdir -p /work
cp /src/prisma/transition/package.json /src/prisma/transition/package-lock.json \
   /src/prisma/transition/transition-from-db-push.mjs /work/
cd /work
npm ci --omit=dev --no-audit --no-fund --loglevel=error
MIGRATIONS_DIR=/src/prisma/migrations exec node /work/transition-from-db-push.mjs "$@"
