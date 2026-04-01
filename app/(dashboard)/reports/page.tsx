"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"

type PurchaseOrder = any
type SalesOrder = any
type SupplierPayment = any
type CustomerPayment = any

function inDateRange(dateValue: string | Date, start: string, end: string) {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return false
  if (start) {
    const startDate = new Date(start)
    startDate.setHours(0, 0, 0, 0)
    if (date < startDate) return false
  }
  if (end) {
    const endDate = new Date(end)
    endDate.setHours(23, 59, 59, 999)
    if (date > endDate) return false
  }
  return true
}

export default function ReportsPage() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([])
  const [customerPayments, setCustomerPayments] = useState<CustomerPayment[]>([])

  const [purchaseStartDate, setPurchaseStartDate] = useState("")
  const [purchaseEndDate, setPurchaseEndDate] = useState("")
  const [purchaseSupplier, setPurchaseSupplier] = useState("all")
  const [purchaseStatus, setPurchaseStatus] = useState("all")

  const [salesStartDate, setSalesStartDate] = useState("")
  const [salesEndDate, setSalesEndDate] = useState("")
  const [salesWarehouse, setSalesWarehouse] = useState("all")
  const [salesCustomer, setSalesCustomer] = useState("all")

  useEffect(() => {
    fetchReportData()
  }, [])

  const fetchReportData = async () => {
    try {
      setIsLoading(true)
      const [poRes, soRes, spRes, cpRes] = await Promise.all([
        fetch("/api/purchase-orders"),
        fetch("/api/sales-orders"),
        fetch("/api/supplier-payments"),
        fetch("/api/customer-payments"),
      ])

      if (!poRes.ok || !soRes.ok || !spRes.ok || !cpRes.ok) {
        throw new Error("Failed to fetch report data")
      }

      const [poData, soData, spData, cpData] = await Promise.all([
        poRes.json(),
        soRes.json(),
        spRes.json(),
        cpRes.json(),
      ])

      setPurchaseOrders(poData || [])
      setSalesOrders(soData || [])
      setSupplierPayments(spData || [])
      setCustomerPayments(cpData || [])
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load reports data.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const purchaseSuppliers = useMemo(() => {
    const unique = new Map<string, string>()
    purchaseOrders.forEach((order) => {
      if (order?.supplier?.id) {
        unique.set(order.supplier.id, order.supplier.name || "Unknown")
      }
    })
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }))
  }, [purchaseOrders])

  const salesWarehouses = useMemo(() => {
    const unique = new Map<string, string>()
    salesOrders.forEach((order) => {
      if (order?.warehouse?.id) {
        unique.set(order.warehouse.id, order.warehouse.name || "Unknown")
      }
    })
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }))
  }, [salesOrders])

  const salesCustomers = useMemo(() => {
    const unique = new Map<string, string>()
    salesOrders.forEach((order) => {
      if (order?.customer?.id) {
        unique.set(order.customer.id, order.customer.name || "Unknown")
      }
    })
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }))
  }, [salesOrders])

  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter((order) => {
      const dateMatch = inDateRange(order.orderDate, purchaseStartDate, purchaseEndDate)
      const supplierMatch = purchaseSupplier === "all" || order.supplierId === purchaseSupplier
      const statusMatch = purchaseStatus === "all" || order.status === purchaseStatus
      return dateMatch && supplierMatch && statusMatch
    })
  }, [purchaseOrders, purchaseStartDate, purchaseEndDate, purchaseSupplier, purchaseStatus])

  const filteredSalesOrders = useMemo(() => {
    return salesOrders.filter((order) => {
      const dateMatch = inDateRange(order.orderDate, salesStartDate, salesEndDate)
      const warehouseMatch = salesWarehouse === "all" || order.warehouseId === salesWarehouse
      const customerMatch = salesCustomer === "all" || order.customerId === salesCustomer
      return dateMatch && warehouseMatch && customerMatch
    })
  }, [salesOrders, salesStartDate, salesEndDate, salesWarehouse, salesCustomer])

  const paymentTrackingRows = useMemo(() => {
    const supplierPaymentMap = supplierPayments.reduce((map: Record<string, number>, payment) => {
      if (!payment.purchaseOrderId) return map
      map[payment.purchaseOrderId] = (map[payment.purchaseOrderId] || 0) + (payment.amount || 0)
      return map
    }, {})

    const customerPaymentMap = customerPayments.reduce((map: Record<string, number>, payment) => {
      if (!payment.salesOrderId) return map
      map[payment.salesOrderId] = (map[payment.salesOrderId] || 0) + (payment.amount || 0)
      return map
    }, {})

    const purchaseRows = purchaseOrders.map((order) => {
      const paid = supplierPaymentMap[order.id] || 0
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        type: "PURCHASE",
        party: order.supplier?.name || "N/A",
        total: order.total || 0,
        paid,
        balance: (order.total || 0) - paid,
        orderDate: order.orderDate,
      }
    })

    const salesRows = salesOrders.map((order) => {
      const paid = customerPaymentMap[order.id] || 0
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        type: "SALES",
        party: order.customer?.name || "N/A",
        total: order.total || 0,
        paid,
        balance: (order.total || 0) - paid,
        orderDate: order.orderDate,
      }
    })

    return [...purchaseRows, ...salesRows].sort(
      (a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    )
  }, [purchaseOrders, salesOrders, supplierPayments, customerPayments])

  const clearPurchaseFilters = () => {
    setPurchaseStartDate("")
    setPurchaseEndDate("")
    setPurchaseSupplier("all")
    setPurchaseStatus("all")
  }

  const clearSalesFilters = () => {
    setSalesStartDate("")
    setSalesEndDate("")
    setSalesWarehouse("all")
    setSalesCustomer("all")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Detailed filterable purchase, sales, and payment tracking reports.
        </p>
      </div>

      <Tabs defaultValue="purchases" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="purchases">Purchase Report</TabsTrigger>
          <TabsTrigger value="sales">Sales Report</TabsTrigger>
          <TabsTrigger value="payments">Payments Report</TabsTrigger>
        </TabsList>

        <TabsContent value="purchases" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Filters</CardTitle>
              <CardDescription>Filter by date range, supplier, and status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={purchaseStartDate} onChange={(e) => setPurchaseStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={purchaseEndDate} onChange={(e) => setPurchaseEndDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <Select value={purchaseSupplier} onValueChange={setPurchaseSupplier}>
                    <SelectTrigger><SelectValue placeholder="All Suppliers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Suppliers</SelectItem>
                      {purchaseSuppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={purchaseStatus} onValueChange={setPurchaseStatus}>
                    <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="PENDING">PENDING</SelectItem>
                      <SelectItem value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</SelectItem>
                      <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                      <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                      <SelectItem value="DELIVERED">DELIVERED</SelectItem>
                      <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="outline" onClick={clearPurchaseFilters}>Clear Filters</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Purchase Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!isLoading && filteredPurchaseOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No purchase records found.</TableCell></TableRow>
                  ) : (
                    filteredPurchaseOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>{order.orderNumber}</TableCell>
                        <TableCell>{new Date(order.orderDate).toLocaleDateString()}</TableCell>
                        <TableCell>{order.supplier?.name || "N/A"}</TableCell>
                        <TableCell>{order.warehouse?.name || "N/A"}</TableCell>
                        <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                        <TableCell className="text-right">{formatCurrency(order.total || 0)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sales Filters</CardTitle>
              <CardDescription>Filter by warehouse, customer, and date.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={salesStartDate} onChange={(e) => setSalesStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={salesEndDate} onChange={(e) => setSalesEndDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Warehouse</Label>
                  <Select value={salesWarehouse} onValueChange={setSalesWarehouse}>
                    <SelectTrigger><SelectValue placeholder="All Warehouses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Warehouses</SelectItem>
                      {salesWarehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select value={salesCustomer} onValueChange={setSalesCustomer}>
                    <SelectTrigger><SelectValue placeholder="All Customers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Customers</SelectItem>
                      {salesCustomers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="outline" onClick={clearSalesFilters}>Clear Filters</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sales Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!isLoading && filteredSalesOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No sales records found.</TableCell></TableRow>
                  ) : (
                    filteredSalesOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>{order.orderNumber}</TableCell>
                        <TableCell>{new Date(order.orderDate).toLocaleDateString()}</TableCell>
                        <TableCell>{order.warehouse?.name || "N/A"}</TableCell>
                        <TableCell>{order.customer?.name || "N/A"}</TableCell>
                        <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                        <TableCell className="text-right">{formatCurrency(order.total || 0)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payment Tracking</CardTitle>
              <CardDescription>
                Linked payment status for both Purchase and Sales orders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Order No</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Amount Paid</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!isLoading && paymentTrackingRows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No payment tracking data found.</TableCell></TableRow>
                  ) : (
                    paymentTrackingRows.map((row) => (
                      <TableRow key={`${row.type}-${row.id}`}>
                        <TableCell><Badge variant={row.type === "SALES" ? "default" : "secondary"}>{row.type}</Badge></TableCell>
                        <TableCell>{row.orderNumber}</TableCell>
                        <TableCell>{row.party}</TableCell>
                        <TableCell>{new Date(row.orderDate).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.total)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.paid)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.balance)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
