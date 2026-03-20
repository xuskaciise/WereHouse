import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser, isAdminRole } from "@/lib/rbac"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const customer = await prisma.customer.findUnique({
      where: { id },
    })

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }
    if (!isAdminRole(currentUser.role) && customer.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(customer)
  } catch (error) {
    console.error("Error fetching customer:", error)
    return NextResponse.json(
      { error: "Failed to fetch customer" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const { name, email, phone, address, city, state } = body

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    const existingCustomer = await prisma.customer.findUnique({ where: { id } })
    if (!existingCustomer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
    if (!isAdminRole(currentUser.role) && existingCustomer.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name,
        email: email || "",
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
      },
    })

    return NextResponse.json(customer)
  } catch (error: any) {
    console.error("Error updating customer:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Customer with this name or email already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to update customer" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getRequestUser(request)
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const existingCustomer = await prisma.customer.findUnique({ where: { id } })
    if (!existingCustomer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
    if (!isAdminRole(currentUser.role) && existingCustomer.userId !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    await prisma.customer.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Customer deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting customer:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint (customer has sales orders)
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete customer that has sales orders. Please remove all related sales orders first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to delete customer" },
      { status: 500 }
    )
  }
}
