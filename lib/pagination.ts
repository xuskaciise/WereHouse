import { json } from "@/lib/api"
import { HttpError } from "@/lib/http-error"

// List endpoints accept:
//   ?page=1&pageSize=25   paginate (pageSize max 100); total in X-Total-Count
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   inclusive date range on the list's date field
// Without ?page the endpoint returns up to UNPAGED_LIMIT rows (for dropdowns
// and existing screens) and sets X-Truncated: true if more exist.

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100
export const UNPAGED_LIMIT = 1000

export interface PageArgs {
  take: number
  skip: number
}

interface ListParams extends PageArgs {
  page: number | null
  pageSize: number
}

function positiveInt(value: string | null, name: string): number | null {
  if (value === null || value === "") return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive whole number`)
  return n
}

export function getListParams(request: Request): ListParams {
  const params = new URL(request.url).searchParams
  const page = positiveInt(params.get("page"), "page")
  if (page === null) return { page: null, pageSize: UNPAGED_LIMIT, take: UNPAGED_LIMIT, skip: 0 }

  const pageSize = Math.min(positiveInt(params.get("pageSize"), "pageSize") ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  return { page, pageSize, take: pageSize, skip: (page - 1) * pageSize }
}

function parseDay(value: string | null, name: string, endOfDay: boolean): Date | undefined {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`)
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${name} must be a valid date`)
  return date
}

/** Prisma `where` fragment for ?from= / ?to= on the given date field. */
export function dateRangeWhere(request: Request, field: string): Record<string, { gte?: Date; lte?: Date }> {
  const params = new URL(request.url).searchParams
  const gte = parseDay(params.get("from"), "from", false)
  const lte = parseDay(params.get("to"), "to", true)
  if (!gte && !lte) return {}
  return { [field]: { ...(gte && { gte }), ...(lte && { lte }) } }
}

/**
 * Runs a paginated query and returns the rows as a JSON array (so existing
 * callers keep working) with pagination metadata in response headers.
 */
export async function listResponse<T>(
  request: Request,
  query: {
    findMany: (page: PageArgs) => Promise<T[]>
    count: () => Promise<number>
    map?: (rows: T[]) => Promise<unknown[]> | unknown[]
  }
): Promise<Response> {
  const params = getListParams(request)
  const [rows, total] = await Promise.all([
    query.findMany({ take: params.take, skip: params.skip }),
    query.count(),
  ])
  const body = query.map ? await query.map(rows) : rows

  const headers: Record<string, string> = { "X-Total-Count": String(total) }
  if (params.page !== null) {
    headers["X-Page"] = String(params.page)
    headers["X-Page-Size"] = String(params.pageSize)
  } else if (total > rows.length) {
    headers["X-Truncated"] = "true"
  }
  return json(body, { headers })
}
