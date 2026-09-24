import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { assertTransferInScope, parseReceiveLines, receiveTransfer, transferDetail } from "@/lib/stock-transfers"

/**
 * Receipt at the destination.
 * Body: { lines: [{ itemId, received, lost?, reason? (required when lost > 0) }], notes? }
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  const body = await readJson(request)
  const lines = parseReceiveLines(body?.lines)
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null
  await prisma.$transaction((tx) => receiveTransfer(tx, params.id, user.id, lines, notes), TX_OPTIONS)
  return json(await transferDetail(params.id))
}, { permission: ["stock_transfers", "edit"] })
