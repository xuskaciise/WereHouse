#!/usr/bin/env node
/**
 * Virtual-user load test. Every virtual user signs in with its own account
 * and then browses like a person: opens a page (the page HTML plus the API
 * calls that page makes, in parallel), waits a few seconds, opens another.
 * All traffic comes from this machine, i.e. one IP, like a whole office or
 * classroom on one network. Read-only: it only sends GET requests (plus the
 * sign-in itself).
 *
 * Usage:
 *   BASE=http://127.0.0.1:3200 node scripts/loadtest/run.mjs
 * Options (env):
 *   USERS_FILE  JSON {password, usernames[]} (default scripts/loadtest/users.local.json)
 *   VUS         number of virtual users (default: all usernames in the file)
 *   RAMP        seconds over which users sign in (default 60)
 *   DURATION    seconds of browsing after the ramp (default 180)
 *   THINK_MIN / THINK_MAX  seconds between pages (default 3 / 8)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = (process.env.BASE || "http://127.0.0.1:3200").replace(/\/$/, "")
const HERE = dirname(fileURLToPath(import.meta.url))
const { password, usernames } = JSON.parse(readFileSync(process.env.USERS_FILE || join(HERE, "users.local.json"), "utf8"))
const VUS = Math.min(Number(process.env.VUS || usernames.length), usernames.length)
const RAMP = Number(process.env.RAMP ?? 60) * 1000
const DURATION = Number(process.env.DURATION ?? 180) * 1000
const THINK_MIN = Number(process.env.THINK_MIN ?? 3) * 1000
const THINK_MAX = Number(process.env.THINK_MAX ?? 8) * 1000

// Page -> the API calls the page makes when it opens.
const PAGES = {
  "/dashboard": ["/api/dashboard/stats", "/api/nav/attention"],
  "/warehouses": ["/api/warehouses", "/api/stock"],
  "/products": ["/api/products", "/api/categories", "/api/stock", "/api/warehouses"],
  "/categories": ["/api/categories"],
  "/inventory": ["/api/products", "/api/stock", "/api/warehouses", "/api/stock-transfers/in-transit"],
  "/sales": ["/api/sales-orders"],
  "/purchases": ["/api/purchase-orders"],
}
const PAGE_NAMES = Object.keys(PAGES)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)

// ---- metrics ----
const stats = new Map() // name -> { times: [], codes: {} }
function record(name, ms, code) {
  let s = stats.get(name)
  if (!s) stats.set(name, (s = { times: [], codes: {} }))
  s.times.push(ms)
  s.codes[code] = (s.codes[code] || 0) + 1
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0)

class Client {
  jar = new Map()
  async req(name, path, { method = "GET", form, headers = {} } = {}) {
    const h = { ...headers, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") }
    let body
    if (form) {
      h["content-type"] = "application/x-www-form-urlencoded"
      body = new URLSearchParams(form)
    }
    const t0 = performance.now()
    let res
    try {
      res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      record(name, performance.now() - t0, e.name === "TimeoutError" ? "timeout" : "neterr")
      return { status: 0, data: null }
    }
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";")
      const i = kv.indexOf("=")
      this.jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const text = await res.text()
    record(name, performance.now() - t0, res.status)
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data, retryAfter: Number(res.headers.get("retry-after")) || 0 }
  }

  /** Signs in like the login page does; retries after a 429 like a person would. */
  async login(username) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const t0 = performance.now()
      const csrf = await this.req("login: csrf", "/api/auth/csrf")
      if (csrf.status === 429) { await sleep((csrf.retryAfter || 10) * 1000); continue }
      if (csrf.status !== 200) return false
      const r = await this.req("login: credentials", "/api/auth/callback/credentials", {
        method: "POST",
        headers: { "X-Auth-Return-Redirect": "1" },
        form: { username, password, csrfToken: csrf.data.csrfToken, callbackUrl: BASE + "/dashboard" },
      })
      if (r.status === 429) { await sleep((r.retryAfter || 10) * 1000); continue }
      const url = new URL(r.data?.url ?? BASE, BASE)
      const ok = r.status < 400 && !url.searchParams.get("error")
      if (ok) record("login: total (incl. retries)", performance.now() - t0, "ok")
      return ok
    }
    return false
  }
}

let loggedIn = 0
let loginFailed = 0
let pagesOpened = 0

async function virtualUser(i, stopAt) {
  await sleep((RAMP * i) / VUS)
  const client = new Client()
  if (!(await client.login(usernames[i]))) { loginFailed++; return }
  loggedIn++
  while (Date.now() < stopAt) {
    const page = PAGE_NAMES[Math.floor(Math.random() * PAGE_NAMES.length)]
    await Promise.all([client.req(`page ${page}`, page), ...PAGES[page].map((api) => client.req(api, api))])
    pagesOpened++
    await sleep(rand(THINK_MIN, THINK_MAX))
  }
}

console.log(`Load test against ${BASE}: ${VUS} virtual users, sign-in over ${RAMP / 1000}s, then ${DURATION / 1000}s of browsing`)
const started = Date.now()
const stopAt = started + RAMP + DURATION
const progress = setInterval(() => {
  const total = [...stats.values()].reduce((a, s) => a + s.times.length, 0)
  const r429 = [...stats.values()].reduce((a, s) => a + (s.codes[429] || 0), 0)
  console.log(`  t=${Math.round((Date.now() - started) / 1000)}s  signed in ${loggedIn}/${VUS}  requests ${total}  429s ${r429}`)
}, 15_000)
await Promise.all(Array.from({ length: VUS }, (_, i) => virtualUser(i, stopAt)))
clearInterval(progress)

// ---- report ----
const elapsed = (Date.now() - started) / 1000
const rows = [...stats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => {
  const t = [...s.times].sort((a, b) => a - b)
  const codes = Object.entries(s.codes).map(([c, n]) => `${c}:${n}`).join(" ")
  return { endpoint: name, count: t.length, "p50 ms": Math.round(pct(t, 50)), "p95 ms": Math.round(pct(t, 95)), "max ms": Math.round(t.at(-1) ?? 0), codes }
})
console.table(rows)
const all = [...stats.values()]
const total = all.reduce((a, s) => a + s.times.length, 0)
const count = (pred) => all.reduce((a, s) => a + Object.entries(s.codes).filter(([c]) => pred(c)).reduce((x, [, n]) => x + n, 0), 0)
console.log(`Signed in: ${loggedIn}/${VUS} (failed: ${loginFailed})   pages opened: ${pagesOpened}`)
console.log(`Requests: ${total} in ${elapsed.toFixed(0)}s (${(total / elapsed).toFixed(1)}/s)`)
console.log(`429 Too Many Requests: ${count((c) => c === "429")}   5xx: ${count((c) => c.startsWith("5"))}   timeouts/network errors: ${count((c) => c === "timeout" || c === "neterr")}`)
