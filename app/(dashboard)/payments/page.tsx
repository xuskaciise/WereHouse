"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { ListPagination, ListStateRow, SearchBox, usePagedList } from "@/components/data-list"
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
import { useCurrentUser } from "@/components/providers/current-user-provider"
import {
  PaymentMethodFields,
  type PaymentMethodValue,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  paymentMethodValueOf,
  usePaymentConfig,
} from "@/components/payment-method-fields"
import { PAYMENT_METHODS, formatSomaliPhone, methodLabel } from "@/lib/payment-methods"
import { can } from "@/lib/permission-rules"
import { useCompany } from "@/components/company-header"
import { CostLinesPicker, PaymentCostLines, lineKey, lineRef, useFifoPreview, type CostLine } from "@/components/cost-payments"

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

// ?tab=customers|suppliers (menu: Customer / Supplier payments), ?new=1 opens "Record payment".
export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsContent />
    </Suspense>
  )
}

function PaymentsContent() {
  const searchParams = useSearchParams()
  const { toast } = useToast()
  // Tabs, lists and buttons follow the customer_payments / supplier_payments
  // permissions; the API enforces the same.
  const { permissions } = useCurrentUser()
  const canCustomer = can(permissions, "customer_payments", "view")
  const canSupplier = can(permissions, "supplier_payments", "view")
  const [activeTab, setActiveTab] = useState(canCustomer ? "customers" : "suppliers")
  const [methodFilter, setMethodFilter] = useState("all")
  const tabModule = activeTab === "customers" ? "customer_payments" : "supplier_payments"
  const canCreatePayment = can(permissions, tabModule, "create")
  const canEditPayment = (type: string) => can(permissions, type === "customers" ? "customer_payments" : "supplier_payments", "edit")
  const canDeletePayment = (type: string) => can(permissions, type === "customers" ? "customer_payments" : "supplier_payments", "delete")
  // Server-side lists (search, method filter, pages) per tab.
  const methodParam = { paymentMethod: methodFilter === "all" ? undefined : methodFilter }
  const customerList = usePagedList(canCustomer ? "/api/customer-payments" : null, methodParam)
  const supplierList = usePagedList(canSupplier ? "/api/supplier-payments" : null, methodParam)
  const customerPayments = customerList.rows as any[]
  const supplierPayments = supplierList.rows as any[]
  const fetchCustomerPayments = customerList.reload
  const fetchSupplierPayments = supplierList.reload
  const [customers, setCustomers] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [salesOrders, setSalesOrders] = useState<any[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  useEffect(() => {
    const tab = searchParams.get("tab")
    if ((tab === "customers" && canCustomer) || (tab === "suppliers" && canSupplier)) setActiveTab(tab)
    if (searchParams.get("new") === "1") {
      setEditingPayment(null)
      setIsDialogOpen(true)
    }
  }, [searchParams, canCustomer, canSupplier])
  const [selectedPayment, setSelectedPayment] = useState<any | null>(null)
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null)

  useEffect(() => {
    // Only load what this role may see (avoids 403s for the other tab).
    if (canCustomer) {
      fetchCustomers()
      fetchSalesOrders()
    }
    if (canSupplier) {
      fetchSuppliers()
      fetchPurchaseOrders()
    }
  }, [])

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

  const company = useCompany()
  const handlePrintInvoice = (payment: any, type: string) => {
    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    const isCustomer = type.startsWith("customer")
    const paymentType = isCustomer ? "Customer Payment Receipt" : "Supplier Payment Receipt"
    const entityName = isCustomer ? payment.customer?.name : payment.supplier?.name
    const entityLabel = isCustomer ? "Customer" : "Supplier"
    const contact = [company?.address, company?.phone, company?.email].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
    const costRows = (payment.allocations ?? [])
      .map((a: any) => {
        const c = a.landedCost ?? a.stockTransferCost
        const doc = a.landedCost?.purchaseOrder?.orderNumber ?? a.stockTransferCost?.stockTransfer?.transferNumber ?? ""
        return `<tr><td>${escapeHtml(doc)}</td><td>${escapeHtml(c?.type?.name ?? "")}${c?.reference ? " (" + escapeHtml(c.reference) + ")" : ""}</td><td class="num">${formatCurrency(c?.amount)}</td><td class="num">${formatCurrency(a.amount)}</td></tr>`
      })
      .join("")

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
            .lines { width: 100%; border-collapse: collapse; margin-top: 10px; }
            .lines th, .lines td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
            .lines .num { text-align: right; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${escapeHtml(company?.name || "Siu Warehouse")}</h1>
            ${contact ? `<p>${contact}</p>` : ""}
            <h2>${paymentType}</h2>
          </div>
          <div class="details">
            <table>
              <tr><td>Payment ID:</td><td>${payment.id}</td></tr>
              <tr><td>${entityLabel}:</td><td>${escapeHtml(entityName || "N/A")}</td></tr>
              <tr><td>Amount:</td><td>${formatCurrency(payment.amount)}</td></tr>
              <tr><td>Payment Date:</td><td>${formatDate(payment.paymentDate)}</td></tr>
              <tr><td>Payment Method:</td><td>${escapeHtml(methodLabel(payment.paymentMethod))}</td></tr>
              ${payment.payerPhone ? `<tr><td>Phone:</td><td>${escapeHtml(formatSomaliPhone(payment.payerPhone))}</td></tr>` : ""}
              ${payment.transactionId ? `<tr><td>Transaction ID:</td><td>${escapeHtml(payment.transactionId)}</td></tr>` : ""}
              ${payment.reference ? `<tr><td>Reference:</td><td>${escapeHtml(payment.reference)}</td></tr>` : ""}
              ${payment.notes ? `<tr><td>Notes:</td><td>${escapeHtml(payment.notes)}</td></tr>` : ""}
              <tr><td>Created By:</td><td>${escapeHtml(payment.user?.username || payment.user?.name || "N/A")}</td></tr>
            </table>
            ${costRows ? `<h3>Cost lines paid</h3><table class="lines"><tr><th>Document</th><th>Cost</th><th class="num">Line amount</th><th class="num">Paid here</th></tr>${costRows}</table>` : ""}
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
        if (canCustomer) fetchCustomerPayments()
        if (canSupplier) fetchSupplierPayments()
        if (canCustomer) fetchCustomers()
        if (canSupplier) fetchSuppliers()
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
          {canCreatePayment && (
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Record Payment
              </Button>
            </DialogTrigger>
          )}
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
                if (canCustomer) fetchCustomerPayments()
                if (canSupplier) fetchSupplierPayments()
                // Refresh customers and suppliers to get updated balances
                if (canCustomer) fetchCustomers()
                if (canSupplier) fetchSuppliers()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={`grid w-full ${canCustomer && canSupplier ? "grid-cols-2" : "grid-cols-1"}`}>
          {canCustomer && <TabsTrigger value="customers">Customer Payments</TabsTrigger>}
          {canSupplier && <TabsTrigger value="suppliers">Supplier Payments</TabsTrigger>}
        </TabsList>

        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={activeTab === "customers" ? customerList.q : supplierList.q}
            onChange={activeTab === "customers" ? customerList.setQ : supplierList.setQ}
            placeholder={activeTab === "customers" ? "Customer, reference, transaction ID, order" : "Supplier, reference, transaction ID, order"}
          />
          <span className="text-sm text-muted-foreground">Payment method</span>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                  <ListStateRow
                    colSpan={8}
                    loading={customerList.loading && customerPayments.length === 0}
                    error={customerList.error}
                    empty={customerPayments.length === 0}
                    searching={!!customerList.q || methodFilter !== "all"}
                    emptyText="No customer payments yet."
                    action={canCreatePayment ? { label: "Record payment", onClick: () => { setEditingPayment(null); setIsDialogOpen(true) } } : null}
                  />
                  {customerPayments.length > 0 && (
                    customerPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">
                          {payment.customer?.name || "N/A"}
                        </TableCell>
                        <TableCell>{formatCurrency(payment.amount)}</TableCell>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>
                          {methodLabel(payment.paymentMethod)}
                          {payment.payerPhone && <div className="text-xs text-muted-foreground">{formatSomaliPhone(payment.payerPhone)}</div>}
                          {payment.transactionId && <div className="text-xs text-muted-foreground">Tx {payment.transactionId}</div>}
                        </TableCell>
                        <TableCell>{payment.reference || "-"}</TableCell>
                        <TableCell>
                          <span className={payment.customer?.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                            {formatCurrency(payment.customer?.balance || 0)}
                          </span>
                        </TableCell>
                        <TableCell>{payment.user?.username || payment.user?.name || "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <PaymentActions
                            canEdit={canEditPayment("customers")}
                            canDelete={canDeletePayment("customers")}
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
              <ListPagination list={customerList} />
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
                      <TableHead>Payable now</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  <ListStateRow
                    colSpan={8}
                    loading={supplierList.loading && supplierPayments.length === 0}
                    error={supplierList.error}
                    empty={supplierPayments.length === 0}
                    searching={!!supplierList.q || methodFilter !== "all"}
                    emptyText="No supplier payments yet."
                    action={canCreatePayment ? { label: "Record payment", onClick: () => { setEditingPayment(null); setIsDialogOpen(true) } } : null}
                  />
                  {supplierPayments.length > 0 && (
                    supplierPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">
                          {payment.supplier?.name || "N/A"}
                        </TableCell>
                        <TableCell>{formatCurrency(payment.amount)}</TableCell>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell>
                          {methodLabel(payment.paymentMethod)}
                          {payment.payerPhone && <div className="text-xs text-muted-foreground">{formatSomaliPhone(payment.payerPhone)}</div>}
                          {payment.transactionId && <div className="text-xs text-muted-foreground">Tx {payment.transactionId}</div>}
                        </TableCell>
                        <TableCell>{payment.reference || "-"}</TableCell>
                        <TableCell>
                          <span className={payment.supplier?.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                            {formatCurrency(payment.supplier?.balance || 0)}
                          </span>
                        </TableCell>
                        <TableCell>{payment.user?.username || payment.user?.name || "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <PaymentActions
                            canEdit={canEditPayment("suppliers")}
                            canDelete={canDeletePayment("suppliers")}
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
              <ListPagination list={supplierList} />
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
  canEdit,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onPrint,
}: {
  payment: any
  type: string
  canEdit: boolean
  canDelete: boolean
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
        {canEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem onClick={onDelete} className="text-red-600">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
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
              <div className="text-base">{methodLabel(payment.paymentMethod)}</div>
              {payment.payerPhone && <div className="text-sm">{formatSomaliPhone(payment.payerPhone)}</div>}
              {payment.transactionId && <div className="text-sm text-muted-foreground">Transaction ID: {payment.transactionId}</div>}
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

          {type === "suppliers" && <PaymentCostLines allocations={payment.allocations} />}

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
    reference: payment?.reference || "",
    notes: payment?.notes || "",
  })

  // Payment method (incl. mobile money phone / transaction ID), shared component.
  const paymentConfig = usePaymentConfig()
  const [method, setMethod] = useState<PaymentMethodValue>(paymentMethodValueOf(payment))

  // Open cost lines owed to the selected supplier (clearing agent, transport...)
  // across all purchase orders and transfers; one payment can settle many (FIFO).
  const [costLines, setCostLines] = useState<CostLine[]>([])
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set())
  const [amountEdited, setAmountEdited] = useState(false)
  useEffect(() => {
    setSelectedLines(new Set())
    if (type !== "suppliers" || !formData.supplierId || payment) {
      setCostLines([])
      return
    }
    fetch(`/api/landed-costs?supplierId=${formData.supplierId}&open=1`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setCostLines)
      .catch(() => setCostLines([]))
  }, [type, formData.supplierId, payment])
  const pickedLines = costLines.filter((l) => selectedLines.has(lineKey(l)))
  const pickedOpen = Math.round(pickedLines.reduce((s, l) => s + Number(l.openAmount), 0) * 100) / 100
  const fifo = useFifoPreview(formData.supplierId, costLines, selectedLines, formData.amount)
  const selectLines = (next: Set<string>) => {
    setSelectedLines(next)
    // The amount follows the selection until it is typed in.
    if (!amountEdited) {
      const open = costLines.filter((l) => next.has(lineKey(l))).reduce((s, l) => s + Number(l.openAmount), 0)
      setFormData((d) => ({ ...d, amount: next.size ? (Math.round(open * 100) / 100).toFixed(2) : "" }))
    }
  }
  // A payment over several cost lines keeps its amount (delete and record again to change it).
  const amountLocked = !!payment && (payment.allocations?.length ?? 0) > 1

  useEffect(() => {
    if (payment) {
      setMethod(paymentMethodValueOf(payment))
      setFormData({
        customerId: payment.customerId || "",
        supplierId: payment.supplierId || "",
        salesOrderId: payment.salesOrderId || "",
        purchaseOrderId: payment.purchaseOrderId || "",
        amount: payment.amount?.toString() || "",
        paymentDate: payment.paymentDate 
          ? new Date(payment.paymentDate).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
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

    const methodError = paymentMethodProblems(method, paymentConfig).error
    if (methodError) {
      toast({ title: "Validation Error", description: methodError, variant: "destructive" })
      return
    }

    setIsSaving(true)

    try {
      const isEdit = !!payment
      const payingLines = !isEdit && type === "suppliers" && pickedLines.length > 0
      const endpoint = payingLines
        ? "/api/supplier-payments/bulk"
        : isEdit
        ? (type === "customers" 
            ? `/api/customer-payments/${payment.id}`
            : `/api/supplier-payments/${payment.id}`)
        : (type === "customers" ? "/api/customer-payments" : "/api/supplier-payments")
      
      const body = payingLines
        ? {
            supplierId: formData.supplierId,
            lines: pickedLines.map(lineRef),
            amount: formData.amount,
            paymentDate: formData.paymentDate,
            ...paymentMethodBody(method),
            reference: formData.reference || null,
            notes: formData.notes || null,
          }
        : type === "customers"
        ? {
            ...(isEdit ? {} : { customerId: formData.customerId }),
            ...(isEdit ? {} : { salesOrderId: formData.salesOrderId || null }),
            amount: formData.amount,
            paymentDate: formData.paymentDate,
            ...paymentMethodBody(method),
            reference: formData.reference || null,
            notes: formData.notes || null,
          }
        : {
            ...(isEdit ? {} : { supplierId: formData.supplierId }),
            ...(isEdit ? {} : { purchaseOrderId: formData.purchaseOrderId || null }),
            amount: formData.amount,
            paymentDate: formData.paymentDate,
            ...paymentMethodBody(method),
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
        const data = await response.json()
        // The bulk endpoint answers { payments: [payment], warnings }.
        const result = payingLines ? { ...data.payments[0], warnings: data.warnings } : data
        const newBalance = type === "customers" 
          ? (result.customer?.balance || 0)
          : (result.supplier?.balance || 0)
        
        toast({
          title: "Success",
          description: isEdit
            ? `Payment updated successfully. New balance: ${formatCurrency(newBalance)}`
            : `Payment recorded successfully. New balance: ${formatCurrency(newBalance)}`,
        })
        // Saved, but e.g. the phone prefix does not match the operator.
        for (const warning of result.warnings ?? []) toast({ title: "Please check", description: warning })
        if (!isEdit) {
          setSelectedLines(new Set())
          setAmountEdited(false)
          setMethod(emptyPaymentMethod())
          setFormData({
            customerId: "",
            supplierId: "",
            salesOrderId: "",
            purchaseOrderId: "",
            amount: "",
            paymentDate: new Date().toISOString().split("T")[0],
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
                label: `${supplier.name} (Payable: ${formatCurrency(supplier.balance || 0)})`,
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
                Payable now: <span className={selectedSupplier.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{formatCurrency(selectedSupplier.balance || 0)}</span>
                {Number(selectedSupplier.orderedNotReceived) > 0 && (
                  <span className="ml-3">Ordered, not received: {formatCurrency(selectedSupplier.orderedNotReceived)}</span>
                )}
              </div>
            )}
          </div>

          {pickedLines.length === 0 && (
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
          )}

          {costLines.length > 0 && (
            <div className="space-y-2">
              <Label>Pay cost lines (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Open landed / transfer costs owed to this party, oldest first. One payment can settle several lines; a smaller amount pays the oldest first.
              </p>
              <CostLinesPicker lines={costLines} selected={selectedLines} onChange={selectLines} allocated={fifo?.allocated} />
              {pickedLines.length > 0 && (
                <div className="text-sm">
                  {pickedLines.length} line(s) selected, open {formatCurrency(pickedOpen)}
                  {fifo?.error && <div className="text-destructive">{fifo.error}</div>}
                </div>
              )}
            </div>
          )}
          {payment && <PaymentCostLines allocations={payment.allocations} />}
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
            onChange={(e) => {
              setAmountEdited(true)
              setFormData({ ...formData, amount: e.target.value })
            }}
            disabled={amountLocked}
            required
          />
          {amountLocked && (
            <p className="text-xs text-muted-foreground">This payment settles several cost lines; delete it and record it again to change the amount.</p>
          )}
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

      <PaymentMethodFields value={method} onChange={setMethod} existingMethod={payment?.paymentMethod} idPrefix="payment" />

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
        <Button type="submit" disabled={isSaving || (pickedLines.length > 0 && !!fifo?.error)}>
          {isSaving ? (payment ? "Updating..." : "Recording...") : (payment ? "Update Payment" : "Record Payment")}
        </Button>
      </DialogFooter>
    </form>
  )
}
