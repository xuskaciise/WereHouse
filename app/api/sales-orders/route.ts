import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { scopeWhere } from "@/lib/permissions"
import { createSalesOrder, parseSalesStatus, salesOrderDetail, salesOrderInclude } from "@/lib/sales-orders"
import { dateRangeWhere, listResponse } from "@/lib/pagination"
import type { Prisma } from "@prisma/client"

// Lighter shape for reports/lists that do not need line items.
const salesOrderSummaryInclude = {
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} as const

// Supports ?page, ?pageSize, ?from, ?to (orderDate), ?status and ?view=summary.
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const status = parseSalesStatus(params.get("status"))
  const where: Prisma.SalesOrderWhereInput = {
    ...scopeWhere(user, "sales"),
    ...dateRangeWhere(request, "orderDate"),
    ...(status && { status }),
  }
  const include = params.get("view") === "summary" ? salesOrderSummaryInclude : salesOrderInclude
  return listResponse(request, {
    findMany: (page) => prisma.salesOrder.findMany({ where, include, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.salesOrder.count({ where }),
  })
}, { permission: [["sales", "view"], ["reports_sales", "view"], ["reports_finance", "view"]] })

// Body: order fields + mode: "draft" (default, no stock touched), "confirm"
// (reserves the stock) or "sell_now" (confirm + deliver everything at once).
// The server decides the status; totals from the client are never used.
export const POST = withAuth(async (request, { user }) => {
  const id = await createSalesOrder(user, await readJson(request))
  return json(await salesOrderDetail(user, id), { status: 201 })
}, { permission: ["sales", "create"] })
