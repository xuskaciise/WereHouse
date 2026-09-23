#!/usr/bin/env node
/**
 * REHEARSAL: independent before/after check of the transition.
 *
 *   node snapshot.mjs save <file.json>          # dump every table (normalised)
 *   node snapshot.mjs compare <before> <after>  # exit 1 on any difference
 *
 * Normalisation: money columns are compared as NUMERIC(12,2) text (i.e. after
 * rounding to cents), everything else as text. Columns that the transition
 * intentionally changes (users.password/passwordHash, stored balances) are
 * excluded; they are checked by verify-db.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs"
import pg from "pg"

const MONEY = new Set([
  "products.costPrice", "products.sellingPrice",
  "purchase_orders.subtotal", "purchase_orders.tax", "purchase_orders.discount", "purchase_orders.total",
  "purchase_order_items.unitPrice", "purchase_order_items.subtotal",
  "supplier_payments.amount",
  "sales_orders.subtotal", "sales_orders.tax", "sales_orders.discount", "sales_orders.total",
  "sales_order_items.unitPrice", "sales_order_items.subtotal",
  "customer_payments.amount", "expenses.amount",
])
const EXCLUDED = new Set(["users.password", "users.passwordHash", "suppliers.balance", "customers.balance"])

async function save(file) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const { rows: tables } = await c.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY 1`
  )
  const snapshot = {}
  for (const { table_name: t } of tables) {
    const { rows: cols } = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
      [t]
    )
    const exprs = cols
      .map((col) => col.column_name)
      .filter((col) => !EXCLUDED.has(`${t}.${col}`))
      .map((col) =>
        MONEY.has(`${t}.${col}`)
          ? `CAST("${col}" AS numeric(12,2))::text AS "${col}"`
          : `"${col}"::text AS "${col}"`
      )
    const { rows } = await c.query(`SELECT ${exprs.join(", ")} FROM public."${t}" ORDER BY id`)
    snapshot[t] = rows
  }
  await c.end()
  writeFileSync(file, JSON.stringify(snapshot, null, 2))
  console.log(`Saved ${Object.keys(snapshot).length} tables, ${Object.values(snapshot).reduce((n, r) => n + r.length, 0)} rows -> ${file}`)
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8"))
  const after = JSON.parse(readFileSync(afterFile, "utf8"))
  const problems = []
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[table] ?? []
    const b = after[table] ?? []
    if (a.length !== b.length) problems.push(`${table}: ${a.length} rows before, ${b.length} after`)
    const byId = new Map(b.map((r) => [r.id, r]))
    for (const row of a) {
      const other = byId.get(row.id)
      if (!other) { problems.push(`${table} ${row.id}: missing after`); continue }
      for (const [col, value] of Object.entries(row)) {
        if (other[col] !== value) problems.push(`${table} ${row.id}.${col}: ${value} -> ${other[col]}`)
      }
    }
  }
  if (problems.length) {
    console.log(`DIFFERENCES (${problems.length}):\n  ${problems.slice(0, 100).join("\n  ")}`)
    process.exit(1)
  }
  console.log(`IDENTICAL: ${Object.keys(before).length} tables, ${Object.values(before).reduce((n, r) => n + r.length, 0)} rows (money compared in cents).`)
}

const [mode, x, y] = process.argv.slice(2)
if (mode === "save" && x) await save(x)
else if (mode === "compare" && x && y) compare(x, y)
else {
  console.error("usage: snapshot.mjs save <file> | compare <before> <after>")
  process.exit(2)
}
