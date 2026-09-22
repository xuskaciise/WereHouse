import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"

const NOT_FOUND = "Warehouse not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: params.id } })
  assertOwnership(user, warehouse, NOT_FOUND)
  return NextResponse.json(warehouse)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.warehouse.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  const { name, code, address, city, state, zipCode, country, capacity } = await readJson(request)
  if (!name || !code) throw new HttpError(400, "Name and Code are required")

  try {
    const warehouse = await prisma.warehouse.update({
      where: { id: params.id },
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
    if (error?.code === "P2002") throw new HttpError(409, "Warehouse with this code already exists")
    throw error
  }
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.warehouse.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  try {
    await prisma.warehouse.delete({ where: { id: params.id } })
  } catch (error: any) {
    if (error?.code === "P2003") {
      throw new HttpError(
        409,
        "Cannot delete warehouse that has stock or orders. Please remove all related data first."
      )
    }
    throw error
  }
  return NextResponse.json({ message: "Warehouse deleted successfully" })
})
