"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { ArrowLeft, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { StockStatus } from "@/lib/types"

export default function WarehouseDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [warehouse, setWarehouse] = useState<any>(null)
  const [stock, setStock] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id) {
      fetchWarehouse()
      fetchStock()
    }
  }, [id])

  const fetchWarehouse = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/warehouses/${id}`)
      if (response.ok) {
        const data = await response.json()
        setWarehouse(data)
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || "Warehouse not found")
      }
    } catch (error) {
      console.error("Error fetching warehouse:", error)
      setError("Failed to fetch warehouse")
    } finally {
      setIsLoading(false)
    }
  }

  const fetchStock = async () => {
    try {
      const response = await fetch("/api/stock")
      if (response.ok) {
        const data = await response.json()
        // Filter stock by warehouse ID
        const warehouseStock = data.filter((s: any) => s.warehouseId === id)
        setStock(warehouseStock)
      }
    } catch (error) {
      console.error("Error fetching stock:", error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error || !warehouse) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">{error || "Warehouse not found"}</p>
          <Link href="/warehouses">
            <Button variant="outline">Back to Warehouses</Button>
          </Link>
        </div>
      </div>
    )
  }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/warehouses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {warehouse.name}
          </h1>
          <p className="text-muted-foreground">
            {warehouse.code && `Code: ${warehouse.code}`}
            {warehouse.address && ` • ${warehouse.address}`}
            {warehouse.city && `, ${warehouse.city}`}
            {warehouse.state && `, ${warehouse.state}`}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>
            Stock items in this warehouse
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No stock items in this warehouse</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.product?.name || "N/A"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.product?.sku || "N/A"}
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.reservedQuantity}</TableCell>
                    <TableCell>
                      {item.quantity - item.reservedQuantity}
                    </TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
