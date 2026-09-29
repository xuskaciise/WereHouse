import { json, withAuth } from "@/lib/api"
import { purchaseReturnDetail } from "@/lib/purchase-returns"

// One return with its lines (printable return note). Returns are final: no edit / delete.
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  return json(await purchaseReturnDetail(user, params.id))
}, { permission: ["purchase_returns", "view"] })
