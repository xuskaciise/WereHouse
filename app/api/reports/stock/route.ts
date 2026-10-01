import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { json, withAuth } from "@/lib/api"
import { hasPermission, isOwnScope } from "@/lib/permissions"

// Stock report: quantities (on hand, reserved, available) per product and
// warehouse; values at the warehouse average cost only for roles that see
// costs (product_cost). ?warehouseId= to filter.
export const GET = withAuth(async (request, { user }) => {
  const warehouseId = new URL(request.url).searchParams.get("warehouseId") || null
  const seesCost = hasPermission(user, ["product_cost", "view"])
  const own = isOwnScope(user, "reports_stock") ? Prisma.sql`AND s."userId" = ${user.id}` : Prisma.empty
  const wh = warehouseId ? Prisma.sql`AND s."warehouseId" = ${warehouseId}` : Prisma.empty
  const rows = await prisma.$queryRaw<
    { productId: string; sku: string; name: string; category: string; warehouseId: string; warehouse: string; quantity: number; reserved: number; reorderLevel: number; avgCost: Prisma.Decimal; value: Prisma.Decimal }[]
  >`
    SELECT p."id" AS "productId", p."sku", p."name", c."name" AS category, w."id" AS "warehouseId", w."name" AS warehouse,
           s."quantity", s."reservedQuantity" AS reserved, p."reorderLevel", s."avgCost", ROUND(s."quantity" * s."avgCost", 2) AS value
    FROM "stock" s
    JOIN "products" p ON p."id" = s."productId"
    JOIN "categories" c ON c."id" = p."categoryId"
    JOIN "warehouses" w ON w."id" = s."warehouseId"
    WHERE TRUE ${own} ${wh}
    ORDER BY w."name", p."name"`
  const warehouses = new Map<string, { id: string; name: string; products: number; quantity: number; reserved: number; value: Prisma.Decimal }>()
  for (const r of rows) {
    const w = warehouses.get(r.warehouseId) ?? { id: r.warehouseId, name: r.warehouse, products: 0, quantity: 0, reserved: 0, value: new Prisma.Decimal(0) }
    w.products += 1
    w.quantity += r.quantity
    w.reserved += r.reserved
    w.value = w.value.plus(r.value)
    warehouses.set(r.warehouseId, w)
  }
  const strip = <T extends Record<string, unknown>>(o: T) => (seesCost ? o : { ...o, avgCost: undefined, value: undefined })
  return json({
    seesCost,
    rows: rows.map((r) => strip({ ...r, available: r.quantity - r.reserved, low: r.quantity - r.reserved <= r.reorderLevel })),
    warehouses: [...warehouses.values()].map((w) => strip(w)),
    totals: strip({
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      reserved: rows.reduce((s, r) => s + r.reserved, 0),
      value: rows.reduce((s, r) => s.plus(r.value), new Prisma.Decimal(0)),
      lowCount: rows.filter((r) => r.quantity - r.reserved <= r.reorderLevel).length,
    }),
  })
}, { permission: ["reports_stock", "view"] })
