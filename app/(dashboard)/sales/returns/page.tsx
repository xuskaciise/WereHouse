"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Eye, Plus, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCan } from "@/components/providers/current-user-provider"
import { formatCurrency, formatDate } from "@/lib/utils"
import { methodLabel } from "@/lib/payment-methods"

export default function SalesReturnsPage() {
  const canCreate = useCan("sales_returns", "create")
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  useEffect(() => {
    const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }) })
    setLoading(true)
    fetch(`/api/sales-returns?${qs}`)
      .then(async (r) => (r.ok ? setRows(await r.json()) : setRows([])))
      .finally(() => setLoading(false))
  }, [from, to])

  const credit = rows.reduce((s, r) => s + Number(r.total), 0)
  const refunded = rows.reduce((s, r) => s + Number(r.refundAmount), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><Undo2 className="h-7 w-7" /> Sales returns</h1>
          <p className="text-muted-foreground">Delivered goods taken back from customers (credit notes)</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/sales/returns/new"><Plus className="mr-2 h-4 w-4" /> New return</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Returns</CardDescription><CardTitle className="text-2xl">{rows.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Credited to customers</CardDescription><CardTitle className="text-2xl">{formatCurrency(credit)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Refunded in money</CardDescription><CardTitle className="text-2xl">{formatCurrency(refunded)}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle>Credit notes</CardTitle>
              <CardDescription>Each credit note reduces the customer balance</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Sales order</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Credit note</TableHead>
                <TableHead>Refund</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No sales returns.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.returnNumber}</TableCell>
                    <TableCell>{formatDate(r.returnDate)}</TableCell>
                    <TableCell>{r.customer?.name}</TableCell>
                    <TableCell>{r.salesOrder?.orderNumber}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{r.reason}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.total)}</TableCell>
                    <TableCell>{Number(r.refundAmount) > 0 ? `${formatCurrency(r.refundAmount)} · ${methodLabel(r.refundMethod)}` : "Credit on account"}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="icon" title="Open"><Link href={`/sales/returns/${r.id}`}><Eye className="h-4 w-4" /></Link></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
