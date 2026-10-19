import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"

const MAX_IDS = 200

type Failure = { id: string; name: string | null; reason: string }

// Deletes the given users one by one and reports which could not be deleted.
// ADMIN accounts and the signed-in user are always refused, whatever the
// client sends. Users with linked records (orders, movements, ...) are kept,
// exactly like the single-user DELETE (the database refuses with P2003).
export const POST = withAuth(
  async (request, { user: currentUser }) => {
    const body = await readJson<{ ids?: unknown }>(request)
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new HttpError(400, "Select at least one user")
    }
    if (!body.ids.every((id) => typeof id === "string" && id.trim() !== "")) {
      throw new HttpError(400, "Invalid user id")
    }
    const ids = [...new Set(body.ids as string[])]
    if (ids.length > MAX_IDS) throw new HttpError(400, `At most ${MAX_IDS} users can be deleted at once`)

    const targets = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, role: true },
    })
    const byId = new Map(targets.map((t) => [t.id, t]))

    const deleted: { id: string; name: string }[] = []
    const failed: Failure[] = []

    for (const id of ids) {
      const target = byId.get(id)
      if (!target) {
        failed.push({ id, name: null, reason: "User not found" })
        continue
      }
      if (target.id === currentUser.id) {
        failed.push({ id, name: target.name, reason: "You cannot delete your own account" })
        continue
      }
      if (target.role === "ADMIN") {
        failed.push({ id, name: target.name, reason: "Administrators cannot be deleted" })
        continue
      }
      try {
        // Role re-checked in the write so a user promoted meanwhile is not deleted.
        const result = await prisma.user.deleteMany({ where: { id, role: { not: "ADMIN" } } })
        if (result.count === 1) deleted.push({ id, name: target.name })
        else failed.push({ id, name: target.name, reason: "User not found or is an administrator" })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
          failed.push({ id, name: target.name, reason: "User has linked records (orders, movements, ...)" })
        } else {
          throw error
        }
      }
    }

    return json({ deleted, failed })
  },
  { permission: ["users", "delete"] }
)
