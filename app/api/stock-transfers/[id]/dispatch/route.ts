import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { assertTransferInScope, dispatchTransfer, transferDetail } from "@/lib/stock-transfers"

// Sends a draft: stock leaves the source at its average cost (in transit).
export const POST = withAuth<{ id: string }>(async (_request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  await prisma.$transaction((tx) => dispatchTransfer(tx, params.id, user.id), TX_OPTIONS)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })
