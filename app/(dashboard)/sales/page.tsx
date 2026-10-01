"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CalendarClock, Eye, Plus, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { totalDiscountOf } from "@/lib/discount-rules"
import { useCan } from "@/components/providers/current-user-provider"
import { SALES_STATUS, isOpenSalesStatus } from "@/lib/sales-labels"
import { ListPagination, ListStateRow, SearchBox, usePagedList } from "@/components/data-list"

const ALL = "ALL"
const count = (url: string) => fetch(url).then((r) => (r.ok ? Number(r.headers.get("X-Total-Count") ?? 0) : 0)).catch(() => 0)

export default function SalesPage() {
  // Hide what the role may not do; the API enforces the same permissions.
  const canCreate = useCan("sales", "create")
  const canSellNow = useCan("sales_deliver", "create")
  const canSeeReservations = useCan("sales_reservations", "view")
  const [status, setStatus] = useState(ALL)
  const list = usePagedList("/api/sales-orders", { status: status === ALL ? undefined : status })
  const [counts, setCounts] = useState<{ drafts: number; open: number } | null>(null)

  // Order counts by state (server-side, whatever page is shown).
  useEffect(() => {
    const base = "/api/sales-orders?view=summary&page=1&pageSize=1&status="
    Promise.all([count(base + "DRAFT"), count(base + "CONFIRMED"), count(base + "PARTIALLY_DELIVERED")]).then(([drafts, confirmed, partial]) =>
      setCounts({ drafts, open: confirmed + partial })
    )
  }, [list.total])

  const isExpired = (order: any) => isOpenSalesStatus(order.status) && order.reservedUntil && new Date(order.reservedUntil) < new Date()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales orders</h1>
          <p className="text-muted-foreground">Drafts reserve nothing; confirmed orders hold stock until delivered</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSeeReservations && (
            <Button asChild variant="outline">
              <Link href="/sales/reservations"><CalendarClock className="mr-2 h-4 w-4" /> Reservations</Link>
            </Button>
          )}
          {canSellNow && (
            <Button asChild variant="outline">
              <Link href="/sales/new?mode=sell"><Store className="mr-2 h-4 w-4" /> Sell now</Link>
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href="/sales/new"><Plus className="mr-2 h-4 w-4" /> New sales order</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Waiting for delivery (confirmed / partly delivered)</CardDescription>
            <CardTitle className="text-2xl">{counts?.open ?? "…"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Drafts (no stock reserved)</CardDescription>
            <CardTitle className="text-2xl">{counts?.drafts ?? "…"}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>{list.loading ? "…" : `${list.total} order(s)`}</CardDescription>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <SearchBox value={list.q} onChange={list.setQ} placeholder="Order number or customer" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {Object.entries(SALES_STATUS).map(([value, s]) => (
                    <SelectItem key={value} value={value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reserved until</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListStateRow
                colSpan={8}
                loading={list.loading && list.rows.length === 0}
                error={list.error}
                empty={list.rows.length === 0}
                searching={!!list.q || status !== ALL}
                emptyText="No sales orders yet."
                action={canSellNow ? { label: "Sell now", href: "/sales/new?mode=sell" } : canCreate ? { label: "New sales order", href: "/sales/new" } : null}
              />
              {list.rows.map((order: any) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">
                    <Link href={`/sales/${order.id}`} className="hover:underline">{order.orderNumber}</Link>
                  </TableCell>
                  <TableCell>{order.customer?.name || "N/A"}</TableCell>
                  <TableCell>{formatDate(order.orderDate || order.createdAt)}</TableCell>
                  <TableCell className={totalDiscountOf(order) > 0 ? "text-green-600" : "text-muted-foreground"}>
                    {totalDiscountOf(order) > 0 ? `-${formatCurrency(totalDiscountOf(order))}` : "-"}
                  </TableCell>
                  <TableCell className="font-medium">{formatCurrency(order.total)}</TableCell>
                  <TableCell>
                    <Badge variant={SALES_STATUS[order.status]?.variant ?? "secondary"}>{SALES_STATUS[order.status]?.label ?? order.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {isOpenSalesStatus(order.status) && order.reservedUntil ? (
                      <span className={isExpired(order) ? "font-medium text-destructive" : ""}>
                        {formatDate(order.reservedUntil)}
                        {isExpired(order) && <Badge variant="destructive" className="ml-2">Expired</Badge>}
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="icon" title="Open">
                      <Link href={`/sales/${order.id}`}><Eye className="h-4 w-4" /></Link>
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
