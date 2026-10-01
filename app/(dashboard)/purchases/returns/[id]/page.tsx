"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatDate, formatUnitCost } from "@/lib/utils"
import { CompanyHeader } from "@/components/company-header"
import { paymentSummary } from "@/lib/payment-methods"

// Printable purchase return note (PR-000001).
export default function PurchaseReturnPage() {
  const { id } = useParams<{ id: string }>()
  const [r, setR] = useState<any | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch(`/api/purchase-returns/${id}`).then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (res.ok) setR(data)
      else setError(data.error || "Failed to load the return")
    })
  }, [id])

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!r) return <p className="py-12 text-center text-muted-foreground">Loading...</p>
  const seesCost = r.costValue !== undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost"><Link href="/purchases/returns"><ArrowLeft className="mr-2 h-4 w-4" /> Purchase returns</Link></Button>
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print return note</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Purchase return note {r.returnNumber}</CardTitle>
              <CardDescription className="mt-1 text-base">
                To supplier: <span className="font-medium text-foreground">{r.supplier?.name}</span>
                {r.supplier?.phone && ` · ${r.supplier.phone}`}
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(r.returnDate)} · from warehouse {r.warehouse?.name} · purchase order {r.purchaseOrder?.orderNumber} ({formatDate(r.purchaseOrder?.orderDate)}) · by {r.user?.username}
              </p>
            </div>
            <CompanyHeader />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 text-sm"><span className="font-medium">Reason:</span> {r.reason}{r.notes && <div className="mt-1 text-muted-foreground">{r.notes}</div>}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {seesCost && <TableHead className="text-right print:hidden">Unit cost</TableHead>}
                {seesCost && <TableHead className="text-right print:hidden">Stock value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.items.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell><div className="font-medium">{i.product?.name}</div><div className="text-xs text-muted-foreground">{i.product?.sku}</div></TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(i.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(i.amount)}</TableCell>
                  {seesCost && <TableCell className="text-right print:hidden">{formatUnitCost(i.unitCost)}</TableCell>}
                  {seesCost && <TableCell className="text-right print:hidden">{formatCurrency(i.costValue)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="ml-auto max-w-sm space-y-1 text-sm">
            <div className="flex justify-between"><span>Goods</span><span>{formatCurrency(r.goodsAmount)}</span></div>
            {Number(r.discount) > 0 && <div className="flex justify-between text-green-600"><span>Share of order discount</span><span>-{formatCurrency(r.discount)}</span></div>}
            {Number(r.tax) > 0 && <div className="flex justify-between"><span>Share of tax</span><span>{formatCurrency(r.tax)}</span></div>}
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Credit from supplier</span><span>{formatCurrency(r.creditTotal)}</span></div>
            {Number(r.refundAmount) > 0 ? (
              <div className="flex justify-between"><span>Refunded ({paymentSummary({ paymentMethod: r.refundMethod, payerPhone: r.payerPhone, transactionId: r.transactionId })})</span><span>{formatCurrency(r.refundAmount)}</span></div>
            ) : (
              <div className="text-muted-foreground">Settled as credit on the supplier account</div>
            )}
            {seesCost && <div className="flex justify-between text-muted-foreground print:hidden"><span>Stock value out (avg cost)</span><span>{formatCurrency(r.costValue)}</span></div>}
          </div>
          <div className="hidden grid-cols-2 gap-8 pt-10 text-sm print:grid">
            <div className="border-t pt-2">Returned by (name / signature / date)</div>
            <div className="border-t pt-2">Received by supplier (name / signature / date)</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
