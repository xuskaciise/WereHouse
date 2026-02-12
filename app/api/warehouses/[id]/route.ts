import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(warehouse)
  } catch (error) {
    console.error("Error fetching warehouse:", error)
    return NextResponse.json(
      { error: "Failed to fetch warehouse" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, code, address, city, state, zipCode, country, capacity } = body

    if (!name || !code) {
      return NextResponse.json(
        { error: "Name and Code are required" },
        { status: 400 }
      )
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        name,
        code,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || null,
        capacity: capacity ? parseInt(capacity.toString()) : null,
      },
    })

    return NextResponse.json(warehouse)
  } catch (error: any) {
    console.error("Error updating warehouse:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Warehouse with this code already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to update warehouse" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.warehouse.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Warehouse deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting warehouse:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint (warehouse has stock, orders, etc.)
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete warehouse that has stock or orders. Please remove all related data first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Failed to delete warehouse" },
      { status: 500 }
    )
  }
}
