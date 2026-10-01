import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { sumMoney } from "@/lib/money"
import { parseLandedCostInput } from "@/lib/landed-costs"
import { assertPurchaseOrderInScope, checkCostRows, previewCostRows, previewLandedCosts } from "@/lib/landed-cost-service"

/**
 * Live allocation preview, computed by the same code that saves (nothing is
 * written). Invalid drafts return 200 with { error } (or per-row problems) so
 * the form can show them inline.
 *   { costId?: string (when editing), cost }  one cost (edit form)
 *   { rows: [cost] }                          the "Add costs" form: all rows together
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await assertPurchaseOrderInScope(user, params.id, "landed_costs")
  const body = await readJson(request)
  if (Array.isArray(body?.rows)) {
    try {
      const { rows, problems } = await checkCostRows(user, params.id, body.rows)
      const preview = await previewCostRows(prisma, params.id, rows)
      return json({ ...preview, problems: [...problems, ...preview.problems], error: null })
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return json({ error: e.message, problems: [] })
      throw e
    }
  }
  const costId = typeof body?.costId === "string" ? body.costId : null
  try {
    const input = parseLandedCostInput(body?.cost)
    const preview = await previewLandedCosts(prisma, params.id, { costId, input })
    let error: string | null = null
    if (input.allocationMethod === "MANUAL" && input.manual && preview.draftAmount) {
      const entered = sumMoney(input.manual.values())
      if (!entered.equals(preview.draftAmount)) {
        error = `Manual allocations add up to ${entered.toFixed(2)} but the cost is ${preview.draftAmount.toFixed(2)}`
      }
    }
    return json({ ...preview, error })
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) return json({ error: e.message })
    throw e
  }
}, { permission: ["landed_costs", "view"] })
