import { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { verifyPassword } from "@/lib/password"
import { RESET_DELETE_TABLES } from "@/lib/reset-tables"

// "Keep configuration" reset: deletes all business data (RESET_DELETE_TABLES),
// keeps users, permissions, settings and landed cost types. Hard-coded
// identifiers only; nothing user-supplied reaches the SQL. No CASCADE: if a
// table outside the list references a listed one, the reset fails instead of
// silently wiping it.
//
// Disabled unless ALLOW_SYSTEM_RESET=true (dev / staging). Production resets
// use scripts/reset/reset-test-data.sh, which takes a verified backup first.
function resetEnabled() {
  return process.env.ALLOW_SYSTEM_RESET === "true"
}

async function countRows(tx: Prisma.TransactionClient) {
  const counts: Record<string, number> = {}
  for (const table of RESET_DELETE_TABLES) {
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM ${Prisma.raw(`"${table}"`)}`
    counts[table] = Number(rows[0].n)
  }
  return counts
}

export const GET = withAuth(async () => json({ enabled: resetEnabled() }), { roles: ["ADMIN"] })

// ADMIN-only (checked against the server session by withAuth), and the admin
// must re-enter their password.
export const POST = withAuth(
  async (request, { user }) => {
    if (!resetEnabled()) {
      throw new HttpError(403, "System reset is disabled on this server (ALLOW_SYSTEM_RESET is not true)")
    }
    const body = await readJson(request)
    const password = typeof body?.password === "string" ? body.password : ""
    if (!password) throw new HttpError(400, "Admin password is required")

    const admin = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    if (!(await verifyPassword(password, admin?.passwordHash))) {
      throw new HttpError(401, "Invalid admin password")
    }

    const tableList = Prisma.raw(RESET_DELETE_TABLES.map((t) => `"${t}"`).join(", "))
    const counts = await prisma.$transaction(async (tx) => {
      const before = await countRows(tx)
      // Kept users point at warehouses that are deleted: clear their default first.
      await tx.$executeRaw`UPDATE "users" SET "defaultWarehouseId" = NULL, "defaultWarehouseLocked" = false`
      await tx.$executeRaw`TRUNCATE TABLE ${tableList} RESTART IDENTITY`
      const after = await countRows(tx)
      return RESET_DELETE_TABLES.map((table) => ({ table, before: before[table], after: after[table] }))
    }, TX_OPTIONS)

    console.warn(`System data reset performed by user ${user.id}`)
    return json({
      success: true,
      message: "System data reset completed. Users, permissions, settings and landed cost types were kept.",
      counts,
    })
  },
  { roles: ["ADMIN"] }
)
