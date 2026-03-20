import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, ownershipWhere } from "@/lib/rbac"

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
    const warehouses = await prisma.warehouse.findMany({
      where: ownershipWhere(currentUser),
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(warehouses)
  } catch (error) {
    console.error("Error fetching warehouses:", error)
    return NextResponse.json(
      { error: "Failed to fetch warehouses" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const body = await request.json()
    const { name, code, address, city, state, zipCode, country, capacity } = body

    if (!name || !code) {
      return NextResponse.json(
        { error: "Name and Code are required" },
        { status: 400 }
      )
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        name,
        code,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || null,
        capacity: capacity ? parseInt(capacity.toString()) : null,
        userId: currentUser.id,
      },
    })

    return NextResponse.json(warehouse, { status: 201 })
  } catch (error: any) {
    console.error("Error creating warehouse:", error)
    
    // Handle unique constraint violations
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Warehouse with this code already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create warehouse" },
      { status: 500 }
    )
  }
}
