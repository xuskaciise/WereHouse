"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useParams } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatDate, formatUnitCost } from "@/lib/utils"
import { paymentSummary } from "@/lib/payment-methods"

// Printable credit note (SR-000001).
export default function SalesReturnPage() {
  const { id } = useParams<{ id: string }>()
  const [r, setR] = useState<any | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch(`/api/sales-returns/${id}`).then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (res.ok) setR(data)
      else setError(data.error || "Failed to load the credit note")
    })
  }, [id])

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!r) return <p className="py-12 text-center text-muted-foreground">Loading...</p>
  const seesCost = r.cogs !== undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost"><Link href="/sales/returns"><ArrowLeft className="mr-2 h-4 w-4" /> Sales returns</Link></Button>
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print credit note</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Credit note {r.returnNumber}</CardTitle>
              <CardDescription className="mt-1 text-base">
                Customer: <span className="font-medium text-foreground">{r.customer?.name}</span>
                {r.customer?.phone && ` · ${r.customer.phone}`}
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(r.returnDate)} · for sales order{" "}
                <Link className="underline print:no-underline" href={`/sales/${r.salesOrder?.id}`}>{r.salesOrder?.orderNumber}</Link> ({formatDate(r.salesOrder?.orderDate)}) · warehouse {r.warehouse?.name} · by {r.user?.username}
              </p>
            </div>
            <Image src="/siu_logo.png" alt="SIU" width={64} height={64} className="h-14 w-auto" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 text-sm"><span className="font-medium">Reason:</span> {r.reason}{r.notes && <div className="mt-1 text-muted-foreground">{r.notes}</div>}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {seesCost && <TableHead className="text-right print:hidden">Unit cost</TableHead>}
                {seesCost && <TableHead className="text-right print:hidden">Cost</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.items.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell><div className="font-medium">{i.product?.name}</div><div className="text-xs text-muted-foreground">{i.product?.sku}</div></TableCell>
                  <TableCell>
                    <Badge variant={i.condition === "DAMAGED" ? "destructive" : "success"}>{i.condition === "DAMAGED" ? "Damaged" : "Resellable"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(i.amount)}</TableCell>
                  {seesCost && <TableCell className="text-right print:hidden">{formatUnitCost(i.unitCost)}</TableCell>}
                  {seesCost && <TableCell className="text-right print:hidden">{formatCurrency(i.cogs)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="ml-auto max-w-sm space-y-1 text-sm">
            <div className="flex justify-between"><span>Goods (after line discounts)</span><span>{formatCurrency(r.subtotal)}</span></div>
            {Number(r.discount) > 0 && <div className="flex justify-between text-green-600"><span>Share of order discount</span><span>-{formatCurrency(r.discount)}</span></div>}
            {Number(r.tax) > 0 && <div className="flex justify-between"><span>Share of tax</span><span>{formatCurrency(r.tax)}</span></div>}
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Credit to customer</span><span>{formatCurrency(r.total)}</span></div>
            {Number(r.refundAmount) > 0 ? (
              <div className="flex justify-between"><span>Refunded ({paymentSummary({ paymentMethod: r.refundMethod, payerPhone: r.payerPhone, transactionId: r.transactionId })})</span><span>{formatCurrency(r.refundAmount)}</span></div>
            ) : (
              <div className="text-muted-foreground">Credited to the customer account</div>
            )}
            {seesCost && (
              <div className="space-y-1 text-muted-foreground print:hidden">
                <div className="flex justify-between"><span>Cost reversed (original)</span><span>{formatCurrency(r.cogs)}</span></div>
                {Number(r.lossValue) > 0 && <div className="flex justify-between text-destructive"><span>of which damaged (loss)</span><span>{formatCurrency(r.lossValue)}</span></div>}
              </div>
            )}
          </div>
          <div className="hidden grid-cols-2 gap-8 pt-10 text-sm print:grid">
            <div className="border-t pt-2">Received by (name / signature / date)</div>
            <div className="border-t pt-2">Customer (name / signature / date)</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
