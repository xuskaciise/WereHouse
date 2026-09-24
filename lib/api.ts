import { NextResponse } from "next/server"
import { Prisma, type Role } from "@prisma/client"
import { HttpError, requireAuth, requireRole, type SessionUser } from "@/lib/auth-guard"
import { toJsonSafe } from "@/lib/money"
import { type PermissionSpec, requirePermission } from "@/lib/permissions"
import { can } from "@/lib/permission-rules"

/**
 * JSON response helper for route handlers. Prisma Decimal money values are
 * sent as numbers (the UI does arithmetic on them), after all server-side
 * calculations have been done in Decimal.
 */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(toJsonSafe(data), init)
}

// Every app/api/**/route.ts handler must be wrapped in withAuth() or
// publicRoute(), and every withAuth() must declare what it needs: a
// permission from the central system (lib/permission-rules.ts), fixed roles
// for system operations, or authenticatedOnly for data any signed-in user may
// read. scripts/check-route-guards.mjs enforces this in `npm run lint`.

type Params = Record<string, string>

interface RouteContext<P extends Params> {
  params: Promise<P>
}

type AuthedHandler<P extends Params> = (
  request: Request,
  context: { user: SessionUser; params: P }
) => Promise<Response>

interface AuthOptions {
  /** [module, action] or a list of alternatives (any one is enough); 403 otherwise. */
  permission?: PermissionSpec
  /** Fixed roles, for system operations outside the permission matrix. */
  roles?: Role[]
  /** Explicitly: any signed-in, approved user. */
  authenticatedOnly?: true
}

export function withAuth<P extends Params = Params>(handler: AuthedHandler<P>, options: AuthOptions) {
  return async (request: Request, context: RouteContext<P>): Promise<Response> => {
    try {
      const user = options.roles?.length ? await requireRole(...options.roles) : await requireAuth()
      if (options.permission) requirePermission(user, options.permission)
      const params = ((await context?.params) ?? {}) as P
      const response = await handler(request, { user, params })
      // Cost data never leaves the server for roles without product_cost:view.
      return can(user.permissions, "product_cost", "view") ? response : await withoutCostFields(response)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/**
 * Response fields that reveal what goods cost the company (average / landed
 * cost, cost price, COGS, stock value, profit). Removed at any depth from
 * JSON responses for users without the product_cost permission, so no route
 * can leak them by including a relation.
 */
export const COST_FIELDS = new Set([
  "costPrice",
  "avgCost",
  "unitCost",
  "landedCost",
  "appliedLandedCost",
  "landedUnitCost",
  "costPerUnit",
  "costIncreasePercent",
  "totalStockValue",
  "stockValue",
  "cogs",
  "cogsAdjustments",
  "grossProfit",
  "marginPercent",
  "inTransitValue",
  "warehouseStockValue",
  "allocatedCost",
  "lossCost",
  "stockLosses",
  "profitAfterLosses",
])

function omitCostFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitCostFields)
  if (value === null || typeof value !== "object") return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!COST_FIELDS.has(key)) result[key] = omitCostFields(item)
  }
  return result
}

async function withoutCostFields(response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("application/json")) return response
  const data = omitCostFields(await response.json())
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return NextResponse.json(data, { status: response.status, headers })
}

/** Explicitly unauthenticated route (e.g. public sign-up). */
export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/**
 * Converts any thrown error into a JSON response. Only HttpError messages and
 * a few well-known Prisma errors are shown to the client; everything else is
 * logged server-side and answered with a generic message.
 */
export function errorResponse(error: unknown, fallbackMessage = "Something went wrong. Please try again."): Response {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2025":
        return NextResponse.json({ error: "Record not found" }, { status: 404 })
      case "P2002":
        return NextResponse.json({ error: "A record with these details already exists" }, { status: 409 })
      case "P2003":
        return NextResponse.json(
          { error: "This record is linked to other data and cannot be changed or deleted" },
          { status: 409 }
        )
    }
  }

  console.error(error)
  const body: Record<string, string> = { error: fallbackMessage }
  if (process.env.NODE_ENV !== "production" && error instanceof Error) {
    body.detail = error.message
  }
  return NextResponse.json(body, { status: 500 })
}

/**
 * Runs a Prisma operation and turns unique (P2002) / foreign-key (P2003)
 * violations into 409 responses with a friendly, non-internal message.
 */
export async function withConflictMessages<T>(
  operation: () => Promise<T>,
  messages: { unique?: string; inUse?: string }
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002" && messages.unique) throw new HttpError(409, messages.unique)
      if (error.code === "P2003" && messages.inUse) throw new HttpError(409, messages.inUse)
    }
    throw error
  }
}

export async function readJson<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, "Invalid JSON body")
  }
}
