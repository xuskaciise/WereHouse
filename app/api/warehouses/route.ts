import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (_request, { user }) => {
  const warehouses = await prisma.warehouse.findMany({
    where: ownershipWhere(user),
    orderBy: { createdAt: "desc" },
  })
  return json(warehouses)
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
