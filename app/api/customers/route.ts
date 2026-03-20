import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, ownershipWhere } from "@/lib/rbac"

export async function GET(request: Request) {
  try {
    const currentUser = await getRequestUser(request)
    const customers = await prisma.customer.findMany({
      where: ownershipWhere(currentUser),
      orderBy: {
        createdAt: "desc",
      },
    })
    return NextResponse.json(customers)
  } catch (error) {
    console.error("Error fetching customers:", error)
    return NextResponse.json(
      { error: "Failed to fetch customers" },
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
    const { name, email, phone, address, city, state } = body

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        email: email || "",
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        userId: currentUser.id,
      },
    })

    return NextResponse.json(customer, { status: 201 })
  } catch (error: any) {
    console.error("Error creating customer:", error)
    
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Customer with this name or email already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to create customer" },
      { status: 500 }
    )
  }
}
