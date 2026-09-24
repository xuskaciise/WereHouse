import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { Decimal, type Money, roundMoney } from "@/lib/money"
import { TAX_SETTINGS, type TaxKind, resolveTaxRate } from "@/lib/tax-rules"

/** Tax rate (percent) for new orders of this kind, read from Settings on the server. */
export async function currentTaxRate(kind: TaxKind): Promise<Money> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [TAX_SETTINGS.default, TAX_SETTINGS[kind]] } },
  })
  return new Decimal(resolveTaxRate(Object.fromEntries(rows.map((r) => [r.key, r.value])), kind))
}

/** Tax on `base` at `ratePercent` (e.g. 8 for 8%), rounded to cents. */
export function taxOn(base: Money, ratePercent: Prisma.Decimal.Value): Money {
  return roundMoney(base.times(ratePercent).div(100))
}
