import type { Prisma, Role } from "@prisma/client"
import { TX_OPTIONS, prisma } from "@/lib/prisma"
import { json, readJson, withAuth } from "@/lib/api"
import { HttpError } from "@/lib/auth-guard"
import { getRolePermissions, invalidatePermissionCache } from "@/lib/permissions"
import {
  ADMIN_ONLY_MODULES,
  EDITABLE_ROLES,
  MODULES,
  type EditableRole,
  type Module,
  type ModulePermission,
} from "@/lib/permission-rules"

// Roles & Permissions page (roles module, ADMIN-only). ADMIN itself is not
// editable and always keeps full access.

export const GET = withAuth(async () => {
  invalidatePermissionCache() // always show what is stored right now
  const roles: Record<string, unknown> = {}
  for (const role of EDITABLE_ROLES) roles[role] = await getRolePermissions(role)
  const log = await prisma.permissionChangeLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, name: true, username: true } } },
  })
  return json({ roles, log })
}, { permission: ["roles", "view"] })

interface ChangeInput {
  role?: unknown
  module?: unknown
  view?: unknown
  create?: unknown
  edit?: unknown
  delete?: unknown
  scope?: unknown
  discountLimit?: unknown
}

function parseChange(raw: ChangeInput): { role: EditableRole; module: Module; value: ModulePermission } {
  if (typeof raw?.role !== "string" || !(EDITABLE_ROLES as readonly string[]).includes(raw.role)) {
    throw new HttpError(400, "Only non-admin roles can be changed (ADMIN always has full access)")
  }
  if (typeof raw.module !== "string" || !(MODULES as readonly string[]).includes(raw.module)) {
    throw new HttpError(400, "Unknown module")
  }
  const mod = raw.module as Module
  if (ADMIN_ONLY_MODULES.includes(mod)) throw new HttpError(400, `${mod} stays ADMIN-only`)

  const flag = (v: unknown, name: string) => {
    if (typeof v !== "boolean") throw new HttpError(400, `${name} must be true or false`)
    return v
  }
  if (raw.scope !== "ALL" && raw.scope !== "OWN") throw new HttpError(400, "scope must be ALL or OWN")

  let discountLimit: number | null = null
  if (mod === "sales_discount" && raw.discountLimit !== null && raw.discountLimit !== undefined && raw.discountLimit !== "") {
    const n = Number(raw.discountLimit)
    if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) !== n * 100) {
      throw new HttpError(400, "Discount limit must be between 0 and 100 (up to 2 decimals), or empty for no limit")
    }
    discountLimit = n
  }

  const value: ModulePermission = {
    view: flag(raw.view, "view"),
    create: flag(raw.create, "create"),
    edit: flag(raw.edit, "edit"),
    delete: flag(raw.delete, "delete"),
    scope: raw.scope,
    discountLimit,
  }
  // Any other action without "view" would be unusable (pages and lists need it).
  if (!value.view && (value.create || value.edit || value.delete)) {
    throw new HttpError(400, `${mod}: create/edit/delete need view`)
  }
  return { role: raw.role as EditableRole, module: mod, value }
}

const same = (a: ModulePermission, b: ModulePermission) => JSON.stringify(a) === JSON.stringify(b)

/** Body: { changes: [{ role, module, view, create, edit, delete, scope, discountLimit }] } */
export const PUT = withAuth(async (request, { user }) => {
  const body = await readJson<{ changes?: ChangeInput[] }>(request)
  if (!Array.isArray(body?.changes) || body.changes.length === 0) {
    throw new HttpError(400, "changes array with at least one entry is required")
  }
  if (body.changes.length > 500) throw new HttpError(400, "Too many changes at once")
  const changes = body.changes.map(parseChange)

  invalidatePermissionCache()
  const current = new Map<Role, Awaited<ReturnType<typeof getRolePermissions>>>()
  for (const role of new Set(changes.map((c) => c.role))) current.set(role, await getRolePermissions(role))

  let saved = 0
  await prisma.$transaction(async (tx) => {
    for (const { role, module: mod, value } of changes) {
      const before = current.get(role)![mod]
      if (same(before, value)) continue
      const data = {
        canView: value.view,
        canCreate: value.create,
        canEdit: value.edit,
        canDelete: value.delete,
        scope: value.scope,
        discountLimit: value.discountLimit,
      }
      await tx.rolePermission.upsert({
        where: { role_module: { role, module: mod } },
        update: data,
        create: { role, module: mod, ...data },
      })
      await tx.permissionChangeLog.create({
        data: {
          userId: user.id,
          role,
          module: mod,
          before: before as unknown as Prisma.InputJsonValue,
          after: value as unknown as Prisma.InputJsonValue,
        },
      })
      saved++
    }
  }, TX_OPTIONS)
  // Takes effect on the next request (this process) and within the cache TTL elsewhere.
  invalidatePermissionCache()

  return json({ saved })
}, { permission: ["roles", "edit"] })
