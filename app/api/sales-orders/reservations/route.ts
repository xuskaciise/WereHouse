import { json, withAuth } from "@/lib/api"
import { listReservations } from "@/lib/sales-orders"

// Open stock reservations of sales orders; ?expired=1 for the expired ones only.
export const GET = withAuth(async (request, { user }) => {
  const expiredOnly = new URL(request.url).searchParams.get("expired") === "1"
  return json(await listReservations(user, { expiredOnly }))
}, { permission: ["sales_reservations", "view"] })
