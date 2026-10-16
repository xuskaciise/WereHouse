import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prisma's default pool is (2 × CPUs + 1) connections with a 10s wait, which
// is too small for 100+ simultaneous users: requests queue and then fail with
// "Timed out fetching a new connection". Use a bigger pool unless the URL
// already sets one (Postgres allows 100 connections by default).
function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "25")
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20")
    return url.toString()
  } catch {
    return raw
  }
}

const url = databaseUrl()

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  })

// Configure connection pool - reuse instance in development
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

// Graceful shutdown
if (typeof window === "undefined") {
  process.on("beforeExit", async () => {
    await prisma.$disconnect()
  })
}

// Options for interactive transactions. Prisma's 5s default is too short for
// multi-line orders against a remote (e.g. Neon) database; row locks keep
// these transactions correct regardless of their duration.
// TX_TIMEOUT_MS raises the timeout for the integration tests against the
// remote dev database (not set in production).
export const TX_OPTIONS = { maxWait: 10_000, timeout: Number(process.env.TX_TIMEOUT_MS) || 30_000 } as const
