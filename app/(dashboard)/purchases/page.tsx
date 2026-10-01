"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, Eye, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { purchaseStatusLabel } from "@/lib/purchase-rules"
import { purchaseOrderStatusBadgeVariant } from "./purchase-order-details-sheet"
import { useCan } from "@/components/providers/current-user-provider"
import { downloadCsv, moneyCell } from "@/lib/export-file"
import { ListPagination, ListStateRow, SearchBox, usePagedList } from "@/components/data-list"

const ALL = "ALL"
const STATUSES = ["PENDING", "PARTIALLY_RECEIVED", "CONFIRMED", "CANCELLED"]

export default function PurchasesPage() {
  const router = useRouter()
  // Hide what the role may not do; the API enforces the same permissions.
  const canCreate = useCan("purchases", "create")
  const [status, setStatus] = useState(ALL)
  const list = usePagedList("/api/purchase-orders", { status: status === ALL ? undefined : status })

  // Old links (?open=<id>) go to the purchase order page.
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open")
    if (open) router.replace(`/purchases/${open}`)
  }, [router])

  const exportCsv = async () => {
    // All matching orders (not only this page).
    const params = new URLSearchParams({ view: "summary" })
    if (list.q.trim()) params.set("q", list.q.trim())
    if (status !== ALL) params.set("status", status)
    const res = await fetch(`/api/purchase-orders?${params}`)
    if (!res.ok) return
    const rows = await res.json()
    downloadCsv(`purchase_orders_${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Order", "Date", "Supplier", "Warehouse", "Status", "Subtotal", "Discount", "Tax", "Total"],
      ...rows.map((o: any) => [
        o.orderNumber,
        String(o.orderDate).slice(0, 10),
        o.supplier?.name,
        o.warehouse?.name,
        purchaseStatusLabel(o.status),
        moneyCell(o.subtotal),
        moneyCell(o.discount),
        moneyCell(o.tax),
        moneyCell(o.total),
      ]),
    ])
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase orders</h1>
          <p className="text-muted-foreground">Order from suppliers, receive the goods, add landed costs and pay</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={list.total === 0} onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {canCreate && (
            <Button asChild>
              <Link href="/purchases/new"><Plus className="mr-2 h-4 w-4" /> New purchase order</Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>{list.loading ? "…" : `${list.total} order(s)`}</CardDescription>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <SearchBox value={list.q} onChange={list.setQ} placeholder="PO number or supplier" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{purchaseStatusLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListStateRow
                colSpan={7}
                loading={list.loading && list.rows.length === 0}
                error={list.error}
                empty={list.rows.length === 0}
                searching={!!list.q || status !== ALL}
                emptyText="No purchase orders yet."
                action={canCreate ? { label: "New purchase order", href: "/purchases/new" } : null}
              />
              {list.rows.map((order: any) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">
                    <Link href={`/purchases/${order.id}`} className="hover:underline">{order.orderNumber}</Link>
                  </TableCell>
                  <TableCell>{order.supplier?.name || "N/A"}</TableCell>
                  <TableCell>{formatDate(order.orderDate)}</TableCell>
                  <TableCell>{formatCurrency(order.total || 0)}</TableCell>
                  <TableCell>
                    <Badge variant={purchaseOrderStatusBadgeVariant(order.status)}>{purchaseStatusLabel(order.status)}</Badge>
                  </TableCell>
                  <TableCell>{order.user?.username || order.user?.name || "N/A"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="icon" title="Open">
                      <Link href={`/purchases/${order.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination list={list} />
        </CardContent>
      </Card>
    </div>
  )
}
