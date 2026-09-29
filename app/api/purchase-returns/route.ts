import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { scopeWhere } from "@/lib/permissions"
import { dateRangeWhere, listResponse } from "@/lib/pagination"
import { createPurchaseReturn, purchaseReturnDetail } from "@/lib/purchase-returns"
import type { Prisma } from "@prisma/client"

const listInclude = {
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, orderNumber: true } },
  user: { select: { id: true, name: true, username: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseReturnInclude

// Supports ?page, ?pageSize, ?from, ?to (returnDate), ?supplierId, ?purchaseOrderId.
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const where: Prisma.PurchaseReturnWhereInput = {
    ...scopeWhere(user, "purchase_returns"),
    ...dateRangeWhere(request, "returnDate"),
    ...(params.get("supplierId") && { supplierId: params.get("supplierId")! }),
    ...(params.get("purchaseOrderId") && { purchaseOrderId: params.get("purchaseOrderId")! }),
  }
  return listResponse(request, {
    findMany: (page) => prisma.purchaseReturn.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, ...page }),
    count: () => prisma.purchaseReturn.count({ where }),
  })
}, { permission: [["purchase_returns", "view"], ["reports_finance", "view"]] })

// Body: { purchaseOrderId, lines: [{ itemId, quantity }], reason, notes?, refund? }.
// Quantities, costs and credit are computed on the server (lib/purchase-returns.ts).
export const POST = withAuth(async (request, { user }) => {
  const id = await createPurchaseReturn(user, await readJson(request))
  return json(await purchaseReturnDetail(user, id), { status: 201 })
}, { permission: ["purchase_returns", "create"] })
