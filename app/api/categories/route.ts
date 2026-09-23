import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = scopeWhere(user, "categories")
  return listResponse(request, {
    findMany: (page) =>
      prisma.category.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.category.count({ where }),
  })
}, { permission: [["categories", "view"], ["products", "view"]] }) // also the product form/filter lookup

export const POST = withAuth(async (request, { user }) => {
  const { name, description } = await readJson(request)
  if (!name) throw new HttpError(400, "Category name is required")

  const category = await withConflictMessages(
    () =>
      prisma.category.create({
        data: { name, description: description || null, userId: user.id },
      }),
    { unique: "Category with this name already exists" }
  )
  return json(category, { status: 201 })
}, { permission: ["categories", "create"] })
