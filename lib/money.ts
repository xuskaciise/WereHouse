import { Prisma } from "@prisma/client"
import { HttpError } from "@/lib/http-error"

// Money is stored as NUMERIC(12,2) (Prisma Decimal) and all server-side
// arithmetic uses Decimal, so totals and balances never pick up
// floating-point rounding errors.

export type Money = Prisma.Decimal
export const Decimal = Prisma.Decimal
export const ZERO: Money = new Prisma.Decimal(0)
const MAX_AMOUNT = new Prisma.Decimal("9999999999.99")

/** Rounds to cents (half-up). */
export function roundMoney(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Parses user input into a 2-decimal Money value, or throws 400. */
export function parseMoney(
  value: unknown,
  { field = "Amount", allowZero = false }: { field?: string; allowZero?: boolean } = {}
): Money {
  let parsed: Money
  try {
    if (typeof value !== "number" && typeof value !== "string") throw new Error()
    if (typeof value === "string" && value.trim() === "") throw new Error()
    parsed = new Prisma.Decimal(value)
  } catch {
    throw new HttpError(400, `${field} must be a number`)
  }
  if (!parsed.isFinite() || parsed.isNegative() || (!allowZero && parsed.isZero()) || parsed.gt(MAX_AMOUNT)) {
    throw new HttpError(400, allowZero ? `${field} must be 0 or more` : `${field} must be greater than 0`)
  }
  return roundMoney(parsed)
}

export function sumMoney(values: Iterable<Prisma.Decimal.Value | null | undefined>): Money {
  let total = ZERO
  for (const value of values) if (value != null) total = total.plus(value)
  return total
}

/** Converts Decimal values (at any depth) to plain numbers for JSON responses. */
export function toJsonSafe<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Prisma.Decimal.isDecimal(value)) return (value as unknown as Money).toNumber() as T
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item)) as T
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = toJsonSafe(item)
  }
  return result as T
}

/** Optional non-negative measurement (weight, volume); null when empty. */
export function parseOptionalMeasure(value: unknown, field: string, decimals: number): Prisma.Decimal | null {
  if (value === undefined || value === null || value === "") return null
  let parsed: Prisma.Decimal
  try {
    parsed = new Prisma.Decimal(value as Prisma.Decimal.Value)
  } catch {
    throw new HttpError(400, `${field} must be a number`)
  }
  if (!parsed.isFinite() || parsed.isNegative()) throw new HttpError(400, `${field} must be 0 or more`)
  return parsed.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP)
}
