// Shared helpers for the integration tests on the DEV database.
import type { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { Decimal } from "@/lib/money"
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, type EditableRole } from "@/lib/permission-rules"
import type { SessionUser } from "@/lib/auth-guard"
import { receiveIntoStock } from "@/lib/stock-valuation"
import { postAccounting } from "@/lib/accounting"

export function assertDevDatabase() {
  const host = new URL(process.env.DATABASE_URL!).hostname
  if (!host.startsWith("ep-icy-glade")) throw new Error("not the dev database: " + host)
  console.log("dev host:", host)
}

let failures = 0
export function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`)
  if (!ok) failures++
}
export async function expectError(name: string, fn: () => Promise<unknown>, status: number) {
  try {
    await fn()
    check(name, false, "no error")
  } catch (e: any) {
    check(name, e?.status === status, `${e?.status} ${e?.message}`)
  }
}
export function finish() {
  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
  process.exitCode = failures ? 1 : 0
}

export const eq = (a: Prisma.Decimal.Value, b: Prisma.Decimal.Value) => new Decimal(a).eq(b)

export async function testUser(username: string, role: "ADMIN" | EditableRole): Promise<SessionUser> {
  const row = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, name: username, role, status: "APPROVED" },
  })
  return { id: row.id, name: row.name, username, role, permissions: role === "ADMIN" ? ADMIN_PERMISSIONS : DEFAULT_PERMISSIONS[role] }
}

export async function fixtures(tag: string, user: SessionUser) {
  const wh = await prisma.warehouse.create({ data: { name: `WH ${tag}`, code: tag, userId: user.id } })
  const cat = await prisma.category.create({ data: { name: `Cat ${tag}`, userId: user.id } })
  const product = (n: string, price: number, cost: number) =>
    prisma.product.create({
      data: { name: `${n} ${tag}`, sku: `${n}-${tag}`, categoryId: cat.id, sellingPrice: price, costPrice: cost, reorderLevel: 1, userId: user.id },
    })
  const supplier = await prisma.supplier.create({ data: { name: `Sup ${tag}`, email: "s@x.so", userId: user.id } })
  const customer = await prisma.customer.create({ data: { name: `Cust ${tag}`, email: "c@x.so", userId: user.id } })
  return { wh, cat, product, supplier, customer }
}

/**
 * A purchase order fully received (like the receive route: stock IN at the
 * unit price, movement, receive record). lines: [productId, quantity, unitPrice].
 */
export async function receivedPurchase(
  user: SessionUser,
  f: { supplierId: string; warehouseId: string; orderNumber: string },
  lines: [string, number, number][],
  { discount = 0, taxRate = 0 } = {}
) {
  const subtotal = lines.reduce((s, [, q, p]) => s.plus(new Decimal(p).times(q)), new Decimal(0))
  const tax = subtotal.times(taxRate).div(100).toDecimalPlaces(2)
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        orderNumber: f.orderNumber,
        supplierId: f.supplierId,
        warehouseId: f.warehouseId,
        userId: user.id,
        status: "CONFIRMED",
        subtotal,
        discount,
        tax,
        taxRate,
        total: subtotal.plus(tax).minus(discount),
        items: {
          create: lines.map(([productId, q, p]) => ({ productId, quantity: q, originalQuantity: q, unitPrice: p, subtotal: new Decimal(p).times(q) })),
        },
      },
      include: { items: true },
    })
    const receive = await tx.purchaseReceive.create({
      data: {
        purchaseOrderId: po.id,
        userId: user.id,
        items: { create: po.items.map((i) => ({ purchaseOrderItemId: i.id, quantityReceived: i.quantity })) },
      },
    })
    for (const i of po.items) {
      await receiveIntoStock(tx, {
        productId: i.productId,
        warehouseId: f.warehouseId,
        quantity: i.quantity,
        value: i.subtotal,
        userId: user.id,
        purchaseOrderItemId: i.id,
      })
      await tx.stockMovement.create({
        data: { productId: i.productId, warehouseId: f.warehouseId, type: "IN", quantity: i.quantity, reference: po.orderNumber, referenceId: receive.id, userId: user.id },
      })
    }
    // Journal like the receive route (payable, stock value).
    await postAccounting(tx, {}, user.id)
    return po
  }, { ...TX_OPTIONS, timeout: 120_000 }) // the dev database is remote and slow
}
