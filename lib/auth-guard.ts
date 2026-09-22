import { cache } from "react"
import type { Role } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"

export interface SessionUser {
  id: string
  name: string
  username: string
  role: Role
}

export { HttpError }

/**
 * Returns the signed-in user, re-read from the database on every request so
 * that role changes, rejections and deletions take effect immediately instead
 * of waiting for the session cookie to expire.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth()
  const id = session?.user?.id
  if (!id) return null

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, username: true, role: true, status: true },
  })
  if (!user || user.status !== "APPROVED") return null

  return { id: user.id, name: user.name, username: user.username, role: user.role }
})

export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new HttpError(401, "Unauthorized")
  return user
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireAuth()
  if (!roles.includes(user.role)) throw new HttpError(403, "Forbidden")
  return user
}

export function isAdmin(user: Pick<SessionUser, "role">): boolean {
  return user.role === "ADMIN"
}

/** Prisma `where` fragment limiting non-admins to the records they own. */
export function ownershipWhere(user: SessionUser, field = "userId"): Record<string, string> {
  return isAdmin(user) ? {} : { [field]: user.id }
}

/**
 * Throws 404 when the record does not exist or belongs to another user
 * (non-admins cannot tell the two cases apart).
 */
export function assertOwnership<T extends { userId: string | null }>(
  user: SessionUser,
  record: T | null,
  notFoundMessage = "Not found"
): asserts record is T {
  if (!record || (!isAdmin(user) && record.userId !== user.id)) {
    throw new HttpError(404, notFoundMessage)
  }
}
