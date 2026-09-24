import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { parsePaymentFields } from "@/lib/payment-fields"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { withNestedSupplierBalance } from "@/lib/balances"
import { supplierPaymentInclude as paymentInclude } from "@/lib/includes"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = { ...scopeWhere(user, "supplier_payments"), ...dateRangeWhere(request, "paymentDate"),
    // ?paymentMethod=EVC_PLUS
    ...(new URL(request.url).searchParams.get("paymentMethod") && {
      paymentMethod: new URL(request.url).searchParams.get("paymentMethod")!,
    }) }
  return listResponse(request, {
    findMany: (page) =>
      prisma.supplierPayment.findMany({ where, include: paymentInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.supplierPayment.count({ where }),
    map: withNestedSupplierBalance,
  })
}, { permission: [["supplier_payments", "view"], ["reports_finance", "view"]] })

export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const { supplierId, purchaseOrderId, landedCostId, stockTransferCostId, amount, paymentDate, reference, notes } = body

  if (!supplierId) throw new HttpError(400, "Supplier, Amount, and Payment Method are required")
  const method = await parsePaymentFields(body)
  const parsedAmount = parseMoney(amount)

  await assertCanReference(user, { supplierId })
  if (purchaseOrderId) {
    const order = await prisma.purchaseOrder.findFirst({
      // The linked order must be one the user can see.
      where: { id: purchaseOrderId, supplierId, ...scopeWhere(user, "purchases") },
      select: { id: true },
    })
    if (!order) throw new HttpError(400, "Purchase order not found for this supplier")
  }
  if (landedCostId) {
    // Settles a landed cost line owed to this supplier (on a PO the user can see).
    const cost = await prisma.purchaseLandedCost.findFirst({
      where: { id: landedCostId, paidToSupplierId: supplierId, purchaseOrder: scopeWhere(user, "purchases") },
      select: { id: true },
    })
    if (!cost) throw new HttpError(400, "Landed cost not found for this supplier")
  }
  if (stockTransferCostId) {
    const cost = await prisma.stockTransferCost.findFirst({
      where: { id: stockTransferCostId, paidToSupplierId: supplierId, stockTransfer: scopeWhere(user, "stock_transfers") },
      select: { id: true },
    })
    if (!cost) throw new HttpError(400, "Transfer cost not found for this supplier")
  }
  if (landedCostId && stockTransferCostId) throw new HttpError(400, "Link the payment to one cost only")

  // The supplier balance is derived from orders and payments (lib/balances.ts),
  // so recording the payment is all that is needed.
  const payment = await prisma.supplierPayment.create({
    data: {
      supplierId,
      purchaseOrderId: purchaseOrderId || null,
      landedCostId: landedCostId || null,
      stockTransferCostId: stockTransferCostId || null,
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod: method.paymentMethod,
      payerPhone: method.payerPhone,
      transactionId: method.transactionId,
      reference: reference || null,
      notes: notes || null,
      userId: user.id,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedSupplierBalance([payment])
  return json({ ...withBalance, warnings: method.warnings }, { status: 201 })
}, { permission: ["supplier_payments", "create"] })
