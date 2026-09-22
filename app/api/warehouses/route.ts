import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = ownershipWhere(user)
  return listResponse(request, {
    findMany: (page) =>
      prisma.warehouse.findMany({ where, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.warehouse.count({ where }),
  })
})

export const POST = withAuth(async (request, { user }) => {
  const { name, code, address, city, state, zipCode, country, capacity } = await readJson(request)
  if (!name || !code) throw new HttpError(400, "Name and Code are required")

  const warehouse = await withConflictMessages(
    () =>
      prisma.warehouse.create({
        data: {
          name,
          code,
          address: address || null,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          country: country || null,
          capacity: capacity ? parseInt(capacity.toString()) : null,
          userId: user.id,
        },
      }),
    { unique: "Warehouse with this code already exists" }
  )
  return json(warehouse, { status: 201 })
})
