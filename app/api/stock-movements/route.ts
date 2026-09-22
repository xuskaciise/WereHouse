import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { ownershipWhere } from "@/lib/auth-guard"
import { dateRangeWhere, listResponse } from "@/lib/pagination"

// Supports ?page, ?pageSize, ?from, ?to (createdAt) and ?q (product name,
// SKU or reference).
export const GET = withAuth(async (request, { user }) => {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100)
  const where: Prisma.StockMovementWhereInput = {
    ...ownershipWhere(user),
    ...dateRangeWhere(request, "createdAt"),
    ...(q && {
      OR: [
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { sku: { contains: q, mode: "insensitive" } } },
        { reference: { contains: q, mode: "insensitive" } },
      ],
    }),
  }

  return listResponse(request, {
    findMany: (page) =>
      prisma.stockMovement.findMany({
        where,
        include: {
          product: true,
          warehouse: true,
          user: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        ...page,
      }),
    count: () => prisma.stockMovement.count({ where }),
  })
})
