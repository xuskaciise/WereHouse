import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { type Money, Decimal } from "@/lib/money"

/**
 * For the sales form: is each line's net unit price (after its discount)
 * below the warehouse average (landed) cost? Returns only a yes/no per line;
 * the cost itself (avgCost) is removed from the response for roles without
 * product_cost by withAuth (lib/api.ts).
 * Body: { warehouseId, lines: [{ productId, netUnitPrice }] }
 */
export const POST = withAuth(async (request) => {
  const body = await readJson(request)
  if (typeof body?.warehouseId !== "string" || !Array.isArray(body.lines) || body.lines.length > 200) {
    throw new HttpError(400, "warehouseId and lines are required")
  }
  const productIds = body.lines.map((l: any) => String(l?.productId ?? "")).filter(Boolean)
  const stock = await prisma.stock.findMany({
    where: { warehouseId: body.warehouseId, productId: { in: productIds } },
    select: { productId: true, avgCost: true },
  })
  const costs = new Map(stock.map((s) => [s.productId, s.avgCost]))
  const results = body.lines.map((line: any, index: number) => {
    const avgCost = costs.get(String(line?.productId ?? ""))
    let price: Money | null = null
    try {
      price = new Decimal(line?.netUnitPrice)
    } catch {
      price = null
    }
    const belowCost = !!avgCost && !!price && price.isFinite() && price.lt(avgCost)
    return { index, belowCost, avgCost: avgCost ?? null }
  })
  return json({ results })
}, { permission: ["sales", "create"] })
