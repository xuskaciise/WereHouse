import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import { authConfig } from "@/lib/auth.config"
import { SlidingWindowLimiter, getClientIp } from "@/lib/rate-limit"

// First line of defence only: verifies that a valid session cookie exists.
// Every API route and page still re-checks the user (status + role) against
// the database via lib/auth-guard.ts.
const { auth } = NextAuth(authConfig)

const apiLimiter = new SlidingWindowLimiter(120, 60_000)
// Login and sign-up: 10 POSTs per minute per IP (on top of the per-account
// lockout in lib/auth.ts).
const credentialLimiter = new SlidingWindowLimiter(10, 60_000)

const PUBLIC_PAGES = new Set(["/login"])
const PUBLIC_API_EXACT = new Set(["/api/register"])
const PUBLIC_API_PREFIX = "/api/auth/"
const CREDENTIAL_ENDPOINTS = new Set(["/api/auth/callback/credentials", "/api/register"])

function tooManyRequests() {
  return NextResponse.json(
    { error: "Too many requests. Please wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60" } }
  )
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith("/api/")

  if (isApi) {
    const ip = getClientIp(req.headers)
    if (req.method === "POST" && CREDENTIAL_ENDPOINTS.has(pathname) && credentialLimiter.hit(ip)) {
      return tooManyRequests()
    }
    if (apiLimiter.hit(ip)) return tooManyRequests()
  }

  const isPublic =
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_API_EXACT.has(pathname) ||
    pathname.startsWith(PUBLIC_API_PREFIX)

  if (isPublic || req.auth?.user) return NextResponse.next()

  if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin))
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
}
