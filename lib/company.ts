import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// Company details for printed documents (invoice, receipts, notes) and the
// walk-in customer used by counter sales. All from Settings.

type Tx = Prisma.TransactionClient | typeof prisma

export const COMPANY_KEYS = ["companyName", "companyAddress", "companyPhone", "companyEmail", "companyWebsite", "paymentTerms"] as const

export const DEFAULT_PAYMENT_TERMS = "Payment due on receipt"
export const LOGO_SETTING = "companyLogo"
/** Max length of the logo data URL (about 300 KB of image). */
export const LOGO_MAX_LENGTH = 400_000
export const WALK_IN_SETTING = "walkInCustomerId"

export async function getCompanyProfile() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...COMPANY_KEYS, LOGO_SETTING] } },
    select: { key: true, value: true, updatedAt: true },
  })
  const get = (key: string) => rows.find((r) => r.key === key)?.value?.trim() ?? ""
  const logo = rows.find((r) => r.key === LOGO_SETTING && r.value)
  return {
    name: get("companyName") || "Siu Warehouse",
    address: get("companyAddress"),
    phone: get("companyPhone"),
    email: get("companyEmail"),
    website: get("companyWebsite"),
    paymentTerms: get("paymentTerms") || DEFAULT_PAYMENT_TERMS,
    // Uploaded logo (served by /api/company/logo, versioned for caching) or the default.
    logoUrl: logo ? `/api/company/logo?v=${logo.updatedAt.getTime()}` : "/siu_logo.png",
  }
}

/** Uploaded logo as { mime, bytes }, or null. */
export async function getCompanyLogo() {
  const row = await prisma.setting.findUnique({ where: { key: LOGO_SETTING } })
  const match = row?.value?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") }
}

/**
 * The walk-in customer (Settings "walkInCustomerId"). Created on first use,
 * and again if it was deleted (e.g. by a data reset). Walk-in sales must be
 * paid in full at the sale (lib/sales-orders.ts).
 */
export async function walkInCustomerId(tx: Tx = prisma): Promise<string> {
  const setting = await tx.setting.findUnique({ where: { key: WALK_IN_SETTING } })
  if (setting?.value && (await tx.customer.findUnique({ where: { id: setting.value }, select: { id: true } }))) return setting.value
  return prisma.$transaction(async (t) => {
    // One creator at a time.
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('walk-in-customer'))`
    const again = await t.setting.findUnique({ where: { key: WALK_IN_SETTING } })
    if (again?.value && (await t.customer.findUnique({ where: { id: again.value }, select: { id: true } }))) return again.value
    const customer = await t.customer.create({ data: { name: "Walk-in customer", email: "", address: "Counter sales (paid at sale)" } })
    await t.setting.upsert({ where: { key: WALK_IN_SETTING }, update: { value: customer.id }, create: { key: WALK_IN_SETTING, value: customer.id } })
    return customer.id
  })
}

/** Id of the walk-in customer if one is configured (never creates it). */
export async function configuredWalkInId(tx: Tx = prisma): Promise<string | null> {
  return (await tx.setting.findUnique({ where: { key: WALK_IN_SETTING } }))?.value || null
}
