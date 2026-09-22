import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { withNestedSupplierBalance } from "@/lib/balances"
import { supplierPaymentInclude as paymentInclude } from "@/lib/includes"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = { ...ownershipWhere(user), ...dateRangeWhere(request, "paymentDate") }
  return listResponse(request, {
    findMany: (page) =>
      prisma.supplierPayment.findMany({ where, include: paymentInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.supplierPayment.count({ where }),
    map: withNestedSupplierBalance,
  })
})

export const POST = withAuth(async (request, { user }) => {
  const { supplierId, purchaseOrderId, amount, paymentDate, paymentMethod, reference, notes } =
    await readJson(request)

  if (!supplierId || !paymentMethod) {
    throw new HttpError(400, "Supplier, Amount, and Payment Method are required")
  }
  const parsedAmount = parseMoney(amount)

  await assertCanReference(user, { supplierId })
  if (purchaseOrderId) {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, supplierId, ...ownershipWhere(user) },
      select: { id: true },
    })
    if (!order) throw new HttpError(400, "Purchase order not found for this supplier")
  }

  // The supplier balance is derived from orders and payments (lib/balances.ts),
  // so recording the payment is all that is needed.
  const payment = await prisma.supplierPayment.create({
    data: {
      supplierId,
      purchaseOrderId: purchaseOrderId || null,
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      reference: reference || null,
      notes: notes || null,
      userId: user.id,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedSupplierBalance([payment])
  return json(withBalance, { status: 201 })
})
