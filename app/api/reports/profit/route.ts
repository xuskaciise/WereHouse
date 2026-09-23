import { json, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission, scopeWhere } from "@/lib/permissions"
import { salesProfit } from "@/lib/profit"

function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null
  const date = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid date")
  return date
}

// Gross profit / margin for the sales report (and ?from=&to= period).
// Needs a sales or finance report permission AND product_cost (costs are
// never shown to roles without it).
export const GET = withAuth(async (request, { user }) => {
  requirePermission(user, ["product_cost", "view"], "Your role cannot see costs and profit")
  const params = new URL(request.url).searchParams
  const own = scopeWhere(user, "sales")
  return json(
    await salesProfit({
      where: own,
      adjustmentWhere: own,
      from: parseDate(params.get("from")),
      to: parseDate(params.get("to"), true),
    })
  )
}, { permission: [["reports_sales", "view"], ["reports_finance", "view"]] })
