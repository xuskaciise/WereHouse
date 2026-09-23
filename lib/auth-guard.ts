import { cache } from "react"
import type { Role } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { getRolePermissions } from "@/lib/permissions"
import type { PermissionMap } from "@/lib/permission-rules"

export interface SessionUser {
  id: string
  name: string
  username: string
  role: Role
  /** Resolved for this request from role_permissions (see lib/permissions.ts). */
  permissions: PermissionMap
}

export { HttpError }

/**
 * Returns the signed-in user, re-read from the database on every request so
 * that role changes, rejections and deletions take effect immediately instead
 * of waiting for the session cookie to expire. Permissions come from the
 * central permission table (briefly cached).
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

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    permissions: await getRolePermissions(user.role),
  }
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
