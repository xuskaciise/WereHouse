import { prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { DEFAULT_MAX_SALES_DISCOUNT_PERCENT, MAX_SALES_DISCOUNT_SETTING } from "@/lib/discount-rules"

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
  // Maximum total discount (%) for roles other than ADMIN/WAREHOUSE_MANAGER.
  [MAX_SALES_DISCOUNT_SETTING]: String(DEFAULT_MAX_SALES_DISCOUNT_PERCENT),
  dateFormat: "MM/DD/YYYY",
  timezone: "UTC",
}
const MAX_VALUE_LENGTH = 500

// Any signed-in user may read settings.
export const GET = withAuth(async () => {
  const settings = await prisma.setting.findMany({
    where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
  })

  const result = { ...DEFAULT_SETTINGS }
  for (const setting of settings) {
    if (setting.value) result[setting.key] = setting.value
  }
  return json(result)
})

// Only ADMIN may change company-wide settings; unknown keys are rejected.
export const PUT = withAuth(
  async (request) => {
    const body = await readJson<Record<string, unknown>>(request)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Invalid settings payload")
    }

    const entries = Object.entries(body)
    for (const [key, value] of entries) {
      if (!(key in DEFAULT_SETTINGS)) throw new HttpError(400, `Unknown setting: ${key}`)
      if (typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, `Invalid value for ${key}`)
      }
      if (String(value).length > MAX_VALUE_LENGTH) throw new HttpError(400, `Value for ${key} is too long`)
      if (key === MAX_SALES_DISCOUNT_SETTING) {
        const n = Number(value)
        if (String(value).trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
          throw new HttpError(400, "Maximum sales discount must be a number between 0 and 100")
        }
      }
    }

    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    )

    return json({ message: "Settings updated successfully" })
  },
  { roles: ["ADMIN"] }
)
