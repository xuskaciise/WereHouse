"use client"

import { useState, useEffect } from "react"
import { Plus, MoreHorizontal, Printer, Edit, Trash2, Eye, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"

export default function PaymentsPage() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("customers")
  const [customerPayments, setCustomerPayments] = useState<any[]>([])
  const [supplierPayments, setSupplierPayments] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [salesOrders, setSalesOrders] = useState<any[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<any | null>(null)
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null)

  useEffect(() => {
    fetchCustomerPayments()
    fetchSupplierPayments()
    fetchCustomers()
    fetchSuppliers()
    fetchSalesOrders()
    fetchPurchaseOrders()
  }, [])

  const fetchCustomerPayments = async () => {
    try {
      const response = await fetch("/api/customer-payments")
      if (response.ok) {
        const data = await response.json()
        setCustomerPayments(data)
      }
    } catch (error) {
      console.error("Error fetching customer payments:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchSupplierPayments = async () => {
    try {
      const response = await fetch("/api/supplier-payments")
      if (response.ok) {
        const data = await response.json()
        setSupplierPayments(data)
      }
    } catch (error) {
      console.error("Error fetching supplier payments:", error)
    }
  }

  const fetchCustomers = async () => {
    try {
      const response = await fetch("/api/customers")
      if (response.ok) {
        const data = await response.json()
        setCustomers(data)
      }
    } catch (error) {
      console.error("Error fetching customers:", error)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const response = await fetch("/api/suppliers")
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data)
      }
    } catch (error) {
      console.error("Error fetching suppliers:", error)
    }
  }

  const fetchSalesOrders = async () => {
    try {
      const response = await fetch("/api/sales-orders")
      if (response.ok) {
        const data = await response.json()
        setSalesOrders(data)
      }
    } catch (error) {
      console.error("Error fetching sales orders:", error)
    }
  }

  const fetchPurchaseOrders = async () => {
    try {
      const response = await fetch("/api/purchase-orders")
      if (response.ok) {
        const data = await response.json()
        setPurchaseOrders(data)
      }
    } catch (error) {
      console.error("Error fetching purchase orders:", error)
    }
  }

  const handlePrintInvoice = (payment: any, type: string) => {
    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    const paymentType = type === "customer" ? "Customer Payment Receipt" : "Supplier Payment Receipt"
    const entityName = type === "customer" ? payment.customer?.name : payment.supplier?.name
    const entityLabel = type === "customer" ? "Customer" : "Supplier"

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${paymentType}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { margin: 0; font-size: 24px; }
            .header p { margin: 5px 0; color: #666; }
            .details { margin: 30px 0; }
            .details table { width: 100%; border-collapse: collapse; }
            .details td { padding: 8px; border-bottom: 1px solid #eee; }
            .details td:first-child { font-weight: bold; width: 150px; }
            .footer { margin-top: 40px; text-align: center; color: #666; font-size: 12px; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Siu Warehouse</h1>
            <p>123 Business School Ave., Education District, ED 10245</p>
            <h2>${paymentType}</h2>
          </div>
          <div class="details">
            <table>
              <tr><td>Payment ID:</td><td>${payment.id}</td></tr>
              <tr><td>${entityLabel}:</td><td>${entityName || "N/A"}</td></tr>
              <tr><td>Amount:</td><td>${formatCurrency(payment.amount)}</td></tr>
              <tr><td>Payment Date:</td><td>${formatDate(payment.paymentDate)}</td></tr>
              <tr><td>Payment Method:</td><td>${payment.paymentMethod}</td></tr>
              ${payment.reference ? `<tr><td>Reference:</td><td>${payment.reference}</td></tr>` : ""}
              ${payment.notes ? `<tr><td>Notes:</td><td>${payment.notes}</td></tr>` : ""}
              <tr><td>Created By:</td><td>${payment.user?.username || payment.user?.name || "N/A"}</td></tr>
            </table>
          </div>
          <div class="footer">
            <p>Generated on ${new Date().toLocaleString()}</p>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    setTimeout(() => {
      printWindow.print()
    }, 250)
  }

  const handleDeletePayment = async () => {
    if (!deletePaymentId) return

    try {
      const endpoint = activeTab === "customers" 
        ? `/api/customer-payments/${deletePaymentId}`
        : `/api/supplier-payments/${deletePaymentId}`

      const response = await fetch(endpoint, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Payment deleted successfully.",
        })
        fetchCustomerPayments()
        fetchSupplierPayments()
        fetchCustomers()
        fetchSuppliers()
        setDeletePaymentId(null)
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete payment.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error deleting payment:", error)
      toast({
        title: "Error",
        description: "Failed to delete payment. Please try again.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground mt-1">
            Manage customer and supplier payments
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{editingPayment ? "Edit Payment" : "Record Payment"}</DialogTitle>
              <DialogDescription>
                {editingPayment 
                  ? `Update payment details for ${activeTab === "customers" ? "customer" : "supplier"}`
                  : `Record a new payment for ${activeTab === "customers" ? "customer" : "supplier"}`
                }
              </DialogDescription>
            </DialogHeader>
            <PaymentForm
              type={activeTab}
              customers={customers}
              suppliers={suppliers}
              salesOrders={salesOrders}
              purchaseOrders={purchaseOrders}
              payment={editingPayment}
              onSuccess={() => {
                setIsDialogOpen(false)
                setEditingPayment(null)
                fetchCustomerPayments()
                fetchSupplierPayments()
                // Refresh customers and suppliers to get updated balances
                fetchCustomers()
                fetchSuppliers()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="customers">Customer Payments</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Customer Payments</CardTitle>
              <CardDescription>
                Record and track payments received from customers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Balance After</TableHead>
                      <TableHead>Created By</TableHead>
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
                  ) : customerPayments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No customer payments found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    customerPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">
                          {payment.customer?.name || "N/A"}
                        </TableCell>
                        <TableCell>{formatCurrency(payment.amount)}</TableCell>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>{payment.paymentMethod}</TableCell>
                        <TableCell>{payment.reference || "-"}</TableCell>
                        <TableCell>
                          <span className={payment.customer?.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                            {formatCurrency(payment.customer?.balance || 0)}
                          </span>
                        </TableCell>
                        <TableCell>{payment.user?.username || payment.user?.name || "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <PaymentActions
                            payment={payment}
                            type="customer"
                            onView={() => setSelectedPayment(payment)}
                            onEdit={() => {
                              setEditingPayment(payment)
                              setIsDialogOpen(true)
                            }}
                            onDelete={() => setDeletePaymentId(payment.id)}
                            onPrint={() => handlePrintInvoice(payment, "customer")}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Supplier Payments</CardTitle>
              <CardDescription>
                Record and track payments made to suppliers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Balance After</TableHead>
                      <TableHead>Created By</TableHead>
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
                  ) : supplierPayments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No supplier payments found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    supplierPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">
                          {payment.supplier?.name || "N/A"}
                        </TableCell>
                        <TableCell>{formatCurrency(payment.amount)}</TableCell>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>{payment.paymentMethod}</TableCell>
                        <TableCell>{payment.reference || "-"}</TableCell>
                        <TableCell>
                          <span className={payment.supplier?.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                            {formatCurrency(payment.supplier?.balance || 0)}
                          </span>
                        </TableCell>
                        <TableCell>{payment.user?.username || payment.user?.name || "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <PaymentActions
                            payment={payment}
                            type="supplier"
                            onView={() => setSelectedPayment(payment)}
                            onEdit={() => {
                              setEditingPayment(payment)
                              setIsDialogOpen(true)
                            }}
                            onDelete={() => setDeletePaymentId(payment.id)}
                            onPrint={() => handlePrintInvoice(payment, "supplier")}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Details Sheet */}
      {selectedPayment && (
        <PaymentDetailsSheet
          payment={selectedPayment}
          type={activeTab}
          open={!!selectedPayment}
          onOpenChange={(open) => !open && setSelectedPayment(null)}
          onPrint={() => handlePrintInvoice(selectedPayment, activeTab)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will delete the payment and restore the balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PaymentActions({
  payment,
  type,
  onView,
  onEdit,
  onDelete,
  onPrint,
}: {
  payment: any
  type: string
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onPrint: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Invoice
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Edit className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PaymentDetailsSheet({
  payment,
  type,
  open,
  onOpenChange,
  onPrint,
}: {
  payment: any
  type: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPrint: () => void
}) {
  if (!payment) return null

  const entityName = type === "customers" ? payment.customer?.name : payment.supplier?.name
  const entityLabel = type === "customers" ? "Customer" : "Supplier"
  const balance = type === "customers" ? payment.customer?.balance : payment.supplier?.balance

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {type === "customers" ? "Customer Payment" : "Supplier Payment"} Details
          </SheetTitle>
          <SheetDescription>
            Payment ID: {payment.id}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" onClick={onPrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Invoice
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">{entityLabel}</div>
              <div className="text-base font-semibold">{entityName || "N/A"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Amount</div>
              <div className="text-base font-semibold">{formatCurrency(payment.amount)}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Payment Date</div>
              <div className="text-base">{formatDate(payment.paymentDate)}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Payment Method</div>
              <div className="text-base">{payment.paymentMethod}</div>
            </div>
            {payment.reference && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">Reference</div>
                <div className="text-base">{payment.reference}</div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-muted-foreground">Balance After</div>
              <div className={`text-base font-semibold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(balance || 0)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Created By</div>
              <div className="text-base">{payment.user?.username || payment.user?.name || "N/A"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Created At</div>
              <div className="text-base">{formatDate(payment.createdAt)}</div>
            </div>
          </div>

          {payment.notes && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">Notes</div>
              <div className="text-sm p-3 bg-muted rounded-md">{payment.notes}</div>
            </div>
          )}

          {type === "customers" && payment.salesOrder && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">Related Sales Order</div>
              <div className="text-sm p-3 bg-muted rounded-md">
                {payment.salesOrder.orderNumber} - {formatCurrency(payment.salesOrder.total)}
              </div>
            </div>
          )}

          {type === "suppliers" && payment.purchaseOrder && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">Related Purchase Order</div>
              <div className="text-sm p-3 bg-muted rounded-md">
                {payment.purchaseOrder.orderNumber} - {formatCurrency(payment.purchaseOrder.total)}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PaymentForm({
  type,
  customers,
  suppliers,
  salesOrders,
  purchaseOrders,
  payment,
  onSuccess,
}: {
  type: string
  customers: any[]
  suppliers: any[]
  salesOrders: any[]
  purchaseOrders: any[]
  payment?: any | null
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({
    customerId: payment?.customerId || "",
    supplierId: payment?.supplierId || "",
    salesOrderId: payment?.salesOrderId || "",
    purchaseOrderId: payment?.purchaseOrderId || "",
    amount: payment?.amount?.toString() || "",
    paymentDate: payment?.paymentDate 
      ? new Date(payment.paymentDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    paymentMethod: payment?.paymentMethod || "",
    reference: payment?.reference || "",
    notes: payment?.notes || "",
  })

  useEffect(() => {
    if (payment) {
      setFormData({
        customerId: payment.customerId || "",
        supplierId: payment.supplierId || "",
        salesOrderId: payment.salesOrderId || "",
        purchaseOrderId: payment.purchaseOrderId || "",
        amount: payment.amount?.toString() || "",
        paymentDate: payment.paymentDate 
          ? new Date(payment.paymentDate).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        paymentMethod: payment.paymentMethod || "",
        reference: payment.reference || "",
        notes: payment.notes || "",
      })
    }
  }, [payment])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (type === "customers" && !formData.customerId) {
      toast({
        title: "Validation Error",
        description: "Please select a customer.",
        variant: "destructive",
      })
      return
    }

    if (type === "suppliers" && !formData.supplierId) {
      toast({
        title: "Validation Error",
        description: "Please select a supplier.",
        variant: "destructive",
      })
      return
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid amount.",
        variant: "destructive",
      })
      return
    }

    if (!formData.paymentMethod) {
      toast({
        title: "Validation Error",
        description: "Please select a payment method.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const isEdit = !!payment
      const endpoint = isEdit
        ? (type === "customers" 
            ? `/api/customer-payments/${payment.id}`
            : `/api/supplier-payments/${payment.id}`)
        : (type === "customers" ? "/api/customer-payments" : "/api/supplier-payments")
      
      const body = type === "customers" 
        ? {
            ...(isEdit ? {} : { customerId: formData.customerId }),
            ...(isEdit ? {} : { salesOrderId: formData.salesOrderId || null }),
            amount: formData.amount,
            paymentDate: formData.paymentDate,
            paymentMethod: formData.paymentMethod,
            reference: formData.reference || null,
            notes: formData.notes || null,
          }
        : {
            ...(isEdit ? {} : { supplierId: formData.supplierId }),
            ...(isEdit ? {} : { purchaseOrderId: formData.purchaseOrderId || null }),
            amount: formData.amount,
            paymentDate: formData.paymentDate,
            paymentMethod: formData.paymentMethod,
            reference: formData.reference || null,
            notes: formData.notes || null,
          }

      const response = await fetch(endpoint, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        const result = await response.json()
        const newBalance = type === "customers" 
          ? (result.customer?.balance || 0)
          : (result.supplier?.balance || 0)
        
        toast({
          title: "Success",
          description: isEdit
            ? `Payment updated successfully. New balance: ${formatCurrency(newBalance)}`
            : `Payment recorded successfully. New balance: ${formatCurrency(newBalance)}`,
        })
        if (!isEdit) {
          setFormData({
            customerId: "",
            supplierId: "",
            salesOrderId: "",
            purchaseOrderId: "",
            amount: "",
            paymentDate: new Date().toISOString().split("T")[0],
            paymentMethod: "",
            reference: "",
            notes: "",
          })
        }
        onSuccess()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to record payment.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error recording payment:", error)
      toast({
        title: "Error",
        description: "Failed to record payment. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const filteredSalesOrders = formData.customerId
    ? salesOrders.filter((order) => order.customerId === formData.customerId)
    : []

  const filteredPurchaseOrders = formData.supplierId
    ? purchaseOrders.filter((order) => order.supplierId === formData.supplierId)
    : []

  const selectedCustomer = customers.find((c) => c.id === formData.customerId)
  const selectedSupplier = suppliers.find((s) => s.id === formData.supplierId)
  const currentBalance = type === "customers" 
    ? (selectedCustomer?.balance || 0)
    : (selectedSupplier?.balance || 0)
  const paymentAmount = parseFloat(formData.amount) || 0
  const newBalance = currentBalance - paymentAmount

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {type === "customers" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="customer">Customer *</Label>
            <Combobox
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.name} (Balance: ${formatCurrency(customer.balance || 0)})`,
              }))}
              value={formData.customerId}
              onValueChange={(value) => {
                setFormData({ ...formData, customerId: value, salesOrderId: "" })
              }}
              placeholder="Select customer"
              searchPlaceholder="Search customers..."
              emptyMessage="No customers found."
              disabled={!!payment}
            />
            {selectedCustomer && (
              <div className="text-sm text-muted-foreground">
                Current Balance: <span className={selectedCustomer.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{formatCurrency(selectedCustomer.balance || 0)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="salesOrder">Sales Order (Optional)</Label>
            <Combobox
              options={filteredSalesOrders.map((order) => ({
                value: order.id,
                label: `${order.orderNumber} - ${formatCurrency(order.total)}`,
              }))}
              value={formData.salesOrderId}
              onValueChange={(value) => setFormData({ ...formData, salesOrderId: value })}
              placeholder="Select sales order (optional)"
              searchPlaceholder="Search sales orders..."
              emptyMessage="No sales orders found."
              disabled={!formData.customerId}
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier *</Label>
            <Combobox
              options={suppliers.map((supplier) => ({
                value: supplier.id,
                label: `${supplier.name} (Balance: ${formatCurrency(supplier.balance || 0)})`,
              }))}
              value={formData.supplierId}
              onValueChange={(value) => {
                setFormData({ ...formData, supplierId: value, purchaseOrderId: "" })
              }}
              placeholder="Select supplier"
              searchPlaceholder="Search suppliers..."
              emptyMessage="No suppliers found."
              disabled={!!payment}
            />
            {selectedSupplier && (
              <div className="text-sm text-muted-foreground">
                Current Balance: <span className={selectedSupplier.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{formatCurrency(selectedSupplier.balance || 0)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchaseOrder">Purchase Order (Optional)</Label>
            <Combobox
              options={filteredPurchaseOrders.map((order) => ({
                value: order.id,
                label: `${order.orderNumber} - ${formatCurrency(order.total)}`,
              }))}
              value={formData.purchaseOrderId}
              onValueChange={(value) => setFormData({ ...formData, purchaseOrderId: value })}
              placeholder="Select purchase order (optional)"
              searchPlaceholder="Search purchase orders..."
              emptyMessage="No purchase orders found."
              disabled={!formData.supplierId}
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount *</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentDate">Payment Date *</Label>
          <Input
            id="paymentDate"
            type="date"
            value={formData.paymentDate}
            onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="paymentMethod">Payment Method *</Label>
        <Select
          value={formData.paymentMethod}
          onValueChange={(value) => setFormData({ ...formData, paymentMethod: value })}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select payment method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
            <SelectItem value="CHECK">Check</SelectItem>
            <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reference">Reference (Optional)</Label>
        <Input
          id="reference"
          value={formData.reference}
          onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
          placeholder="Payment reference number"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (Optional)</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes"
          rows={3}
        />
      </div>

      {(formData.customerId || formData.supplierId) && formData.amount && (
        <div className="border-t pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Current Balance:</span>
            <span className={currentBalance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
              {formatCurrency(currentBalance)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Payment Amount:</span>
            <span className="font-medium">{formatCurrency(paymentAmount)}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t pt-2">
            <span>New Balance After Payment:</span>
            <span className={newBalance >= 0 ? "text-green-600" : "text-red-600"}>
              {formatCurrency(newBalance)}
            </span>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onSuccess} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? (payment ? "Updating..." : "Recording...") : (payment ? "Update Payment" : "Record Payment")}
        </Button>
      </DialogFooter>
    </form>
  )
}
