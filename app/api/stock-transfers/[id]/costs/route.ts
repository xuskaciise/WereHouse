import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import {
  addEvent,
  assertTransferCostsEditable,
  assertTransferInScope,
  lockTransfer,
  parseTransferCostInput,
  syncTransferCosts,
  transferCostSnapshot,
  transferDetail,
} from "@/lib/stock-transfers"

/**
 * Adds a transfer cost (e.g. transport between warehouses), allocated by
 * value and added to the destination landed cost.
 * Body: { typeId, paidToSupplierId, amount, reference?, costDate?, notes?,
 *         reason? (required once RECEIVED, admin only), paidNow?: { paymentMethod } }
 */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  await assertTransferInScope(user, params.id)
  const body = await readJson(request)
  const input = parseTransferCostInput(body)
  await assertCanReference(user, { supplierId: input.paidToSupplierId })
  const type = await prisma.landedCostType.findUnique({ where: { id: input.typeId } })
  if (!type || !type.isActive) throw new HttpError(400, "Choose an active cost type")
  const paidNow = body.paidNow && typeof body.paidNow === "object" ? body.paidNow : null
  if (paidNow) {
    requirePermission(user, ["supplier_payments", "create"], "Your role cannot record supplier payments")
  }
  const paidMethod = paidNow ? await parsePaymentFields(paidNow) : null

  await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, params.id)
    const reason = assertTransferCostsEditable(user, t, body.reason)
    const cost = await tx.stockTransferCost.create({ data: { ...input, stockTransferId: t.id, userId: user.id } })
    await syncTransferCosts(tx, t.id, user.id)
    if (paidNow) {
      await tx.supplierPayment.create({
        data: {
          supplierId: input.paidToSupplierId,
          stockTransferCostId: cost.id,
          amount: input.amount,
          paymentMethod: paidMethod!.paymentMethod,
          payerPhone: paidMethod!.payerPhone,
          transactionId: paidMethod!.transactionId,
          reference: input.reference,
          notes: `Transfer cost ${t.transferNumber}: ${type.name}`,
          userId: user.id,
        },
      })
    }
    await addEvent(tx, {
      stockTransferId: t.id,
      type: "COST_ADDED",
      userId: user.id,
      notes: reason,
      data: { after: await transferCostSnapshot(tx, cost.id) },
    })
  }, TX_OPTIONS)

  return json({ ...(await transferDetail(params.id)), warnings: paidMethod?.warnings ?? [] }, { status: 201 })
}, { permission: ["stock_transfers", "edit"] })
