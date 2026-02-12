"use client"

import { useState, useEffect } from "react"
import { Plus, Eye, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"

export default function PurchasesPage() {
  const { toast } = useToast()
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)

  useEffect(() => {
    fetchPurchaseOrders()
  }, [])

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
                      No purchase orders found. Click "New Purchase Order" to create your first order.
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
                        <Badge
                          variant={
                            order.status === "CONFIRMED"
                              ? "success"
                              : order.status === "PENDING"
                              ? "warning"
                              : "default"
                          }
                        >
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.user?.username || order.user?.name || "N/A"}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setSelectedOrder(order)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
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
        />
      )}
    </div>
  )
}

function PurchaseOrderDetailsSheet({
  order,
  open,
  onOpenChange,
}: {
  order: any
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Purchase Order: {order.orderNumber}</SheetTitle>
          <SheetDescription>
            View purchase order details and items
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {/* Order Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Order Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Supplier</h4>
                <p className="mt-1">{order.supplier?.name || "N/A"}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Warehouse</h4>
                <p className="mt-1">{order.warehouse?.name || "N/A"}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Order Date</h4>
                <p className="mt-1">{formatDate(order.orderDate)}</p>
              </div>
              {order.expectedDeliveryDate && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Expected Delivery</h4>
                  <p className="mt-1">{formatDate(order.expectedDeliveryDate)}</p>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
                <p className="mt-1">
                  <Badge
                    variant={
                      order.status === "CONFIRMED"
                        ? "success"
                        : order.status === "PENDING"
                        ? "warning"
                        : "default"
                    }
                  >
                    {order.status}
                  </Badge>
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Created By</h4>
                <p className="mt-1">{order.user?.username || order.user?.name || "N/A"}</p>
              </div>
            </div>
            {order.notes && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Notes</h4>
                <p className="mt-1">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Order Items */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Order Items</h3>
            {order.items && order.items.length > 0 ? (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.product?.name || "N/A"}
                        </TableCell>
                        <TableCell>{item.product?.sku || "N/A"}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.subtotal || item.quantity * item.unitPrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground">No items found</p>
            )}
          </div>

          {/* Order Summary */}
          <div className="space-y-4 border-t pt-4">
            <h3 className="text-lg font-semibold">Order Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(order.subtotal || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (8%)</span>
                <span className="font-medium">{formatCurrency(order.tax || 0)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium text-green-600">
                    -{formatCurrency(order.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(order.total || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
