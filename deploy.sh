#!/usr/bin/env bash
# Server-side deploy for the warehouse app. Called by .github/workflows/deploy.yml
# (and usable by hand) from /root/SIU_WAREHOUSE on the VPS.
#
#   ./deploy.sh pull   <sha> <github-user>   # token on stdin; pulls both images
#   ./deploy.sh deploy <sha>                 # backup -> migrate -> switch -> health check
#   ./deploy.sh rollback                     # switch the app back to the :rollback image
#
# Only touches the siu_warehouse compose project (db, app, migrate) and the
# ghcr.io/xuskaciise/warehouse images. Other projects on the VPS are never
# referenced.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

IMAGE="ghcr.io/xuskaciise/warehouse"
ENV_FILE=".env.production"
TAG_FILE=".deployed-image-tag"

log() { echo "=== $* ==="; }
die() { echo "deploy: ERROR: $*" >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

env_value() {
  # Reads KEY=value from .env.production without sourcing it.
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

validate_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{7,40}$ ]] || die "invalid image tag '${1:-}' (expected a commit SHA)"
}

check_env() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found (copy .env.production.template)"
  local missing=()
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL; do
    [[ -n "$(env_value "$key")" ]] || missing+=("$key")
  done
  [[ -n "$(env_value AUTH_SECRET)$(env_value NEXTAUTH_SECRET)" ]] || missing+=("AUTH_SECRET")
  [[ -n "$(env_value AUTH_TRUST_HOST)$(env_value AUTH_URL)" ]] || missing+=("AUTH_TRUST_HOST or AUTH_URL")
  ((${#missing[@]} == 0)) || die "missing in $ENV_FILE: ${missing[*]}"
}

app_port() {
  local port
  port="$(env_value APP_PORT)"
  echo "${port:-3009}"
}

health_check() {
  local url="http://127.0.0.1:$(app_port)/api/health"
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then
      echo "healthy: $url"
      return 0
    fi
    sleep 3
  done
  echo "unhealthy after 90s: $url" >&2
  return 1
}

cmd_pull() {
  local sha="${1:-}" user="${2:-}"
  validate_sha "$sha"
  [[ -n "$user" ]] || die "usage: deploy.sh pull <sha> <github-user>  (token on stdin)"

  # Log in with a temporary Docker config so the root user's existing registry
  # credentials (used by other projects) are never overwritten or logged out.
  (
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    DOCKER_CONFIG="$tmp" docker login ghcr.io -u "$user" --password-stdin >/dev/null \
      || die "docker login to ghcr.io failed"
    DOCKER_CONFIG="$tmp" docker pull "$IMAGE:$sha"
    DOCKER_CONFIG="$tmp" docker pull "$IMAGE:$sha-migrator"
  )
}

current_app_container() {
  docker ps -aq \
    --filter label=com.docker.compose.project=siu_warehouse \
    --filter label=com.docker.compose.service=app | head -n 1
}

cmd_deploy() {
  local sha="${1:-}"
  validate_sha "$sha"
  check_env
  export IMAGE_TAG="$sha"

  docker image inspect "$IMAGE:$sha" >/dev/null 2>&1 || die "image $IMAGE:$sha not present (run: deploy.sh pull)"
  docker image inspect "$IMAGE:$sha-migrator" >/dev/null 2>&1 || die "image $IMAGE:$sha-migrator not present"

  log "Database"
  # Start the db only if it is not running; never recreate it during a deploy.
  if ! docker ps -q --filter label=com.docker.compose.project=siu_warehouse \
      --filter label=com.docker.compose.service=db --filter status=running | grep -q .; then
    compose up -d --wait db
  fi

  log "Backup (warehouse only)"
  local backup
  backup="$(scripts/backup-warehouse-db.sh "pre-${sha:0:12}")" || die "backup failed - deploy aborted, nothing changed"
  echo "backup: $backup"

  log "Migrate"
  local migrate_log
  migrate_log="$(mktemp)"
  if ! compose run --rm -T --no-deps migrate 2>&1 | tee "$migrate_log"; then
    rm -f "$migrate_log"
    die "migration failed - deploy aborted, app not switched. Backup: $backup"
  fi
  local migrations_applied=false
  grep -q "No pending migrations" "$migrate_log" || migrations_applied=true
  rm -f "$migrate_log"

  log "Switch app to $IMAGE:$sha"
  local prev_container prev_image=""
  prev_container="$(current_app_container)"
  if [[ -n "$prev_container" ]]; then
    prev_image="$(docker inspect --format '{{.Image}}' "$prev_container")"
    docker tag "$prev_image" "$IMAGE:rollback"
    echo "previous image saved as $IMAGE:rollback"
  fi
  compose up -d --no-deps app

  log "Health check"
  if ! health_check; then
    compose logs --tail 80 app || true
    if [[ -n "$prev_image" ]]; then
      log "ROLLBACK to previous image"
      IMAGE_TAG=rollback compose up -d --no-deps app
      health_check || echo "WARNING: rolled-back app is not healthy either" >&2
    fi
    if [[ "$migrations_applied" == true ]]; then
      echo "WARNING: this deploy applied database migrations; they were NOT rolled back." >&2
      echo "         If the previous app version cannot use the new schema, restore: $backup" >&2
    fi
    die "deploy of $sha failed health check"
  fi

  echo "$sha" > "$TAG_FILE"

  log "Cleanup (warehouse images only)"
  # Keep this deploy, the rollback image and anything tagged in use; remove
  # older ghcr.io/xuskaciise/warehouse tags only.
  docker images "$IMAGE" --format '{{.Tag}}' | while read -r tag; do
    case "$tag" in
      "$sha" | "$sha-migrator" | rollback | "<none>") ;;
      *) docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true ;;
    esac
  done

  log "Deployed $sha"
}

cmd_rollback() {
  check_env
  docker image inspect "$IMAGE:rollback" >/dev/null 2>&1 || die "no $IMAGE:rollback image available"
  IMAGE_TAG=rollback compose up -d --no-deps app
  health_check || die "rolled-back app is not healthy"
  echo "rollback" > "$TAG_FILE"
  log "Rolled back (database not changed)"
}

case "${1:-}" in
  pull) shift; cmd_pull "$@" ;;
  deploy) shift; cmd_deploy "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  *) die "usage: deploy.sh {pull <sha> <github-user> | deploy <sha> | rollback}" ;;
esac
