import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, ownershipWhere } from "@/lib/auth-guard"
import { withCustomerBalance } from "@/lib/balances"

export const GET = withAuth(async (_request, { user }) => {
  const customers = await prisma.customer.findMany({
    where: ownershipWhere(user),
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(await withCustomerBalance(customers))
})

export const POST = withAuth(async (request, { user }) => {
  const { name, email, phone, address, city, state } = await readJson(request)
  if (!name) throw new HttpError(400, "Name is required")

  const customer = await prisma.customer.create({
    data: {
      name,
      email: email || "",
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      userId: user.id,
    },
  })

  return NextResponse.json({ ...customer, balance: 0 }, { status: 201 })
})
