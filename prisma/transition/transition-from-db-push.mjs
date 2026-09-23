#!/usr/bin/env node
/**
 * ONE-TIME TRANSITION: old `db push` schema  ->  Prisma Migrate `init` schema
 * ============================================================================
 *
 * Converts a database created by `prisma db push` from the OLD schema (main
 * branch before the security fixes: plaintext `users.password`, Float money
 * columns, stored supplier/customer `balance`, no `_prisma_migrations`) into
 * exactly the schema of prisma/migrations/<timestamp>_init, keeping all data,
 * and baselines it so `prisma migrate deploy` manages it from then on.
 *
 * Everything runs in ONE transaction: it either fully succeeds or changes
 * nothing. Steps:
 *   1. Refuse if the database is already managed by Prisma Migrate or already
 *      on the new schema, or contains objects this script does not know.
 *   2. Lock the old tables and run pre-flight checks on the old data:
 *        - rows that would violate the new CHECK constraints (negative stock,
 *          reserved > quantity)                 -> STOP with a list
 *        - money values that do not fit NUMERIC(12,2) (NaN/Infinity/too big)
 *                                               -> STOP with a list
 *        - money values with more than 2 decimals -> REPORT (rounded half-up
 *          to cents, e.g. an old tax of 1.616 becomes 1.62)
 *   3. Rename the old `public` schema to `transition_old`, create a fresh
 *      `public` and execute the committed init migration.sql in it verbatim
 *      (tables, enums, indexes, foreign keys, CHECK constraints).
 *   4. Copy every table (foreign-key order). Money -> NUMERIC(12,2); enums are
 *      re-cast; `users.password` is hashed with bcrypt (cost 12) into
 *      `passwordHash`; stored balances are not copied.
 *   5. Verify inside the transaction: identical row counts, and every copied
 *      value identical to the old value (money compared after rounding).
 *   6. REPORT every stored balance that differs from the calculated balance
 *      (orders not CANCELLED minus payments), then drop `transition_old`.
 *   7. Create `_prisma_migrations` and record the init migration as applied.
 *   8. COMMIT  (or ROLLBACK with --dry-run).
 *
 * Usage (DATABASE_URL must point at the warehouse database):
 *   node transition-from-db-push.mjs --dry-run   # full run, then ROLLBACK: changes nothing
 *   node transition-from-db-push.mjs             # real run
 * On the VPS use ./deploy.sh transition --dry-run | --apply (runs this in Docker).
 *
 * Exit codes: 0 success, 2 refused/stopped by a check (nothing changed),
 *             1 unexpected error (transaction rolled back, nothing changed).
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import pg from "pg"

const DRY_RUN = process.argv.includes("--dry-run")
const BCRYPT_COST = 12
const OLD_SCHEMA = "transition_old"
const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(HERE, "..", "migrations")

// Parents before children (foreign keys are not deferrable).
const TABLE_ORDER = [
  "users",
  "settings",
  "categories",
  "expense_categories",
  "warehouses",
  "suppliers",
  "customers",
  "products",
  "stock",
  "stock_movements",
  "purchase_orders",
  "purchase_order_items",
  "purchase_receives",
  "purchase_receive_items",
  "supplier_payments",
  "sales_orders",
  "sales_order_items",
  "customer_payments",
  "stock_transfers",
  "stock_transfer_items",
  "expenses",
]

// Float -> NUMERIC(12,2)
const MONEY_COLUMNS = {
  products: ["costPrice", "sellingPrice"],
  purchase_orders: ["subtotal", "tax", "discount", "total"],
  purchase_order_items: ["unitPrice", "subtotal"],
  supplier_payments: ["amount"],
  sales_orders: ["subtotal", "tax", "discount", "total"],
  sales_order_items: ["unitPrice", "subtotal"],
  customer_payments: ["amount"],
  expenses: ["amount"],
}

// Old columns intentionally not copied.
const DROPPED_COLUMNS = { users: ["password"], suppliers: ["balance"], customers: ["balance"] }
// New columns filled by this script instead of being copied.
const COMPUTED_COLUMNS = { users: ["passwordHash"] }

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const REPORT_LIMIT = 50

class Stop extends Error {}

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`
const section = (title) => console.log(`\n=== ${title} ===`)

function findInitMigration() {
  if (!existsSync(MIGRATIONS_DIR)) throw new Stop(`Migrations directory not found: ${MIGRATIONS_DIR}`)
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /_init$/.test(d.name))
    .map((d) => d.name)
    .sort()
  if (dirs.length !== 1) throw new Stop(`Expected exactly one *_init migration in ${MIGRATIONS_DIR}, found ${dirs.length}`)
  // Prisma computes the checksum over the file as stored in git (LF endings);
  // normalise in case the file was copied from a Windows checkout.
  const sql = readFileSync(join(MIGRATIONS_DIR, dirs[0], "migration.sql"), "utf8").replace(/\r\n/g, "\n")
  return { name: dirs[0], sql, checksum: createHash("sha256").update(sql, "utf8").digest("hex") }
}

async function tableColumns(client, schema, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            t.typtype = 'e' AS is_enum,
            a.attnotnull AS not_null,
            ad.adbin IS NOT NULL AS has_default
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [schema, table]
  )
  return rows
}

async function tablesIn(client, schema) {
  const { rows } = await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`,
    [schema]
  )
  return rows.map((r) => r.name)
}

function printRows(rows) {
  for (const row of rows.slice(0, REPORT_LIMIT)) console.log("   ", JSON.stringify(row))
  if (rows.length > REPORT_LIMIT) console.log(`    ... and ${rows.length - REPORT_LIMIT} more`)
}

// --- 1. Guards ---------------------------------------------------------------
async function guards(client) {
  section("Checking that this is an old (db push) warehouse database")

  const { rows: pm } = await client.query(`SELECT to_regclass('public._prisma_migrations') AS t`)
  if (pm[0].t) {
    throw new Stop("REFUSED: public._prisma_migrations exists - this database is already managed by Prisma Migrate (already transitioned?). Nothing changed.")
  }
  const { rows: old } = await client.query(`SELECT to_regnamespace($1) AS s`, [OLD_SCHEMA])
  if (old[0].s) throw new Stop(`REFUSED: schema "${OLD_SCHEMA}" already exists (left over from an earlier attempt?). Nothing changed.`)

  const userCols = (await tableColumns(client, "public", "users")).map((c) => c.name)
  if (userCols.length === 0) throw new Stop("REFUSED: table public.users not found - not a warehouse database. Nothing changed.")
  if (userCols.includes("passwordHash") || !userCols.includes("password")) {
    throw new Stop("REFUSED: users already has passwordHash / has no password column - the database is already on the new schema. Nothing changed.")
  }

  const tables = await tablesIn(client, "public")
  const unknownTables = tables.filter((t) => !TABLE_ORDER.includes(t))
  const { rows: otherObjects } = await client.query(
    `SELECT 'relation ' || c.relname::text || ' (' || c.relkind::text || ')' AS object
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f')
     UNION ALL
     SELECT 'function ' || p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
     UNION ALL
     SELECT 'extension ' || e.extname::text FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'public'`
  )
  const unknown = [...unknownTables.map((t) => `table ${t}`), ...otherObjects.map((o) => o.object)]
  if (unknown.length > 0) {
    throw new Stop(`STOPPED: the public schema contains objects this script does not know and would drop:\n    ${unknown.join("\n    ")}\nNothing changed.`)
  }
  console.log(`OK: old schema detected (${tables.length} tables, no Prisma migration history).`)
  return tables
}

// --- 2. Pre-flight data checks ---------------------------------------------
async function preflight(client, oldTables) {
  section("Locking old tables")
  await client.query(`LOCK TABLE ${oldTables.map((t) => `public.${q(t)}`).join(", ")} IN ACCESS EXCLUSIVE MODE`)
  console.log(`Locked ${oldTables.length} tables.`)

  section("Pre-flight: rows that would violate the new CHECK constraints")
  if (oldTables.includes("stock")) {
    const { rows } = await client.query(
      `SELECT id, "productId", "warehouseId", quantity, "reservedQuantity"
         FROM public.stock
        WHERE quantity < 0 OR "reservedQuantity" < 0 OR "reservedQuantity" > quantity
        ORDER BY id`
    )
    if (rows.length > 0) {
      console.log(`${rows.length} stock row(s) violate "quantity >= 0" / "0 <= reservedQuantity <= quantity":`)
      printRows(rows)
      throw new Stop("STOPPED: fix these stock rows first (e.g. a stock adjustment in the old app, or an UPDATE with a documented reason), then run again. Nothing changed.")
    }
  }
  console.log("OK: no violations.")

  section("Pre-flight: money values")
  const outOfRange = []
  const rounding = []
  for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
    if (!oldTables.includes(table)) continue
    const present = new Set((await tableColumns(client, "public", table)).map((c) => c.name))
    for (const col of cols) {
      if (!present.has(col)) continue
      const c = q(col)
      const { rows: bad } = await client.query(
        `SELECT id, ${c}::text AS value FROM public.${q(table)}
          WHERE ${c} IS NOT NULL
            AND (${c}::float8 = 'NaN'::float8 OR ${c}::float8 IN ('Infinity'::float8, '-Infinity'::float8)
                 OR abs(${c}::float8) > 9999999999.99)`
      )
      for (const r of bad) outOfRange.push({ table, column: col, ...r })
      const { rows: [agg] } = await client.query(
        `SELECT count(*)::int AS n,
                max(abs(${c}::numeric - round(${c}::numeric, 2)))::text AS max_delta,
                (array_agg(id ORDER BY id))[1:3] AS sample_ids
           FROM public.${q(table)}
          WHERE ${c} IS NOT NULL AND abs(${c}::float8) <= 9999999999.99
            AND ${c}::numeric <> round(${c}::numeric, 2)`
      )
      if (agg.n > 0) rounding.push({ table, column: col, rows: agg.n, maxChange: agg.max_delta, sampleIds: agg.sample_ids })
    }
  }
  if (outOfRange.length > 0) {
    console.log("Values that cannot be stored as NUMERIC(12,2):")
    printRows(outOfRange)
    throw new Stop("STOPPED: correct these values first. Nothing changed.")
  }
  if (rounding.length > 0) {
    console.log("REPORT: values with more than 2 decimals; they will be rounded half-up to cents (each change < 0.005):")
    printRows(rounding)
  } else {
    console.log("OK: all money values already have at most 2 decimals.")
  }
  return rounding
}

// --- 3. New schema ----------------------------------------------------------
async function createNewSchema(client, migration) {
  section(`Creating the new schema from ${migration.name}/migration.sql`)
  await client.query(`ALTER SCHEMA public RENAME TO ${q(OLD_SCHEMA)}`)
  await client.query(`CREATE SCHEMA public`)
  await client.query(`GRANT USAGE ON SCHEMA public TO PUBLIC`)
  await client.query(`SET LOCAL search_path TO public`)
  await client.query(migration.sql)
  console.log(`OK: ${(await tablesIn(client, "public")).length} tables created (indexes, foreign keys and CHECK constraints included).`)
}

// --- 4. Copy ------------------------------------------------------------------
async function copyData(client, oldTables) {
  section("Copying data")
  const newTables = await tablesIn(client, "public")
  const missingInNew = oldTables.filter((t) => !newTables.includes(t))
  if (missingInNew.length > 0) throw new Stop(`STOPPED: old tables with no place in the new schema: ${missingInNew.join(", ")}. Nothing changed.`)
  const notOrdered = newTables.filter((t) => !TABLE_ORDER.includes(t))
  if (notOrdered.length > 0) throw new Stop(`STOPPED: new tables unknown to this script: ${notOrdered.join(", ")}. Nothing changed.`)

  const plans = []
  for (const table of TABLE_ORDER) {
    if (!oldTables.includes(table)) {
      console.log(`  ${table}: not present in the old database - left empty`)
      continue
    }
    const oldCols = await tableColumns(client, OLD_SCHEMA, table)
    const newCols = await tableColumns(client, "public", table)
    const oldNames = new Set(oldCols.map((c) => c.name))
    const newNames = new Set(newCols.map((c) => c.name))
    const dropped = DROPPED_COLUMNS[table] ?? []
    const computed = COMPUTED_COLUMNS[table] ?? []

    const lost = oldCols.map((c) => c.name).filter((n) => !newNames.has(n) && !dropped.includes(n))
    if (lost.length > 0) throw new Stop(`STOPPED: ${table} has old columns that would be lost: ${lost.join(", ")}. Nothing changed.`)

    const copied = []
    for (const col of newCols) {
      if (computed.includes(col.name)) continue
      if (!oldNames.has(col.name)) {
        if (col.not_null && !col.has_default) {
          throw new Stop(`STOPPED: ${table}.${col.name} is required in the new schema but missing in the old one. Nothing changed.`)
        }
        console.log(`  ${table}.${col.name}: not in the old database - filled with its default/NULL`)
        continue
      }
      const source = col.is_enum ? `o.${q(col.name)}::text` : `o.${q(col.name)}`
      copied.push({ name: col.name, expr: `CAST(${source} AS ${col.type})` })
    }

    const colList = copied.map((c) => q(c.name)).join(", ")
    const { rowCount } = await client.query(
      `INSERT INTO public.${q(table)} (${colList}) SELECT ${copied.map((c) => c.expr).join(", ")} FROM ${q(OLD_SCHEMA)}.${q(table)} o`
    )
    console.log(`  ${table}: ${rowCount} rows`)
    plans.push({ table, copied })
  }
  return plans
}

// --- 4b. Passwords ------------------------------------------------------------
async function hashPasswords(client) {
  section("Hashing passwords (bcrypt, cost 12)")
  const { rows } = await client.query(`SELECT id, username, password FROM ${q(OLD_SCHEMA)}.users ORDER BY "createdAt", id`)
  const noPassword = []
  const alreadyHashed = []
  const samples = []
  let hashed = 0
  for (const user of rows) {
    let hash = null
    if (user.password == null || user.password === "") {
      noPassword.push(user.username)
    } else if (BCRYPT_RE.test(user.password)) {
      hash = user.password
      alreadyHashed.push(user.username)
    } else {
      hash = await bcrypt.hash(user.password, BCRYPT_COST)
      hashed++
      if (samples.length < 3) samples.push({ plain: user.password, hash })
    }
    if (hash) await client.query(`UPDATE public.users SET "passwordHash" = $1 WHERE id = $2`, [hash, user.id])
  }
  for (const s of samples) {
    if (!(await bcrypt.compare(s.plain, s.hash))) throw new Error("bcrypt self-check failed")
  }
  console.log(`  ${hashed} password(s) hashed, bcrypt self-check passed.`)
  if (alreadyHashed.length) console.log(`  ${alreadyHashed.length} user(s) already had a bcrypt hash (kept): ${alreadyHashed.join(", ")}`)
  if (noPassword.length) {
    console.log(`  REPORT: ${noPassword.length} user(s) have no password and cannot log in until an admin sets one: ${noPassword.join(", ")}`)
  }
  return { hashed, noPassword, alreadyHashed }
}

// --- 5. Verification ------------------------------------------------------------
async function verify(client, plans) {
  section("Verifying copied data")
  for (const { table, copied } of plans) {
    const oldSide = copied.map((c) => `(${c.expr})::text`).join(", ")
    const newSide = copied.map((c) => `n.${q(c.name)}::text`).join(", ")
    const { rows: [counts] } = await client.query(
      `SELECT (SELECT count(*) FROM ${q(OLD_SCHEMA)}.${q(table)})::int AS old_count,
              (SELECT count(*) FROM public.${q(table)})::int AS new_count`
    )
    const { rows: [diff] } = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT ${oldSide} FROM ${q(OLD_SCHEMA)}.${q(table)} o
         EXCEPT ALL
         SELECT ${newSide} FROM public.${q(table)} n
       ) d`
    )
    if (counts.old_count !== counts.new_count || diff.n !== 0) {
      throw new Error(`verification failed for ${table}: old=${counts.old_count} new=${counts.new_count} differing=${diff.n}`)
    }
  }
  const { rows: [users] } = await client.query(
    `SELECT (SELECT count(*) FROM ${q(OLD_SCHEMA)}.users WHERE password IS NOT NULL AND password <> '')::int AS with_password,
            (SELECT count(*) FROM public.users WHERE "passwordHash" IS NOT NULL)::int AS with_hash`
  )
  if (users.with_password !== users.with_hash) {
    throw new Error(`verification failed: ${users.with_password} users had a password but ${users.with_hash} have a hash`)
  }
  console.log(`OK: ${plans.length} tables - identical row counts and identical values (money compared after rounding to cents).`)
}

// --- 6. Balances ------------------------------------------------------------------
async function balanceReport(client) {
  section("Stored balances vs calculated balances")
  const mismatches = []
  const checks = [
    { party: "supplier", table: "suppliers", orders: "purchase_orders", payments: "supplier_payments", fk: "supplierId" },
    { party: "customer", table: "customers", orders: "sales_orders", payments: "customer_payments", fk: "customerId" },
  ]
  for (const c of checks) {
    const hasBalance = (await tableColumns(client, OLD_SCHEMA, c.table)).some((col) => col.name === "balance")
    if (!hasBalance) {
      console.log(`  ${c.table}: no stored balance column in the old database - nothing to compare`)
      continue
    }
    const { rows } = await client.query(
      `WITH o AS (SELECT ${q(c.fk)} AS id, SUM(total) AS s FROM public.${q(c.orders)} WHERE status <> 'CANCELLED' GROUP BY 1),
            p AS (SELECT ${q(c.fk)} AS id, SUM(amount) AS s FROM public.${q(c.payments)} GROUP BY 1)
       SELECT x.id, x.name,
              round(old.balance::numeric, 2)::text AS stored,
              (COALESCE(o.s, 0) - COALESCE(p.s, 0))::text AS calculated,
              (COALESCE(o.s, 0) - COALESCE(p.s, 0) - round(COALESCE(old.balance, 0)::numeric, 2))::text AS difference
         FROM public.${q(c.table)} x
         JOIN ${q(OLD_SCHEMA)}.${q(c.table)} old ON old.id = x.id
         LEFT JOIN o ON o.id = x.id
         LEFT JOIN p ON p.id = x.id
        WHERE abs(COALESCE(o.s, 0) - COALESCE(p.s, 0) - round(COALESCE(old.balance, 0)::numeric, 2)) >= 0.01
        ORDER BY x.name`
    )
    for (const r of rows) mismatches.push({ party: c.party, ...r })
  }
  if (mismatches.length > 0) {
    console.log(`REPORT: ${mismatches.length} stored balance(s) differ from the calculated value.`)
    console.log("        The app now always shows the calculated value (orders not CANCELLED minus payments):")
    printRows(mismatches)
  } else {
    console.log("OK: every stored balance equals the calculated balance.")
  }
  return mismatches
}

// --- 7. Baseline --------------------------------------------------------------
async function baseline(client, migration) {
  section("Baselining for Prisma Migrate")
  await client.query(`DROP SCHEMA ${q(OLD_SCHEMA)} CASCADE`)
  // Same definition Prisma Migrate uses for its history table.
  await client.query(`
    CREATE TABLE "_prisma_migrations" (
      "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum"            VARCHAR(64) NOT NULL,
      "finished_at"         TIMESTAMPTZ,
      "migration_name"      VARCHAR(255) NOT NULL,
      "logs"                TEXT,
      "rolled_back_at"      TIMESTAMPTZ,
      "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`)
  await client.query(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, $1, now(), $2, NULL, NULL, now(), 1)`,
    [migration.checksum, migration.name]
  )
  console.log(`OK: old schema dropped; ${migration.name} recorded as applied (checksum ${migration.checksum.slice(0, 12)}...).`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Stop("DATABASE_URL is not set.")
  const migration = findInitMigration()

  const client = new pg.Client({ connectionString })
  await client.connect()
  let inTransaction = false
  try {
    const { rows: [info] } = await client.query(`SELECT current_database() AS db, current_setting('server_version') AS version`)
    console.log(`Database: ${info.db} (PostgreSQL ${info.version})${DRY_RUN ? "   *** DRY RUN - everything is rolled back at the end ***" : ""}`)

    await client.query("BEGIN")
    inTransaction = true
    await client.query("SET LOCAL lock_timeout = '15s'")

    const oldTables = await guards(client)
    await preflight(client, oldTables)
    await createNewSchema(client, migration)
    const plans = await copyData(client, oldTables)
    const passwords = await hashPasswords(client)
    await verify(client, plans)
    const mismatches = await balanceReport(client)
    await baseline(client, migration)

    if (DRY_RUN) {
      await client.query("ROLLBACK")
      inTransaction = false
      section("DRY RUN COMPLETE - all steps succeeded, everything rolled back, nothing changed")
    } else {
      await client.query("COMMIT")
      inTransaction = false
      section("TRANSITION COMMITTED")
      console.log("Next: `prisma migrate deploy` must report \"No pending migrations to apply.\" (deploy.sh does this).")
    }
    console.log(`Summary: ${plans.length} tables copied, ${passwords.hashed} passwords hashed, ${passwords.noPassword.length} users without password, ${mismatches.length} balance mismatch(es) reported.`)
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  if (error instanceof Stop) {
    console.error(`\n${error.message}`)
    process.exit(2)
  }
  console.error("\nFAILED - the transaction was rolled back, nothing changed.")
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
