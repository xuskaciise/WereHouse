import { json, withAuth } from "@/lib/api"
import { parsePeriod, profitAndLoss } from "@/lib/profit-loss"

// Profit & Loss from the journal: ?from=&to= (default this month), compared
// with the previous period of the same length.
export const GET = withAuth(async (request, { user }) => {
  return json(await profitAndLoss(user, parsePeriod(new URL(request.url).searchParams)))
}, { permission: ["reports_finance", "view"] })
