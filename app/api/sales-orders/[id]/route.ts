import { json, readJson, withAuth } from "@/lib/api"
import { assertSalesOrderInScope, deleteDraftSalesOrder, editSalesOrder, salesOrderDetail } from "@/lib/sales-orders"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await assertSalesOrderInScope(user, params.id)
  return json(await salesOrderDetail(user, params.id))
}, { permission: ["sales", "view"] })

// Edit a DRAFT, or a CONFIRMED order before any delivery (reservation adjusted). Same body as POST.
export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  await editSalesOrder(user, params.id, await readJson(request))
  return json(await salesOrderDetail(user, params.id))
}, { permission: ["sales", "edit"] })

// Only drafts can be deleted; anything else is cancelled instead.
export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await deleteDraftSalesOrder(user, params.id)
  return json({ success: true })
}, { permission: ["sales", "delete"] })
