import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { scopeWhere } from "@/lib/permissions"
import { dateRangeWhere, listResponse } from "@/lib/pagination"
import { createSalesReturn, salesReturnDetail } from "@/lib/sales-returns"
import type { Prisma } from "@prisma/client"

const listInclude = {
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  salesOrder: { select: { id: true, orderNumber: true } },
  user: { select: { id: true, name: true, username: true } },
  _count: { select: { items: true } },
} satisfies Prisma.SalesReturnInclude

// Supports ?page, ?pageSize, ?from, ?to (returnDate), ?customerId, ?salesOrderId.
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const where: Prisma.SalesReturnWhereInput = {
    ...scopeWhere(user, "sales_returns"),
    ...dateRangeWhere(request, "returnDate"),
    ...(params.get("customerId") && { customerId: params.get("customerId")! }),
    ...(params.get("salesOrderId") && { salesOrderId: params.get("salesOrderId")! }),
  }
  return listResponse(request, {
    findMany: (page) => prisma.salesReturn.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.salesReturn.count({ where }),
  })
}, { permission: [["sales_returns", "view"], ["reports_finance", "view"]] })

// Body: { salesOrderId, lines: [{ itemId, quantity, condition: RESELLABLE | DAMAGED }], reason, notes?, refund? }.
// Quantities, credit note and costs are computed on the server (lib/sales-returns.ts).
export const POST = withAuth(async (request, { user }) => {
  const id = await createSalesReturn(user, await readJson(request))
  return json(await salesReturnDetail(user, id), { status: 201 })
}, { permission: ["sales_returns", "create"] })
