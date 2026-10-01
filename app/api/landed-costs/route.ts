import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { listCostLines } from "@/lib/cost-payments"

// Cost lines (landed costs of purchase orders and stock transfer costs) owed
// to a party, with paid and open amounts, oldest first (the FIFO order of
// payments). Used to pay one or many lines.
//   ?supplierId=     the paid-to party (or)
//   ?purchaseOrderId= every party's lines of one PO
//   ?open=1          only lines with an open balance
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const supplierId = params.get("supplierId")
  const purchaseOrderId = params.get("purchaseOrderId")
  if (!supplierId && !purchaseOrderId) throw new HttpError(400, "supplierId or purchaseOrderId is required")
  const lines = await listCostLines(prisma, user, { supplierId, purchaseOrderId, openOnly: params.get("open") === "1" })
  return json(lines.map((l) => ({ ...l, type: { name: l.typeName } })))
}, { permission: [["supplier_payments", "view"], ["landed_costs", "view"], ["stock_transfers", "view"]] })
