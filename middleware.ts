import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import { authConfig } from "@/lib/auth.config"
import { SlidingWindowLimiter, getClientIp } from "@/lib/rate-limit"

// First line of defence only: verifies that a valid session cookie exists.
// Every API route and page still re-checks the user (status + role) against
// the database via lib/auth-guard.ts.
const { auth } = NextAuth(authConfig)

// Many users usually share one public IP (an office or shop network behind
// NAT), so signed-in requests are limited per user, not per IP. The per-IP
// limits only stop floods and anonymous abuse and are sized for ~150 users
// behind a single IP.
const userApiLimiter = new SlidingWindowLimiter(300, 60_000)
const anonymousApiLimiter = new SlidingWindowLimiter(120, 60_000)
const ipFloodLimiter = new SlidingWindowLimiter(6000, 60_000)
// Login and sign-up: 200 POSTs per minute per IP, so a whole office or class
// can sign in at once; brute force on one account is stopped by the
// per-account lockout in lib/auth.ts.
const credentialLimiter = new SlidingWindowLimiter(200, 60_000)
// Cheap Auth.js reads (no database) that every login page makes before the
// user is signed in. Only the per-IP flood guard applies to them.
const AUTH_READS = new Set(["/api/auth/csrf", "/api/auth/session", "/api/auth/providers"])

const PUBLIC_PAGES = new Set(["/login"])
const PUBLIC_API_EXACT = new Set(["/api/register", "/api/health"])
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
    if (ipFloodLimiter.hit(ip)) return tooManyRequests()
    // req.auth comes from the verified session JWT, so the user id can't be forged.
    const userId = req.auth?.user?.id
    if (req.method === "POST" && CREDENTIAL_ENDPOINTS.has(pathname)) {
      if (credentialLimiter.hit(ip)) return tooManyRequests()
    } else if (userId) {
      if (userApiLimiter.hit(`u:${userId}`)) return tooManyRequests()
    } else if (!(req.method === "GET" && AUTH_READS.has(pathname)) && anonymousApiLimiter.hit(ip)) {
      return tooManyRequests()
    }
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
