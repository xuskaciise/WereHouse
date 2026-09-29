import { json, readJson, withAuth } from "@/lib/api"
import { deliverSalesOrder, salesOrderDetail } from "@/lib/sales-orders"

// Body: { lines: [{ itemId, quantity }] | "all", notes? }. Deducts the reserved
// stock and records revenue, customer debt and COGS for the delivered share.
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await deliverSalesOrder(user, params.id, await readJson(request))
  return json(await salesOrderDetail(user, params.id))
}, { permission: ["sales_deliver", "create"] })
