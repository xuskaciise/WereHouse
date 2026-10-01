import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"

// The signed-in user's own profile: default warehouse (unless an admin locked it).
export const GET = withAuth(async (_request, { user }) => {
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      defaultWarehouseId: true,
      defaultWarehouseLocked: true,
      defaultWarehouse: { select: { id: true, name: true } },
    },
  })
  return json(me)
}, { authenticatedOnly: true })

// Body: { defaultWarehouseId: string | null }.
export const PATCH = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  if (body?.defaultWarehouseId === undefined) throw new HttpError(400, "Nothing to update")
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { defaultWarehouseLocked: true } })
  if (current.defaultWarehouseLocked) throw new HttpError(403, "Your default warehouse is set by an administrator")
  const warehouseId = typeof body.defaultWarehouseId === "string" && body.defaultWarehouseId ? body.defaultWarehouseId : null
  if (warehouseId) {
    if (!(await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } }))) throw new HttpError(400, "Warehouse not found")
    await assertCanReference(user, { warehouseId })
  }
  await prisma.user.update({ where: { id: user.id }, data: { defaultWarehouseId: warehouseId } })
  return json({ defaultWarehouseId: warehouseId })
}, { authenticatedOnly: true })
