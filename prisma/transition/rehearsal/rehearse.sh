#!/usr/bin/env bash
# Full rehearsal of the one-time transition on an EMPTY staging database.
#
#   prisma/transition/rehearsal/rehearse.sh [.env.staging]
#
# 1. create the OLD schema (main branch schema.prisma, via db push)
# 2. seed realistic old-style data (plaintext passwords, float money, wrong balances)
#    and add an EMPTY _prisma_migrations table, as on production (the Aug 25
#    deploy ran `prisma migrate deploy` without a migrations folder)
# 3. a _prisma_migrations WITH rows must refuse; transition --dry-run, and
#    prove it changed nothing
# 4. transition for real, then `prisma migrate deploy` and a drift check
# 5. independent before/after comparison + DB checks
# 6. a second transition run must refuse
# 7. run the production standalone build against staging and test logins,
#    money, stock, balances, roles and new writes
#
# The staging DATABASE_URL is read from the given file and never printed.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
STAGING_FILE="${1:-.env.staging}"
WORK="$(mktemp -d)"
REHEARSAL="prisma/transition/rehearsal"
APP_PORT=3200
APP_PID=""
cleanup() { [[ -n "$APP_PID" ]] && kill "$APP_PID" 2>/dev/null || true; }
trap cleanup EXIT

step() { echo; echo "######## $* ########"; }
die() { echo "REHEARSAL FAILED: $*" >&2; exit 1; }

[[ -f "$STAGING_FILE" ]] || die "$STAGING_FILE not found"
read_url() { node -e 'const m=require("fs").readFileSync(process.argv[1],"utf8").match(/^DATABASE_URL=["\x27]?([^"\x27\r\n]+)/m); if(!m) process.exit(1); process.stdout.write(m[1])' "$1"; }
DATABASE_URL="$(read_url "$STAGING_FILE")" || die "no DATABASE_URL in $STAGING_FILE"
export DATABASE_URL
if [[ -f .env ]] && [[ "$(node -e 'console.log(new URL(process.argv[1]).host)' "$(read_url .env)")" == "$(node -e 'console.log(new URL(process.argv[1]).host)' "$DATABASE_URL")" ]]; then
  die "the staging database is on the same host as .env - refusing"
fi

step "0. Staging state"
# "empty"  -> create the old schema and seed it
# "seeded" -> exactly the untouched rehearsal seed. A failed transition is
#             all-or-nothing, so the rehearsal resumes without wiping anything.
STATE="$(node -e '
  const {Client}=require("pg"); const c=new Client({connectionString:process.env.DATABASE_URL});
  (async()=>{ await c.connect();
    const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname=$1",["public"])).rows.map(r=>r.tablename);
    if(tables.length===0){ console.log("empty"); return }
    const pw=(await c.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3",["public","users","password"])).rows[0].n;
    if(pw!==1){ console.log("other"); return }
    if(tables.includes("_prisma_migrations") && (await c.query("SELECT count(*)::int n FROM public._prisma_migrations")).rows[0].n!==0){ console.log("other"); return }
    let rows=0; for(const t of tables) rows+=(await c.query(`SELECT count(*)::int n FROM public."${t}"`)).rows[0].n;
    const ids=(await c.query("SELECT string_agg(id, $1 ORDER BY id) s FROM public.users",[","])).rows[0].s;
    console.log(ids==="u_acc,u_admin,u_legacy,u_mgr,u_pend,u_rej,u_sales,u_stu" && rows===53 ? "seeded" : "other")
  })().finally(()=>c.end())')"
echo "staging state: $STATE"

case "$STATE" in
  empty)
    step "1. Create the OLD schema from main:prisma/schema.prisma"
    mkdir -p "$WORK/old"
    git show main:prisma/schema.prisma > "$WORK/old/schema.prisma"
    npx prisma db push --schema "$WORK/old/schema.prisma" --skip-generate 2>&1 | grep -v -i "datasource"

    step "2. Seed old-style data"
    node "$REHEARSAL/seed-old-schema.mjs" --staging
    ;;
  seeded)
    echo "Reusing the untouched old-schema rehearsal seed (steps 1-2 already done)."
    ;;
  *)
    die "staging is neither empty nor the untouched rehearsal seed - reset it in the Neon console first"
    ;;
esac

pg_exec() { node -e 'const {Client}=require("pg"); const c=new Client({connectionString:process.env.DATABASE_URL}); c.connect().then(()=>c.query(process.argv[1])).finally(()=>c.end())' "$1"; }

step "2b. EMPTY _prisma_migrations (as on production)"
pg_exec 'CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)'
echo "empty public._prisma_migrations present"
node "$REHEARSAL/snapshot.mjs" save "$WORK/before.json"

step "3. Transition (prepared exactly like the container: npm ci from the lockfile)"
mkdir -p "$WORK/t"
cp prisma/transition/package.json prisma/transition/package-lock.json prisma/transition/transition-from-db-push.mjs "$WORK/t/"
(cd "$WORK/t" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
transition() { MIGRATIONS_DIR="$ROOT/prisma/migrations" node "$WORK/t/transition-from-db-push.mjs" "$@"; }

step "3a. A _prisma_migrations WITH rows must refuse"
pg_exec "INSERT INTO public.\"_prisma_migrations\" (id, checksum, migration_name) VALUES ('rehearsal-row', 'x', 'rehearsal_fake')"
set +e
transition --dry-run > "$WORK/with-rows.log" 2>&1
rc=$?
set -e
pg_exec "DELETE FROM public.\"_prisma_migrations\" WHERE id = 'rehearsal-row'"
tail -n 2 "$WORK/with-rows.log"
[[ $rc -eq 2 ]] && grep -q "REFUSED: public._prisma_migrations has 1 row" "$WORK/with-rows.log" \
  && echo "PASS  non-empty _prisma_migrations refused (exit 2)" || die "non-empty _prisma_migrations was not refused (exit $rc)"

step "3b. DRY RUN"
transition --dry-run | tee "$WORK/dry-run.log"
grep -q "dropped the EMPTY public._prisma_migrations" "$WORK/dry-run.log" \
  && echo "PASS  dry run accepted the empty _prisma_migrations" || die "dry run did not handle the empty _prisma_migrations"
node "$REHEARSAL/snapshot.mjs" save "$WORK/after-dry-run.json"
node "$REHEARSAL/snapshot.mjs" compare "$WORK/before.json" "$WORK/after-dry-run.json"
node -e '
  const {Client}=require("pg"); const c=new Client({connectionString:process.env.DATABASE_URL});
  c.connect().then(()=>c.query(`SELECT to_regclass($1) pm, (SELECT count(*)::int FROM information_schema.columns WHERE table_schema=$2 AND table_name=$3 AND column_name=$4) pw`,["public._prisma_migrations","public","users","password"]))
   .then(async r=>{ const n=r.rows[0].pm ? (await c.query("SELECT count(*)::int n FROM public._prisma_migrations")).rows[0].n : -1;
     const ok=n===0 && r.rows[0].pw===1; console.log(ok?"PASS  dry run left the old schema and the empty _prisma_migrations untouched":"FAIL  dry run changed the schema"); if(!ok) process.exit(1) }).finally(()=>c.end())'

step "3c. REAL RUN"
transition | tee "$WORK/transition.log"
grep -q "BookCo" "$WORK/transition.log" && grep -q "Campus Shop" "$WORK/transition.log" \
  && echo "PASS  mismatch report lists BookCo and Campus Shop" || die "balance mismatch report is missing the deliberately wrong balances"
grep -q "ex2" "$WORK/transition.log" || grep -q '"expenses"' "$WORK/transition.log" \
  && echo "PASS  rounding report lists sub-cent values" || die "rounding report missing"

step "4. prisma migrate deploy + drift check"
npx prisma migrate deploy 2>&1 | grep -v -i "datasource" | tee "$WORK/migrate.log"
grep -q "No pending migrations" "$WORK/migrate.log" && echo "PASS  migrate deploy: no pending migrations" || die "migrate deploy did not report 'No pending migrations'"
if npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1; then
  echo "PASS  no drift between the database and schema.prisma"
else
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>&1 | grep -v -i datasource | head -40
  die "schema drift detected"
fi

step "5. Before/after comparison and DB checks"
node "$REHEARSAL/snapshot.mjs" save "$WORK/after.json"
node "$REHEARSAL/snapshot.mjs" compare "$WORK/before.json" "$WORK/after.json"
node "$REHEARSAL/verify-db.mjs"

step "6. Second run must refuse"
set +e
transition > "$WORK/second.log" 2>&1
rc=$?
set -e
cat "$WORK/second.log"
[[ $rc -eq 2 ]] && grep -q "REFUSED" "$WORK/second.log" && echo "PASS  second run refused safely (exit 2)" || die "second run did not refuse (exit $rc)"

step "7. Production build against staging"
[[ -f .next/standalone/server.js ]] || die "run 'npx next build' first"
mkdir -p "$WORK/app"
cp -r .next/standalone/. "$WORK/app/"
rm -f "$WORK/app/.env"
mkdir -p "$WORK/app/.next"
cp -r .next/static "$WORK/app/.next/static"
cp -r public "$WORK/app/public"
(
  cd "$WORK/app"
  NODE_ENV=production PORT=$APP_PORT HOSTNAME=127.0.0.1 AUTH_TRUST_HOST=true \
  AUTH_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" \
  node server.js > "$WORK/app.log" 2>&1
) &
APP_PID=$!
for _ in $(seq 1 40); do curl -fs -o /dev/null "http://127.0.0.1:$APP_PORT/api/health" && break; sleep 1; done
BASE="http://127.0.0.1:$APP_PORT" node "$REHEARSAL/verify-app.mjs"

step "REHEARSAL PASSED"
echo "Logs: $WORK"
