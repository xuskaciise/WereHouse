"use client"

import { useState, useEffect } from "react"
import { Plus, Package, Edit, Trash2, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Warehouse } from "@/lib/types"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"

export default function WarehousesPage() {
  const { toast } = useToast()
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [warehouseToDelete, setWarehouseToDelete] = useState<string | null>(null)

  useEffect(() => {
    fetchWarehouses()
    fetchStock()
  }, [])

  const fetchWarehouses = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/warehouses")
      if (response.ok) {
        const data = await response.json()
        setWarehouses(data)
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch warehouses",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching warehouses:", error)
      toast({
        title: "Error",
        description: "Failed to fetch warehouses",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
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

  const handleEdit = (warehouse: any) => {
    setEditingWarehouse(warehouse)
    setIsDialogOpen(true)
    setSelectedWarehouse(null)
  }

  const handleDeleteClick = (warehouseId: string) => {
    // Check if warehouse has stock
    const warehouseStock = stock.filter((s) => s.warehouseId === warehouseId)
    const hasStock = warehouseStock.length > 0

    if (hasStock) {
      toast({
        title: "Cannot Delete Warehouse",
        description: "This warehouse has stock items. Please remove all stock before deleting the warehouse.",
        variant: "destructive",
      })
      return
    }

    setWarehouseToDelete(warehouseId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!warehouseToDelete) return

    // Double check if warehouse has stock before deleting
    const warehouseStock = stock.filter((s) => s.warehouseId === warehouseToDelete)
    if (warehouseStock.length > 0) {
      toast({
        title: "Cannot Delete Warehouse",
        description: "This warehouse has stock items. Please remove all stock before deleting the warehouse.",
        variant: "destructive",
      })
      setDeleteDialogOpen(false)
      setWarehouseToDelete(null)
      return
    }

    try {
      const response = await fetch(`/api/warehouses/${warehouseToDelete}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Warehouse Deleted",
          description: "Warehouse has been deleted successfully.",
        })
        fetchWarehouses()
        fetchStock()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete warehouse",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error deleting warehouse:", error)
      toast({
        title: "Error",
        description: "Failed to delete warehouse",
        variant: "destructive",
      })
    } finally {
      setDeleteDialogOpen(false)
      setWarehouseToDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Warehouses</h1>
          <p className="text-muted-foreground">
            Manage physical storage locations and track item distributions
          </p>
        </div>
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) {
              setEditingWarehouse(null)
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingWarehouse(null)
                setIsDialogOpen(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Warehouse
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingWarehouse ? "Edit Warehouse" : "Add New Warehouse"}
              </DialogTitle>
              <DialogDescription>
                {editingWarehouse
                  ? "Update warehouse information"
                  : "Create a new warehouse location"}
              </DialogDescription>
            </DialogHeader>
            <WarehouseForm
              warehouse={editingWarehouse}
              onSuccess={() => {
                setIsDialogOpen(false)
                setEditingWarehouse(null)
                fetchWarehouses()
                fetchStock()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the warehouse
              and all associated data. If the warehouse has stock or orders, it cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Loading warehouses...</p>
          </CardContent>
        </Card>
      ) : warehouses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No warehouses found. Click "Add Warehouse" to create your first warehouse.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((warehouse) => {
          // Filter stock by warehouse ID
          const warehouseStock = stock.filter((s) => s.warehouseId === warehouse.id)
          const totalItems = warehouseStock.reduce(
            (sum, s) => sum + s.quantity,
            0
          )
          const uniqueSKUs = new Set(warehouseStock.map((s) => s.productId)).size
          const capacityUsage = warehouse.capacity
            ? (totalItems / warehouse.capacity) * 100
            : 0
          const hasStock = warehouseStock.length > 0

          return (
            <Card
              key={warehouse.id}
              className={`transition-shadow hover:shadow-lg ${
                selectedWarehouse === warehouse.id
                  ? "ring-2 ring-primary"
                  : ""
              }`}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <CardTitle className="text-lg">{warehouse.name}</CardTitle>
                    <Badge variant="outline">{warehouse.code}</Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEdit(warehouse)
                        }}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteClick(warehouse.id)
                        }}
                        className="text-destructive"
                        disabled={hasStock}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete {hasStock ? "(Has Stock)" : ""}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CardDescription>{warehouse.address}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Capacity Usage</span>
                    <span className="font-medium">
                      {capacityUsage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        capacityUsage > 80
                          ? "bg-red-500"
                          : capacityUsage > 50
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${Math.min(capacityUsage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm mt-4">
                    <span className="text-muted-foreground">Total Items</span>
                    <span className="font-medium">{totalItems}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Unique SKUs</span>
                    <span className="font-medium">
                      {uniqueSKUs}
                    </span>
                  </div>
                  <Link href={`/warehouses/${warehouse.id}`}>
                    <Button variant="outline" className="w-full mt-4">
                      <Package className="mr-2 h-4 w-4" />
                      View Inventory
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )
        })}
        </div>
      )}
    </div>
  )
}

function WarehouseForm({
  warehouse,
  onSuccess,
}: {
  warehouse: Warehouse | null
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const getAuthHeaders = () => {
    if (typeof window === "undefined") return {}
    const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
    if (!userData) return {}
    try {
      const user = JSON.parse(userData)
      return {
        "x-user-id": user?.id || "",
        "x-user-role": user?.role || "",
        "x-user-type": user?.user_type || "",
      }
    } catch {
      return {}
    }
  }
  const [formData, setFormData] = useState({
    name: warehouse?.name || "",
    code: warehouse?.code || "",
    address: warehouse?.address || "",
    city: warehouse?.city || "",
    state: warehouse?.state || "",
    capacity: warehouse?.capacity?.toString() || "",
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (warehouse) {
      setFormData({
        name: warehouse.name,
        code: warehouse.code,
        address: warehouse.address || "",
        city: warehouse.city || "",
        state: warehouse.state || "",
        capacity: warehouse.capacity?.toString() || "",
      })
    } else {
      setFormData({
        name: "",
        code: "",
        address: "",
        city: "",
        state: "",
        capacity: "",
      })
    }
  }, [warehouse])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.code.trim()) {
      toast({
        title: "Validation Error",
        description: "Name and Code are required fields.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const url = warehouse ? `/api/warehouses/${warehouse.id}` : "/api/warehouses"
      const method = warehouse ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          code: formData.code.trim(),
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          state: formData.state.trim() || null,
          capacity: formData.capacity ? parseInt(formData.capacity) : null,
        }),
      })

      if (response.ok) {
        toast({
          title: warehouse ? "Warehouse Updated" : "Warehouse Created",
          description: `${formData.name} has been ${warehouse ? "updated" : "created"} successfully.`,
        })
        onSuccess()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || `Failed to ${warehouse ? "update" : "create"} warehouse`,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error saving warehouse:", error)
      toast({
        title: "Error",
        description: `Failed to ${warehouse ? "update" : "create"} warehouse`,
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
          <Label htmlFor="name">Warehouse Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            placeholder="Central Warehouse"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Warehouse Code *</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            required
            placeholder="WH-001"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          placeholder="123 Main Street"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            placeholder="New York"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            value={formData.state}
            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
            placeholder="NY"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="capacity">Capacity</Label>
        <Input
          id="capacity"
          type="number"
          value={formData.capacity}
          onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
          placeholder="10000"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onSuccess} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : warehouse ? "Update" : "Create"} Warehouse
        </Button>
      </DialogFooter>
    </form>
  )
}
