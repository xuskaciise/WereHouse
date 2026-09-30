import { json, withAuth } from "@/lib/api"
import { returnableSalesLines } from "@/lib/sales-returns"

// Lines of the order with delivered, already returned and still returnable units.
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  return json(await returnableSalesLines(user, params.id))
}, { permission: ["sales_returns", "create"] })
