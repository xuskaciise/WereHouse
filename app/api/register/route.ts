import { prisma } from "@/lib/prisma"
import { json, publicRoute, readJson, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { hashPassword, validatePassword } from "@/lib/password"

// Public student self-registration (rate limited in middleware.ts). The role
// and status are fixed server-side: every sign-up is a STUDENT account that
// stays PENDING until an admin approves it. Client-sent role/status are ignored.
export const POST = publicRoute(async (request) => {
  const body = await readJson(request)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const username = typeof body?.username === "string" ? body.username.trim() : ""

  if (!name || !username || name.length > 100 || username.length > 50) {
    throw new HttpError(400, "Name and ID number are required")
  }
  const passwordError = validatePassword(body?.password)
  if (passwordError) throw new HttpError(400, passwordError)

  const passwordHash = await hashPassword(body.password)
  await withConflictMessages(
    () =>
      prisma.user.create({
        data: { name, username, passwordHash, role: "STUDENT", status: "PENDING" },
      }),
    { unique: "This ID number is already registered" }
  )

  return json(
    { message: "Account created. An administrator must approve it before you can sign in." },
    { status: 201 }
  )
})
