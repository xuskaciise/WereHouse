"use client"

import { useState, useEffect } from "react"
import { Plus, Search, MoreVertical, Edit, Trash2 } from "lucide-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { StockStatus } from "@/lib/types"
import { useToast } from "@/components/ui/use-toast"

export default function InventoryPage() {
  const { toast } = useToast()
  const [stock, setStock] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingStock, setEditingStock] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchStock()
    fetchWarehouses()
    fetchProducts()
  }, [])

  const fetchStock = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/stock")
      if (response.ok) {
        const data = await response.json()
        setStock(data)
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch stock",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching stock:", error)
      toast({
        title: "Error",
        description: "Failed to fetch stock",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
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

  const filteredStock = stock.filter((item) => {
    if (!item.product) return false
    const matchesWarehouse =
      selectedWarehouse === "all" || item.warehouseId === selectedWarehouse
    const matchesSearch =
      item.product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.product.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesWarehouse && matchesSearch
  })

  const getStatusBadge = (status: StockStatus) => {
    switch (status) {
      case "IN_STOCK":
        return <Badge variant="success">In Stock</Badge>
      case "LOW_STOCK":
        return <Badge variant="warning">Low Stock</Badge>
      case "OUT_OF_STOCK":
        return <Badge variant="destructive">Out of Stock</Badge>
    }
  }

  const handleDelete = async (stockId: string) => {
    if (!confirm("Are you sure you want to delete this stock record?")) {
      return
    }

    try {
      const response = await fetch(`/api/stock/${stockId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Stock Deleted",
          description: "Stock record has been successfully deleted.",
        })
        fetchStock()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete stock",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error deleting stock:", error)
      toast({
        title: "Error",
        description: "Failed to delete stock",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Management</h1>
          <p className="text-muted-foreground">
            View and manage inventory across all warehouses
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingStock(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Adjust Stock
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingStock ? "Edit Stock" : "Adjust Stock"}
              </DialogTitle>
              <DialogDescription>
                {editingStock
                  ? "Update stock quantity for this product"
                  : "Adjust inventory quantity for a product in a warehouse"}
              </DialogDescription>
            </DialogHeader>
            <AdjustStockForm
              stock={editingStock}
              products={products}
              warehouses={warehouses}
              onSuccess={() => {
                setIsDialogOpen(false)
                setEditingStock(null)
                fetchStock()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Combobox
              options={[
                { value: "all", label: "All Warehouses" },
                ...warehouses.map((wh) => ({
                  value: wh.id,
                  label: wh.name,
                })),
              ]}
              value={selectedWarehouse}
              onValueChange={setSelectedWarehouse}
              placeholder="All Warehouses"
              searchPlaceholder="Search warehouses..."
              emptyMessage="No warehouses found."
              className="w-[200px]"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading stock...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Reorder Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No stock items found. Add products and warehouses to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStock.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.product?.name || "N/A"}
                    </TableCell>
                    <TableCell>{item.warehouse?.name || "N/A"}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.reservedQuantity}</TableCell>
                    <TableCell>
                      {item.quantity - item.reservedQuantity}
                    </TableCell>
                    <TableCell>{item.product?.reorderLevel || 0}</TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingStock(item)
                              setIsDialogOpen(true)
                            }}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(item.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
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
  stock,
  products,
  warehouses,
  onSuccess,
}: {
  stock: any | null
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

  useEffect(() => {
    if (stock) {
      setFormData({
        productId: stock.productId,
        warehouseId: stock.warehouseId,
        adjustmentType: "set",
        quantity: stock.quantity.toString(),
        notes: "",
      })
    } else {
      setFormData({
        productId: "",
        warehouseId: "",
        adjustmentType: "set",
        quantity: "",
        notes: "",
      })
    }
  }, [stock])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!stock && (!formData.productId || !formData.warehouseId)) {
      toast({
        title: "Validation Error",
        description: "Please select a product and warehouse.",
        variant: "destructive",
      })
      return
    }

    if (!formData.quantity) {
      toast({
        title: "Validation Error",
        description: "Please enter a quantity.",
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
      let response
      if (stock) {
        // Update existing stock
        response = await fetch(`/api/stock/${stock.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            quantity: quantity,
          }),
        })
      } else {
        // Create new stock adjustment
        response = await fetch("/api/stock/adjust", {
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
      }

      if (response.ok) {
        toast({
          title: stock ? "Stock Updated" : "Stock Adjusted",
          description: stock 
            ? "Stock has been updated successfully." 
            : "Stock has been adjusted successfully.",
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
            disabled={!!stock}
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
            disabled={!!stock}
          />
        </div>
      </div>

      {stock ? (
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
      ) : (
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
      )}

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
