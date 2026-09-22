import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { hashPassword, validatePassword } from "@/lib/password"
import { parseRole, parseStatus, publicUserSelect } from "@/lib/users"
import { listResponse } from "@/lib/pagination"

// User management is ADMIN-only. Public student sign-up lives in /api/register.

export const GET = withAuth(
  async (request) => {
    return listResponse(request, {
      findMany: (page) => prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: publicUserSelect, ...page }),
      count: () => prisma.user.count(),
    })
  },
  { roles: ["ADMIN"] }
)

export const POST = withAuth(
  async (request) => {
    const body = await readJson(request)
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const username = typeof body.username === "string" ? body.username.trim() : ""
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null

    if (!name || !username) {
      throw new HttpError(400, "Name, username, and password are required")
    }
    const passwordError = validatePassword(body.password)
    if (passwordError) throw new HttpError(400, passwordError)

    const user = await prisma.user.create({
      data: {
        name,
        username,
        email,
        passwordHash: await hashPassword(body.password),
        role: body.role === undefined ? "STUDENT" : parseRole(body.role),
        // Accounts created by an admin are trusted unless a status is given.
        status: body.status === undefined ? "APPROVED" : parseStatus(body.status),
      },
      select: publicUserSelect,
    })

    return json(user, { status: 201 })
  },
  { roles: ["ADMIN"] }
)
