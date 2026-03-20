import { prisma } from "@/lib/prisma"

export interface RequestUser {
  id: string
  role: string
}

export function isAdminRole(role?: string | null): boolean {
  return (role || "").toUpperCase() === "ADMIN"
}

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })

  if (!dbUser) return null

  return {
    id: dbUser.id,
    role: dbUser.role,
  }
}

export function ownershipWhere(user: RequestUser | null, field = "userId") {
  if (!user || isAdminRole(user.role)) return {}
  return { [field]: user.id }
}

