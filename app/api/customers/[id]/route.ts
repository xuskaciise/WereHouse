import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"
import { withCustomerBalance } from "@/lib/balances"

const NOT_FOUND = "Customer not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const customer = await prisma.customer.findUnique({ where: { id: params.id } })
  assertOwnership(user, customer, NOT_FOUND)
  const [withBalance] = await withCustomerBalance([customer])
  return NextResponse.json(withBalance)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.customer.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  const { name, email, phone, address, city, state } = await readJson(request)
  if (!name) throw new HttpError(400, "Name is required")

  const customer = await prisma.customer.update({
    where: { id: params.id },
    data: {
      name,
      email: email || "",
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
    },
  })
  const [withBalance] = await withCustomerBalance([customer])
  return NextResponse.json(withBalance)
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.customer.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  try {
    await prisma.customer.delete({ where: { id: params.id } })
  } catch (error: any) {
    if (error?.code === "P2003") {
      throw new HttpError(
        409,
        "Cannot delete customer that has sales orders. Please remove all related sales orders first."
      )
    }
    throw error
  }
  return NextResponse.json({ message: "Customer deleted successfully" })
})
