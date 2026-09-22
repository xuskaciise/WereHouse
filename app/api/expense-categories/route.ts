import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = ownershipWhere(user)
  return listResponse(request, {
    findMany: (page) =>
      prisma.expenseCategory.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.expenseCategory.count({ where }),
  })
})

export const POST = withAuth(async (request, { user }) => {
  const { name, description } = await readJson(request)
  if (!name) throw new HttpError(400, "Category name is required")

  const category = await withConflictMessages(
    () =>
      prisma.expenseCategory.create({
        data: { name, description: description || null, userId: user.id },
      }),
    { unique: "Category with this name already exists" }
  )
  return json(category, { status: 201 })
})
