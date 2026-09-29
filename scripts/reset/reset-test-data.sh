#!/usr/bin/env bash
# Production test-data reset (VPS, /root/SIU_WAREHOUSE). Deletes ALL business
# data and all users except one admin; keeps role permissions + change log,
# settings and landed cost types. See scripts/reset/reset-test-data.sql.
#
#   scripts/reset/reset-test-data.sh --keep-admin <username>
#       DRY RUN (read-only session): row counts, plan and a confirmation token.
#   scripts/reset/reset-test-data.sh --keep-admin <username> --apply <token>
#       verified backup (scripts/backup-warehouse-db.sh) -> reset in ONE
#       transaction -> before/after counts. The token must come from a dry-run
#       of the unchanged data, otherwise nothing is changed.
#
# Only touches the siu_warehouse db container (found by compose labels).
# Restore a backup: see scripts/backup-warehouse-db.sh.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SQL="scripts/reset/reset-test-data.sql"
die() { echo "reset: ERROR: $*" >&2; exit 1; }

ADMIN="" TOKEN="" MODE="dry-run"
while (($#)); do
  case "$1" in
    --keep-admin) ADMIN="${2:-}"; shift 2 ;;
    --apply) MODE="apply"; TOKEN="${2:-}"; shift 2 ;;
    *) die "unknown argument '$1' (usage: --keep-admin <username> [--apply <token>])" ;;
  esac
done
[[ "$ADMIN" =~ ^[A-Za-z0-9._@-]{1,64}$ ]] || die "--keep-admin <username> is required (letters, digits, . _ @ -)"
[[ "$MODE" == "dry-run" || "$TOKEN" =~ ^[0-9a-f]{12}$ ]] || die "--apply needs the 12-character token printed by the dry-run"
[[ -f "$SQL" ]] || die "$SQL not found"

DB_CONTAINER="$(docker ps -q \
  --filter label=com.docker.compose.project=siu_warehouse \
  --filter label=com.docker.compose.service=db)"
[[ -n "$DB_CONTAINER" ]] || die "warehouse db container (project siu_warehouse, service db) is not running"
[[ "$(wc -l <<<"$DB_CONTAINER")" -eq 1 ]] || die "more than one warehouse db container found"

psql_in_db() {
  docker exec -i "$@" "$DB_CONTAINER" \
    sh -c 'exec psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off'
}

if [[ "$MODE" == "dry-run" ]]; then
  echo "=== DRY RUN (read-only) ==="
  {
    printf "SET reset.mode = 'dry-run';\nSET reset.keep_admin = '%s';\nBEGIN TRANSACTION READ ONLY;\n" "$ADMIN"
    cat "$SQL"
    printf "ROLLBACK;\n"
  } | psql_in_db -e PGOPTIONS=--default_transaction_read_only=on
  echo "To apply: $0 --keep-admin $ADMIN --apply <token above>"
  exit 0
fi

echo "=== Backup (verified) ==="
BACKUP="$(scripts/backup-warehouse-db.sh reset-test-data)" || die "backup failed - nothing changed"
echo "backup: $BACKUP"

echo "=== Reset (one transaction) ==="
if ! {
  printf "SET reset.mode = 'apply';\nSET reset.keep_admin = '%s';\nSET reset.token = '%s';\nBEGIN;\n" "$ADMIN" "$TOKEN"
  cat "$SQL"
  printf "COMMIT;\n"
} | psql_in_db; then
  die "reset failed and was rolled back - nothing changed. Backup: $BACKUP"
fi
echo "=== Reset committed. Backup taken before the reset: $BACKUP ==="
