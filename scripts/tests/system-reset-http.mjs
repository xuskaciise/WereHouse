// HTTP checks of POST /api/admin/system-reset against a running DEV server
// (next start), signed in as the dev smoke users (scripts/tests/smoke-users.ts).
// The last check really resets the dev data.
//   node scripts/tests/system-reset-http.mjs <baseUrl> <passwordFile>
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
  return (body) =>
    fetch(`${base}/api/admin/system-reset`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", cookie: cookie() },
      body: JSON.stringify(body),
    })
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`)
  if (!ok) failures++
}

const anonymous = await fetch(`${base}/api/admin/system-reset`, { method: "POST", redirect: "manual", body: "{}" })
check("anonymous is refused", [401, 403, 307].includes(anonymous.status), anonymous.status)

const accountant = await login("smoke_accountant")
const asAccountant = await accountant({ confirm: "RESET", password })
check("ACCOUNTANT gets 403", asAccountant.status === 403, asAccountant.status)

const admin = await login("smoke_admin")
const noConfirm = await admin({ confirm: "reset", password })
check("admin without RESET gets 400", noConfirm.status === 400, noConfirm.status)
const wrong = await admin({ confirm: "RESET", password: password + "x" })
check("admin with a wrong password gets 401", wrong.status === 401, wrong.status)

const ok = await admin({ confirm: "RESET", password })
const result = await ok.json()
check("admin reset succeeds", ok.status === 200 && result.success === true, `${ok.status} ${JSON.stringify(result).slice(0, 200)}`)
const row = (t) => result.counts?.find((c) => c.table === t)
check("counts: products after = 0", row("products")?.after === 0, JSON.stringify(row("products")))
check("counts: users unchanged", row("users") && row("users").before === row("users").after, JSON.stringify(row("users")))
check("backup reported", typeof result.backup === "string" && result.backup.startsWith("reset_backup_"), result.backup)

const again = await login("smoke_admin")
check("admin can still sign in after the reset", typeof again === "function", "")

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
process.exitCode = failures ? 1 : 0
