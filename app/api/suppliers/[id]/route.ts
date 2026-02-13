import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supplier = await prisma.supplier.findUnique({
      where: { id },
    })

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(supplier)
  } catch (error) {
    console.error("Error fetching supplier:", error)
    return NextResponse.json(
      { error: "Failed to fetch supplier" },
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

    const supplier = await prisma.supplier.update({
      where: { id },
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

    return NextResponse.json(supplier)
  } catch (error: any) {
    console.error("Error updating supplier:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Supplier with this email or name already exists" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to update supplier" },
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
    await prisma.supplier.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Supplier deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting supplier:", error)
    
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    // Handle foreign key constraint (supplier has purchase orders)
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete supplier that has purchase orders. Please remove all related purchase orders first." },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: error.message || "Failed to delete supplier" },
      { status: 500 }
    )
  }
}
