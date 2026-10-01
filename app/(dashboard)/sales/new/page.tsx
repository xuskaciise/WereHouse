"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Plus, Trash2, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import { useCan, useCurrentUser } from "@/components/providers/current-user-provider"
import {
  DISCOUNT_REASON_MAX_LENGTH,
  type DiscountTypeValue,
  discountReasonRequired,
} from "@/lib/discount-rules"
import { useRouter } from "next/navigation"
import { resolveTaxRate, taxLabel } from "@/lib/tax-rules"
import Link from "next/link"
import { CompanyHeader, useCompany } from "@/components/company-header"
import { QuickCreateButton } from "@/components/quick-create"
import { defaultWarehouseFor, rememberWarehouse } from "@/components/default-warehouse"
import { Checkbox } from "@/components/ui/checkbox"
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  paymentMethodBody,
  paymentMethodProblems,
  usePaymentConfig,
  type PaymentMethodValue,
} from "@/components/payment-method-fields"

interface OrderItem {
  productId: string
  quantity: number
  unitPrice: number
  discountType: DiscountTypeValue
  discountValue: string
}

// Preview only, in integer cents with the server's rounding (half-up); the
// server recalculates and validates everything in Decimal.
const toCents = (value: unknown) => Math.round(Number(value || 0) * 100)

function discountCents(baseCents: number, type: DiscountTypeValue, raw: string): { cents: number; error?: string } {
  if (raw.trim() === "") return { cents: 0 }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return { cents: 0, error: "must be 0 or more" }
  if (type === "PERCENT") {
    if (value > 100) return { cents: 0, error: "percentage must be between 0 and 100" }
    return { cents: Math.round((baseCents * value) / 100) }
  }
  const cents = toCents(value)
  if (cents > baseCents) return { cents, error: "cannot be larger than the amount it applies to" }
  return { cents }
}

function DiscountInput({
  type,
  value,
  onTypeChange,
  onValueChange,
  invalid,
  id,
}: {
  type: DiscountTypeValue
  value: string
  onTypeChange: (type: DiscountTypeValue) => void
  onValueChange: (value: string) => void
  invalid?: boolean
  id?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={type} onValueChange={(v) => onTypeChange(v as DiscountTypeValue)}>
        <SelectTrigger className="h-9 w-16 px-2" aria-label="Discount type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="PERCENT">%</SelectItem>
          <SelectItem value="AMOUNT">$</SelectItem>
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        max={type === "PERCENT" ? 100 : undefined}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="0"
        className={`h-9 w-24 ${invalid ? "border-destructive" : ""}`}
      />
    </div>
  )
}

export default function NewSalesOrderPage() {
  const { toast } = useToast()
  const router = useRouter()
  const currentUser = useCurrentUser()
  // From the sales_discount permission (Roles & Permissions); the server enforces the same.
  const canDiscount = currentUser.permissions.sales_discount.create
  const discountLimit = currentUser.permissions.sales_discount.discountLimit
  const unlimitedDiscount = discountLimit === null
  const maxDiscountPercent = discountLimit ?? 100
  const reasonLimit = currentUser.discountReasonReferenceLimit
  // Buttons follow the permissions; the server enforces the same.
  const canDraft = useCan("sales", "create")
  const canConfirm = useCan("sales_confirm", "create")
  const canDeliver = useCan("sales_deliver", "create")
  // ?edit=<id>: edit a draft, or a confirmed order before any delivery.
  const [editing, setEditing] = useState<any | null>(null)
  // ?mode=sell: counter sale ("Sell now"): walk-in customer, deliver + pay at once.
  const [sellMode, setSellMode] = useState(false)
  const company = useCompany()
  const canTakePayment = useCan("customer_payments", "create")
  const paymentConfig = usePaymentConfig()
  const [paidNow, setPaidNow] = useState(false)
  const [paidAmount, setPaidAmount] = useState("")
  const [payMethod, setPayMethod] = useState<PaymentMethodValue>(emptyPaymentMethod("CASH"))
  const [quickAdd, setQuickAdd] = useState("")
  const [customers, setCustomers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [customerId, setCustomerId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [expectedDelivery, setExpectedDelivery] = useState("")
  const [items, setItems] = useState<OrderItem[]>([])
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountTypeValue>("PERCENT")
  const [orderDiscountValue, setOrderDiscountValue] = useState("")
  const [discountReason, setDiscountReason] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  // Sales tax rate from Settings (preview; the server applies and stores it).
  const [taxRate, setTaxRate] = useState(0)
  useEffect(() => {
    fetch("/api/settings").then(async (r) => r.ok && setTaxRate(resolveTaxRate(await r.json(), "sales")))
  }, [])
  const orderNumber = editing?.orderNumber ?? "New order"
  const walkInId = company?.walkInCustomerId ?? null
  const isWalkIn = !!walkInId && customerId === walkInId
  useEffect(() => {
    if (!sellMode || editing) return
    if (walkInId) setCustomerId((current) => current || walkInId)
    setItems((prev) => (prev.length ? prev : [{ productId: "", quantity: 1, unitPrice: 0, discountType: "PERCENT", discountValue: "" }]))
  }, [sellMode, walkInId, editing])
  // Walk-in sales are always paid in full; other customers may pay now (optional).
  const payNow = isWalkIn || paidNow

  // Scan / type a SKU (or an exact name) and press Enter: adds the product or +1.
  const addByCode = () => {
    const code = quickAdd.trim().toLowerCase()
    if (!code) return
    const product = products.find((p) => p.sku?.toLowerCase() === code) ?? products.find((p) => p.name?.toLowerCase() === code)
    if (!product) {
      toast({ title: "Not found", description: `No product with SKU or name "${quickAdd.trim()}"`, variant: "destructive" })
      return
    }
    setItems((prev) => {
      const at = prev.findIndex((i) => i.productId === product.id)
      if (at >= 0) return prev.map((i, n) => (n === at ? { ...i, quantity: i.quantity + 1 } : i))
      const empty = prev.findIndex((i) => !i.productId)
      const line = { productId: product.id, quantity: 1, unitPrice: product.sellingPrice, discountType: "PERCENT" as DiscountTypeValue, discountValue: "" }
      return empty >= 0 ? prev.map((i, n) => (n === empty ? line : i)) : [...prev, line]
    })
    setQuickAdd("")
  }

  useEffect(() => {
    fetchCustomers()
    fetchProducts()
    fetchWarehouses()
    fetchStock()
    const params = new URLSearchParams(window.location.search)
    if (params.get("mode") === "sell") setSellMode(true)
    else if (!params.get("customer")) setItems((prev) => (prev.length ? prev : [{ productId: "", quantity: 1, unitPrice: 0, discountType: "PERCENT", discountValue: "" }]))
    if (params.get("customer")) setCustomerId(params.get("customer")!)
    const editId = params.get("edit")
    if (editId) {
      fetch(`/api/sales-orders/${editId}`).then(async (r) => {
        if (!r.ok) return
        const order = await r.json()
        setEditing(order)
        setCustomerId(order.customerId)
        setWarehouseId(order.warehouseId)
        setExpectedDelivery(order.expectedDeliveryDate ? String(order.expectedDeliveryDate).slice(0, 10) : "")
        setItems(
          order.items.map((i: any) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            discountType: i.discountType ?? "PERCENT",
            discountValue: i.discountValue ? String(Number(i.discountValue)) : "",
          }))
        )
        if (order.discountType) setOrderDiscountType(order.discountType)
        if (order.discountValue) setOrderDiscountValue(String(Number(order.discountValue)))
        setDiscountReason(order.discountReason ?? "")
      })
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

  const fetchProducts = async () => {
    try {
      const response = await fetch("/api/products")
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error("Error fetching products:", error)
    }
  }

  const fetchWarehouses = async () => {
    try {
      const response = await fetch("/api/warehouses")
      if (response.ok) {
        const data = await response.json()
        setWarehouses(data)
        // Default / last used warehouse (not when editing an order).
        if (!new URLSearchParams(window.location.search).get("edit")) {
          setWarehouseId((current) => current || defaultWarehouseFor(currentUser, data))
        }
      }
    } catch (error) {
      console.error("Error fetching warehouses:", error)
    }
  }

  const fetchStock = async () => {
    try {
      const response = await fetch("/api/stock")
      if (response.ok) {
        const data = await response.json()
        setStock(data)
      }
    } catch (error) {
      console.error("Error fetching stock:", error)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        productId: "",
        quantity: 1,
        unitPrice: 0,
        discountType: "PERCENT",
        discountValue: "",
      },
    ])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    if (field === "productId") {
      const product = products.find((p) => p.id === value)
      if (product) {
        newItems[index].unitPrice = product.sellingPrice
      }
    }
    setItems(newItems)
  }

  const getAvailableStock = (productId: string) => {
    if (!warehouseId) return 0
    const stockItem = stock.find(
      (s) => s.productId === productId && s.warehouseId === warehouseId
    )
    const available = stockItem ? stockItem.quantity - stockItem.reservedQuantity : 0
    // A confirmed order being edited may reuse its own reservation.
    const own =
      editing?.status === "CONFIRMED" && editing.warehouseId === warehouseId
        ? editing.items.filter((i: any) => i.productId === productId).reduce((sum: number, i: any) => sum + i.remainingQuantity, 0)
        : 0
    return available + own
  }

  const getInsufficientStockItems = () => {
    return items
      .map((item, index) => {
        const available = getAvailableStock(item.productId)
        return {
          index,
          item,
          available,
          isInvalid:
            !item.productId ||
            item.quantity <= 0 ||
            (item.productId && item.quantity > available),
        }
      })
      .filter((entry) => entry.isInvalid)
  }

  const hasInsufficientStock = getInsufficientStockItems().some(
    (entry) => entry.item.productId && entry.item.quantity > entry.available
  )

  // --- Live totals (preview) -------------------------------------------------
  const lineTotals = items.map((item) => {
    const grossCents = toCents(item.unitPrice) * item.quantity
    const discount = discountCents(grossCents, item.discountType, item.discountValue)
    return { grossCents, discountCents: discount.error ? 0 : discount.cents, error: discount.error }
  })
  const grossCents = lineTotals.reduce((sum, line) => sum + line.grossCents, 0)
  const itemDiscountCents = lineTotals.reduce((sum, line) => sum + line.discountCents, 0)
  const subtotalCents = grossCents - itemDiscountCents
  const orderDiscount = discountCents(subtotalCents, orderDiscountType, orderDiscountValue)
  const orderDiscountCents = orderDiscount.error ? 0 : orderDiscount.cents
  const taxableCents = subtotalCents - orderDiscountCents
  const taxCents = Math.round((taxableCents * taxRate) / 100)
  const totalCents = taxableCents + taxCents
  const totalDiscountCents = itemDiscountCents + orderDiscountCents
  // Rounded to 2 decimals, as on the server.
  const discountPercent = grossCents > 0 ? Math.round((totalDiscountCents * 10000) / grossCents) / 100 : 0
  const overLimit = !unlimitedDiscount && discountPercent > maxDiscountPercent
  const reasonRequired = totalDiscountCents > 0 && discountReasonRequired(discountPercent, reasonLimit)

  const discountErrors: string[] = []
  lineTotals.forEach((line, index) => {
    if (line.error) discountErrors.push(`Line ${index + 1} discount ${line.error}`)
  })
  if (orderDiscount.error) discountErrors.push(`Order discount ${orderDiscount.error}`)
  if (overLimit) {
    discountErrors.push(
      `The total discount of ${discountPercent.toFixed(2)}% exceeds your limit of ${maxDiscountPercent}%. Ask a sales manager or admin.`
    )
  }
  if (reasonRequired && !discountReason.trim()) {
    discountErrors.push(
      `A reason is required for a total discount above ${Math.min(reasonLimit, 20)}%.`
    )
  }

  const money = (cents: number) => formatCurrency(cents / 100)

  // "Selling below cost" check against the warehouse average (landed) cost,
  // done on the server. Roles without product_cost get only yes/no.
  const [belowCost, setBelowCost] = useState<Record<number, { below: boolean; avgCost?: number }>>({})
  const costCheckKey = JSON.stringify([
    warehouseId,
    items.map((item, i) => [item.productId, item.quantity, lineTotals[i]?.grossCents, lineTotals[i]?.discountCents]),
  ])
  useEffect(() => {
    const lines = items.map((item, i) => ({
      productId: item.productId,
      netUnitPrice:
        item.quantity > 0 ? ((lineTotals[i].grossCents - lineTotals[i].discountCents) / item.quantity / 100).toFixed(4) : "0",
    }))
    if (!warehouseId || lines.every((l) => !l.productId)) {
      setBelowCost({})
      return
    }
    const timer = setTimeout(async () => {
      const res = await fetch("/api/sales-orders/cost-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, lines }),
      })
      if (!res.ok) return
      const data = await res.json()
      setBelowCost(
        Object.fromEntries(
          data.results.map((r: any) => [r.index, { below: r.belowCost, avgCost: r.avgCost === undefined ? undefined : Number(r.avgCost) }])
        )
      )
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costCheckKey])
  const discountPayload = (type: DiscountTypeValue, value: string) =>
    value.trim() === "" || Number(value) === 0 ? null : { type, value }

  const handleSubmit = async (mode: "draft" | "confirm" | "sell_now") => {
    const isDraft = mode === "draft"
    if (isWalkIn && mode !== "sell_now") {
      toast({ title: "Walk-in customer", description: "Walk-in sales are paid in full at once. Choose a named customer for orders on credit.", variant: "destructive" })
      return
    }
    if (mode === "sell_now" && payNow) {
      const problem = paymentMethodProblems(payMethod, paymentConfig).error
      if (problem) {
        toast({ title: "Payment", description: problem, variant: "destructive" })
        return
      }
    }
    if (!customerId || !warehouseId || items.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in customer, warehouse, and add at least one item.",
        variant: "destructive",
      })
      return
    }

    // Validate that all items have product selected
    const invalidItems = items.filter(item => !item.productId || item.quantity <= 0)
    if (invalidItems.length > 0) {
      toast({
        title: "Validation Error",
        description: "Please ensure all items have a product selected and quantity is greater than 0.",
        variant: "destructive",
      })
      return
    }

    if (discountErrors.length > 0) {
      toast({ title: "Discount", description: discountErrors[0], variant: "destructive" })
      return
    }

    // Stock is only reserved / delivered on confirm (a draft never touches stock)
    const needsStock = !isDraft || editing?.status === "CONFIRMED"
    const insufficientItems = (needsStock ? items : [])
      .map((item) => ({
        item,
        available: getAvailableStock(item.productId),
      }))
      .filter(({ item, available }) => item.productId && item.quantity > available)

    if (insufficientItems.length > 0) {
      const first = insufficientItems[0]
      const productName =
        products.find((p) => p.id === first.item.productId)?.name || "Selected product"
      toast({
        title: "Insufficient Stock",
        description: `Insufficient stock! Only ${first.available} items available in this warehouse. (${productName})`,
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(editing ? `/api/sales-orders/${editing.id}` : "/api/sales-orders", {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId,
          warehouseId,
          expectedDelivery: expectedDelivery || null,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: discountPayload(item.discountType, item.discountValue),
          })),
          discount: discountPayload(orderDiscountType, orderDiscountValue),
          discountReason: discountReason.trim() || null,
          notes: editing?.notes ?? null,
          mode,
          ...(mode === "sell_now" && payNow && {
            payment: { amount: isWalkIn ? (totalCents / 100).toFixed(2) : paidAmount || (totalCents / 100).toFixed(2), ...paymentMethodBody(payMethod) },
          }),
        }),
      })

      if (response.ok) {
        const saved = await response.json()
        toast({
          title: editing ? "Order updated" : mode === "sell_now" ? "Sold and delivered" : mode === "confirm" ? "Order confirmed" : "Draft saved",
          description: editing
            ? "The changes are saved."
            : mode === "sell_now"
            ? "The stock left the warehouse and the sale is recorded."
            : mode === "confirm"
            ? "The stock is reserved for this customer until it is delivered."
            : "The draft does not reserve or deduct any stock.",
        })
        router.push(`/sales/${saved.id}`)
      } else {
        const error = await response.json()
        const serverMessage =
          error?.error ||
          error?.message ||
          "Failed to create sales order"
        toast({
          title: "Error",
          description: serverMessage,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating sales order:", error)
      toast({
        title: "Error",
        description: "Failed to create sales order. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const summaryRows = (
    <>
      <div className="flex justify-between text-sm">
        <span>Subtotal (before discounts)</span>
        <span>{money(grossCents)}</span>
      </div>
      {itemDiscountCents > 0 && (
        <div className="flex justify-between text-sm text-green-600">
          <span>Item discounts</span>
          <span>-{money(itemDiscountCents)}</span>
        </div>
      )}
      {orderDiscountCents > 0 && (
        <div className="flex justify-between text-sm text-green-600">
          <span>
            Order discount{orderDiscountType === "PERCENT" ? ` (${Number(orderDiscountValue)}%)` : ""}
          </span>
          <span>-{money(orderDiscountCents)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span>Taxable amount</span>
        <span>{money(taxableCents)}</span>
      </div>
      {taxCents !== 0 && (
        <div className="flex justify-between text-sm">
          <span>{taxLabel(taxRate)}</span>
          <span>{money(taxCents)}</span>
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/sales">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {editing ? `Edit ${editing.orderNumber}` : sellMode ? "Sell now" : "Create New Sale Order"}
          </h1>
          <p className="text-muted-foreground">
            Create a new sales order for a customer
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Order Details</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {orderNumber}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customer">Customer Selection</Label>
                <Combobox
                  options={customers.map((customer) => ({
                    value: customer.id,
                    label: customer.name,
                  }))}
                  value={customerId}
                  onValueChange={setCustomerId}
                  placeholder="Select customer"
                  searchPlaceholder="Search customers..."
                  emptyMessage="No customers found."
                />
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{isWalkIn ? "Walk-in: paid in full at the sale. For credit choose a named customer." : ""}</span>
                  <span className="flex items-center gap-2">
                    {walkInId && !isWalkIn && !editing && (
                      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setCustomerId(walkInId)}>Walk-in customer</Button>
                    )}
                    <QuickCreateButton kind="customer" onCreated={(c) => { setCustomers((prev) => [...prev, c]); setCustomerId(c.id) }} />
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="warehouse">Warehouse</Label>
                <Combobox
                  options={warehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouse.name,
                  }))}
                  value={warehouseId}
                  onValueChange={(id) => { setWarehouseId(id); rememberWarehouse(currentUser, id) }}
                  placeholder="Select warehouse"
                  searchPlaceholder="Search warehouses..."
                  emptyMessage="No warehouses found."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delivery">Expected Delivery Date</Label>
                <Input
                  id="delivery"
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Product/Item List</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Price</TableHead>
                      {canDiscount && <TableHead>Discount</TableHead>}
                      <TableHead>Total</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => {
                      const availableStock = getAvailableStock(item.productId)
                      const product = products.find(
                        (p) => p.id === item.productId
                      )
                      const line = lineTotals[index]
                      return (
                        <TableRow key={index}>
                          <TableCell>
                            <Combobox
                              options={products.map((p) => ({
                                value: p.id,
                                label: `${p.name} (${p.sku})`,
                              }))}
                              value={item.productId}
                              onValueChange={(value) =>
                                updateItem(index, "productId", value)
                              }
                              placeholder="Select product"
                              searchPlaceholder="Search products..."
                              emptyMessage="No products found."
                              className="w-[250px]"
                            />
                            {product && (
                              <div className="text-xs text-muted-foreground mt-1">
                                SKU: {product.sku}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              max={availableStock}
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  "quantity",
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="w-20"
                            />
                          </TableCell>
                          <TableCell>
                            {item.productId && (
                              <Badge
                                variant={
                                  item.quantity > availableStock
                                    ? "destructive"
                                    : availableStock === 0
                                    ? "destructive"
                                    : availableStock < 10
                                    ? "warning"
                                    : "success"
                                }
                              >
                                {item.quantity > availableStock
                                  ? `Insufficient (${availableStock} available)`
                                  : availableStock === 0
                                  ? "Out of Stock"
                                  : availableStock < 10
                                  ? `Low Stock (${availableStock} left)`
                                  : "In Stock"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          {canDiscount && (
                            <TableCell>
                              <DiscountInput
                                type={item.discountType}
                                value={item.discountValue}
                                invalid={!!line?.error}
                                onTypeChange={(type) => updateItem(index, "discountType", type)}
                                onValueChange={(value) => updateItem(index, "discountValue", value)}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            {line && line.discountCents > 0 ? (
                              <div>
                                <div>{money(line.grossCents - line.discountCents)}</div>
                                <div className="text-xs text-muted-foreground line-through">
                                  {money(line.grossCents)}
                                </div>
                              </div>
                            ) : (
                              money(line?.grossCents ?? 0)
                            )}
                            {belowCost[index]?.below && (
                              <div className="mt-1 text-xs font-normal text-destructive">
                                Selling below cost
                                {belowCost[index].avgCost !== undefined && ` (${formatCurrency(belowCost[index].avgCost!)} / unit)`}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={addItem}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Another Item
                </Button>
                <div className="relative min-w-[220px] flex-1">
                  <ScanLine className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Scan / type SKU and press Enter"
                    value={quickAdd}
                    onChange={(e) => setQuickAdd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByCode() } }}
                  />
                </div>
                <QuickCreateButton kind="product" onCreated={(p) => { setProducts((prev) => [...prev, p]); setItems((prev) => [...prev.filter((i) => i.productId), { productId: p.id, quantity: 1, unitPrice: Number(p.sellingPrice), discountType: "PERCENT", discountValue: "" }]) }} />
              </div>
            </CardContent>
          </Card>

          {canDiscount && (
            <Card>
              <CardHeader>
                <CardTitle>Discount</CardTitle>
                <CardDescription>
                  Applied to the subtotal after item discounts; tax is calculated on the discounted amount.
                  {unlimitedDiscount
                    ? " Your role has no discount limit."
                    : ` Your maximum total discount is ${maxDiscountPercent}%.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orderDiscount">Order discount</Label>
                  <DiscountInput
                    id="orderDiscount"
                    type={orderDiscountType}
                    value={orderDiscountValue}
                    invalid={!!orderDiscount.error}
                    onTypeChange={setOrderDiscountType}
                    onValueChange={setOrderDiscountValue}
                  />
                </div>
                {totalDiscountCents > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="discountReason">
                      Discount reason {reasonRequired ? "*" : "(optional)"}
                    </Label>
                    <Textarea
                      id="discountReason"
                      value={discountReason}
                      maxLength={DISCOUNT_REASON_MAX_LENGTH}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      placeholder="e.g. Bulk order for the school library"
                      rows={2}
                    />
                  </div>
                )}
                <div className="rounded-md border p-4 space-y-2">
                  {summaryRows}
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span>{money(totalCents)}</span>
                  </div>
                  {totalDiscountCents > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Total discount: {money(totalDiscountCents)} ({discountPercent.toFixed(2)}% of{" "}
                      {money(grossCents)})
                    </div>
                  )}
                </div>
                {discountErrors.length > 0 && (
                  <ul className="space-y-1 text-sm text-destructive">
                    {discountErrors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {editing ? (
            <Button
              className="w-full"
              onClick={() => handleSubmit("draft")}
              disabled={isSaving || discountErrors.length > 0 || (editing.status === "CONFIRMED" && hasInsufficientStock)}
            >
              {isSaving ? "Saving..." : editing.status === "CONFIRMED" ? "Save changes (reservation is adjusted)" : "Save draft"}
            </Button>
          ) : (
            <div className="space-y-2">
              {canConfirm && canDeliver && (sellMode || isWalkIn || paidNow || canTakePayment) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Payment</CardTitle>
                    <CardDescription>{isWalkIn ? "Walk-in sale: the full amount is paid now." : "Money received with \"Sell & deliver now\" (optional)."}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!canTakePayment ? (
                      <p className="text-sm text-destructive">Your role cannot record payments{isWalkIn ? ", so it cannot sell to the walk-in customer" : ""}.</p>
                    ) : (
                      <>
                        {!isWalkIn && (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={paidNow} onCheckedChange={(c) => { setPaidNow(c === true); if (c === true) setPaidAmount((totalCents / 100).toFixed(2)) }} />
                            Paid now
                          </label>
                        )}
                        {payNow && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label>Amount paid</Label>
                              <Input type="number" min="0" step="0.01" value={isWalkIn ? (totalCents / 100).toFixed(2) : paidAmount} disabled={isWalkIn} onChange={(e) => setPaidAmount(e.target.value)} />
                            </div>
                            <div className="sm:col-span-2"><PaymentMethodFields value={payMethod} onChange={setPayMethod} idPrefix="sale-pay" /></div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
              <div className="flex flex-wrap gap-2">
                {canDraft && !sellMode && !isWalkIn && (
                  <Button variant="outline" className="flex-1" onClick={() => handleSubmit("draft")} disabled={isSaving || discountErrors.length > 0}>
                    {isSaving ? "Saving..." : "Save draft"}
                  </Button>
                )}
                {canConfirm && !sellMode && !isWalkIn && (
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => handleSubmit("confirm")}
                    disabled={isSaving || hasInsufficientStock || discountErrors.length > 0}
                  >
                    {hasInsufficientStock ? "Insufficient stock" : "Confirm (reserve stock)"}
                  </Button>
                )}
                {canConfirm && canDeliver && (
                  <Button
                    className="flex-1"
                    onClick={() => handleSubmit("sell_now")}
                    disabled={isSaving || hasInsufficientStock || discountErrors.length > 0 || (isWalkIn && !canTakePayment)}
                  >
                    {hasInsufficientStock ? "Insufficient stock" : payNow ? `Sell & deliver now · paid ${money(isWalkIn ? totalCents : Math.round(Number(paidAmount || 0) * 100))}` : "Sell & deliver now"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Draft: no stock is touched. Confirm: the stock is reserved for the customer until it is delivered. Sell &amp;
                deliver now: the goods leave the warehouse at once (counter sale).
              </p>
            </div>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground">
                  Estimated Total
                </div>
                <div className="text-3xl font-bold mt-2">
                  {money(totalCents)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invoice preview</CardTitle>
              <CardDescription>Print or save as PDF from the order page after saving.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-b pb-4">
                <CompanyHeader align="center" />
                <div className="mt-2 text-center text-xs text-muted-foreground">
                  Invoice #{orderNumber}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <div className="font-medium">BILL TO:</div>
                  <div className="text-muted-foreground">
                    {customerId
                      ? customers.find((c) => c.id === customerId)?.name
                      : "Select customer"}
                  </div>
                </div>
                <div>
                  <div className="font-medium">ORDER DATE:</div>
                  <div className="text-muted-foreground">
                    {new Date().toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => {
                      const product = products.find(
                        (p) => p.id === item.productId
                      )
                      const line = lineTotals[index]
                      return (
                        <TableRow key={index}>
                          <TableCell>
                            <div className="font-medium">
                              {product?.name || "Select product"}
                            </div>
                            {product && (
                              <div className="text-xs text-muted-foreground">
                                {product.description}
                              </div>
                            )}
                            {line && line.discountCents > 0 && (
                              <div className="text-xs text-green-600">
                                Discount -{money(line.discountCents)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            {money((line?.grossCents ?? 0) - (line?.discountCents ?? 0))}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-4 space-y-2">
                {summaryRows}
                <div className="border-t pt-2">
                  <div className="flex justify-between font-bold text-lg">
                    <span>GRAND TOTAL</span>
                    <span className="text-primary">
                      {money(totalCents)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Terms: {company?.paymentTerms ?? ""}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
