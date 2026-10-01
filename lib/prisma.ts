import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
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
