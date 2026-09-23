import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertInScope } from "@/lib/permissions"

const NOT_FOUND = "Category not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const category = await prisma.category.findUnique({ where: { id: params.id } })
  assertInScope(user, "categories", category, NOT_FOUND)
  return json(category)
}, { permission: ["categories", "view"] })

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.category.findUnique({ where: { id: params.id } })
  assertInScope(user, "categories", existing, NOT_FOUND)

  const { name, description } = await readJson(request)
  if (!name) throw new HttpError(400, "Category name is required")

  const category = await withConflictMessages(
    () =>
      prisma.category.update({
        where: { id: params.id },
        data: { name, description: description || null },
      }),
    { unique: "Category with this name already exists" }
  )
  return json(category)
}, { permission: ["categories", "edit"] })

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.category.findUnique({ where: { id: params.id } })
  assertInScope(user, "categories", existing, NOT_FOUND)

  await withConflictMessages(() => prisma.category.delete({ where: { id: params.id } }), {
    inUse: "Cannot delete category that has products. Please remove all products first.",
  })
  return json({ message: "Category deleted successfully" })
}, { permission: ["categories", "delete"] })
