import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { DEFAULT_PAYMENT_CONFIG, PAYMENT_METHODS, PAYMENT_METHOD_SETTING } from "@/lib/payment-methods"
import { isValidTaxRateInput } from "@/lib/tax-rules"
import { CURRENCIES } from "@/lib/utils"
import { DEFAULT_PAYMENT_TERMS, LOGO_MAX_LENGTH, LOGO_SETTING, WALK_IN_SETTING } from "@/lib/company"

const TAX_KEYS: Record<string, string> = {
  defaultTaxRate: "Default tax rate",
  salesTaxRate: "Sales tax rate",
  purchaseTaxRate: "Purchase tax rate",
}

const DEFAULT_SETTINGS: Record<string, string> = {
  companyName: "Siu Warehouse",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  companyWebsite: "",
  // Printed on invoices and receipts.
  paymentTerms: DEFAULT_PAYMENT_TERMS,
  // data:image/...;base64 (served by /api/company/logo; not returned by GET).
  [LOGO_SETTING]: "",
  // Customer preselected in "Sell now"; its sales must be paid in full at the sale.
  [WALK_IN_SETTING]: "",
  defaultCurrency: "USD",
  // Tax rates in % (0-100, max 2 decimals); an empty sales / purchase rate
  // falls back to the default rate (lib/tax-rules.ts). Stored on each order.
  defaultTaxRate: "0",
  salesTaxRate: "0",
  purchaseTaxRate: "0",
  lowStockThreshold: "10",
  // Days a confirmed sales order holds its stock (1-365, lib/sales-orders.ts).
  salesReservationDays: "7",
  // Enabled payment methods and mobile money prefixes (lib/payment-methods.ts).
  [PAYMENT_METHOD_SETTING]: JSON.stringify(DEFAULT_PAYMENT_CONFIG),
  dateFormat: "MM/DD/YYYY",
  timezone: "UTC",
}
const MAX_VALUE_LENGTH = 500

// Any signed-in user may read settings (company details, tax rates used by forms).
export const GET = withAuth(async () => {
  const settings = await prisma.setting.findMany({
    where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
  })

  const result: Record<string, string | boolean> = { ...DEFAULT_SETTINGS }
  for (const setting of settings) {
    if (setting.value) result[setting.key] = setting.value
  }
  // The logo is large: only whether one is set (the image is at /api/company/logo).
  result.hasCompanyLogo = !!result[LOGO_SETTING]
  delete result[LOGO_SETTING]
  return json(result)
}, { authenticatedOnly: true })

/** Strict check of the payment method settings; returns the normalized JSON. */
function validatePaymentConfig(value: unknown): string {
  let raw: any
  try {
    raw = typeof value === "string" ? JSON.parse(value) : value
  } catch {
    throw new HttpError(400, "Invalid payment method settings")
  }
  const codes = PAYMENT_METHODS.map((m) => m.code)
  if (!raw || !Array.isArray(raw.disabled) || raw.disabled.some((c: unknown) => !codes.includes(c as string))) {
    throw new HttpError(400, "Invalid list of disabled payment methods")
  }
  if (raw.disabled.length >= codes.length) throw new HttpError(400, "At least one payment method must stay enabled")
  const prefixes: Record<string, string[]> = {}
  for (const m of PAYMENT_METHODS.filter((m) => m.mobile)) {
    const list = raw.prefixes?.[m.code] ?? []
    if (!Array.isArray(list) || list.some((p: unknown) => typeof p !== "string" || !/^\d{2}$/.test(p))) {
      throw new HttpError(400, `${m.label} prefixes must be 2-digit numbers, e.g. 61`)
    }
    prefixes[m.code] = Array.from(new Set(list as string[])).sort()
  }
  return JSON.stringify({ disabled: Array.from(new Set(raw.disabled)), prefixes })
}

// Changing settings needs settings:edit, which only ADMIN has (not grantable); unknown keys are rejected.
export const PUT = withAuth(
  async (request) => {
    const body = await readJson<Record<string, unknown>>(request)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Invalid settings payload")
    }

    for (const [key, value] of Object.entries(body)) {
      if (!(key in DEFAULT_SETTINGS)) throw new HttpError(400, `Unknown setting: ${key}`)
      if (typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, `Invalid value for ${key}`)
      }
      if (key in TAX_KEYS) {
        if (!isValidTaxRateInput(value)) throw new HttpError(400, `${TAX_KEYS[key]} must be between 0 and 100 (max 2 decimals)`)
        body[key] = String(value).trim()
        continue
      }
      if (key === "salesReservationDays") {
        const days = Number(value)
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, "Reservation days must be a whole number from 1 to 365")
        body[key] = String(days)
        continue
      }
      if (key === LOGO_SETTING) {
        const v = String(value)
        if (v !== "" && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) {
          throw new HttpError(400, "The logo must be a PNG, JPEG or WebP image")
        }
        if (v.length > LOGO_MAX_LENGTH) throw new HttpError(400, "The logo is too large (max. about 300 KB)")
        continue
      }
      if (key === WALK_IN_SETTING) {
        const v = String(value)
        if (v && !(await prisma.customer.findUnique({ where: { id: v }, select: { id: true } }))) {
          throw new HttpError(400, "Walk-in customer not found")
        }
        continue
      }
      if (key === "paymentTerms" && String(value).length > 300) throw new HttpError(400, "Payment terms must be at most 300 characters")
      if (key === "defaultCurrency") {
        if (!CURRENCIES.includes(String(value) as never)) throw new HttpError(400, `Currency must be one of ${CURRENCIES.join(", ")}`)
        continue
      }
      if (key === PAYMENT_METHOD_SETTING) {
        body[key] = validatePaymentConfig(value)
        continue
      }
      if (String(value).length > MAX_VALUE_LENGTH) throw new HttpError(400, `Value for ${key} is too long`)
    }

    await prisma.$transaction(
      Object.entries(body).map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    )

    return json({ message: "Settings updated successfully" })
  },
  { permission: ["settings", "edit"] }
)
