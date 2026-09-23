#!/usr/bin/env node
/**
 * REHEARSAL: database-level checks after the transition of the data created by
 * seed-old-schema.mjs. Expected values are worked out by hand from the seed
 * (old float values rounded half-up to cents).
 */
import bcrypt from "bcryptjs"
import pg from "pg"

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
let failures = 0
const check = (name, ok, got = "") => {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`)
}
const one = async (sql, params) => (await c.query(sql, params)).rows[0]

// Migration history / structure
const mig = (await c.query(`SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations`)).rows
check("exactly one baselined migration (*_init, finished)", mig.length === 1 && /_init$/.test(mig[0].migration_name) && mig[0].finished_at && !mig[0].rolled_back_at, mig)
const cons = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.stock'::regclass AND contype = 'c' ORDER BY 1`)).rows.map((r) => r.conname)
check("stock CHECK constraints present", cons.includes("stock_quantity_non_negative") && cons.includes("stock_reserved_valid"), cons)
const oldSchema = await one(`SELECT to_regnamespace('transition_old') AS s`)
check("temporary old schema removed", !oldSchema.s, oldSchema)
const cols = (await c.query(`SELECT table_name || '.' || column_name AS c, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public'`)).rows
check("no password or balance columns left", !cols.some((r) => ["users.password", "suppliers.balance", "customers.balance"].includes(r.c)))
const money = cols.filter((r) => ["products.costPrice", "purchase_orders.total", "expenses.amount", "customer_payments.amount"].includes(r.c))
check("money columns are numeric(12,2)", money.length === 4 && money.every((r) => r.data_type === "numeric" && r.numeric_precision === 12 && r.numeric_scale === 2), money)

// Users and passwords
const passwords = {
  admin: "OldAdmin#2024", manager: "manager123", sales: "sales-pass", accountant: "acc 2024!",
  131313: "student1", 141414: "pending1", 151515: "rejected1",
}
const users = (await c.query(`SELECT username, role::text, status::text, "passwordHash" FROM users ORDER BY username`)).rows
check("8 users kept", users.length === 8, users.length)
for (const [username, plain] of Object.entries(passwords)) {
  const u = users.find((x) => x.username === String(username))
  check(`bcrypt hash for ${username} matches the old password`, !!u?.passwordHash && (await bcrypt.compare(plain, u.passwordHash)), u?.passwordHash?.slice(0, 7))
}
check("legacy user without password has no hash", users.find((u) => u.username === "legacy")?.passwordHash === null)
check("roles/status preserved", users.find((u) => u.username === "141414")?.status === "PENDING" && users.find((u) => u.username === "151515")?.status === "REJECTED" && users.find((u) => u.username === "manager")?.role === "WAREHOUSE_MANAGER")

// Money: old floats rounded half-up to cents
const expectMoney = [
  ["purchase_orders", "po1", { subtotal: "2320.50", tax: "185.64", total: "2506.14" }],
  ["purchase_orders", "po2", { subtotal: "242.40", tax: "19.39", total: "261.79" }],
  ["purchase_orders", "po3", { subtotal: "900.20", tax: "72.02", total: "972.22" }],
  ["sales_orders", "so1", { subtotal: "12.00", tax: "0.60", total: "12.60" }],
  ["sales_orders", "so2", { subtotal: "599.99", tax: "30.00", total: "629.99" }],
  ["products", "p_laptop", { costPrice: "450.10", sellingPrice: "599.99" }],
  ["products", "p_pen", { costPrice: "0.35", sellingPrice: "0.60" }],
  ["purchase_order_items", "po2_i0", { unitPrice: "20.20", subtotal: "242.40" }],
  ["supplier_payments", "sp2", { amount: "100.50" }],
  ["customer_payments", "cp1", { amount: "12.60" }],
  ["expenses", "ex1", { amount: "45.75" }],
  ["expenses", "ex2", { amount: "12.35" }],
]
for (const [table, id, expected] of expectMoney) {
  const row = await one(`SELECT ${Object.keys(expected).map((k) => `"${k}"::text AS "${k}"`).join(", ")} FROM "${table}" WHERE id = $1`, [id])
  check(`${table} ${id} money`, JSON.stringify(row) === JSON.stringify(expected), row)
}

// Stock unchanged
const stock = (await c.query(`SELECT id, quantity, "reservedQuantity" FROM stock ORDER BY id`)).rows
check("stock quantities unchanged", JSON.stringify(stock) === JSON.stringify([
  { id: "st1", quantity: 4, reservedQuantity: 1 },
  { id: "st2", quantity: 180, reservedQuantity: 0 },
  { id: "st3", quantity: 12, reservedQuantity: 0 },
]), stock)

// Calculated balances (same rule as lib/balances.ts)
const supplierBalances = Object.fromEntries((await c.query(
  `SELECT s.id, (COALESCE((SELECT SUM(total) FROM purchase_orders WHERE "supplierId" = s.id AND status <> 'CANCELLED'), 0)
               - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE "supplierId" = s.id), 0))::text AS b FROM suppliers s`
)).rows.map((r) => [r.id, r.b]))
check("supplier balances", supplierBalances.s_acme === "1506.14" && supplierBalances.s_books === "161.29" && supplierBalances.s_idle === "0", supplierBalances)
const customerBalances = Object.fromEntries((await c.query(
  `SELECT k.id, (COALESCE((SELECT SUM(total) FROM sales_orders WHERE "customerId" = k.id AND status <> 'CANCELLED'), 0)
               - COALESCE((SELECT SUM(amount) FROM customer_payments WHERE "customerId" = k.id), 0))::text AS b FROM customers k`
)).rows.map((r) => [r.id, r.b]))
check("customer balances", customerBalances.k_uni === "0.00" && customerBalances.k_shop === "429.99", customerBalances)

await c.end()
console.log(failures ? `\n${failures} FAILED` : "\nALL DB CHECKS PASSED")
process.exit(failures ? 1 : 0)
