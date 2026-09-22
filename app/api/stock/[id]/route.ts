import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, withAuth } from "@/lib/api"
import { HttpError, assertOwnership } from "@/lib/auth-guard"
import { parseQuantity, setStockQuantity } from "@/lib/stock"

const NOT_FOUND = "Stock not found"

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const stock = await prisma.stock.findUnique({
    where: { id: params.id },
    include: { product: true, warehouse: true },
  })
  assertOwnership(user, stock, NOT_FOUND)
  return NextResponse.json(stock)
})

export const PUT = withAuth<{ id: string }>(async (request, { user, params }) => {
  const existing = await prisma.stock.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  const { quantity, reservedQuantity } = await readJson(request)
  if (quantity === undefined) throw new HttpError(400, "Quantity is required")
  const newQuantity = parseQuantity(quantity, { allowZero: true })

  const stock = await prisma.$transaction(async (tx) => {
    const { oldQuantity } = await setStockQuantity(tx, {
      productId: existing.productId,
      warehouseId: existing.warehouseId,
      quantity: newQuantity,
      userId: user.id,
    })

    if (reservedQuantity !== undefined) {
      const reserved = parseQuantity(reservedQuantity, { allowZero: true })
      if (reserved > newQuantity) throw new HttpError(400, "Reserved quantity cannot exceed quantity")
      await tx.stock.update({ where: { id: params.id }, data: { reservedQuantity: reserved } })
    }

    if (newQuantity !== oldQuantity) {
      await tx.stockMovement.create({
        data: {
          productId: existing.productId,
          warehouseId: existing.warehouseId,
          type: "ADJUSTMENT",
          quantity: newQuantity - oldQuantity,
          reference: "Manual Update",
          notes: "Stock updated via edit",
          userId: user.id,
        },
      })
    }

    return tx.stock.findUnique({
      where: { id: params.id },
      include: { product: true, warehouse: true },
    })
  })

  return NextResponse.json(stock)
})

export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const existing = await prisma.stock.findUnique({ where: { id: params.id } })
  assertOwnership(user, existing, NOT_FOUND)

  await prisma.stock.delete({ where: { id: params.id } })
  return NextResponse.json({ message: "Stock deleted successfully" })
})
