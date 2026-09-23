"use client"

import { useEffect, useMemo, useState } from "react"
import { Lock, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { formatDate } from "@/lib/utils"
import {
  ACTIONS,
  ADMIN_ONLY_MODULES,
  EDITABLE_ROLES,
  MODULES,
  MODULE_LABELS,
  ROLE_LABELS,
  type EditableRole,
  type Module,
  type ModulePermission,
  type PermissionMap,
} from "@/lib/permission-rules"

type Matrix = Record<EditableRole, PermissionMap>

interface LogEntry {
  id: string
  role: EditableRole
  module: Module
  before: ModulePermission
  after: ModulePermission
  createdAt: string
  user?: { username: string; name: string }
}

function describe(p: ModulePermission): string {
  const actions = ACTIONS.filter((a) => p[a]).join("/") || "none"
  const limit = p.discountLimit === null ? "" : `, limit ${p.discountLimit}%`
  return `${actions} (${p.scope.toLowerCase()}${limit})`
}

export default function RolesPage() {
  const { toast } = useToast()
  const [saved, setSaved] = useState<Matrix | null>(null)
  const [draft, setDraft] = useState<Matrix | null>(null)
  const [limitInput, setLimitInput] = useState<Record<string, string>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const load = async () => {
    const response = await fetch("/api/roles")
    if (!response.ok) {
      toast({ title: "Error", description: "Failed to load permissions", variant: "destructive" })
      return
    }
    const data = await response.json()
    setSaved(data.roles)
    setDraft(structuredClone(data.roles))
    setLimitInput(
      Object.fromEntries(
        EDITABLE_ROLES.map((role) => {
          const limit = data.roles[role].sales_discount.discountLimit
          return [role, limit === null ? "" : String(limit)]
        })
      )
    )
    setLog(data.log)
  }

  useEffect(() => {
    load()
  }, [])

  const changes = useMemo(() => {
    if (!saved || !draft) return []
    const list: ({ role: EditableRole; module: Module } & ModulePermission)[] = []
    for (const role of EDITABLE_ROLES) {
      for (const mod of MODULES) {
        if (JSON.stringify(saved[role][mod]) !== JSON.stringify(draft[role][mod])) {
          list.push({ role, module: mod, ...draft[role][mod] })
        }
      }
    }
    return list
  }, [saved, draft])

  const update = (role: EditableRole, mod: Module, patch: Partial<ModulePermission>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      const cell = { ...next[role][mod], ...patch }
      // Create/edit/delete need view; removing view removes the rest.
      if (patch.view === false) Object.assign(cell, { create: false, edit: false, delete: false })
      if (patch.create || patch.edit || patch.delete) cell.view = true
      next[role][mod] = cell
      return next
    })
  }

  const setLimit = (role: EditableRole, raw: string) => {
    setLimitInput((prev) => ({ ...prev, [role]: raw }))
    const n = raw.trim() === "" ? null : Number(raw)
    if (n === null || (Number.isFinite(n) && n >= 0 && n <= 100)) update(role, "sales_discount", { discountLimit: n })
  }

  const save = async () => {
    if (changes.length === 0) return
    setIsSaving(true)
    try {
      const response = await fetch("/api/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Failed to save permissions")
      toast({
        title: "Permissions saved",
        description: `${data.saved} change(s) saved. They apply to users on their next action; no logout needed.`,
      })
      await load()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (!draft) {
    return <div className="py-12 text-center text-muted-foreground">Loading permissions...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles &amp; Permissions</h1>
          <p className="text-muted-foreground">
            What each role may see and do. The same rules drive the menu, the pages, the buttons and every API
            request. Admin always has full access.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => saved && setDraft(structuredClone(saved))} disabled={changes.length === 0 || isSaving}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Discard
          </Button>
          <Button onClick={save} disabled={changes.length === 0 || isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : `Save${changes.length ? ` (${changes.length})` : ""}`}
          </Button>
        </div>
      </div>

      <Tabs defaultValue={EDITABLE_ROLES[0]} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="ADMIN">Admin</TabsTrigger>
          {EDITABLE_ROLES.map((role) => (
            <TabsTrigger key={role} value={role}>
              {ROLE_LABELS[role]}
              {changes.some((c) => c.role === role) && <span className="ml-1 text-primary">•</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ADMIN">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" /> Admin
              </CardTitle>
              <CardDescription>
                Full access to every module, company-wide, with no discount limit. This cannot be changed, so an
                administrator can never be locked out.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        {EDITABLE_ROLES.map((role) => (
          <TabsContent key={role} value={role}>
            <Card>
              <CardHeader>
                <CardTitle>{ROLE_LABELS[role]}</CardTitle>
                <CardDescription>
                  Scope &quot;All&quot; = company-wide data, &quot;Own&quot; = only records this user created.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      {ACTIONS.map((action) => (
                        <TableHead key={action} className="text-center capitalize">
                          {action}
                        </TableHead>
                      ))}
                      <TableHead>Scope</TableHead>
                      <TableHead>Discount limit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MODULES.map((mod) => {
                      const cell = draft[role][mod]
                      const locked = ADMIN_ONLY_MODULES.includes(mod)
                      const changed = JSON.stringify(cell) !== JSON.stringify(saved?.[role][mod])
                      return (
                        <TableRow key={mod} className={changed ? "bg-primary/5" : ""}>
                          <TableCell className="font-medium">
                            {MODULE_LABELS[mod]}
                            {locked && (
                              <Badge variant="secondary" className="ml-2">
                                Admin only
                              </Badge>
                            )}
                          </TableCell>
                          {ACTIONS.map((action) => (
                            <TableCell key={action} className="text-center">
                              <Checkbox
                                aria-label={`${ROLE_LABELS[role]} ${mod} ${action}`}
                                checked={cell[action]}
                                disabled={locked}
                                onCheckedChange={(checked) => update(role, mod, { [action]: checked === true })}
                              />
                            </TableCell>
                          ))}
                          <TableCell>
                            <Select
                              value={cell.scope}
                              disabled={locked}
                              onValueChange={(scope) => update(role, mod, { scope: scope as "ALL" | "OWN" })}
                            >
                              <SelectTrigger className="h-8 w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ALL">All</SelectItem>
                                <SelectItem value="OWN">Own</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {mod === "sales_discount" ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  className="h-8 w-20"
                                  placeholder="none"
                                  value={limitInput[role] ?? ""}
                                  onChange={(e) => setLimit(role, e.target.value)}
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">
                  Discount limit: highest total discount (%) this role may give; empty = no limit. A reason is required
                  above the limit and above 20%.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Change log</CardTitle>
          <CardDescription>Every permission change: who, when and what.</CardDescription>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(entry.createdAt)} {new Date(entry.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>{entry.user?.username || entry.user?.name || "N/A"}</TableCell>
                    <TableCell>{ROLE_LABELS[entry.role] ?? entry.role}</TableCell>
                    <TableCell>{MODULE_LABELS[entry.module] ?? entry.module}</TableCell>
                    <TableCell className="text-muted-foreground">{describe(entry.before)}</TableCell>
                    <TableCell>{describe(entry.after)}</TableCell>
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
