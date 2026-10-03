import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { verifyPassword } from "@/lib/password"
import { FailureLimiter } from "@/lib/rate-limit"
import { backupBeforeReset, resetSystemData } from "@/lib/system-reset"

// Settings "Reset System Data": deletes all business data, keeps all users,
// permissions, settings and the chart of accounts (lib/system-reset.ts).
// ADMIN-only (checked against the server session by withAuth); the admin
// must type RESET and re-enter their password.

// 5 wrong passwords within 15 minutes lock the reset for that admin for 15 minutes.
const passwordFailures = new FailureLimiter(5, 15 * 60_000, 15 * 60_000)

export const POST = withAuth(
  async (request, { user }) => {
    const body = await readJson(request)
    if (body?.confirm !== "RESET") throw new HttpError(400, "Type RESET to confirm")
    const password = typeof body?.password === "string" ? body.password : ""
    if (!password) throw new HttpError(400, "Admin password is required")

    if (passwordFailures.isBlocked(user.id)) {
      throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.")
    }
    const admin = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    if (!(await verifyPassword(password, admin?.passwordHash))) {
      passwordFailures.recordFailure(user.id)
      throw new HttpError(401, "Invalid admin password")
    }
    passwordFailures.reset(user.id)

    const backup = await backupBeforeReset()
    const counts = await resetSystemData(user.id)

    console.warn(`System data reset performed by user ${user.id} (backup: ${backup ?? "none"})`)
    return json({
      success: true,
      message: "System data reset completed. Users, permissions, settings and the chart of accounts were kept.",
      backup,
      counts,
    })
  },
  { roles: ["ADMIN"] }
)
