import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { parseTypeName } from "@/lib/landed-cost-service"

// Rename or (de)activate a cost type. Body: { name?, isActive? }
export const PATCH = withAuth<{ id: string }>(async (request, { params }) => {
  const body = await readJson(request)
  const data: { name?: string; nameKey?: string; isActive?: boolean } = {}
  if (body?.name !== undefined) {
    data.name = parseTypeName(body.name)
    data.nameKey = data.name.toLowerCase()
  }
  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false")
    data.isActive = body.isActive
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, "Nothing to update")
  const type = await withConflictMessages(() => prisma.landedCostType.update({ where: { id: params.id }, data }), {
    unique: `A cost type named "${data.name}" already exists`,
  })
  return json(type)
}, { permission: ["landed_cost_types", "edit"] })

// Only unused types can be deleted; used ones can be deactivated.
export const DELETE = withAuth<{ id: string }>(async (_request, { params }) => {
  const type = await prisma.landedCostType.findUnique({
    where: { id: params.id },
    include: { _count: { select: { costs: true } } },
  })
  if (!type) throw new HttpError(404, "Cost type not found")
  if (type._count.costs > 0) {
    throw new HttpError(409, `"${type.name}" is used by ${type._count.costs} cost line(s); deactivate it instead`)
  }
  await prisma.landedCostType.delete({ where: { id: params.id } })
  return json({ success: true })
}, { permission: ["landed_cost_types", "delete"] })
