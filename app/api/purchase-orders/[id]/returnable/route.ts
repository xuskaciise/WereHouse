import { json, withAuth } from "@/lib/api"
import { returnableLines } from "@/lib/purchase-returns"

// Lines of the order with received, already returned and still returnable units.
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  return json(await returnableLines(user, params.id))
}, { permission: ["purchase_returns", "create"] })
