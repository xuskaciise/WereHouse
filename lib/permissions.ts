import type { Role } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import {
  ADMIN_ONLY_MODULES,
  ADMIN_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  EDITABLE_ROLES,
  MODULES,
  type Action,
  type EditableRole,
  type Module,
  type PermissionMap,
  can,
} from "@/lib/permission-rules"

// Server side of the central permission system. Permissions are read from
// role_permissions on each request through a short in-process cache, so an
// admin's change applies without redeploy or re-login (immediately in this
// process, which also clears the cache, and within CACHE_MS elsewhere).

const CACHE_MS = 30_000
const cache = new Map<Role, { at: number; map: PermissionMap }>()

export function invalidatePermissionCache(): void {
  cache.clear()
}

function isEditableRole(role: Role): role is EditableRole {
  return (EDITABLE_ROLES as readonly string[]).includes(role)
}

export async function getRolePermissions(role: Role): Promise<PermissionMap> {
  if (role === "ADMIN") return ADMIN_PERMISSIONS
  if (!isEditableRole(role)) return emptyPermissions()

  const hit = cache.get(role)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.map

  const rows = await prisma.rolePermission.findMany({ where: { role } })
  // A module without a row falls back to the default (e.g. a module added later).
  const map = structuredClone(DEFAULT_PERMISSIONS[role])
  for (const row of rows) {
    if (!(MODULES as readonly string[]).includes(row.module)) continue
    map[row.module as Module] = {
      view: row.canView,
      create: row.canCreate,
      edit: row.canEdit,
      delete: row.canDelete,
      scope: row.scope,
      discountLimit: row.discountLimit === null ? null : row.discountLimit.toNumber(),
    }
  }
  // Never grantable to other roles, whatever the table says.
  for (const mod of ADMIN_ONLY_MODULES) {
    map[mod] = { ...map[mod], view: false, create: false, edit: false, delete: false }
  }
  cache.set(role, { at: Date.now(), map })
  return map
}

function emptyPermissions(): PermissionMap {
  const map = structuredClone(ADMIN_PERMISSIONS)
  for (const mod of MODULES) map[mod] = { ...map[mod], view: false, create: false, edit: false, delete: false }
  return map
}

// --- Checks used by routes ---------------------------------------------------

export interface PermissionUser {
  id: string
  role: Role
  permissions: PermissionMap
}

/** [module, action], or a list of them where any one is enough. */
export type PermissionSpec = [Module, Action] | [Module, Action][]

function alternatives(spec: PermissionSpec): [Module, Action][] {
  return Array.isArray(spec[0]) ? (spec as [Module, Action][]) : [spec as [Module, Action]]
}

export function hasPermission(user: PermissionUser, spec: PermissionSpec): boolean {
  return alternatives(spec).some(([mod, action]) => can(user.permissions, mod, action))
}

export function requirePermission(
  user: PermissionUser,
  spec: PermissionSpec,
  message = "You do not have permission to do this"
): void {
  if (!hasPermission(user, spec)) throw new HttpError(403, message)
}

/** Prisma `where` fragment: {} for scope ALL, { [field]: user.id } for OWN. */
export function scopeWhere(user: PermissionUser, mod: Module, field = "userId"): Record<string, string> {
  return user.permissions[mod].scope === "OWN" ? { [field]: user.id } : {}
}

export function isOwnScope(user: PermissionUser, mod: Module): boolean {
  return user.permissions[mod].scope === "OWN"
}

/**
 * 404 when the record does not exist or is outside the user's scope for this
 * module (OWN scope users cannot tell the two apart).
 */
export function assertInScope<T extends { userId: string | null }>(
  user: PermissionUser,
  mod: Module,
  record: T | null,
  notFoundMessage = "Not found"
): asserts record is T {
  if (!record || (isOwnScope(user, mod) && record.userId !== user.id)) {
    throw new HttpError(404, notFoundMessage)
  }
}

/** Maximum total sales discount in %, null = no limit; throws 403 if no discounts at all. */
export function salesDiscountLimit(user: PermissionUser): number | null {
  requirePermission(user, ["sales_discount", "create"], "You are not allowed to give discounts")
  return user.permissions.sales_discount.discountLimit
}
