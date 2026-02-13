import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Try to fetch suppliers - handle case where balance column doesn't exist
    let suppliers: any[]
    try {
      // First try normal query
      suppliers = await prisma.supplier.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
          contactPerson: true,
          createdAt: true,
          updatedAt: true,
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
    } catch (dbError: any) {
      // If balance column doesn't exist, use raw query
      if (dbError.message?.includes("balance") || dbError.message?.includes("does not exist")) {
        console.log("Balance column not found, using raw query")
        // Use raw query to get suppliers without balance column
        const rawSuppliers = await prisma.$queryRaw<any[]>`
          SELECT 
            id, name, email, phone, address, city, state, "zipCode", country, "contactPerson", 
            "createdAt", "updatedAt"
          FROM suppliers
          ORDER BY "createdAt" DESC
        `
        
        // Fetch related data separately
        const supplierIds = rawSuppliers.map((s: any) => s.id)
        
        const purchaseOrders = await prisma.purchaseOrder.findMany({
          where: { supplierId: { in: supplierIds } },
          select: { supplierId: true, total: true },
        })
        
        const supplierPayments = await prisma.supplierPayment.findMany({
          where: { supplierId: { in: supplierIds } },
          select: { supplierId: true, amount: true },
        })
        
        // Attach related data to suppliers
        suppliers = rawSuppliers.map((supplier: any) => ({
          ...supplier,
          purchaseOrders: purchaseOrders.filter((po: any) => po.supplierId === supplier.id).map((po: any) => ({ total: po.total })),
          supplierPayments: supplierPayments.filter((sp: any) => sp.supplierId === supplier.id).map((sp: any) => ({ amount: sp.amount })),
        }))
      } else {
        throw dbError
      }
    }

    // Calculate actual balance from purchase orders and payments
    const suppliersWithBalance = suppliers.map((supplier: any) => {
      const totalPurchases = supplier.purchaseOrders.reduce(
        (sum: number, order: any) => sum + (order.total || 0),
        0
      )
      const totalPayments = supplier.supplierPayments.reduce(
        (sum: number, payment: any) => sum + (payment.amount || 0),
        0
      )
      const calculatedBalance = totalPurchases - totalPayments

      return {
        ...supplier,
        balance: calculatedBalance,
        purchaseOrders: undefined,
        supplierPayments: undefined,
      }
    })

    // Update balances asynchronously to not block the response
    // Only update if balance column exists in database
    suppliersWithBalance.forEach((supplier: any) => {
      const originalSupplier = suppliers.find((s: any) => s.id === supplier.id)
      const currentBalance = (originalSupplier as any)?.balance ?? 0
      if (Math.abs(currentBalance - supplier.balance) > 0.01) {
        // Try to update balance, but ignore if column doesn't exist
        prisma.supplier.update({
          where: { id: supplier.id },
          data: { balance: supplier.balance },
        }).catch((err: any) => {
          // Ignore errors if balance column doesn't exist
          if (!err.message?.includes("does not exist") && !err.message?.includes("balance")) {
            console.error(`Error updating balance for supplier ${supplier.id}:`, err)
          }
        })
      }
    })

    return NextResponse.json(suppliersWithBalance)
  } catch (error: any) {
    console.error("Error fetching suppliers:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch suppliers" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, phone, address, city, state, zipCode, country, contactPerson } = body

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      )
    }

    // Try to create supplier - handle if balance column doesn't exist
    let supplier: any
    try {
      supplier = await prisma.supplier.create({
        data: {
          name: name.trim(),
          email: email.trim(),
          phone: phone?.trim() || null,
          address: address?.trim() || null,
          city: city?.trim() || null,
          state: state?.trim() || null,
          zipCode: zipCode?.trim() || null,
          country: country?.trim() || null,
          contactPerson: contactPerson?.trim() || null,
        },
      })
    } catch (createError: any) {
      // If balance column doesn't exist, use raw query with proper parameterization
      if (createError.message?.includes("balance") || createError.message?.includes("does not exist")) {
        const id = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT gen_random_uuid()::text as id
        `
        const supplierId = id[0].id
        
        await prisma.$executeRaw`
          INSERT INTO suppliers (id, name, email, phone, address, city, state, "zipCode", country, "contactPerson", "createdAt", "updatedAt")
          VALUES (${supplierId}, ${name.trim()}, ${email.trim()}, ${phone?.trim() || null}, ${address?.trim() || null}, ${city?.trim() || null}, ${state?.trim() || null}, ${zipCode?.trim() || null}, ${country?.trim() || null}, ${contactPerson?.trim() || null}, NOW(), NOW())
        `
        
        // Fetch the created supplier
        supplier = await prisma.$queryRaw<any>`
          SELECT * FROM suppliers WHERE id = ${supplierId}
        `
        supplier = supplier[0]
      } else {
        throw createError
      }
    }

    return NextResponse.json(supplier, { status: 201 })
  } catch (error: any) {
    console.error("Error creating supplier:", error)
    
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Supplier with this email or name already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create supplier" },
      { status: 500 }
    )
  }
}
