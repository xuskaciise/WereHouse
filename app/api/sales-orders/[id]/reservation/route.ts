import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { extendReservation, releaseReservation, salesOrderDetail } from "@/lib/sales-orders"

// Body: { action: "extend", until, reason } or { action: "release", reason }.
// Permission per action is checked in lib/sales-orders.ts (extend = edit,
// release = delete on sales_reservations).
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const body = await readJson(request)
  if (body?.action === "extend") await extendReservation(user, params.id, body)
  else if (body?.action === "release") await releaseReservation(user, params.id, body)
  else throw new HttpError(400, "action must be extend or release")
  return json(await salesOrderDetail(user, params.id))
}, { permission: [["sales_reservations", "edit"], ["sales_reservations", "delete"]] })
