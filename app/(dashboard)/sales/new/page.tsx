"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Plus, Trash2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Combobox } from "@/components/ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import Link from "next/link"

interface OrderItem {
  productId: string
  quantity: number
  unitPrice: number
}

export default function NewSalesOrderPage() {
  const { toast } = useToast()
  const router = useRouter()
  const [customers, setCustomers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [customerId, setCustomerId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [expectedDelivery, setExpectedDelivery] = useState("")
  const [items, setItems] = useState<OrderItem[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const orderNumber = "SO-2023-0042"

  useEffect(() => {
    fetchCustomers()
    fetchProducts()
    fetchWarehouses()
    fetchStock()
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
    return stockItem ? stockItem.quantity - stockItem.reservedQuantity : 0
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

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )
  const tax = subtotal * 0.05
  const total = subtotal + tax

  const handleSubmit = async (isDraft: boolean = false) => {
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

    // Validate available stock per selected warehouse before submit
    const insufficientItems = items
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
      const response = await fetch("/api/sales-orders", {
        method: "POST",
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
          })),
          notes: null,
          status: isDraft ? "PENDING" : "CONFIRMED",
        }),
      })

      if (response.ok) {
        toast({
          title: isDraft ? "Draft Saved" : "Sales Order Created",
          description: isDraft
            ? "Sales order has been saved as draft."
            : "Sales order has been created successfully.",
        })
        router.push("/sales")
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
            Create New Sale Order
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="warehouse">Warehouse</Label>
                <Combobox
                  options={warehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouse.name,
                  }))}
                  value={warehouseId}
                  onValueChange={setWarehouseId}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price</TableHead>
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
                        <TableCell className="font-medium">
                          {formatCurrency(item.quantity * item.unitPrice)}
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
              <Button
                variant="outline"
                className="mt-4"
                onClick={addItem}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Another Item
              </Button>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => handleSubmit(true)}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Draft"}
            </Button>
            <Button 
              className="flex-1"
              onClick={() => handleSubmit(false)}
              disabled={isSaving || hasInsufficientStock}
            >
              {isSaving ? "Creating..." : hasInsufficientStock ? "Insufficient Stock" : "Finalize & Post"}
            </Button>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground">
                  Estimated Total
                </div>
                <div className="text-3xl font-bold mt-2">
                  {formatCurrency(total)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Live Invoice Preview</CardTitle>
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center border-b pb-4">
                <div className="text-lg font-bold">Siu Warehouse</div>
                <div className="text-xs text-muted-foreground mt-1">
                  123 Business School Ave.
                  <br />
                  Education District, ED 10245
                </div>
                <div className="text-xs text-muted-foreground mt-2">
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
                          </TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.quantity * item.unitPrice)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Tax (5%)</span>
                  <span>{formatCurrency(tax)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between font-bold text-lg">
                    <span>GRAND TOTAL</span>
                    <span className="text-primary">
                      {formatCurrency(total)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  *Terms: Net 30
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
