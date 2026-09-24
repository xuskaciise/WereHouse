import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { DEFAULT_PAYMENT_CONFIG, PAYMENT_METHODS, PAYMENT_METHOD_SETTING } from "@/lib/payment-methods"

const DEFAULT_SETTINGS: Record<string, string> = {
  companyName: "Siu Warehouse",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  companyWebsite: "",
  defaultCurrency: "USD",
  defaultTaxRate: "8",
  salesTaxRate: "5",
  purchaseTaxRate: "8",
  lowStockThreshold: "10",
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

  const result = { ...DEFAULT_SETTINGS }
  for (const setting of settings) {
    if (setting.value) result[setting.key] = setting.value
  }
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

// Changing settings needs settings:edit (ADMIN by default); unknown keys are rejected.
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
