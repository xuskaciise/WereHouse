#!/usr/bin/env node
// Fails (exit 1) when an API route handler or Server Action is not protected
// by the shared auth helpers. Run as part of `npm run lint`.
//
// Rules:
//  - Every app/api/**/route.ts must export its HTTP handlers only as
//      export const GET = withAuth(...)   or   export const POST = publicRoute(...)
//    (the Auth.js catch-all route is the single allow-listed exception).
//  - Every exported function in a "use server" file must call requireAuth()
//    or requireRole().
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = process.cwd()
const APP_DIR = join(ROOT, "app")
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const ALLOWED_UNWRAPPED = new Set(["app/api/auth/[...nextauth]/route.ts"])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

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
      const decl = src.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*([A-Za-z_]+)`))
      if (decl) {
        handlers++
        if (decl[1] !== "withAuth" && decl[1] !== "publicRoute") {
          problems.push(`${rel}: ${method} must be wrapped with withAuth() or publicRoute()`)
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

  if (/^\s*["']use server["']/.test(src)) {
    const fnRegex = /export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{/g
    let match
    while ((match = fnRegex.exec(src))) {
      const body = src.slice(match.index + match[0].length, match.index + match[0].length + 400)
      if (!/\brequire(Auth|Role)\s*\(/.test(body)) {
        problems.push(`${rel}: server action ${match[1]}() must call requireAuth()/requireRole() first`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error("Route guard check failed:\n  " + problems.join("\n  "))
  process.exit(1)
}
console.log(`Route guard check passed (${files.filter((f) => /route\.ts$/.test(f)).length} route files).`)
