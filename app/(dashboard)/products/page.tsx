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
import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"
import { Product, Category } from "@/lib/types"
import { useToast } from "@/components/ui/use-toast"
import { validateProductDates } from "@/lib/product-date-validation"

export default function ProductsPage() {
  const { toast } = useToast()
  const [products, setProducts] = useState<any[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchCategories()
    fetchProducts()
    fetchWarehouses()
    fetchStock()
  }, [])

  const fetchCategories = async () => {
    try {
      const response = await fetch("/api/categories")
      if (response.ok) {
        const data = await response.json()
        setCategories(data)
      }
    } catch (error) {
      console.error("Error fetching categories:", error)
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

  const fetchProducts = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/products")
      if (response.ok) {
        const data = await response.json()
        console.log("Fetched products:", data) // Debug log
        setProducts(data || [])
      } else {
        const error = await response.json()
        console.error("Failed to fetch products:", error)
        toast({
          title: "Error",
          description: error.error || "Failed to fetch products",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching products:", error)
      toast({
        title: "Error",
        description: "Failed to fetch products",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory =
      selectedCategory === "all" || product.categoryId === selectedCategory
    return matchesSearch && matchesCategory
  })

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) {
      return
    }

    try {
      const response = await fetch(`/api/products/${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Product Deleted",
          description: "Product has been successfully deleted.",
        })
        fetchProducts()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete product",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error deleting product:", error)
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive",
      })
    }
  }

  const getStatusBadge = (product: Product) => {
    // Calculate total stock for this product across all warehouses
    const productStock = stock.filter((s: any) => s.productId === product.id)
    const totalStock: number = productStock.reduce((sum: number, s: any) => sum + (s.quantity || 0), 0)
    
    if (totalStock === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>
    }
    if (totalStock < (product.reorderLevel || 0)) {
      return <Badge variant="warning">Low Stock</Badge>
    }
    return <Badge variant="success">In Stock</Badge>
  }

  const getTotalStock = (productId: string) => {
    const productStock = stock.filter((s: any) => s.productId === productId)
    return productStock.reduce((sum: number, s: any) => sum + (s.quantity || 0), 0)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Product Management</h1>
          <p className="text-muted-foreground">
            Manage your warehouse stock and track inventory values
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? "Edit Product" : "Add New Product"}
              </DialogTitle>
              <DialogDescription>
                {editingProduct
                  ? "Update product information"
                  : "Add a new product to your inventory"}
              </DialogDescription>
            </DialogHeader>
            <ProductForm
              product={editingProduct}
              categories={categories}
              warehouses={warehouses}
              onSuccess={async () => {
                setIsDialogOpen(false)
                setEditingProduct(null)
                // Clear search and category filter to show all products including the new one
                setSearchTerm("")
                setSelectedCategory("all")
                // Wait a bit for the database to be ready, then fetch products
                await new Promise(resolve => setTimeout(resolve, 300))
                await fetchProducts()
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
                placeholder="Search products by name or SKU..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading products...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Selling Price</TableHead>
                  <TableHead>Production Date</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Stock Quantity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No products found. Click "Add New Product" to create your first product.
                    </TableCell>
                  </TableRow>
                ) : (
                filteredProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-sm text-muted-foreground">
                        SKU: {product.sku}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{product.category?.name || "N/A"}</Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(product.costPrice)}</TableCell>
                  <TableCell className="text-green-600 font-medium">
                    {formatCurrency(product.sellingPrice)}
                  </TableCell>
                  <TableCell>
                    {product.issueDate ? new Date(product.issueDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    {product.expireDate ? new Date(product.expireDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>{getTotalStock(product.id)}</TableCell>
                  <TableCell>{getStatusBadge(product)}</TableCell>
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
                            setEditingProduct(product)
                            setIsDialogOpen(true)
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(product.id)}
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

function ProductForm({
  product,
  categories,
  warehouses,
  onSuccess,
}: {
  product: Product | null
  categories: Category[]
  warehouses: any[]
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const toDateInputValue = (value?: string | Date | null) => {
    if (!value) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return date.toISOString().split("T")[0]
  }
  const [formData, setFormData] = useState({
    name: product?.name || "",
    sku: product?.sku || "",
    description: product?.description || "",
    categoryId: product?.categoryId || "",
    costPrice: product?.costPrice.toString() || "",
    sellingPrice: product?.sellingPrice.toString() || "",
    productionDate: toDateInputValue(product?.issueDate),
    expiryDate: toDateInputValue(product?.expireDate),
  })
  const [productStock, setProductStock] = useState<any[]>([])
  const [stockQuantities, setStockQuantities] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingStock, setIsLoadingStock] = useState(false)

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        sku: product.sku,
        description: product.description || "",
        categoryId: product.categoryId,
        costPrice: product.costPrice.toString(),
        sellingPrice: product.sellingPrice.toString(),
        productionDate: toDateInputValue(product.issueDate),
        expiryDate: toDateInputValue(product.expireDate),
      })
      fetchProductStock()
    } else {
      setFormData({
        name: "",
        sku: "",
        description: "",
        categoryId: "",
        costPrice: "",
        sellingPrice: "",
        productionDate: "",
        expiryDate: "",
      })
      setProductStock([])
      setStockQuantities({})
    }
  }, [product, warehouses])

  const fetchProductStock = async () => {
    if (!product) return
    
    try {
      setIsLoadingStock(true)
      const response = await fetch("/api/stock")
      if (response.ok) {
        const allStock = await response.json()
        const productStockItems = allStock.filter((s: any) => s.productId === product.id)
        setProductStock(productStockItems)
        
        // Initialize stock quantities
        const quantities: Record<string, string> = {}
        productStockItems.forEach((stock: any) => {
          quantities[stock.id] = stock.quantity.toString()
        })
        setStockQuantities(quantities)
      }
    } catch (error) {
      console.error("Error fetching product stock:", error)
    } finally {
      setIsLoadingStock(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.sku.trim() || !formData.categoryId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields (Name, SKU, Category).",
        variant: "destructive",
      })
      return
    }

    const productDateError = validateProductDates({
      productionDate: formData.productionDate,
      expiryDate: formData.expiryDate,
    })
    if (productDateError) {
      toast({
        title: "Validation Error",
        description: productDateError,
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const url = product ? `/api/products/${product.id}` : "/api/products"
      const method = product ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          sku: formData.sku.trim(),
          description: formData.description.trim() || null,
          categoryId: formData.categoryId,
          costPrice: parseFloat(formData.costPrice) || 0,
          sellingPrice: parseFloat(formData.sellingPrice) || 0,
          productionDate: formData.productionDate || null,
          expiryDate: formData.expiryDate || null,
          reorderLevel: product?.reorderLevel || 10,
          stockUpdates: product ? Object.entries(stockQuantities).map(([stockId, quantity]) => ({
            stockId,
            quantity: parseInt(quantity) || 0,
          })) : null,
        }),
      })

      if (response.ok) {
        toast({
          title: product ? "Product Updated" : "Product Created",
          description: `${formData.name} has been ${product ? "updated" : "created"} successfully.`,
        })
        // Small delay to ensure database is updated
        setTimeout(() => {
          onSuccess()
        }, 100)
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || `Failed to ${product ? "update" : "create"} product`,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error saving product:", error)
      toast({
        title: "Error",
        description: `Failed to ${product ? "update" : "create"} product`,
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
          <Label htmlFor="name">Product Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sku">SKU *</Label>
          <Input
            id="sku"
            value={formData.sku}
            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">Category *</Label>
          <Combobox
            options={categories.map((cat) => ({
              value: cat.id,
              label: cat.name,
            }))}
            value={formData.categoryId}
            onValueChange={(value) =>
              setFormData({ ...formData, categoryId: value })
            }
            placeholder="Select category"
            searchPlaceholder="Search categories..."
            emptyMessage="No categories available. Please create a category first."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="costPrice">Cost Price *</Label>
          <Input
            id="costPrice"
            type="number"
            step="0.01"
            value={formData.costPrice}
            onChange={(e) =>
              setFormData({ ...formData, costPrice: e.target.value })
            }
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sellingPrice">Selling Price *</Label>
          <Input
            id="sellingPrice"
            type="number"
            step="0.01"
            value={formData.sellingPrice}
            onChange={(e) =>
              setFormData({ ...formData, sellingPrice: e.target.value })
            }
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="productionDate">Production Date</Label>
          <Input
            id="productionDate"
            type="date"
            value={formData.productionDate}
            onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiryDate">Expiry Date</Label>
          <Input
            id="expiryDate"
            type="date"
            value={formData.expiryDate}
            onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
          />
        </div>
      </div>


      {product && productStock.length > 0 && (
        <div className="space-y-4 border-t pt-4">
          <div>
            <Label className="text-base font-semibold">Stock Quantities by Warehouse</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Update quantities for each warehouse
            </p>
          </div>
          <div className="space-y-3">
            {productStock.map((stock) => {
              const warehouse = warehouses.find((w) => w.id === stock.warehouseId)
              return (
                <div key={stock.id} className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Warehouse</Label>
                    <Input
                      value={warehouse?.name || "Unknown"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`quantity-${stock.id}`}>Quantity</Label>
                    <Input
                      id={`quantity-${stock.id}`}
                      type="number"
                      min="0"
                      value={stockQuantities[stock.id] || "0"}
                      onChange={(e) =>
                        setStockQuantities({
                          ...stockQuantities,
                          [stock.id]: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onSuccess} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : product ? "Update" : "Create"} Product
        </Button>
      </DialogFooter>
    </form>
  )
}
