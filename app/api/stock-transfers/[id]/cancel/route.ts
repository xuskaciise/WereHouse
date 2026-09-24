import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { assertTransferInScope, cancelTransfer, transferDetail } from "@/lib/stock-transfers"

// Body: { reason }. Drafts, or in-transit transfers (goods return to the source).
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  const body = await readJson(request)
  await prisma.$transaction((tx) => cancelTransfer(tx, params.id, user.id, body?.reason), TX_OPTIONS)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })
