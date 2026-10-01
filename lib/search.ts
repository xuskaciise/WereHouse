import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { type PermissionUser, hasPermission, scopeWhere } from "@/lib/permissions"
import type { Module } from "@/lib/permission-rules"

// Global search (navbar, Ctrl+K): products, customers, suppliers and document
// numbers. Every section is filtered by the user's permissions and scope.

export interface SearchHit {
  type: string
  label: string
  sub?: string
  href: string
}

const LIMIT = 6

export async function globalSearch(user: PermissionUser, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 60)
  if (q.length < 2) return []
  const has = (mod: Module) => hasPermission(user, [mod, "view"])
  const contains = { contains: q, mode: "insensitive" as const }
  const tasks: Promise<SearchHit[]>[] = []

  if (has("products")) {
    tasks.push(
      prisma.product
        .findMany({ where: { ...scopeWhere(user, "products"), OR: [{ name: contains }, { sku: contains }] } as Prisma.ProductWhereInput, take: LIMIT, select: { id: true, name: true, sku: true } })
        .then((rows) => rows.map((r) => ({ type: "Product", label: r.name, sub: r.sku, href: `/products?q=${encodeURIComponent(r.sku)}` })))
    )
  }
  if (has("customers")) {
    tasks.push(
      prisma.customer
        .findMany({ where: { ...scopeWhere(user, "customers"), OR: [{ name: contains }, { phone: contains }, { email: contains }] } as Prisma.CustomerWhereInput, take: LIMIT, select: { id: true, name: true, phone: true } })
        .then((rows) => rows.map((r) => ({ type: "Customer", label: r.name, sub: r.phone ?? undefined, href: `/customers?q=${encodeURIComponent(r.name)}` })))
    )
  }
  if (has("suppliers")) {
    tasks.push(
      prisma.supplier
        .findMany({ where: { ...scopeWhere(user, "suppliers"), OR: [{ name: contains }, { phone: contains }, { email: contains }] } as Prisma.SupplierWhereInput, take: LIMIT, select: { id: true, name: true, phone: true } })
        .then((rows) => rows.map((r) => ({ type: "Supplier", label: r.name, sub: r.phone ?? undefined, href: `/suppliers?q=${encodeURIComponent(r.name)}` })))
    )
  }
  if (has("sales")) {
    tasks.push(
      prisma.salesOrder
        .findMany({ where: { ...scopeWhere(user, "sales"), OR: [{ orderNumber: contains }, { deliveries: { some: { deliveryNumber: contains } } }] }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, orderNumber: true, customer: { select: { name: true } } } })
        .then((rows) => rows.map((r) => ({ type: "Sales order", label: r.orderNumber, sub: r.customer.name, href: `/sales/${r.id}` })))
    )
  }
  if (has("purchases")) {
    tasks.push(
      prisma.purchaseOrder
        .findMany({ where: { ...scopeWhere(user, "purchases"), orderNumber: contains }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, orderNumber: true, supplier: { select: { name: true } } } })
        .then((rows) => rows.map((r) => ({ type: "Purchase order", label: r.orderNumber, sub: r.supplier.name, href: `/purchases/${r.id}` })))
    )
  }
  if (has("stock_transfers")) {
    tasks.push(
      prisma.stockTransfer
        .findMany({ where: { ...scopeWhere(user, "stock_transfers"), transferNumber: contains }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, transferNumber: true } })
        .then((rows) => rows.map((r) => ({ type: "Transfer", label: r.transferNumber, href: `/transfers/${r.id}` })))
    )
  }
  if (has("sales_returns")) {
    tasks.push(
      prisma.salesReturn
        .findMany({ where: { ...scopeWhere(user, "sales_returns"), returnNumber: contains }, take: LIMIT, select: { id: true, returnNumber: true, customer: { select: { name: true } } } })
        .then((rows) => rows.map((r) => ({ type: "Credit note", label: r.returnNumber, sub: r.customer.name, href: `/sales/returns/${r.id}` })))
    )
  }
  if (has("purchase_returns")) {
    tasks.push(
      prisma.purchaseReturn
        .findMany({ where: { ...scopeWhere(user, "purchase_returns"), returnNumber: contains }, take: LIMIT, select: { id: true, returnNumber: true, supplier: { select: { name: true } } } })
        .then((rows) => rows.map((r) => ({ type: "Purchase return", label: r.returnNumber, sub: r.supplier.name, href: `/purchases/returns/${r.id}` })))
    )
  }
  if (has("accounting")) {
    tasks.push(
      prisma.journalEntry
        .findMany({ where: { ...scopeWhere(user, "accounting"), entryNumber: contains }, take: LIMIT, select: { entryNumber: true, description: true } })
        .then((rows) => rows.map((r) => ({ type: "Journal entry", label: r.entryNumber, sub: r.description, href: `/accounts/journal?q=${encodeURIComponent(r.entryNumber)}` })))
    )
  }
  return (await Promise.all(tasks)).flat()
}
