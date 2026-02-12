import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        purchaseOrders: {
          select: {
            total: true,
          },
        },
        supplierPayments: {
          select: {
            amount: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    // Calculate actual balance from purchase orders and payments
    const suppliersWithBalance = suppliers.map((supplier) => {
      const totalPurchases = supplier.purchaseOrders.reduce(
        (sum, order) => sum + (order.total || 0),
        0
      )
      const totalPayments = supplier.supplierPayments.reduce(
        (sum, payment) => sum + (payment.amount || 0),
        0
      )
      const calculatedBalance = totalPurchases - totalPayments

      // Update balance in database if it's different (to keep it in sync)
      if (Math.abs((supplier.balance || 0) - calculatedBalance) > 0.01) {
        // Update asynchronously to not block the response
        prisma.supplier.update({
          where: { id: supplier.id },
          data: { balance: calculatedBalance },
        }).catch(console.error)
      }

      return {
        ...supplier,
        balance: calculatedBalance,
        purchaseOrders: undefined,
        supplierPayments: undefined,
      }
    })

    return NextResponse.json(suppliersWithBalance)
  } catch (error) {
    console.error("Error fetching suppliers:", error)
    return NextResponse.json(
      { error: "Failed to fetch suppliers" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, phone, address, city, state, contactPerson } = body

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    const supplier = await prisma.supplier.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        contactPerson: contactPerson || null,
      },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error: any) {
    console.error("Error creating supplier:", error)
    
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Supplier with this name already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create supplier" },
      { status: 500 }
    )
  }
}
