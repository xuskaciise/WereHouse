import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 120

const hits = new Map<string, number[]>()

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown"
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()
  return "unknown"
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - WINDOW_MS
  const stamps = (hits.get(ip) ?? []).filter((t) => t > windowStart)
  stamps.push(now)
  hits.set(ip, stamps)

  if (hits.size > 5000) {
    for (const [key, arr] of hits) {
      const recent = arr.filter((t) => t > windowStart)
      if (recent.length === 0) hits.delete(key)
      else hits.set(key, recent)
    }
  }

  return stamps.length > MAX_REQUESTS
}

export function middleware(request: NextRequest) {
  if (isRateLimited(getClientIp(request))) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": "60",
        "Content-Type": "text/plain; charset=utf-8",
      },
    })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/api/:path*"],
}
