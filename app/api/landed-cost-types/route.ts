import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth, withConflictMessages } from "@/lib/api"
import { parseTypeName } from "@/lib/landed-cost-service"

// Global list of landed cost types. Anyone working with landed costs can read
// it (to pick a type); managing it needs landed_cost_types.

export const GET = withAuth(async (request) => {
  const activeOnly = new URL(request.url).searchParams.get("active") === "true"
  const types = await prisma.landedCostType.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { costs: true } } },
  })
  return json(types)
}, { permission: [["landed_costs", "view"], ["landed_cost_types", "view"]] })

export const POST = withAuth(async (request) => {
  const body = await readJson(request)
  const name = parseTypeName(body?.name)
  const max = await prisma.landedCostType.aggregate({ _max: { sortOrder: true } })
  const type = await withConflictMessages(
    () =>
      prisma.landedCostType.create({
        data: { name, nameKey: name.toLowerCase(), sortOrder: (max._max.sortOrder ?? 0) + 1 },
      }),
    { unique: `A cost type named "${name}" already exists` }
  )
  return json(type, { status: 201 })
}, { permission: ["landed_cost_types", "create"] })
