import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { withNestedSupplierBalance } from "@/lib/balances"
import { supplierPaymentInclude as paymentInclude } from "@/lib/includes"
import { payCostLines } from "@/lib/cost-payments"

/**
 * Pays cost lines (landed costs of purchase orders and stock transfer costs)
 * in one go: ONE payment per paid-to party, each settling its selected lines
 * oldest first (FIFO); more than the open balance is rejected. All payments
 * of a request in one transaction. Body: see payCostLines (lib/cost-payments.ts).
 */
export const POST = withAuth(async (request, { user }) => {
  const { ids, warnings } = await payCostLines(user, await readJson(request))
  const payments = await prisma.supplierPayment.findMany({ where: { id: { in: ids } }, include: paymentInclude, orderBy: { createdAt: "asc" } })
  return json({ payments: await withNestedSupplierBalance(payments), warnings }, { status: 201 })
}, { permission: ["supplier_payments", "create"] })
