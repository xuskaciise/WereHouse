"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, Power, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"

// Global list of landed cost types (Shipment, Customs & Clearance, ...).
export default function LandedCostTypesPage() {
  const { toast } = useToast()
  const canCreate = useCan("landed_cost_types", "create")
  const canEdit = useCan("landed_cost_types", "edit")
  const canDelete = useCan("landed_cost_types", "delete")
  const [types, setTypes] = useState<any[]>([])
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const load = async () => {
    const res = await fetch("/api/landed-cost-types")
    if (res.ok) setTypes(await res.json())
  }
  useEffect(() => {
    load()
  }, [])

  const call = async (url: string, method: string, body?: unknown, success?: string) => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Error", description: data.error || "Failed", variant: "destructive" })
      return false
    }
    if (success) toast({ title: success })
    await load()
    return true
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Landed Cost Types</h1>
        <p className="text-muted-foreground">
          Types of additional purchase costs (shipment, customs, transport, commission...). Used on purchase orders.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cost types</CardTitle>
          <CardDescription>A type used by cost lines cannot be deleted; deactivate it instead.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canCreate && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await call("/api/landed-cost-types", "POST", { name }, "Cost type added")) setName("")
              }}
            >
              <Input placeholder="New cost type, e.g. Insurance" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={!name.trim()}>
                <Plus className="mr-2 h-4 w-4" /> Add
              </Button>
            </form>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Used by</TableHead>
                <TableHead>Status</TableHead>
                {(canEdit || canDelete) && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((type) => (
                <TableRow key={type.id}>
                  <TableCell className="font-medium">
                    {editing?.id === type.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          if (await call(`/api/landed-cost-types/${type.id}`, "PATCH", { name: editing?.name }, "Renamed")) setEditing(null)
                        }}
                      >
                        <Input className="h-8" value={editing?.name ?? ""} maxLength={60} onChange={(e) => setEditing({ id: type.id, name: e.target.value })} autoFocus />
                        <Button size="sm" type="submit">Save</Button>
                        <Button size="sm" type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                      </form>
                    ) : (
                      type.name
                    )}
                  </TableCell>
                  <TableCell className="text-right">{type._count?.costs ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={type.isActive ? "success" : "secondary"}>{type.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  {(canEdit || canDelete) && (
                    <TableCell className="whitespace-nowrap text-right">
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="icon" title="Rename" onClick={() => setEditing({ id: type.id, name: type.name })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={type.isActive ? "Deactivate" : "Activate"}
                            onClick={() => call(`/api/landed-cost-types/${type.id}`, "PATCH", { isActive: !type.isActive })}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => call(`/api/landed-cost-types/${type.id}`, "DELETE", undefined, "Deleted")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
