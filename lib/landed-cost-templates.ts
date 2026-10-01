import type { Prisma } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { withConflictMessages } from "@/lib/api"
import { parseLandedCostInput } from "@/lib/landed-costs"
import { assertCostsEditable, assertPurchaseOrderInScope, createLandedCostInTx, lockPurchaseOrder } from "@/lib/landed-cost-service"
import { assertCanReference } from "@/lib/ownership"
import { postAccounting } from "@/lib/accounting"
import type { SessionUser } from "@/lib/auth-guard"

// Landed cost templates: a saved set of cost lines (type, paid to, fixed
// amount or %, allocation) applied to a purchase order in one click. Each
// line becomes an ordinary landed cost through the same validation and
// service as a manually added one (lib/landed-cost-service.ts).

export const templateInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: { type: { select: { id: true, name: true, isActive: true } }, paidToSupplier: { select: { id: true, name: true } } },
  },
} satisfies Prisma.LandedCostTemplateInclude

const nameKey = (name: string) => name.trim().toLowerCase()

/** Body: { name, description?, isActive?, items: [{ typeId, paidToSupplierId?, amountType, value, percentBase, allocationMethod }] } */
async function parseTemplate(body: any, { partial }: { partial: boolean }) {
  const data: { name?: string; nameKey?: string; description?: string | null; isActive?: boolean } = {}
  if (!partial || body?.name !== undefined) {
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : ""
    if (!name) throw new HttpError(400, "Template name is required")
    if (name.length > 80) throw new HttpError(400, "Template name must be at most 80 characters")
    data.name = name
    data.nameKey = nameKey(name)
  }
  if (body?.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim() : ""
    if (d.length > 300) throw new HttpError(400, "Description must be at most 300 characters")
    data.description = d || null
  }
  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false")
    data.isActive = body.isActive
  }
  let items: Prisma.LandedCostTemplateItemCreateManyTemplateInput[] | undefined
  if (!partial || body?.items !== undefined) {
    if (!Array.isArray(body?.items) || body.items.length === 0) throw new HttpError(400, "Add at least one cost line")
    if (body.items.length > 20) throw new HttpError(400, "A template can have at most 20 lines")
    items = []
    for (const [index, raw] of (body.items as any[]).entries()) {
      // Same rules as a landed cost (paid-to may be left empty: chosen when applying).
      const input = parseLandedCostInput({ ...raw, paidToSupplierId: raw?.paidToSupplierId || "__apply__" })
      if (input.allocationMethod === "MANUAL") throw new HttpError(400, `Line ${index + 1}: manual allocation cannot be saved in a template`)
      const type = await prisma.landedCostType.findUnique({ where: { id: input.typeId }, select: { isActive: true } })
      if (!type?.isActive) throw new HttpError(400, `Line ${index + 1}: choose an active cost type`)
      const supplierId = raw?.paidToSupplierId ? String(raw.paidToSupplierId) : null
      if (supplierId && !(await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) {
        throw new HttpError(400, `Line ${index + 1}: paid-to party not found`)
      }
      items.push({
        typeId: input.typeId,
        paidToSupplierId: supplierId,
        amountType: input.amountType,
        value: input.value,
        percentBase: input.percentBase,
        allocationMethod: input.allocationMethod,
        sortOrder: index,
      })
    }
  }
  return { data, items }
}

export async function listTemplates({ activeOnly }: { activeOnly: boolean }) {
  return prisma.landedCostTemplate.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: templateInclude,
    orderBy: { name: "asc" },
  })
}

const duplicate = (name?: string) => ({ unique: `A template named "${name ?? ""}" already exists` })

export async function createTemplate(user: SessionUser, body: any) {
  const { data, items } = await parseTemplate(body, { partial: false })
  return withConflictMessages(
    () =>
      prisma.landedCostTemplate.create({
        data: { name: data.name!, nameKey: data.nameKey!, description: data.description ?? null, isActive: data.isActive ?? true, userId: user.id, items: { createMany: { data: items! } } },
        include: templateInclude,
      }),
    duplicate(data.name)
  )
}

export async function updateTemplate(id: string, body: any) {
  const { data, items } = await parseTemplate(body, { partial: true })
  return withConflictMessages(
    () =>
      prisma.$transaction(async (tx) => {
        if (!(await tx.landedCostTemplate.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "Template not found")
        if (items) {
          await tx.landedCostTemplateItem.deleteMany({ where: { templateId: id } })
          await tx.landedCostTemplateItem.createMany({ data: items.map((i) => ({ ...i, templateId: id })) })
        }
        return tx.landedCostTemplate.update({ where: { id }, data, include: templateInclude })
      }, TX_OPTIONS),
    duplicate(data.name)
  )
}

export async function deleteTemplate(id: string) {
  const found = await prisma.landedCostTemplate.findUnique({ where: { id }, select: { id: true } })
  if (!found) throw new HttpError(404, "Template not found")
  await prisma.landedCostTemplate.delete({ where: { id } })
}

/**
 * Applies a template to a purchase order: one landed cost per line, in one
 * transaction (all or nothing). Lines without a fixed paid-to party use
 * body.paidToSupplierId, else the PO supplier. Body: { templateId,
 * paidToSupplierId?, reference?, costDate?, reason? (finalized costs) }.
 */
export async function applyTemplate(user: SessionUser, purchaseOrderId: string, body: any): Promise<number> {
  await assertPurchaseOrderInScope(user, purchaseOrderId, "landed_costs")
  const template = await prisma.landedCostTemplate.findUnique({ where: { id: String(body?.templateId ?? "") }, include: templateInclude })
  if (!template || !template.isActive) throw new HttpError(400, "Choose an active template")
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { supplierId: true } })
  const fallbackSupplier = typeof body?.paidToSupplierId === "string" && body.paidToSupplierId ? body.paidToSupplierId : po.supplierId

  const inputs = template.items.map((item) => {
    if (!item.type.isActive) throw new HttpError(400, `Cost type "${item.type.name}" is inactive; update the template`)
    return {
      typeName: item.type.name,
      input: parseLandedCostInput({
        typeId: item.typeId,
        paidToSupplierId: item.paidToSupplierId ?? fallbackSupplier,
        amountType: item.amountType,
        value: item.value.toString(),
        percentBase: item.percentBase,
        allocationMethod: item.allocationMethod,
        reference: body?.reference,
        costDate: body?.costDate,
        notes: `Template: ${template.name}`,
      }),
    }
  })
  for (const { input } of inputs) await assertCanReference(user, { supplierId: input.paidToSupplierId })

  return prisma.$transaction(async (tx) => {
    const locked = await lockPurchaseOrder(tx, purchaseOrderId)
    const reason = assertCostsEditable(user, locked, body?.reason)
    for (const { input, typeName } of inputs) await createLandedCostInTx(tx, user.id, purchaseOrderId, input, { reason, typeName })
    await postAccounting(tx, {}, user.id)
    return inputs.length
  }, TX_OPTIONS)
}
