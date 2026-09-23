import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { sumMoney } from "@/lib/money"

// Landed cost lines owed to a supplier (?supplierId=), with the amount already
// paid: used to link a supplier payment to the cost it settles.
export const GET = withAuth(async (request, { user }) => {
  const supplierId = new URL(request.url).searchParams.get("supplierId")
  if (!supplierId) throw new HttpError(400, "supplierId is required")
  const costs = await prisma.purchaseLandedCost.findMany({
    where: {
      paidToSupplierId: supplierId,
      purchaseOrder: { status: { not: "CANCELLED" }, ...scopeWhere(user, "purchases") },
    },
    orderBy: { costDate: "desc" },
    include: {
      type: { select: { name: true } },
      purchaseOrder: { select: { id: true, orderNumber: true } },
      supplierPayments: { select: { amount: true } },
    },
  })
  return json(
    costs.map(({ supplierPayments, ...cost }) => {
      const paid = sumMoney(supplierPayments.map((p) => p.amount))
      return { ...cost, paidAmount: paid, openAmount: cost.amount.minus(paid) }
    })
  )
}, { permission: [["supplier_payments", "view"], ["landed_costs", "view"]] })
