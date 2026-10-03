import { formatCurrency } from "@/lib/utils"

/**
 * Goods total + landed costs = total landed cost (from the landed cost view).
 * The goods total is what the supplier is owed; landed costs are owed to
 * their own parties, so the two are labelled separately.
 */
export function LandedTotalSummary({ view }: { view: any }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          Goods total
          <span className="block text-xs">Payable to the supplier (after discount and tax)</span>
        </span>
        <span className="font-medium">{formatCurrency(view.goodsTotal)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          + Landed costs
          <span className="block text-xs">Payable to their own parties (shipping, customs, transport…)</span>
        </span>
        <span className="font-medium">{formatCurrency(view.landedCostsTotal)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t pt-2 text-lg font-bold">
        <span>Total landed cost</span>
        <span>{formatCurrency(view.totalLandedCost)}</span>
      </div>
      <div className="flex justify-between gap-4 text-sm">
        <span className="text-muted-foreground">Uplift (landed costs vs goods value before tax)</span>
        <span className="font-medium">{Number(view.upliftPercent).toFixed(2)}%</span>
      </div>
      <p className="text-xs text-muted-foreground">
        The supplier is owed the goods total only. The total landed cost is what the goods cost the company and is not
        an amount owed to the supplier.
      </p>
    </div>
  )
}
