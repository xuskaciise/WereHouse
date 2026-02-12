import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const stockMovements = await prisma.stockMovement.findMany({
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
}
