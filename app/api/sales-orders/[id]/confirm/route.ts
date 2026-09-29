import { json, withAuth } from "@/lib/api"
import { confirmSalesOrder, salesOrderDetail } from "@/lib/sales-orders"

// DRAFT -> CONFIRMED: reserves the ordered stock (fails if not available).
export const POST = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await confirmSalesOrder(user, params.id)
  return json(await salesOrderDetail(user, params.id))
}, { permission: ["sales_confirm", "create"] })
