import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { hashPassword, validatePassword } from "@/lib/password"
import { assertAdminRemains, parseRole, parseStatus, publicUserSelect } from "@/lib/users"

// All user management is ADMIN-only and verified against the server session.
const ADMIN_ONLY = { roles: ["ADMIN" as const] }

export const GET = withAuth<{ id: string }>(async (_request, { params }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: publicUserSelect,
  })
  if (!user) throw new HttpError(404, "User not found")
  return json(user)
}, ADMIN_ONLY)

export const PUT = withAuth<{ id: string }>(async (request, { params }) => {
  const body = await readJson(request)
  const data: Prisma.UserUpdateInput = {}

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "Name is required")
    data.name = body.name.trim()
  }
  if (body.username !== undefined) {
    if (typeof body.username !== "string" || !body.username.trim()) {
      throw new HttpError(400, "Username is required")
    }
    data.username = body.username.trim()
  }
  if (body.email !== undefined) {
    data.email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null
  }
  const role = body.role === undefined ? undefined : parseRole(body.role)
  const status = body.status === undefined ? undefined : parseStatus(body.status)
  if (role) data.role = role
  if (status) data.status = status
  if (typeof body.password === "string" && body.password.trim() !== "") {
    const passwordError = validatePassword(body.password)
    if (passwordError) throw new HttpError(400, passwordError)
    data.passwordHash = await hashPassword(body.password)
  }

  await assertAdminRemains(params.id, { role, status })

  const user = await prisma.user.update({
    where: { id: params.id },
    data,
    select: publicUserSelect,
  })
  return json(user)
}, ADMIN_ONLY)

export const PATCH = withAuth<{ id: string }>(async (request, { params }) => {
  const body = await readJson(request)
  const status = parseStatus(body.status)

  await assertAdminRemains(params.id, { status })

  const user = await prisma.user.update({
    where: { id: params.id },
    data: { status },
    select: publicUserSelect,
  })
  return json(user)
}, ADMIN_ONLY)

export const DELETE = withAuth<{ id: string }>(async (_request, { user: currentUser, params }) => {
  if (params.id === currentUser.id) {
    throw new HttpError(400, "You cannot delete your own account")
  }
  await assertAdminRemains(params.id, { deleted: true })

  await prisma.user.delete({ where: { id: params.id } })
  return json({ message: "User deleted successfully" })
}, ADMIN_ONLY)
