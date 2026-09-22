import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withAuth } from "@/lib/api"
import { ownershipWhere } from "@/lib/auth-guard"

export const GET = withAuth(async (request, { user: currentUser }) => {
  try {
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
})

export const POST = withAuth(async (request, { user: currentUser }) => {
  try {
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
})
