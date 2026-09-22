import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (_request, { user }) => {
  const categories = await prisma.expenseCategory.findMany({
    where: ownershipWhere(user),
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(categories)
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
  return NextResponse.json(category, { status: 201 })
})
