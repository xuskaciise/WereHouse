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
docker compose --env-file .env.production up -d --remove-orphans

# First deploy / schema changes (pick one workflow):
#   docker compose --env-file .env.production run --rm app npx prisma migrate deploy
#   docker compose --env-file .env.production run --rm app npx prisma db push

echo "Deploy finished. Listening on host port 3001 (map to CloudPanel reverse proxy)."
