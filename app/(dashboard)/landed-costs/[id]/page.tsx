"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate } from "@/lib/utils"
import { METHOD_LABELS, unit4 } from "../../purchases/landed-costs-section"

export default function LandedCostReportPage() {
  const { id } = useParams<{ id: string }>()
  const seesCost = useCan("product_cost", "view")
  const [view, setView] = useState<any | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}/landed-costs`).then(async (res) => {
      if (res.ok) setView(await res.json())
      else setError((await res.json().catch(() => ({}))).error || "Failed to load the report")
    })
  }, [id])

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!view) return <p className="py-12 text-center text-muted-foreground">Loading...</p>
  const po = view.purchaseOrder

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="ghost">
          <Link href="/purchases">
            <ArrowLeft className="mr-2 h-4 w-4" /> Purchase orders
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Landed cost report — {po.orderNumber}</CardTitle>
              <CardDescription>
                {po.supplier?.name} · {po.warehouse?.name} · ordered {formatDate(po.orderDate)}
              </CardDescription>
              <div className="mt-2">
                {po.costsFinalizedAt ? (
                  <Badge variant="success">
                    Costs finalized {formatDate(po.costsFinalizedAt)}
                    {po.costsFinalizedBy ? ` by ${po.costsFinalizedBy.username}` : ""}
                  </Badge>
                ) : (
                  <Badge variant="warning">Costs not finalized</Badge>
                )}
              </div>
            </div>
            <Image src="/siu_logo.png" alt="SIU" width={64} height={64} className="h-14 w-auto" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Goods value</div>
              <div className="text-xl font-semibold">{formatCurrency(view.goodsValue)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Additional costs</div>
              <div className="text-xl font-semibold">{formatCurrency(view.totalCosts)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Uplift</div>
              <div className="text-xl font-semibold">{Number(view.upliftPercent).toFixed(2)}%</div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Costs</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Paid to</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Allocation</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.costs.map((cost: any) => (
                  <TableRow key={cost.id}>
                    <TableCell className="font-medium">{cost.type?.name}</TableCell>
                    <TableCell>{cost.paidToSupplier?.name}</TableCell>
                    <TableCell>
                      {cost.amountType === "FIXED"
                        ? "Fixed"
                        : `${Number(cost.value)}% of ${cost.percentBase === "GOODS" ? "goods value" : "goods + fixed costs"}`}
                    </TableCell>
                    <TableCell>{METHOD_LABELS[cost.allocationMethod]}</TableCell>
                    <TableCell>{cost.reference || "-"}</TableCell>
                    <TableCell>{cost.paymentStatus.replace("_", " ")}</TableCell>
                    <TableCell className="text-right">{formatCurrency(cost.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6}>Total additional costs</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(view.totalCosts)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {seesCost && (
            <div>
              <h3 className="mb-2 font-semibold">Unit cost per product</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Goods value</TableHead>
                    <TableHead className="text-right">Allocated costs</TableHead>
                    <TableHead className="text-right">Unit cost before</TableHead>
                    <TableHead className="text-right">Landed unit cost</TableHead>
                    <TableHead className="text-right">Increase</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.product?.name}
                        <div className="text-xs text-muted-foreground">{item.product?.sku}</div>
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.subtotal)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.landedCost)}</TableCell>
                      <TableCell className="text-right">{unit4(item.unitPrice)}</TableCell>
                      <TableCell className="text-right font-semibold">{unit4(item.landedUnitCost)}</TableCell>
                      <TableCell className="text-right">{Number(item.costIncreasePercent).toFixed(2)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="space-y-1 rounded-md bg-muted p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">How these figures are calculated</p>
            <p>
              Percentage costs are calculated on the goods value (the order subtotal before tax), or on the goods value
              plus the fixed costs when that basis is chosen. Each cost is allocated to the lines by value, quantity,
              weight, volume or manually; allocations are rounded to the cent and any difference goes to the last line.
              Landed unit cost = unit price + allocated costs / quantity (4 decimals).
            </p>
            <p>
              Received goods enter the warehouse average cost at their landed unit cost. If a cost is added or changed
              after some of the goods were already sold, the change is split with an average-cost approximation: the
              share min(units in stock, units received) / units received updates the stock value; the rest is booked as
              cost of goods sold (it lowers the profit of the period).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
