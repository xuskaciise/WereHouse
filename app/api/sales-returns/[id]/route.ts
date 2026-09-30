import { json, withAuth } from "@/lib/api"
import { salesReturnDetail } from "@/lib/sales-returns"

// One return with its lines (printable credit note). Returns are final: no edit / delete.
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  return json(await salesReturnDetail(user, params.id))
}, { permission: ["sales_returns", "view"] })
