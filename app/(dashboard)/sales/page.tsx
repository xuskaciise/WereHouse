"use client"

import { useState, useEffect } from "react"
import { CalendarClock, Eye, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import Link from "next/link"
import { totalDiscountOf } from "@/lib/discount-rules"
import { useCan } from "@/components/providers/current-user-provider"
import { SALES_STATUS, isOpenSalesStatus } from "@/lib/sales-labels"

export default function SalesPage() {
  // Hide what the role may not do; the API enforces the same permissions.
  const canCreate = useCan("sales", "create")
  const canSeeReservations = useCan("sales_reservations", "view")
  const [salesOrders, setSalesOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("ALL")

  useEffect(() => {
    fetchSalesOrders(statusFilter)
  }, [statusFilter])

  const fetchSalesOrders = async (status: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/sales-orders${status === "ALL" ? "" : `?status=${status}`}`)
      if (response.ok) {
        const data = await response.json()
        setSalesOrders(data)
      }
    } catch (error) {
      console.error("Error fetching sales orders:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Delivered (invoiced) today: deliveries are what count as sales.
  const calculateTotalSalesToday = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    return salesOrders
      .filter((order) => {
        const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null
        return order.status === "DELIVERED" && deliveredAt && deliveredAt >= today && deliveredAt < tomorrow
      })
      .reduce((sum, order) => sum + Number(order.total || 0), 0)
  }

  // Pending shipments: confirmed or partly delivered (drafts are not orders yet).
  const calculatePendingShipments = () => salesOrders.filter((order) => isOpenSalesStatus(order.status)).length
  const isExpired = (order: any) => isOpenSalesStatus(order.status) && order.reservedUntil && new Date(order.reservedUntil) < new Date()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales Orders</h1>
          <p className="text-muted-foreground">
            Manage customer orders and track sales
          </p>
        </div>
        <div className="flex gap-2">
          {canSeeReservations && (
            <Button asChild variant="outline">
              <Link href="/sales/reservations"><CalendarClock className="mr-2 h-4 w-4" /> Reservations</Link>
            </Button>
          )}
          {canCreate && (
            <Link href="/sales/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Sales Order
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fully delivered today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(calculateTotalSalesToday())}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending Shipments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{calculatePendingShipments()}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Recent Sales Orders</CardTitle>
              <CardDescription>Drafts reserve nothing; confirmed orders hold stock until delivered</CardDescription>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {Object.entries(SALES_STATUS).map(([value, s]) => (
                  <SelectItem key={value} value={value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reserved until</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : salesOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No sales orders found. Click &quot;New Sales Order&quot; to create your first order.
                  </TableCell>
                </TableRow>
              ) : (
                salesOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">
                    {order.orderNumber}
                  </TableCell>
                  <TableCell>{order.customer?.name || "N/A"}</TableCell>
                  <TableCell>{formatDate(order.orderDate || order.createdAt)}</TableCell>
                  <TableCell className={totalDiscountOf(order) > 0 ? "text-green-600" : "text-muted-foreground"}>
                    {totalDiscountOf(order) > 0 ? `-${formatCurrency(totalDiscountOf(order))}` : "-"}
                  </TableCell>
                  <TableCell className="font-medium">{formatCurrency(order.total)}</TableCell>
                  <TableCell>
                    <Badge variant={SALES_STATUS[order.status]?.variant ?? "secondary"}>
                      {SALES_STATUS[order.status]?.label ?? order.status}
                    </Badge>
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
