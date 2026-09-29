import { json, readJson, withAuth } from "@/lib/api"
import { cancelSalesOrder, salesOrderDetail } from "@/lib/sales-orders"

// Body: { reason }. Releases the reservation; a partially delivered order is
// closed (the rest released) instead of cancelled.
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await cancelSalesOrder(user, params.id, await readJson(request))
  return json(await salesOrderDetail(user, params.id))
}, { permission: ["sales_confirm", "delete"] })
