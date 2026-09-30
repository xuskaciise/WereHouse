"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCan } from "@/components/providers/current-user-provider"

// Account pickers for categories, products and expense categories. Shown only
// to roles with accounting:edit (the server ignores the fields for others).

const DEFAULT = "__default"
let request: Promise<any[]> | null = null
function useAccounts() {
  const [accounts, setAccounts] = useState<any[]>([])
  useEffect(() => {
    request ??= fetch("/api/accounts").then((r) => (r.ok ? r.json() : [])).catch(() => [])
    request.then(setAccounts)
  }, [])
  return accounts
}

export interface AccountLinkValue {
  inventoryAccountId: string | null
  salesAccountId: string | null
  cogsAccountId: string | null
}
export const emptyAccountLinks = (v?: Partial<AccountLinkValue> | null): AccountLinkValue => ({
  inventoryAccountId: v?.inventoryAccountId ?? null,
  salesAccountId: v?.salesAccountId ?? null,
  cogsAccountId: v?.cogsAccountId ?? null,
})

function AccountSelect({ label, group, type, value, onChange, defaultLabel }: {
  label: string
  group?: string
  type?: string
  value: string | null
  onChange: (id: string | null) => void
  defaultLabel: string
}) {
  const accounts = useAccounts().filter((a) => a.isActive && (!group || a.group === group) && (!type || a.type === type))
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : v)}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
          {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Inventory / Sales / COGS accounts of a category (defaults) or a product (overrides). */
export function AccountLinkFields({ value, onChange, level }: { value: AccountLinkValue; onChange: (v: AccountLinkValue) => void; level: "category" | "product" }) {
  const canEdit = useCan("accounting", "edit")
  if (!canEdit) return null
  const fallback = level === "product" ? "Category default" : "System default"
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="text-sm font-medium">Accounts</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <AccountSelect label="Inventory" group="INVENTORY" value={value.inventoryAccountId} onChange={(v) => onChange({ ...value, inventoryAccountId: v })} defaultLabel={fallback} />
        <AccountSelect label="Sales" group="SALES" value={value.salesAccountId} onChange={(v) => onChange({ ...value, salesAccountId: v })} defaultLabel={fallback} />
        <AccountSelect label="Cost of goods sold" group="COGS" value={value.cogsAccountId} onChange={(v) => onChange({ ...value, cogsAccountId: v })} defaultLabel={fallback} />
      </div>
    </div>
  )
}

/** Expense account of an expense category. */
export function ExpenseAccountField({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const canEdit = useCan("accounting", "edit")
  if (!canEdit) return null
  return <AccountSelect label="Expense account" type="EXPENSE" value={value} onChange={onChange} defaultLabel="New account with the category name" />
}
