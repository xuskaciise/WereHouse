"use client"

import type { CurrentUser } from "@/components/providers/current-user-provider"

// Warehouse preselected in forms: the user's default (set by an admin in
// Users, or by the user in their profile), otherwise the last one used.

const key = (userId: string) => `last-warehouse:${userId}`

export function defaultWarehouseFor(user: CurrentUser, warehouses: { id: string }[]): string {
  const has = (id: string | null | undefined) => !!id && warehouses.some((w) => w.id === id)
  if (has(user.defaultWarehouseId)) return user.defaultWarehouseId!
  try {
    const last = localStorage.getItem(key(user.id))
    if (has(last)) return last!
  } catch {
    // storage unavailable: no remembered warehouse
  }
  return warehouses.length === 1 ? warehouses[0].id : ""
}

/** Remembers the warehouse picked in a form (only used when no default is set). */
export function rememberWarehouse(user: CurrentUser, warehouseId: string) {
  if (!warehouseId || user.defaultWarehouseId) return
  try {
    localStorage.setItem(key(user.id), warehouseId)
  } catch {
    // ignore
  }
}
