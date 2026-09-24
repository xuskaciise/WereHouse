import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { scopeWhere } from "@/lib/permissions"
import { sumMoney } from "@/lib/money"

// Landed cost lines and stock transfer costs owed to a supplier
// (?supplierId=), with the amount already paid: used to link a supplier
// payment to the cost it settles (kind LANDED_COST or TRANSFER_COST).
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
  const transferCosts = await prisma.stockTransferCost.findMany({
    where: { paidToSupplierId: supplierId, stockTransfer: scopeWhere(user, "stock_transfers") },
    orderBy: { costDate: "desc" },
    include: {
      type: { select: { name: true } },
      stockTransfer: { select: { id: true, transferNumber: true } },
      supplierPayments: { select: { amount: true } },
    },
  })
  return json([
    ...costs.map(({ supplierPayments, ...cost }) => {
      const paid = sumMoney(supplierPayments.map((p) => p.amount))
      return { ...cost, kind: "LANDED_COST", documentNumber: cost.purchaseOrder.orderNumber, paidAmount: paid, openAmount: cost.amount.minus(paid) }
    }),
    ...transferCosts.map(({ supplierPayments, ...cost }) => {
      const paid = sumMoney(supplierPayments.map((p) => p.amount))
      return { ...cost, kind: "TRANSFER_COST", documentNumber: cost.stockTransfer.transferNumber, paidAmount: paid, openAmount: cost.amount.minus(paid) }
    }),
  ])
}, { permission: [["supplier_payments", "view"], ["landed_costs", "view"], ["stock_transfers", "view"]] })
