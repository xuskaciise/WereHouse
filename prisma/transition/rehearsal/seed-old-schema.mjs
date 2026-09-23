#!/usr/bin/env node
/**
 * REHEARSAL ONLY: fills an EMPTY staging database that has the OLD (db push)
 * schema with realistic data, the way the old application stored it:
 * plaintext passwords, JavaScript-float money (e.g. tax = subtotal * 0.08),
 * stored supplier/customer balances (one of each deliberately wrong).
 *
 * Usage: DATABASE_URL=<staging> node seed-old-schema.mjs --staging
 * Refuses to run on a database that already has users or migration history.
 */
import pg from "pg"

if (!process.argv.includes("--staging")) {
  console.error("Refusing to run without --staging (this script is for rehearsal databases only).")
  process.exit(2)
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const { rows: [state] } = await c.query(
  `SELECT to_regclass('public._prisma_migrations') AS pm, to_regclass('public.users') AS users`
)
if (state.pm || !state.users) {
  console.error("Refusing: expected the OLD schema (users table, no _prisma_migrations).")
  process.exit(2)
}
const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM public.users`)
if (n > 0) {
  console.error("Refusing: users table is not empty.")
  process.exit(2)
}

const now = new Date()
const daysAgo = (d) => new Date(now.getTime() - d * 86400000)

// Old-app arithmetic (JavaScript floats, no rounding).
const line = (quantity, unitPrice) => ({ quantity, unitPrice, subtotal: quantity * unitPrice })
const order = (lines, rate) => {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const tax = subtotal * rate
  return { subtotal, tax, discount: 0, total: subtotal + tax - 0 }
}

async function insert(table, row) {
  const cols = Object.keys(row)
  await c.query(
    `INSERT INTO public."${table}" (${cols.map((k) => `"${k}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row)
  )
}

await c.query("BEGIN")

// Users: plaintext passwords (as the old app stored them).
const users = [
  ["u_admin", "Amina Admin", "admin", "OldAdmin#2024", "ADMIN", "APPROVED"],
  ["u_mgr", "Mohamed Manager", "manager", "manager123", "WAREHOUSE_MANAGER", "APPROVED"],
  ["u_sales", "Sahra Sales", "sales", "sales-pass", "SALES_OFFICER", "APPROVED"],
  ["u_acc", "Abdi Accountant", "accountant", "acc 2024!", "ACCOUNTANT", "APPROVED"],
  ["u_stu", "Student One", "131313", "student1", "STUDENT", "APPROVED"],
  ["u_pend", "Student Pending", "141414", "pending1", "STUDENT", "PENDING"],
  ["u_rej", "Student Rejected", "151515", "rejected1", "STUDENT", "REJECTED"],
  ["u_legacy", "Legacy No Password", "legacy", null, "STUDENT", "APPROVED"],
]
for (const [id, name, username, password, role, status] of users) {
  await insert("users", { id, name, username, password, role, status, createdAt: daysAgo(200), updatedAt: daysAgo(30) })
}

await insert("settings", { id: "set1", key: "companyName", value: "SIU Warehouse", createdAt: now, updatedAt: now })
await insert("settings", { id: "set2", key: "defaultCurrency", value: "USD", createdAt: now, updatedAt: now })

await insert("categories", { id: "cat_el", name: "Electronics", description: "Devices", userId: "u_admin", createdAt: daysAgo(190), updatedAt: daysAgo(190) })
await insert("categories", { id: "cat_bk", name: "Textbooks", description: null, userId: "u_mgr", createdAt: daysAgo(189), updatedAt: daysAgo(189) })
await insert("expense_categories", { id: "ec_util", name: "Utilities", description: "Power & water", userId: "u_acc", createdAt: daysAgo(180), updatedAt: daysAgo(180) })

await insert("warehouses", { id: "wh_main", name: "Main Store", code: "WH-001", city: "Mogadishu", country: "Somalia", capacity: 5000, userId: "u_admin", createdAt: daysAgo(185), updatedAt: daysAgo(185) })
await insert("warehouses", { id: "wh_annex", name: "Annex", code: "WH-002", city: "Hargeisa", country: "Somalia", capacity: 800, userId: "u_mgr", createdAt: daysAgo(184), updatedAt: daysAgo(184) })

await insert("products", { id: "p_laptop", name: "Laptop 14\"", sku: "EL-001", categoryId: "cat_el", costPrice: 450.1, sellingPrice: 599.99, reorderLevel: 2, issueDate: daysAgo(100), expireDate: new Date(now.getTime() + 900 * 86400000), userId: "u_admin", createdAt: daysAgo(170), updatedAt: daysAgo(20) })
await insert("products", { id: "p_pen", name: "Pen (blue)", sku: "ST-010", categoryId: "cat_el", costPrice: 0.35, sellingPrice: 0.6, reorderLevel: 50, userId: "u_admin", createdAt: daysAgo(169), updatedAt: daysAgo(169) })
await insert("products", { id: "p_book", name: "Business Ethics 10th Ed", sku: "BK-042", categoryId: "cat_bk", costPrice: 20.2, sellingPrice: 35.5, reorderLevel: 5, userId: "u_mgr", createdAt: daysAgo(168), updatedAt: daysAgo(168) })

// Suppliers / customers (stored balances filled in below).
await insert("suppliers", { id: "s_acme", name: "Acme Electronics", email: "sales@acme.example", phone: "+252 61 000 0001", contactPerson: "Ali", balance: 0, userId: "u_admin", createdAt: daysAgo(160), updatedAt: daysAgo(10) })
await insert("suppliers", { id: "s_books", name: "BookCo", email: "orders@bookco.example", balance: 0, userId: "u_mgr", createdAt: daysAgo(159), updatedAt: daysAgo(10) })
await insert("suppliers", { id: "s_idle", name: "Idle Supplier", email: "idle@example.com", balance: 0, userId: "u_admin", createdAt: daysAgo(158), updatedAt: daysAgo(158) })
await insert("customers", { id: "k_uni", name: "University Library", email: "lib@uni.example", balance: 0, userId: "u_sales", createdAt: daysAgo(150), updatedAt: daysAgo(5) })
await insert("customers", { id: "k_shop", name: "Campus Shop", email: "shop@uni.example", balance: 0, userId: "u_sales", createdAt: daysAgo(149), updatedAt: daysAgo(5) })

// Purchase orders (8% tax computed like the old code).
const po1Lines = [line(5, 450.1), line(200, 0.35)]
const po1 = order(po1Lines, 0.08)
const po2Lines = [line(12, 20.2)]
const po2 = order(po2Lines, 0.08)
const po3Lines = [line(2, 450.1)]
const po3 = order(po3Lines, 0.08)

async function purchaseOrder(id, number, supplierId, warehouseId, lines, totals, status, userId, day, products) {
  await insert("purchase_orders", { id, orderNumber: number, supplierId, warehouseId, orderDate: daysAgo(day), status, ...totals, userId, createdAt: daysAgo(day), updatedAt: daysAgo(day) })
  for (let i = 0; i < lines.length; i++) {
    await insert("purchase_order_items", { id: `${id}_i${i}`, purchaseOrderId: id, productId: products[i], ...lines[i], createdAt: daysAgo(day) })
  }
}
await purchaseOrder("po1", "PO-000001", "s_acme", "wh_main", po1Lines, po1, "CONFIRMED", "u_mgr", 90, ["p_laptop", "p_pen"])
await purchaseOrder("po2", "PO-000002", "s_books", "wh_annex", po2Lines, po2, "CONFIRMED", "u_mgr", 80, ["p_book"])
await purchaseOrder("po3", "PO-000003", "s_acme", "wh_main", po3Lines, po3, "CANCELLED", "u_admin", 70, ["p_laptop"])

// Receives (full) + stock movements IN.
await insert("purchase_receives", { id: "rcv1", purchaseOrderId: "po1", userId: "u_mgr", notes: "All received", createdAt: daysAgo(88) })
await insert("purchase_receive_items", { id: "rcv1_a", purchaseReceiveId: "rcv1", purchaseOrderItemId: "po1_i0", quantityReceived: 5 })
await insert("purchase_receive_items", { id: "rcv1_b", purchaseReceiveId: "rcv1", purchaseOrderItemId: "po1_i1", quantityReceived: 200 })
await insert("purchase_receives", { id: "rcv2", purchaseOrderId: "po2", userId: "u_mgr", notes: null, createdAt: daysAgo(78) })
await insert("purchase_receive_items", { id: "rcv2_a", purchaseReceiveId: "rcv2", purchaseOrderItemId: "po2_i0", quantityReceived: 12 })
for (const [id, productId, warehouseId, qty, ref, day] of [
  ["mv1", "p_laptop", "wh_main", 5, "PO-000001", 88],
  ["mv2", "p_pen", "wh_main", 200, "PO-000001", 88],
  ["mv3", "p_book", "wh_annex", 12, "PO-000002", 78],
]) {
  await insert("stock_movements", { id, productId, warehouseId, type: "IN", quantity: qty, reference: ref, referenceId: "rcv", notes: `Purchase receive for ${ref}`, userId: "u_mgr", createdAt: daysAgo(day) })
}

// Sales orders (5% tax) + stock movements OUT.
const so1Lines = [line(20, 0.6)]
const so1 = order(so1Lines, 0.05)
const so2Lines = [line(1, 599.99)]
const so2 = order(so2Lines, 0.05)
async function salesOrder(id, number, customerId, lines, totals, day, products) {
  await insert("sales_orders", { id, orderNumber: number, customerId, warehouseId: "wh_main", orderDate: daysAgo(day), status: "DELIVERED", ...totals, userId: "u_sales", createdAt: daysAgo(day), updatedAt: daysAgo(day) })
  for (let i = 0; i < lines.length; i++) {
    await insert("sales_order_items", { id: `${id}_i${i}`, salesOrderId: id, productId: products[i], ...lines[i], createdAt: daysAgo(day) })
  }
}
await salesOrder("so1", "SO-000001", "k_uni", so1Lines, so1, 60, ["p_pen"])
await salesOrder("so2", "SO-000002", "k_shop", so2Lines, so2, 30, ["p_laptop"])
await insert("stock_movements", { id: "mv4", productId: "p_pen", warehouseId: "wh_main", type: "OUT", quantity: 20, reference: "SO-000001", referenceId: "so1", notes: "Sales order SO-000001", userId: "u_sales", createdAt: daysAgo(60) })
await insert("stock_movements", { id: "mv5", productId: "p_laptop", warehouseId: "wh_main", type: "OUT", quantity: 1, reference: "SO-000002", referenceId: "so2", notes: "Sales order SO-000002", userId: "u_sales", createdAt: daysAgo(30) })

// Stock on hand (consistent with the movements).
await insert("stock", { id: "st1", productId: "p_laptop", warehouseId: "wh_main", quantity: 4, reservedQuantity: 1, status: "IN_STOCK", userId: "u_mgr", createdAt: daysAgo(88), updatedAt: daysAgo(30) })
await insert("stock", { id: "st2", productId: "p_pen", warehouseId: "wh_main", quantity: 180, reservedQuantity: 0, status: "IN_STOCK", userId: "u_mgr", createdAt: daysAgo(88), updatedAt: daysAgo(60) })
await insert("stock", { id: "st3", productId: "p_book", warehouseId: "wh_annex", quantity: 12, reservedQuantity: 0, status: "IN_STOCK", userId: "u_mgr", createdAt: daysAgo(78), updatedAt: daysAgo(78) })

// Payments.
await insert("supplier_payments", { id: "sp1", supplierId: "s_acme", purchaseOrderId: "po1", amount: 1000, paymentDate: daysAgo(85), paymentMethod: "BANK_TRANSFER", reference: "TRX-1", userId: "u_acc", createdAt: daysAgo(85) })
await insert("supplier_payments", { id: "sp2", supplierId: "s_books", purchaseOrderId: "po2", amount: 100.5, paymentDate: daysAgo(75), paymentMethod: "CASH", userId: "u_acc", createdAt: daysAgo(75) })
await insert("customer_payments", { id: "cp1", customerId: "k_uni", salesOrderId: "so1", amount: so1.total, paymentDate: daysAgo(55), paymentMethod: "CASH", userId: "u_acc", createdAt: daysAgo(55) })
await insert("customer_payments", { id: "cp2", customerId: "k_shop", salesOrderId: "so2", amount: 200, paymentDate: daysAgo(25), paymentMethod: "MOBILE_MONEY", reference: "EVC-77", userId: "u_acc", createdAt: daysAgo(25) })

// Expenses (one with a sub-cent value).
await insert("expenses", { id: "ex1", categoryId: "ec_util", amount: 45.75, description: "Electricity March", expenseDate: daysAgo(40), paymentMethod: "CASH", userId: "u_acc", createdAt: daysAgo(40), updatedAt: daysAgo(40) })
await insert("expenses", { id: "ex2", categoryId: "ec_util", amount: 12.345, description: "Water (metered)", expenseDate: daysAgo(35), paymentMethod: "CASH", userId: "u_acc", createdAt: daysAgo(35), updatedAt: daysAgo(35) })

// Stored balances as the old app kept them (float arithmetic), with
// deliberate mistakes on BookCo (+50) and Campus Shop (never updated).
await c.query(`UPDATE public.suppliers SET balance = $1 WHERE id = 's_acme'`, [po1.total - 1000])
await c.query(`UPDATE public.suppliers SET balance = $1 WHERE id = 's_books'`, [po2.total - 100.5 + 50])
await c.query(`UPDATE public.customers SET balance = $1 WHERE id = 'k_uni'`, [so1.total - so1.total])
await c.query(`UPDATE public.customers SET balance = 0 WHERE id = 'k_shop'`)

await c.query("COMMIT")
await c.end()

console.log("Seeded OLD-schema rehearsal data:")
console.log(`  PO totals (float): po1=${po1.total} po2=${po2.total} po3(cancelled)=${po3.total}`)
console.log(`  SO totals (float): so1=${so1.total} so2=${so2.total}`)
console.log("  Wrong stored balances on purpose: supplier BookCo (+50), customer Campus Shop (0)")
