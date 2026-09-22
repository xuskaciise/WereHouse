import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (request, { user: currentUser }) => {
  try {
    const stockMovements = await prisma.stockMovement.findMany({
      where: ownershipWhere(currentUser),
      include: {
        product: true,
        warehouse: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(stockMovements)
  } catch (error) {
    console.error("Error fetching stock movements:", error)
    return NextResponse.json(
      { error: "Failed to fetch stock movements" },
      { status: 500 }
    )
  }
})
