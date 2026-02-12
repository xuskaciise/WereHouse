"use client"

import { useState, useEffect } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import Link from "next/link"

export default function LowStockPage() {
  const { toast } = useToast()
  const [stock, setStock] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchStock()
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

  const lowStockItems = stock.filter((item) => {
    if (!item.product) return false
    return item.quantity <= (item.product.reorderLevel || 0)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Low Stock Alert</h1>
          <p className="text-muted-foreground">
            Products below reorder level that need attention
          </p>
        </div>
        <Link href="/purchases/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Purchase Order
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Low Stock Items ({lowStockItems.length})</CardTitle>
          <CardDescription>
            These products are below their reorder level
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading stock data...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Reorder Level</TableHead>
                  <TableHead>Shortage</TableHead>
                  <TableHead>Cost Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No low stock items. All products are well stocked!
                    </TableCell>
                  </TableRow>
                ) : (
                  lowStockItems.map((item) => {
                    const reorderLevel = item.product?.reorderLevel || 0
                    const shortage = reorderLevel - item.quantity
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.product?.name || "N/A"}
                        </TableCell>
                        <TableCell>{item.warehouse?.name || "N/A"}</TableCell>
                        <TableCell className="text-red-600 font-medium">
                          {item.quantity}
                        </TableCell>
                        <TableCell>{reorderLevel}</TableCell>
                        <TableCell className="text-red-600 font-medium">
                          -{shortage}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(item.product?.costPrice || 0)}
                        </TableCell>
                        <TableCell>
                          {item.quantity === 0 ? (
                            <Badge variant="destructive">Out of Stock</Badge>
                          ) : (
                            <Badge variant="warning">Low Stock</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
