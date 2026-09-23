import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { parseMoney } from "@/lib/money"
import { withNestedCustomerBalance } from "@/lib/balances"
import { customerPaymentInclude as paymentInclude } from "@/lib/includes"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

export const GET = withAuth(async (request, { user }) => {
  const where = { ...scopeWhere(user, "customer_payments"), ...dateRangeWhere(request, "paymentDate") }
  return listResponse(request, {
    findMany: (page) =>
      prisma.customerPayment.findMany({ where, include: paymentInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.customerPayment.count({ where }),
    map: withNestedCustomerBalance,
  })
}, { permission: [["customer_payments", "view"], ["reports_finance", "view"]] })

export const POST = withAuth(async (request, { user }) => {
  const { customerId, salesOrderId, amount, paymentDate, paymentMethod, reference, notes } =
    await readJson(request)

  if (!customerId || !paymentMethod) {
    throw new HttpError(400, "Customer, Amount, and Payment Method are required")
  }
  const parsedAmount = parseMoney(amount)

  await assertCanReference(user, { customerId })
  if (salesOrderId) {
    const order = await prisma.salesOrder.findFirst({
      // The linked order must be one the user can see (own orders for OWN sales scope).
      where: { id: salesOrderId, customerId, ...scopeWhere(user, "sales") },
      select: { id: true },
    })
    if (!order) throw new HttpError(400, "Sales order not found for this customer")
  }

  // The customer balance is derived from orders and payments (lib/balances.ts).
  const payment = await prisma.customerPayment.create({
    data: {
      customerId,
      salesOrderId: salesOrderId || null,
      amount: parsedAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      reference: reference || null,
      notes: notes || null,
      userId: user.id,
    },
    include: paymentInclude,
  })

  const [withBalance] = await withNestedCustomerBalance([payment])
  return json(withBalance, { status: 201 })
}, { permission: ["customer_payments", "create"] })
