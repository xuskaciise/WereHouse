// Settings "Reset System Data" (lib/system-reset.ts) on the DEV database:
// deletes all business data, keeps every user (role + password), permissions,
// settings and the chart of accounts, re-seeds the defaults and leaves a
// backup schema. WIPES the dev business data.
import { prisma } from "@/lib/prisma"
import { RESET_DELETE_TABLES } from "@/lib/reset-tables"
import { backupBeforeReset, resetSystemData } from "@/lib/system-reset"
import { assertDevDatabase, check, finish, fixtures, receivedPurchase, testUser } from "./helpers"

async function count(table: string, schema?: string) {
  const name = schema ? `"${schema}"."${table}"` : `"${table}"`
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${name}`)
  return Number(rows[0].n)
}

async function main() {
  assertDevDatabase()
  const tag = "rs" + Date.now().toString(36)
  const admin = await testUser("reset_admin", "ADMIN")
  const student = await testUser("reset_student", "STUDENT")
  const f = await fixtures(tag, admin)
  const p = await f.product("A", 150, 100)
  await prisma.user.update({ where: { id: student.id }, data: { defaultWarehouseId: f.wh.id, defaultWarehouseLocked: true } })
  await receivedPurchase(admin, { supplierId: f.supplier.id, warehouseId: f.wh.id, orderNumber: `PO-${tag}` }, [[p.id, 5, 100]])
  await prisma.landedCostType.upsert({ where: { nameKey: `extra ${tag}` }, update: {}, create: { name: `Extra ${tag}`, nameKey: `extra ${tag}` } })

  const usersBefore = await prisma.user.findMany({ select: { id: true, role: true, passwordHash: true }, orderBy: { id: "asc" } })
  const keptBefore = {
    role_permissions: await count("role_permissions"),
    permission_change_logs: await count("permission_change_logs"),
    settings: await count("settings"),
    accounts: await count("accounts"),
  }
  const productsBefore = await count("products")
  check("dev has business data before the reset", productsBefore > 0 && (await count("warehouses")) > 0, productsBefore)

  const backup = await backupBeforeReset()
  check("backup schema created", typeof backup === "string" && /^reset_backup_\d{17}$/.test(backup), backup)
  if (backup) {
    check("backup holds the products", (await count("products", backup)) === productsBefore)
    check("backup holds every deleted table", (
      await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = ${backup}`
    )[0].n === BigInt(RESET_DELETE_TABLES.length + 1))
  }

  const counts = await resetSystemData(admin.id)
  const byTable = Object.fromEntries(counts.map((c) => [c.table, c]))
  check("counts returned for all tables", counts.length === 46, counts.length)
  check("before counts reported", byTable.products.before === productsBefore, byTable.products)

  for (const table of RESET_DELETE_TABLES) {
    const n = await count(table)
    const expected = table === "expense_categories" ? 9 : 0
    if (n !== expected) check(`${table} emptied`, false, n)
  }
  check("all deleted tables empty (expense categories = 9 defaults)", true)

  const usersAfter = await prisma.user.findMany({ select: { id: true, role: true, passwordHash: true, defaultWarehouseId: true }, orderBy: { id: "asc" } })
  check("every user kept", usersAfter.length === usersBefore.length, [usersBefore.length, usersAfter.length])
  check("roles and passwords unchanged", usersBefore.every((u, i) => usersAfter[i]?.id === u.id && usersAfter[i].role === u.role && usersAfter[i].passwordHash === u.passwordHash))
  check("default warehouses cleared", usersAfter.every((u) => u.defaultWarehouseId === null))
  for (const [table, n] of Object.entries(keptBefore)) {
    const after = await count(table)
    check(`${table} kept`, table === "accounts" ? after >= n : after === n, [n, after])
  }

  const types = await prisma.landedCostType.findMany({ orderBy: { sortOrder: "asc" } })
  check("landed cost types = 5 defaults", types.map((t) => t.id).join() === "lct_shipment,lct_customs_clearance,lct_transportation,lct_commission,lct_other", types.map((t) => t.name))
  const cats = await prisma.expenseCategory.findMany({ include: { account: true } })
  check("9 expense categories, each linked to an expense account", cats.length === 9 && cats.every((c) => c.account?.type === "EXPENSE"), cats.map((c) => [c.name, c.account?.code]))

  const [tb] = await prisma.$queryRaw<{ d: string; c: string }[]>`SELECT COALESCE(sum(debit),0)::text AS d, COALESCE(sum(credit),0)::text AS c FROM journal_lines`
  check("trial balance empty and balanced", tb.d === "0" && tb.c === "0", tb)

  const second = await backupBeforeReset()
  const third = await backupBeforeReset()
  const schemas = await prisma.$queryRaw<{ n: string }[]>`SELECT nspname AS n FROM pg_namespace WHERE nspname LIKE 'reset\_backup\_%' ORDER BY 1`
  check("only the 2 newest backups are kept", schemas.length === 2 && schemas.some((s) => s.n === third), [second, third, schemas])

  finish()
}

main().finally(() => prisma.$disconnect())
