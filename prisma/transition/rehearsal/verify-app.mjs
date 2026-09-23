#!/usr/bin/env node
/**
 * REHEARSAL: application-level checks against the app running on the
 * transitioned staging database: old users log in with their OLD passwords,
 * roles and ownership apply, and money/stock/balances come out unchanged.
 *
 * Usage: BASE=http://localhost:3200 node verify-app.mjs
 */
const BASE = process.env.BASE || "http://localhost:3200"
let failures = 0
const check = (name, ok, got = "") => {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${typeof got === "string" ? got : JSON.stringify(got)})`}`)
}

class Client {
  jar = new Map()
  async req(path, { method = "GET", body, form, headers = {} } = {}) {
    const h = { ...headers, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") }
    let payload
    if (form) { h["content-type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form) }
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body) }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" })
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";"); const i = kv.indexOf("=")
      this.jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const text = await res.text()
    let data; try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data }
  }
  async login(username, password) {
    const { data: csrf } = await this.req("/api/auth/csrf")
    const r = await this.req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "X-Auth-Return-Redirect": "1" },
      form: { username, password, csrfToken: csrf.csrfToken, callbackUrl: BASE + "/dashboard" },
    })
    const url = new URL(r.data?.url ?? BASE, BASE)
    return { ok: !url.searchParams.get("error"), code: url.searchParams.get("code") }
  }
}

check("health endpoint", (await new Client().req("/api/health")).status === 200)

// Old users with their OLD plaintext passwords
const logins = [
  ["admin", "OldAdmin#2024", true], ["manager", "manager123", true], ["sales", "sales-pass", true],
  ["accountant", "acc 2024!", true], ["131313", "student1", true],
]
const clients = {}
for (const [u, p, ok] of logins) {
  const client = new Client()
  const r = await client.login(u, p)
  check(`old user ${u} logs in with old password`, r.ok === ok, r)
  clients[u] = client
}
const pending = await new Client().login("141414", "pending1")
check("pending student refused with 'pending'", !pending.ok && pending.code === "pending", pending)
const rejected = await new Client().login("151515", "rejected1")
check("rejected student refused with 'rejected'", !rejected.ok && rejected.code === "rejected", rejected)
check("user without password cannot log in", !(await new Client().login("legacy", "anything")).ok)
check("wrong password refused", !(await new Client().login("admin", "manager123")).ok)

const admin = clients.admin
// Money, stock and balances through the API
const suppliers = Object.fromEntries((await admin.req("/api/suppliers")).data.map((s) => [s.id, s.balance]))
check("supplier balances (calculated)", suppliers.s_acme === 1506.14 && suppliers.s_books === 161.29 && suppliers.s_idle === 0, suppliers)
const customers = Object.fromEntries((await admin.req("/api/customers")).data.map((c) => [c.id, c.balance]))
check("customer balances (calculated)", customers.k_uni === 0 && customers.k_shop === 429.99, customers)
const products = Object.fromEntries((await admin.req("/api/products")).data.map((p) => [p.id, [p.costPrice, p.sellingPrice]]))
check("product prices", JSON.stringify(products.p_laptop) === "[450.1,599.99]" && JSON.stringify(products.p_pen) === "[0.35,0.6]", products)
const stock = Object.fromEntries((await admin.req("/api/stock")).data.map((s) => [s.id, s.quantity]))
check("stock quantities", stock.st1 === 4 && stock.st2 === 180 && stock.st3 === 12, stock)
const pos = Object.fromEntries((await admin.req("/api/purchase-orders")).data.map((o) => [o.orderNumber, o.total]))
check("purchase order totals", pos["PO-000001"] === 2506.14 && pos["PO-000002"] === 261.79 && pos["PO-000003"] === 972.22, pos)
const dash = (await admin.req("/api/dashboard/stats")).data
check("dashboard aggregates", dash.totalPurchases === 3740.15 && dash.totalSales === 642.59 && dash.totalStockValue === 2105.8 && dash.lowStockCount === 0, dash)

// Roles and ownership after the transition
check("student cannot list users", (await clients["131313"].req("/api/users")).status === 403)
const mgrProducts = (await clients.manager.req("/api/products")).data.map((p) => p.id)
check("manager sees only own products", JSON.stringify(mgrProducts) === '["p_book"]', mgrProducts)

// New writes work on migrated data: next order number continues the sequence
const sale = await admin.req("/api/sales-orders", { method: "POST", body: { customerId: "k_shop", warehouseId: "wh_main", items: [{ productId: "p_laptop", quantity: 1, unitPrice: 599.99 }] } })
check("new sale on migrated data (SO-000003)", sale.status === 201 && sale.data.orderNumber === "SO-000003", sale.data)
const after = Object.fromEntries((await admin.req("/api/stock")).data.map((s) => [s.id, s.quantity]))
check("stock decremented 4 -> 3", after.st1 === 3, after)
const oversell = await admin.req("/api/sales-orders", { method: "POST", body: { customerId: "k_shop", warehouseId: "wh_main", items: [{ productId: "p_laptop", quantity: 3, unitPrice: 1 }] } })
check("reserved stock respected (3 on hand, 1 reserved)", oversell.status === 400, oversell.data)
const pay = await admin.req("/api/customer-payments", { method: "POST", body: { customerId: "k_shop", amount: "429.99", paymentMethod: "CASH" } })
check("payment -> Campus Shop balance 629.99", pay.status === 201 && pay.data.customer.balance === 629.99, pay.data?.customer?.balance)

console.log(failures ? `\n${failures} FAILED` : "\nALL APP CHECKS PASSED")
process.exit(failures ? 1 : 0)
