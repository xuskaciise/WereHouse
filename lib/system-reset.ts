import { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { RESET_DELETE_TABLES, RESET_KEEP_TABLES } from "@/lib/reset-tables"

// Settings "Reset System Data" (app/api/admin/system-reset): deletes all
// business data (RESET_DELETE_TABLES) and keeps every user (with role and
// password), role permissions + their log, settings and the chart of
// accounts. Re-seeds the default landed cost types and expense categories
// (same defaults as scripts/reset/reset-test-data.sql).
//
// Only hard-coded identifiers reach the SQL. No CASCADE: if a table outside
// the delete list references a listed one, the reset fails instead of
// silently wiping it.

const ALL_TABLES = [...RESET_KEEP_TABLES, ...RESET_DELETE_TABLES] as const
// Must not change during the reset.
const GUARDED_TABLES = ["users", "role_permissions", "permission_change_logs", "settings"] as const
// Restore copies of the deleted data (backupBeforeReset).
const BACKUP_TABLES = [...RESET_DELETE_TABLES, "landed_cost_types"] as const
const BACKUP_SCHEMA_PREFIX = "reset_backup_"
const BACKUPS_KEPT = 2
// Counting and truncating ~46 tables can take longer than a normal write.
const RESET_TX_OPTIONS = { ...TX_OPTIONS, timeout: Math.max(TX_OPTIONS.timeout, 120_000) }

type Db = Prisma.TransactionClient | typeof prisma

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

export type ResetCount = { table: string; before: number; after: number }
export type ResetResult = { backup: string | null; counts: ResetCount[] }

async function countRows(db: Db): Promise<Record<string, number>> {
  const sql = ALL_TABLES.map((t) => `SELECT '${t}' AS t, count(*) AS n FROM ${ident(t)}`).join(" UNION ALL ")
  const rows = await db.$queryRaw<{ t: string; n: bigint }[]>(Prisma.raw(sql))
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]))
}

/**
 * Copies the tables the reset deletes into a new schema reset_backup_<UTC
 * timestamp, ms> of the same database and drops all but the newest
 * BACKUPS_KEPT such schemas. Best effort: returns the schema name, or null
 * when the copy failed (the reset still runs). Restore by hand, e.g.
 * `INSERT INTO products SELECT * FROM reset_backup_….products`, parents first.
 */
export async function backupBeforeReset(): Promise<string | null> {
  const schema = BACKUP_SCHEMA_PREFIX + new Date().toISOString().replace(/\D/g, "").slice(0, 17)
  // One statement (atomic, one round trip).
  const copies = BACKUP_TABLES.map((t) => `CREATE TABLE ${ident(schema)}.${ident(t)} AS TABLE ${ident(t)};`).join("\n")
  try {
    await prisma.$executeRaw(Prisma.raw(`DO $backup$ BEGIN\nCREATE SCHEMA ${ident(schema)};\n${copies}\nEND $backup$`))
  } catch (error) {
    console.error("System reset: backup failed, continuing without it", error)
    return null
  }
  try {
    const old = await prisma.$queryRaw<{ name: string }[]>`
      SELECT nspname AS name FROM pg_namespace
      WHERE nspname LIKE ${BACKUP_SCHEMA_PREFIX + "%"} ORDER BY nspname DESC OFFSET ${BACKUPS_KEPT}`
    for (const { name } of old) {
      if (/^reset_backup_\d{17}$/.test(name)) await prisma.$executeRaw(Prisma.raw(`DROP SCHEMA ${ident(name)} CASCADE`))
    }
  } catch (error) {
    console.error("System reset: could not drop old backups", error)
  }
  return schema
}

/** Runs the reset in ONE transaction; any failed guard rolls everything back. */
export async function resetSystemData(adminUserId: string): Promise<ResetCount[]> {
  return prisma.$transaction(async (tx) => {
    // Nothing else may write while the reset runs.
    await tx.$executeRaw(Prisma.raw(`LOCK TABLE ${ALL_TABLES.map(ident).join(", ")} IN ACCESS EXCLUSIVE MODE`))
    const before = await countRows(tx)

    // Kept users point at warehouses that are deleted: clear their default first.
    await tx.$executeRaw`UPDATE "users" SET "defaultWarehouseId" = NULL, "defaultWarehouseLocked" = false WHERE "defaultWarehouseId" IS NOT NULL`
    // Postgres refuses to TRUNCATE a table that a kept table has a foreign key
    // to (users -> warehouses), even when no row uses it: those are emptied
    // with DELETE after the others are truncated.
    const referenced = new Set(
      (
        await tx.$queryRaw<{ t: string }[]>`
          SELECT DISTINCT confrelid::regclass::text AS t FROM pg_constraint
          WHERE contype = 'f' AND conrelid::regclass::text IN (${Prisma.join([...RESET_KEEP_TABLES])})`
      ).map((r) => r.t)
    )
    const truncated = RESET_DELETE_TABLES.filter((t) => !referenced.has(t))
    await tx.$executeRaw(Prisma.raw(`TRUNCATE TABLE ${truncated.map(ident).join(", ")} RESTART IDENTITY`))
    for (const table of RESET_DELETE_TABLES.filter((t) => referenced.has(t))) {
      await tx.$executeRaw(Prisma.raw(`DELETE FROM ${ident(table)}`))
    }

    // Landed cost types: back to the defaults of the landed_costs migration.
    await tx.$executeRaw`DELETE FROM landed_cost_types
      WHERE id NOT IN ('lct_shipment', 'lct_customs_clearance', 'lct_transportation', 'lct_commission', 'lct_other')`
    await tx.$executeRaw`INSERT INTO landed_cost_types (id, name, "nameKey", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
        ('lct_shipment', 'Shipment', 'shipment', true, 1, now(), now()),
        ('lct_customs_clearance', 'Customs & Clearance', 'customs & clearance', true, 2, now(), now()),
        ('lct_transportation', 'Transportation', 'transportation', true, 3, now(), now()),
        ('lct_commission', 'Commission', 'commission', true, 4, now(), now()),
        ('lct_other', 'Other', 'other', true, 5, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "nameKey" = EXCLUDED."nameKey",
        "isActive" = true, "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now()`

    // Default expense categories (editable on the Expense Categories page).
    await tx.$executeRaw`INSERT INTO expense_categories (id, name, "nameKey", description, "isActive", "userId", "createdAt", "updatedAt") VALUES
        ('ec_rent', 'Rent', 'rent', 'Warehouse, shop and office rent', true, ${adminUserId}, now(), now()),
        ('ec_salaries', 'Salaries & Wages', 'salaries & wages', 'Staff salaries, wages and allowances', true, ${adminUserId}, now(), now()),
        ('ec_utilities', 'Utilities', 'utilities', 'Electricity and water', true, ${adminUserId}, now(), now()),
        ('ec_internet_phone', 'Internet & Phone', 'internet & phone', 'Internet, airtime and phone bills', true, ${adminUserId}, now(), now()),
        ('ec_transport', 'Transport & Fuel', 'transport & fuel', 'Local transport, delivery and fuel (not purchase landed costs)', true, ${adminUserId}, now(), now()),
        ('ec_repairs', 'Repairs & Maintenance', 'repairs & maintenance', 'Repairs of buildings, vehicles and equipment', true, ${adminUserId}, now(), now()),
        ('ec_office', 'Office Supplies', 'office supplies', 'Stationery, printing and cleaning supplies', true, ${adminUserId}, now(), now()),
        ('ec_fees', 'Bank & Mobile Money Fees', 'bank & mobile money fees', 'Bank charges and EVC Plus / ZAAD / E-Dahab fees', true, ${adminUserId}, now(), now()),
        ('ec_other', 'Other', 'other', 'Anything that fits no other category', true, ${adminUserId}, now(), now())`

    // Chart of accounts: kept as it is. Each default category is linked to
    // the expense account with its name; a missing one is created with the
    // next free code 6001-6899.
    await tx.$executeRaw`UPDATE expense_categories c SET "accountId" = (
        SELECT a.id FROM accounts a
        WHERE a.type = 'EXPENSE' AND a."isActive" AND lower(trim(a.name)) = c."nameKey"
        ORDER BY a.code LIMIT 1)`
    await tx.$executeRaw`INSERT INTO accounts (id, code, name, type, "group", "updatedAt")
      SELECT 'acc_exp_' || c.id,
             ((SELECT COALESCE(MAX(code::int), 6000) FROM accounts WHERE code ~ '^6[0-8][0-9][0-9]$') + row_number() OVER (ORDER BY c.name))::text,
             c.name, 'EXPENSE', 'OPERATING_EXPENSE', now()
      FROM expense_categories c WHERE c."accountId" IS NULL`
    await tx.$executeRaw`UPDATE expense_categories c SET "accountId" = 'acc_exp_' || c.id WHERE c."accountId" IS NULL`

    const after = await countRows(tx)
    for (const table of GUARDED_TABLES) {
      if (after[table] !== before[table]) {
        throw new Error(`System reset guard: ${table} changed (${before[table]} -> ${after[table]}) - rolled back`)
      }
    }
    if (after.accounts < before.accounts) throw new Error("System reset guard: accounts were deleted - rolled back")

    return ALL_TABLES.map((table) => ({ table, before: before[table], after: after[table] }))
  }, RESET_TX_OPTIONS)
}
