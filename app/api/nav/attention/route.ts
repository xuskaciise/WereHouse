import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { hasPermission, isOwnScope } from "@/lib/permissions"

// Counts for the menu badges and the attention bell; each only for roles that
// can open the related page (and within their scope).
export const GET = withAuth(async (_request, { user }) => {
  const result: { lowStock?: number; expiredReservations?: number; unpaidCosts?: number; unpaidCostsAmount?: string } = {}
  const tasks: Promise<void>[] = []

  if (hasPermission(user, ["low_stock", "view"])) {
    const own = isOwnScope(user, "low_stock") ? Prisma.sql`AND s."userId" = ${user.id}` : Prisma.empty
    tasks.push(
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM "stock" s JOIN "products" p ON p."id" = s."productId"
        WHERE s."quantity" - s."reservedQuantity" <= p."reorderLevel" ${own}`.then((r) => { result.lowStock = Number(r[0].n) })
    )
  }
  if (hasPermission(user, ["sales_reservations", "view"])) {
    const own = isOwnScope(user, "sales_reservations") || isOwnScope(user, "sales") ? { userId: user.id } : {}
    tasks.push(
      prisma.salesOrder
        .count({ where: { ...own, status: { in: ["CONFIRMED", "PARTIALLY_DELIVERED"] }, reservedUntil: { lt: new Date() } } })
        .then((n) => { result.expiredReservations = n })
    )
  }
  if (hasPermission(user, ["supplier_payments", "view"])) {
    const own = isOwnScope(user, "supplier_payments") ? Prisma.sql`AND c."userId" = ${user.id}` : Prisma.empty
    // Landed costs (non-cancelled POs) and transfer costs not fully paid.
    tasks.push(
      prisma.$queryRaw<{ n: bigint; amount: Prisma.Decimal | null }[]>`
        SELECT COUNT(*) AS n, SUM(c.amount - c.paid) AS amount FROM (
          SELECT lc."amount", lc."userId", COALESCE((SELECT SUM(sp."amount") FROM "supplier_payments" sp WHERE sp."landedCostId" = lc."id"), 0) AS paid
          FROM "purchase_landed_costs" lc JOIN "purchase_orders" po ON po."id" = lc."purchaseOrderId" WHERE po."status" <> 'CANCELLED'
          UNION ALL
          SELECT tc."amount", tc."userId", COALESCE((SELECT SUM(sp."amount") FROM "supplier_payments" sp WHERE sp."stockTransferCostId" = tc."id"), 0)
          FROM "stock_transfer_costs" tc
        ) c WHERE c.paid < c.amount ${own}`.then((r) => {
        result.unpaidCosts = Number(r[0].n)
        result.unpaidCostsAmount = (r[0].amount ?? new Prisma.Decimal(0)).toFixed(2)
      })
    )
  }
  await Promise.all(tasks)
  return json(result)
}, { authenticatedOnly: true })
