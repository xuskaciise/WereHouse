import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { applyTemplate } from "@/lib/landed-cost-templates"
import { landedCostView } from "@/lib/landed-cost-service"

// Body: { templateId, paidToSupplierId?, reference?, costDate?, reason? }.
// Adds every line of the template as a landed cost (all or nothing).
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const added = await applyTemplate(user, params.id, await readJson(request))
  return json({ ...(await landedCostView(prisma, params.id)), added }, { status: 201 })
}, { permission: ["landed_costs", "create"] })
