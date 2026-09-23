"use client"

import { useState, useEffect } from "react"
import { Plus, Eye, Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"
import { purchaseStatusLabel } from "@/lib/purchase-rules"
import { PurchaseOrderDetailsSheet, purchaseOrderStatusBadgeVariant } from "./purchase-order-details-sheet"

export default function PurchasesPage() {
  const { toast } = useToast()
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [pendingPrint, setPendingPrint] = useState(false)

  useEffect(() => {
    fetchPurchaseOrders()
  }, [])

  useEffect(() => {
    if (!selectedOrder || !pendingPrint) return
    const timer = window.setTimeout(() => {
      window.print()
      setPendingPrint(false)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [selectedOrder, pendingPrint])

  const fetchPurchaseOrders = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/purchase-orders")
      if (response.ok) {
        const data = await response.json()
        setPurchaseOrders(data || [])
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch purchase orders",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching purchase orders:", error)
      toast({
        title: "Error",
        description: "Failed to fetch purchase orders",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const reloadOrdersAndSelection = async (orderId: string) => {
    try {
      const response = await fetch("/api/purchase-orders")
      if (!response.ok) return
      const data = await response.json()
      setPurchaseOrders(data || [])
      const next = (data as any[]).find((o: any) => o.id === orderId)
      if (next) setSelectedOrder(next)
    } catch (error) {
      console.error("Error refreshing purchase orders:", error)
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">
            Manage educational supply orders and track procurement workflow
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Link href="/purchases/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Purchase Order
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Purchase Orders</CardTitle>
              <CardDescription>
                List of all purchase orders
              </CardDescription>
            </div>
            <span className="text-sm text-muted-foreground">
              Total: {purchaseOrders.length}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading purchase orders...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No purchase orders found. Click &quot;New Purchase Order&quot; to create your first order.
                    </TableCell>
                  </TableRow>
                ) : (
                  purchaseOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        {order.orderNumber}
                      </TableCell>
                      <TableCell>{order.supplier?.name || "N/A"}</TableCell>
                      <TableCell>{formatDate(order.orderDate)}</TableCell>
                      <TableCell>{formatCurrency(order.total || 0)}</TableCell>
                      <TableCell>
                        <Badge variant={purchaseOrderStatusBadgeVariant(order.status)}>
                          {purchaseStatusLabel(order.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.user?.username || order.user?.name || "N/A"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setPendingPrint(false)
                              setSelectedOrder(order)
                            }}
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedOrder(order)
                              setPendingPrint(true)
                            }}
                            title="Print"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedOrder && (
        <PurchaseOrderDetailsSheet
          order={selectedOrder}
          open={!!selectedOrder}
          onOpenChange={(open) => !open && setSelectedOrder(null)}
          onReceiveComplete={(orderId) => reloadOrdersAndSelection(orderId)}
        />
      )}
    </div>
  )
}

