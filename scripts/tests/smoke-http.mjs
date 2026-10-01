// HTTP smoke test against a running server (next start): signs in as the dev
// smoke users and checks that pages and APIs answer without server errors.
//   node scripts/tests/smoke-http.mjs <baseUrl> <passwordFile>
import { readFileSync } from "node:fs"

const [base, passFile] = process.argv.slice(2)
const password = readFileSync(passFile, "utf8").trim()
let failures = 0

async function login(username) {
  const jar = new Map()
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  const csrfRes = await fetch(`${base}/api/auth/csrf`)
  keep(csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: `${base}/dashboard` }),
  })
  keep(res)
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${username}`)
  return (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), cookie: cookie() } })
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`)
  if (!ok) failures++
}

const pages = [
  "/dashboard", "/sales", "/sales/new?mode=sell", "/sales/reservations", "/sales/returns", "/customers", "/payments?tab=customers",
  "/purchases", "/purchases/new", "/purchases/returns", "/suppliers", "/payments?tab=suppliers",
  "/products", "/categories", "/inventory", "/inventory/low-stock", "/warehouses", "/transfers", "/inventory/movements",
  "/expenses", "/accounts", "/accounts/journal", "/accounts/ledger", "/accounts/trial-balance",
  "/reports", "/reports?tab=purchases", "/reports/stock", "/reports/expenses", "/reports/profit-loss",
  "/users", "/roles", "/settings", "/settings/financial", "/settings/payment-methods", "/settings/inventory",
  "/settings/landed-cost-types", "/settings/expense-categories", "/landed-cost-types",
]
const apis = ["/api/nav/attention", "/api/search?q=so", "/api/company", "/api/profile", "/api/reports/stock", "/api/landed-cost-templates", "/api/settings"]

const admin = await login("smoke_admin")
for (const p of pages) {
  const res = await admin(p)
  check(`admin page ${p}`, res.status === 200 || (p === "/landed-cost-types" && res.status === 307), res.status)
}
for (const a of apis) {
  const res = await admin(a)
  check(`admin api ${a}`, res.status === 200, `${res.status} ${(await res.text()).slice(0, 120)}`)
}
const settings = await (await admin("/api/settings")).json()
check("settings GET hides the logo data", !("companyLogo" in settings) && "hasCompanyLogo" in settings)
const company = await (await admin("/api/company")).json()
check("company profile has a walk-in customer for sellers", typeof company.walkInCustomerId === "string" && !!company.logoUrl)
const logo = await admin("/api/company/logo")
check("logo route answers (image or default)", logo.status === 200 || logo.status === 307, logo.status)

const acc = await login("smoke_accountant")
for (const [p, ok] of [["/settings", 307], ["/settings/landed-cost-types", 200], ["/settings/expense-categories", 200], ["/settings/financial", 307], ["/users", 307], ["/accounts", 200], ["/reports/profit-loss", 200]]) {
  const res = await acc(p)
  check(`accountant ${p} -> ${ok}`, res.status === ok, res.status)
}
const put = await acc("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentTerms: "x" }) })
check("accountant cannot change settings", put.status === 403, put.status)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
