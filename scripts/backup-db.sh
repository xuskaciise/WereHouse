#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/warehouse_${STAMP}.sql.gz"

echo "Writing ${OUT} ..."

docker compose exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
  | gzip > "${OUT}"

echo "Done. Size: $(du -h "${OUT}" | cut -f1)"
