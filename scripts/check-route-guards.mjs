#!/usr/bin/env node
// Fails (exit 1) when an API route handler, Server Action or dashboard page is
// not protected by the shared auth / permission helpers. Run as part of
// `npm run lint`.
//
// Rules:
//  - Every app/api/**/route.ts must export its HTTP handlers only as
//      export const GET = withAuth(...)   or   export const POST = publicRoute(...)
//    (the Auth.js catch-all route is the single allow-listed exception).
//  - Every withAuth(...) must say what it needs: { permission: [...] } from the
//    central permission system (lib/permission-rules.ts), { roles: [...] } for
//    fixed system operations, or { authenticatedOnly: true }.
//  - Every page under app/(dashboard) must be covered by requirePageAccess()
//    (lib/page-access.ts): in its own page.tsx or in a layout.tsx between it
//    and app/(dashboard). The /no-access page is the only exception.
//  - Every exported function in a "use server" file must call requireAuth(),
//    requireRole() or requirePermission() first.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

const ROOT = process.cwd()
const APP_DIR = join(ROOT, "app")
const DASHBOARD_DIR = join(APP_DIR, "(dashboard)")
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const ALLOWED_UNWRAPPED = new Set(["app/api/auth/[...nextauth]/route.ts"])
const OPEN_PAGES = new Set(["app/(dashboard)/no-access/page.tsx"])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// Index of the ")" that closes the "(" at `open` (strings and comments skipped).
function closeParen(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i)
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++
      continue
    }
    if (ch === "(") depth++
    else if (ch === ")" && --depth === 0) return i
  }
  return -1
}

const GUARD_OPTION = /(permission|roles)\s*:|authenticatedOnly\s*:\s*true/
const isDashboardPage = (file) => file.startsWith(DASHBOARD_DIR + sep) && /[\\/]page\.tsx$/.test(file)

const problems = []
const files = walk(APP_DIR).filter((f) => /\.(ts|tsx)$/.test(f))

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/")
  const src = readFileSync(file, "utf8")

  if (rel.startsWith("app/api/") && /\/route\.ts$/.test(rel)) {
    if (ALLOWED_UNWRAPPED.has(rel)) continue
    let handlers = 0
    for (const method of METHODS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(src)) {
        problems.push(`${rel}: ${method} is a plain function; wrap it with withAuth() or publicRoute()`)
      }
      const decl = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*([A-Za-z_]+)`).exec(src)
      if (decl) {
        handlers++
        if (decl[1] !== "withAuth" && decl[1] !== "publicRoute") {
          problems.push(`${rel}: ${method} must be wrapped with withAuth() or publicRoute()`)
        } else if (decl[1] === "withAuth") {
          // The options object is the last argument, just before the closing ")".
          const open = src.indexOf("(", decl.index + decl[0].length)
          const close = closeParen(src, open)
          const tail = close > 0 ? src.slice(Math.max(open, close - 400), close) : ""
          if (!GUARD_OPTION.test(tail)) {
            problems.push(`${rel}: ${method} withAuth() needs { permission }, { roles } or { authenticatedOnly: true }`)
          }
        }
      }
    }
    if (/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/.test(src)) {
      problems.push(`${rel}: re-exported handlers cannot be verified; declare them with withAuth()/publicRoute()`)
    }
    if (handlers === 0 && !problems.some((p) => p.startsWith(rel))) {
      problems.push(`${rel}: no recognisable handlers found`)
    }
  }

  if (isDashboardPage(file) && !OPEN_PAGES.has(rel)) {
    let covered = /requirePageAccess\(/.test(src)
    for (let dir = dirname(file); !covered && dir.startsWith(DASHBOARD_DIR + sep); dir = dirname(dir)) {
      try {
        covered = /requirePageAccess\(/.test(readFileSync(join(dir, "layout.tsx"), "utf8"))
      } catch {
        // no layout in this folder
      }
    }
    if (!covered) problems.push(`${rel}: page is not guarded by requirePageAccess() (in the page or a layout)`)
  }

  if (/^\s*["']use server["']/.test(src)) {
    const fnRegex = /export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{/g
    let match
    while ((match = fnRegex.exec(src))) {
      const body = src.slice(match.index + match[0].length, match.index + match[0].length + 400)
      if (!/\brequire(Auth|Role|Permission)\s*\(/.test(body)) {
        problems.push(`${rel}: server action ${match[1]}() must call requireAuth()/requireRole()/requirePermission() first`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error("Route guard check failed:\n  " + problems.join("\n  "))
  process.exit(1)
}
const routeCount = files.filter((f) => /route\.ts$/.test(f)).length
const pageCount = files.filter(isDashboardPage).length
console.log(`Route guard check passed (${routeCount} route files, ${pageCount} dashboard pages).`)
