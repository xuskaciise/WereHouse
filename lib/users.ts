import { Prisma, Role, UserStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"

export const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

const ROLES = new Set<string>(Object.values(Role))
const STATUSES = new Set<string>(Object.values(UserStatus))

export function parseRole(value: unknown): Role {
  if (typeof value !== "string" || !ROLES.has(value)) throw new HttpError(400, "Invalid role")
  return value as Role
}

export function parseStatus(value: unknown): UserStatus {
  if (typeof value !== "string" || !STATUSES.has(value)) {
    throw new HttpError(400, "Valid status (PENDING, APPROVED, REJECTED) is required")
  }
  return value as UserStatus
}

/**
 * Refuses a change that would leave the system without any approved ADMIN
 * (demoting, rejecting or deleting the last one).
 */
export async function assertAdminRemains(
  targetUserId: string,
  next: { role?: Role; status?: UserStatus; deleted?: boolean }
): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, status: true },
  })
  if (!target) throw new HttpError(404, "User not found")

  const isActiveAdmin = target.role === "ADMIN" && target.status === "APPROVED"
  const staysActiveAdmin =
    !next.deleted && (next.role ?? target.role) === "ADMIN" && (next.status ?? target.status) === "APPROVED"
  if (!isActiveAdmin || staysActiveAdmin) return

  const otherAdmins = await prisma.user.count({
    where: { role: "ADMIN", status: "APPROVED", id: { not: targetUserId } },
  })
  if (otherAdmins === 0) {
    throw new HttpError(400, "At least one approved administrator must remain")
  }
}
