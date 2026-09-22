#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env.production ]]; then
  echo "error: copy .env.production.template to .env.production and configure secrets." >&2
  exit 1
fi

GIT_BRANCH="${GIT_BRANCH:-main}"

git fetch origin
git checkout "${GIT_BRANCH}"
git pull "origin" "${GIT_BRANCH}"

docker compose --env-file .env.production build --pull

# Apply pending Prisma migrations before the new app version starts.
# (Never use `prisma db push` against production: it has no migration history.)
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production run --rm migrate

docker compose --env-file .env.production up -d --remove-orphans

echo "Deploy finished. Listening on host port 3001 (map to CloudPanel reverse proxy)."
