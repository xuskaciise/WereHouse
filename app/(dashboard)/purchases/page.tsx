"use client"

import { useState, useEffect } from "react"
import { Plus, Eye, Download, Printer, PackageCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"

function totalReceivedForLineItem(item: { receiveItems?: { quantityReceived: number }[] }) {
  if (!item?.receiveItems?.length) return 0
  return item.receiveItems.reduce((s, r) => s + r.quantityReceived, 0)
}

function purchaseOrderStatusBadgeVariant(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "success" as const
    case "PARTIALLY_RECEIVED":
      return "default" as const
    case "PENDING":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function canReceivePurchaseOrder(order: { status?: string }) {
  return order?.status === "PENDING" || order?.status === "PARTIALLY_RECEIVED"
}

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
                        <Badge variant={purchaseOrderStatusBadgeVariant(order.status)}>
                          {order.status}
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

function PurchaseOrderDetailsSheet({
  order,
  open,
  onOpenChange,
  onReceiveComplete,
}: {
  order: any
  open: boolean
  onOpenChange: (open: boolean) => void
  onReceiveComplete: (orderId: string) => void | Promise<void>
}) {
  const { toast } = useToast()
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveNote, setReceiveNote] = useState("")
  const [receiveQtyByItemId, setReceiveQtyByItemId] = useState<Record<string, string>>({})
  const [receiveSubmitting, setReceiveSubmitting] = useState(false)

  const openReceiveDialog = () => {
    const init: Record<string, string> = {}
    for (const item of order.items || []) {
      const recv = totalReceivedForLineItem(item)
      const rem = Math.max(0, item.quantity - recv)
      init[item.id] = rem > 0 ? String(rem) : "0"
    }
    setReceiveQtyByItemId(init)
    setReceiveNote("")
    setReceiveOpen(true)
  }

  const submitReceive = async () => {
    if (!order?.id) return
    setReceiveSubmitting(true)
    try {
      const lines = (order.items || []).map((item: any) => ({
        purchaseOrderItemId: item.id,
        quantityReceived: parseInt(receiveQtyByItemId[item.id] || "0", 10) || 0,
      }))
      const res = await fetch(`/api/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, notes: receiveNote.trim() || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Receive failed")
      }
      toast({
        title: "Goods received",
        description: "Warehouse stock and movements have been updated.",
      })
      setReceiveOpen(false)
      await onReceiveComplete(order.id)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to receive order"
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      })
    } finally {
      setReceiveSubmitting(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <div id="purchase-order-print-root" className="space-y-6 pt-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pr-6">
              <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/siu_logo.png"
                  alt="SIU"
                  className="h-12 w-auto max-w-[200px] object-contain object-left"
                />
                <div className="min-w-0 text-left">
                  <SheetTitle className="text-left text-xl font-semibold leading-tight">
                    Purchase Order: {order.orderNumber}
                  </SheetTitle>
                  <SheetDescription className="text-left mt-1">
                    View purchase order details and items
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden shrink-0">
                {canReceivePurchaseOrder(order) && (
                  <Button type="button" variant="default" size="sm" onClick={openReceiveDialog}>
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Receive Order
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </div>
            </div>
            <div className="space-y-6">
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
                      <Badge variant={purchaseOrderStatusBadgeVariant(order.status)}>
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

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Order Items</h3>
                {order.items && order.items.length > 0 ? (
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-right">Ordered</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.items.map((item: any) => {
                          const recv = totalReceivedForLineItem(item)
                          const rem = Math.max(0, item.quantity - recv)
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.product?.name || "N/A"}
                              </TableCell>
                              <TableCell>{item.product?.sku || "N/A"}</TableCell>
                              <TableCell className="text-right">{item.quantity}</TableCell>
                              <TableCell className="text-right">{recv}</TableCell>
                              <TableCell className="text-right">{rem}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(item.unitPrice)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(item.subtotal || item.quantity * item.unitPrice)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No items found</p>
                )}
              </div>

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
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Receive goods — {order.orderNumber}</DialogTitle>
            <DialogDescription>
              Enter quantities actually received at {order.warehouse?.name || "the warehouse"}. Stock
              updates only after you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right w-20">Max</TableHead>
                  <TableHead className="text-right w-28">Receive now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order.items || []).map((item: any) => {
                  const recv = totalReceivedForLineItem(item)
                  const rem = Math.max(0, item.quantity - recv)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-sm">
                        {item.product?.name || "N/A"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{rem}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={rem}
                          className="h-8 w-24 text-right ml-auto"
                          disabled={rem <= 0}
                          value={receiveQtyByItemId[item.id] ?? "0"}
                          onChange={(e) =>
                            setReceiveQtyByItemId((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="space-y-2">
              <Label htmlFor="receive-note">Receiving notes (optional)</Label>
              <Textarea
                id="receive-note"
                value={receiveNote}
                onChange={(e) => setReceiveNote(e.target.value)}
                placeholder="Delivery reference, condition, etc."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitReceive} disabled={receiveSubmitting}>
              {receiveSubmitting ? "Saving…" : "Confirm receive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
