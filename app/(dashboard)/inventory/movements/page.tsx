"use client"

import { useState, useEffect } from "react"
import { Plus, Search, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Combobox } from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/utils"
import { MovementType } from "@/lib/types"
import { useToast } from "@/components/ui/use-toast"

export default function StockMovementsPage() {
  const { toast } = useToast()
  const [stockMovements, setStockMovements] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchStockMovements()
    fetchProducts()
    fetchWarehouses()
  }, [])

  const fetchStockMovements = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/stock-movements")
      if (response.ok) {
        const data = await response.json()
        setStockMovements(data)
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch stock movements",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching stock movements:", error)
      toast({
        title: "Error",
        description: "Failed to fetch stock movements",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
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

  const filteredMovements = stockMovements.filter((movement) => {
    if (!movement.product) return false
    return (
      movement.product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      movement.product.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      movement.reference?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  const getTypeBadge = (type: MovementType) => {
    switch (type) {
      case "IN":
        return <Badge variant="success">IN</Badge>
      case "OUT":
        return <Badge variant="destructive">OUT</Badge>
      case "TRANSFER":
        return <Badge variant="default">TRANSFER</Badge>
      case "ADJUSTMENT":
        return <Badge variant="warning">ADJUSTMENT</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Movement Log</h1>
          <p className="text-muted-foreground">
            Audit and analyze the flow of goods across your network
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Adjustment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>New Stock Adjustment</DialogTitle>
                <DialogDescription>
                  Adjust inventory quantity for a product in a warehouse
                </DialogDescription>
              </DialogHeader>
              <AdjustStockForm
                products={products}
                warehouses={warehouses}
                onSuccess={() => {
                  setIsDialogOpen(false)
                  fetchStockMovements()
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search product or SKU..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading stock movements...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Product Info</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No stock movements found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      {formatDateTime(movement.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{movement.product?.name || "N/A"}</div>
                        <div className="text-sm text-muted-foreground">
                          SKU: {movement.product?.sku || "N/A"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{movement.warehouse?.name || "N/A"}</TableCell>
                    <TableCell>{getTypeBadge(movement.type)}</TableCell>
                    <TableCell
                      className={
                        movement.quantity > 0
                          ? "text-green-600 font-medium"
                          : "text-red-600 font-medium"
                      }
                    >
                      {movement.quantity > 0 ? "+" : ""}
                      {movement.quantity}
                    </TableCell>
                    <TableCell>{movement.reference || "-"}</TableCell>
                    <TableCell>{movement.user?.username || movement.user?.name || "N/A"}</TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AdjustStockForm({
  products,
  warehouses,
  onSuccess,
}: {
  products: any[]
  warehouses: any[]
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    productId: "",
    warehouseId: "",
    adjustmentType: "set", // "set", "add", "subtract"
    quantity: "",
    notes: "",
  })
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.productId || !formData.warehouseId || !formData.quantity) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    const quantity = parseInt(formData.quantity)
    if (isNaN(quantity) || quantity < 0) {
      toast({
        title: "Validation Error",
        description: "Quantity must be a positive number.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch("/api/stock/adjust", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: formData.productId,
          warehouseId: formData.warehouseId,
          adjustmentType: formData.adjustmentType,
          quantity: quantity,
          notes: formData.notes.trim() || null,
        }),
      })

      if (response.ok) {
        toast({
          title: "Stock Adjusted",
          description: "Stock has been adjusted successfully.",
        })
        onSuccess()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to adjust stock",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error adjusting stock:", error)
      toast({
        title: "Error",
        description: "Failed to adjust stock",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="product">Product *</Label>
          <Combobox
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name} (${product.sku})`,
            }))}
            value={formData.productId}
            onValueChange={(value) => setFormData({ ...formData, productId: value })}
            placeholder="Select product"
            searchPlaceholder="Search products..."
            emptyMessage="No products available"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="warehouse">Warehouse *</Label>
          <Combobox
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouse.name,
            }))}
            value={formData.warehouseId}
            onValueChange={(value) => setFormData({ ...formData, warehouseId: value })}
            placeholder="Select warehouse"
            searchPlaceholder="Search warehouses..."
            emptyMessage="No warehouses available"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="adjustmentType">Adjustment Type *</Label>
          <Select
            value={formData.adjustmentType}
            onValueChange={(value) => setFormData({ ...formData, adjustmentType: value })}
          >
            <SelectTrigger id="adjustmentType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="set">Set Quantity</SelectItem>
              <SelectItem value="add">Add Quantity</SelectItem>
              <SelectItem value="subtract">Subtract Quantity</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity *</Label>
          <Input
            id="quantity"
            type="number"
            min="0"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            required
            placeholder="0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Reason for adjustment..."
          rows={3}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onSuccess} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Adjusting..." : "Adjust Stock"}
        </Button>
      </DialogFooter>
    </form>
  )
}
