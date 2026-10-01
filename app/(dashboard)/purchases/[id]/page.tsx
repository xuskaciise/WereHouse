"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PurchaseOrderDetailsSheet } from "../purchase-order-details-sheet"

// Full purchase order page: lines, receive, landed costs, payments, returns.
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<any | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const res = await fetch(`/api/purchase-orders/${id}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setOrder(data)
    else setError(data.error || "Failed to load the purchase order")
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="py-12 text-center text-destructive">{error}</p>
  if (!order) return <p className="py-12 text-center text-muted-foreground">Loading...</p>
  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" className="-ml-4 print:hidden">
        <Link href="/purchases"><ArrowLeft className="mr-2 h-4 w-4" /> Purchase orders</Link>
      </Button>
      <PurchaseOrderDetailsSheet order={order} open onOpenChange={() => {}} onReceiveComplete={load} asPage />
    </div>
  )
}
