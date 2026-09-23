import type { DiscountType } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, parseMoney, roundMoney, sumMoney } from "@/lib/money"
import type { OrderItemInput } from "@/lib/orders"
import {
  DISCOUNT_REASON_MAX_LENGTH,
  DISCOUNT_REASON_THRESHOLD_PERCENT,
  MAX_SALES_DISCOUNT_SETTING,
  SALES_TAX_RATE,
  parseMaxDiscountPercent,
} from "@/lib/discount-rules"

// Sales order discounts. Everything here is Decimal and runs on the server;
// totals sent by the client are never used.
//
//   line gross     = quantity x unitPrice
//   line subtotal  = line gross - line discount            (never below 0)
//   subtotal       = sum of line subtotals
//   order discount = % of subtotal, or a fixed amount      (never above subtotal)
//   taxable        = subtotal - order discount
//   tax            = taxable x 5%
//   total          = taxable + tax

export interface Discount {
  type: DiscountType | null
  value: Money
}

const NO_DISCOUNT: Discount = { type: null, value: ZERO }
const HUNDRED = new Decimal(100)

/** Parses `{ type: "PERCENT" | "AMOUNT", value }`; missing or 0 means no discount. */
export function parseDiscount(raw: unknown, label: string): Discount {
  if (raw === undefined || raw === null || raw === "") return NO_DISCOUNT
  if (typeof raw !== "object") throw new HttpError(400, `${label} discount is invalid`)
  const { type, value } = raw as { type?: unknown; value?: unknown }
  if (value === undefined || value === null || value === "") return NO_DISCOUNT
  if (type !== "PERCENT" && type !== "AMOUNT") {
    throw new HttpError(400, `${label} discount type must be PERCENT or AMOUNT`)
  }
  const parsed = parseMoney(value, { field: `${label} discount`, allowZero: true })
  if (type === "PERCENT" && parsed.gt(HUNDRED)) {
    throw new HttpError(400, `${label} discount percentage must be between 0 and 100`)
  }
  return parsed.isZero() ? NO_DISCOUNT : { type, value: parsed }
}

function discountAmount(base: Money, discount: Discount, label: string): Money {
  if (!discount.type) return ZERO
  const amount = discount.type === "PERCENT" ? roundMoney(base.times(discount.value).div(HUNDRED)) : discount.value
  if (amount.gt(base)) {
    throw new HttpError(
      400,
      `${label} discount (${amount.toFixed(2)}) cannot be larger than the amount it applies to (${base.toFixed(2)})`
    )
  }
  return amount
}

export interface SalesLineTotals extends OrderItemInput {
  discountType: DiscountType | null
  discountValue: Money
  discountAmount: Money
}

export function calculateSalesTotals(
  items: OrderItemInput[],
  lineDiscounts: Discount[],
  orderDiscount: Discount,
  itemLabel: (index: number) => string
) {
  let gross = ZERO
  const lines: SalesLineTotals[] = items.map((item, index) => {
    const lineGross = roundMoney(item.unitPrice.times(item.quantity))
    gross = gross.plus(lineGross)
    const discount = lineDiscounts[index] ?? NO_DISCOUNT
    const amount = discountAmount(lineGross, discount, itemLabel(index))
    return {
      ...item,
      subtotal: lineGross.minus(amount),
      discountType: discount.type,
      discountValue: discount.value,
      discountAmount: amount,
    }
  })

  const subtotal = sumMoney(lines.map((line) => line.subtotal))
  const itemDiscount = sumMoney(lines.map((line) => line.discountAmount))
  const discount = discountAmount(subtotal, orderDiscount, "Order")
  const taxable = subtotal.minus(discount)
  const tax = roundMoney(taxable.times(SALES_TAX_RATE))
  const total = taxable.plus(tax)
  const totalDiscount = itemDiscount.plus(discount)
  // Share of the gross amount given away, e.g. 12.5 for 12.5%.
  const discountPercent = gross.isZero() ? ZERO : totalDiscount.times(HUNDRED).div(gross)

  return {
    lines,
    gross,
    subtotal,
    itemDiscount,
    discount,
    discountType: orderDiscount.type,
    discountValue: orderDiscount.value,
    taxable,
    tax,
    total,
    totalDiscount,
    discountPercent,
  }
}

export async function getMaxSalesDiscountPercent(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: MAX_SALES_DISCOUNT_SETTING } })
  return parseMaxDiscountPercent(setting?.value)
}

/** Reason is required above the role limit, and always above 20%. */
export function isDiscountReasonRequired(discountPercent: Money, limitPercent: number): boolean {
  return discountPercent.gt(Math.min(limitPercent, DISCOUNT_REASON_THRESHOLD_PERCENT))
}

export function parseDiscountReason(value: unknown, required: boolean): string | null {
  const reason = typeof value === "string" ? value.trim() : ""
  if (!reason) {
    if (required) throw new HttpError(400, "A reason is required for this discount")
    return null
  }
  if (reason.length > DISCOUNT_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Discount reason must be at most ${DISCOUNT_REASON_MAX_LENGTH} characters`)
  }
  return reason
}

export function formatPercent(value: Money): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()
}
