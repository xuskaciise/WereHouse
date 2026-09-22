import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"

const NOT_FOUND = "Supplier not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: params.id } })
  assertOwnership(user, supplier, NOT_FOUND)
  return NextResponse.json(supplier)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.supplier.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  const { name, email, phone, address, city, state, zipCode, country, contactPerson } = await readJson(request)
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "Name is required")
  if (typeof email !== "string" || !email.trim()) throw new HttpError(400, "Email is required")

  const supplier = await prisma.supplier.update({
    where: { id: params.id },
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
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.supplier.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  const linked = await prisma.purchaseOrder.count({ where: { supplierId: params.id } })
  if (linked > 0) {
    throw new HttpError(
      409,
      "Cannot delete supplier that has purchase orders. Please remove all related purchase orders first."
    )
  }

  await prisma.supplier.delete({ where: { id: params.id } })
  return NextResponse.json({ message: "Supplier deleted successfully" })
})
