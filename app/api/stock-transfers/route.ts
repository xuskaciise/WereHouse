import type { Prisma, TransferStatus } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { requirePermission, scopeWhere } from "@/lib/permissions"
import { assertCanReference } from "@/lib/ownership"
import { createWithOrderNumber } from "@/lib/orders"
import { dateRangeWhere, listResponse } from "@/lib/pagination"
import { addEvent, dispatchTransfer, parseTransferInput, receiveTransfer, transferInclude } from "@/lib/stock-transfers"

const STATUSES: TransferStatus[] = ["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]

// ?status=, ?warehouseId= (source or destination), ?from=&to= (transfer date), ?page=
export const GET = withAuth(async (request, { user }) => {
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  if (status && !STATUSES.includes(status as TransferStatus)) throw new HttpError(400, "Invalid status")
  const warehouseId = params.get("warehouseId")
  const where: Prisma.StockTransferWhereInput = {
    ...scopeWhere(user, "stock_transfers"),
    ...dateRangeWhere(request, "transferDate"),
    ...(status && { status: status as TransferStatus }),
    ...(warehouseId && { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }),
  }
  return listResponse(request, {
    findMany: (page) =>
      prisma.stockTransfer.findMany({
        where,
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, username: true } },
          items: { select: { quantity: true, dispatchedQuantity: true, receivedQuantity: true, lostQuantity: true, returnedQuantity: true } },
        },
        orderBy: { createdAt: "desc" },
        ...page,
      }),
    count: () => prisma.stockTransfer.count({ where }),
  })
}, { permission: ["stock_transfers", "view"] })

/**
 * Body: { fromWarehouseId, toWarehouseId, expectedDate?, notes?, items: [{ productId, quantity }],
 *         mode?: "DRAFT" (default) | "DISPATCH" | "INSTANT" }
 * DISPATCH sends the goods right away; INSTANT dispatches and receives everything in one step.
 */
export const POST = withAuth(async (request, { user }) => {
  const body = await readJson(request)
  const input = parseTransferInput(body)
  const mode = body.mode ?? "DRAFT"
  if (!["DRAFT", "DISPATCH", "INSTANT"].includes(mode)) throw new HttpError(400, "mode must be DRAFT, DISPATCH or INSTANT")
  if (mode !== "DRAFT") requirePermission(user, ["stock_transfers", "edit"], "Your role cannot dispatch transfers")
  await assertCanReference(user, {
    warehouseId: input.fromWarehouseId,
    productIds: input.items.map((i) => i.productId),
  })
  await assertCanReference(user, { warehouseId: input.toWarehouseId })

  const id = await createWithOrderNumber(
    "TR",
    () => prisma.stockTransfer.count(),
    (transferNumber) =>
      prisma.$transaction(async (tx) => {
        const transfer = await tx.stockTransfer.create({
          data: {
            transferNumber,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            expectedDate: input.expectedDate,
            notes: input.notes,
            instant: mode === "INSTANT",
            userId: user.id,
            items: { create: input.items },
          },
          include: { items: true },
        })
        await addEvent(tx, { stockTransferId: transfer.id, type: "CREATED", userId: user.id, notes: input.notes })
        if (mode !== "DRAFT") await dispatchTransfer(tx, transfer.id, user.id)
        if (mode === "INSTANT") {
          await receiveTransfer(
            tx,
            transfer.id,
            user.id,
            transfer.items.map((i) => ({ itemId: i.id, received: i.quantity, lost: 0, reason: null })),
            "Instant transfer"
          )
        }
        return transfer.id
      }, TX_OPTIONS)
  )

  return json(await prisma.stockTransfer.findUnique({ where: { id }, include: transferInclude }), { status: 201 })
}, { permission: ["stock_transfers", "create"] })
