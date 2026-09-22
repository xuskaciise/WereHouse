#!/usr/bin/env bash
# Warehouse-only PostgreSQL backup, used by deploy.sh before every migration.
# Exits non-zero (and so aborts the deploy) if the dump fails, is empty or is
# not a readable archive. Independent of the shared /usr/local/bin/db-backup.sh.
#
# Usage: scripts/backup-warehouse-db.sh [label]
# Prints the path of the verified backup file on success.
# Restore (see SETUP.md / runbook):
#   docker exec -i <db-container> sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < FILE
set -Eeuo pipefail

LABEL="${1:-manual}"
BACKUP_DIR="${WAREHOUSE_BACKUP_DIR:-/var/backups/db/warehouse-deploy}"
KEEP="${WAREHOUSE_BACKUP_KEEP:-20}"

die() { echo "backup: ERROR: $*" >&2; exit 1; }

# Find this project's db container by compose labels (no dependency on
# IMAGE_TAG and no chance of matching another project's database).
DB_CONTAINER="$(docker ps -q \
  --filter label=com.docker.compose.project=siu_warehouse \
  --filter label=com.docker.compose.service=db)"
[[ -n "$DB_CONTAINER" ]] || die "warehouse db container (project siu_warehouse, service db) is not running"
[[ "$(wc -l <<<"$DB_CONTAINER")" -eq 1 ]] || die "more than one warehouse db container found"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/warehouse_${STAMP}_${LABEL}.dump"
PARTIAL="$OUT.partial"
trap 'rm -f "$PARTIAL"' EXIT

# Custom format (-Fc): compressed and restorable with pg_restore.
docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$PARTIAL" \
  || die "pg_dump failed"

[[ -s "$PARTIAL" ]] || die "dump file is empty"

# Verify it is a readable archive that actually contains table data.
TOC="$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$PARTIAL")" || die "dump is not a valid pg_restore archive"
grep -q "TABLE DATA" <<<"$TOC" || die "dump contains no table data"

mv "$PARTIAL" "$OUT"
trap - EXIT

# Retention: keep the newest $KEEP warehouse deploy backups (this directory only).
ls -1t "$BACKUP_DIR"/warehouse_*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --

echo "$OUT"
