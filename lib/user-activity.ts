import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type ActivityArea, ACTIVITY_AREAS, isActivityArea } from "@/lib/user-activity-rules"

// User activity report: everything one user recorded (sales, purchases,
// payments, stock, transfers, expenses, master data, permission changes),
// read from the userId each table already stores. Each source is filtered by
// user and period in its own SELECT (so the userId/createdAt indexes are
// used); area, warehouse and text filters apply to the combined rows. Sums
// are done by the database in NUMERIC and returned as Decimal.

export interface UserActivityFilters {
  userId: string
  from: Date
  to: Date
  areas: ActivityArea[]
  warehouseId?: string
  q?: string
  page: number
  pageSize: number
}

const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function day(value: string | null, name: string, endOfDay: boolean): Date | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`)
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} must be a valid date`)
  return d
}

function positiveInt(value: string | null, name: string, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive whole number`)
  return n
}

/** ?userId (required), ?from=&to= (default: last 30 days), ?areas=sales,payments, ?warehouseId, ?q, ?page, ?pageSize. */
export function parseUserActivityFilters(params: URLSearchParams): UserActivityFilters {
  const userId = params.get("userId")?.trim()
  if (!userId) throw new HttpError(400, "userId is required")
  const now = new Date()
  const to = day(params.get("to"), "to", true) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const from = day(params.get("from"), "from", false) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29))
  if (from > to) throw new HttpError(400, "from must be before to")
  if (to.getTime() - from.getTime() > 10 * 366 * 86400000) throw new HttpError(400, "The period can be at most 10 years")
  const areaParam = params.get("areas")?.trim()
  const areas = areaParam ? areaParam.split(",").map((a) => a.trim()).filter(Boolean) : [...ACTIVITY_AREAS]
  for (const a of areas) if (!isActivityArea(a)) throw new HttpError(400, `Unknown area: ${a}`)
  const q = params.get("q")?.trim().slice(0, 80) || undefined
  return {
    userId,
    from,
    to,
    areas: areas as ActivityArea[],
    warehouseId: params.get("warehouseId")?.trim() || undefined,
    q,
    page: positiveInt(params.get("page"), "page", 1),
    pageSize: Math.min(positiveInt(params.get("pageSize"), "pageSize", PAGE_SIZE), MAX_PAGE_SIZE),
  }
}

/**
 * One SELECT per source, all with the same columns: area, kind, id, at, ref,
 * "linkId" (record the row links to), detail, amount, quantity and up to two
 * warehouses. `u` and `p` are the user and period conditions for alias x.
 */
function sources(userId: string, from: Date, to: Date): Record<ActivityArea, Prisma.Sql[]> {
  const by = (x: string) => Prisma.sql`${Prisma.raw(`${x}."userId"`)} = ${userId} AND ${Prisma.raw(`${x}."createdAt"`)} BETWEEN ${from} AND ${to}`
  return {
    sales: [
      Prisma.sql`SELECT 'sales' AS area, 'sales_order' AS kind, so."id", so."createdAt" AS at, so."orderNumber" AS ref, so."id" AS "linkId",
        c."name" || ' · ' || so."status"::text AS detail, so."total" AS amount, NULL::int AS quantity, so."warehouseId" AS wh1, NULL::text AS wh2
        FROM "sales_orders" so JOIN "customers" c ON c."id" = so."customerId" WHERE ${by("so")}`,
      Prisma.sql`SELECT 'sales', 'sales_delivery', d."id", d."createdAt", d."deliveryNumber", d."salesOrderId",
        'Order ' || so."orderNumber" || ' · ' || c."name", d."total", NULL::int, so."warehouseId", NULL::text
        FROM "sales_deliveries" d JOIN "sales_orders" so ON so."id" = d."salesOrderId" JOIN "customers" c ON c."id" = so."customerId" WHERE ${by("d")}`,
      Prisma.sql`SELECT 'sales', 'sales_return', r."id", r."createdAt", r."returnNumber", r."id",
        c."name" || ' · ' || r."reason", r."total", NULL::int, r."warehouseId", NULL::text
        FROM "sales_returns" r JOIN "customers" c ON c."id" = r."customerId" WHERE ${by("r")}`,
      Prisma.sql`SELECT 'sales', 'sales_event', e."id", e."createdAt", so."orderNumber", e."salesOrderId",
        e."type" || COALESCE(' · ' || e."notes", ''), NULL::numeric, NULL::int, so."warehouseId", NULL::text
        FROM "sales_order_events" e JOIN "sales_orders" so ON so."id" = e."salesOrderId" WHERE ${by("e")}`,
    ],
    payments: [
      Prisma.sql`SELECT 'payments', 'customer_payment', cp."id", cp."createdAt", COALESCE(so."orderNumber", cp."reference"), cp."salesOrderId",
        c."name" || ' · ' || cp."paymentMethod", cp."amount", NULL::int, so."warehouseId", NULL::text
        FROM "customer_payments" cp JOIN "customers" c ON c."id" = cp."customerId" LEFT JOIN "sales_orders" so ON so."id" = cp."salesOrderId" WHERE ${by("cp")}`,
      Prisma.sql`SELECT 'payments', 'supplier_payment', sp."id", sp."createdAt", COALESCE(po."orderNumber", sp."reference"), sp."purchaseOrderId",
        s."name" || ' · ' || sp."paymentMethod", sp."amount", NULL::int, po."warehouseId", NULL::text
        FROM "supplier_payments" sp JOIN "suppliers" s ON s."id" = sp."supplierId" LEFT JOIN "purchase_orders" po ON po."id" = sp."purchaseOrderId" WHERE ${by("sp")}`,
    ],
    purchases: [
      Prisma.sql`SELECT 'purchases', 'purchase_order', po."id", po."createdAt", po."orderNumber", po."id",
        s."name" || ' · ' || po."status"::text, po."total", NULL::int, po."warehouseId", NULL::text
        FROM "purchase_orders" po JOIN "suppliers" s ON s."id" = po."supplierId" WHERE ${by("po")}`,
      Prisma.sql`SELECT 'purchases', 'purchase_receive', pr."id", pr."createdAt", po."orderNumber", po."id",
        s."name" || COALESCE(' · ' || pr."notes", ''), NULL::numeric,
        (SELECT COALESCE(SUM(i."quantityReceived"), 0)::int FROM "purchase_receive_items" i WHERE i."purchaseReceiveId" = pr."id"), po."warehouseId", NULL::text
        FROM "purchase_receives" pr JOIN "purchase_orders" po ON po."id" = pr."purchaseOrderId" JOIN "suppliers" s ON s."id" = po."supplierId" WHERE ${by("pr")}`,
      Prisma.sql`SELECT 'purchases', 'purchase_adjustment', a."id", a."createdAt", po."orderNumber", po."id",
        p."name" || ' · ' || a."type"::text || ' ' || a."oldQuantity" || ' → ' || a."newQuantity" || COALESCE(' · ' || a."reason", ''),
        NULL::numeric, a."newQuantity" - a."oldQuantity", po."warehouseId", NULL::text
        FROM "purchase_order_item_adjustments" a JOIN "purchase_order_items" poi ON poi."id" = a."purchaseOrderItemId"
        JOIN "purchase_orders" po ON po."id" = poi."purchaseOrderId" JOIN "products" p ON p."id" = poi."productId" WHERE ${by("a")}`,
      Prisma.sql`SELECT 'purchases', 'purchase_return', r."id", r."createdAt", r."returnNumber", r."id",
        s."name" || ' · ' || r."reason", r."creditTotal", NULL::int, r."warehouseId", NULL::text
        FROM "purchase_returns" r JOIN "suppliers" s ON s."id" = r."supplierId" WHERE ${by("r")}`,
      Prisma.sql`SELECT 'purchases', 'landed_cost', lc."id", lc."createdAt", po."orderNumber", po."id",
        t."name" || ' · ' || s."name", lc."amount", NULL::int, po."warehouseId", NULL::text
        FROM "purchase_landed_costs" lc JOIN "purchase_orders" po ON po."id" = lc."purchaseOrderId"
        JOIN "landed_cost_types" t ON t."id" = lc."typeId" JOIN "suppliers" s ON s."id" = lc."paidToSupplierId" WHERE ${by("lc")}`,
      Prisma.sql`SELECT 'purchases', 'landed_cost_log', l."id", l."createdAt", po."orderNumber", po."id",
        l."action" || COALESCE(' · ' || l."reason", ''), NULL::numeric, NULL::int, po."warehouseId", NULL::text
        FROM "landed_cost_logs" l JOIN "purchase_orders" po ON po."id" = l."purchaseOrderId" WHERE ${by("l")}`,
    ],
    stock: [
      Prisma.sql`SELECT 'stock', 'stock_movement', m."id", m."createdAt", m."reference", m."productId",
        p."name" || ' · ' || m."type"::text || COALESCE(' · ' || m."notes", ''), NULL::numeric, m."quantity", m."warehouseId", NULL::text
        FROM "stock_movements" m JOIN "products" p ON p."id" = m."productId" WHERE ${by("m")}`,
    ],
    transfers: [
      Prisma.sql`SELECT 'transfers', 'transfer', t."id", t."createdAt", t."transferNumber", t."id",
        fw."name" || ' → ' || tw."name" || ' · ' || t."status"::text, NULL::numeric,
        (SELECT COALESCE(SUM(i."quantity"), 0)::int FROM "stock_transfer_items" i WHERE i."stockTransferId" = t."id"), t."fromWarehouseId", t."toWarehouseId"
        FROM "stock_transfers" t JOIN "warehouses" fw ON fw."id" = t."fromWarehouseId" JOIN "warehouses" tw ON tw."id" = t."toWarehouseId" WHERE ${by("t")}`,
      Prisma.sql`SELECT 'transfers', 'transfer_receipt', r."id", r."createdAt", t."transferNumber", t."id",
        r."type"::text || COALESCE(' · ' || r."notes", ''), NULL::numeric, NULL::int, t."fromWarehouseId", t."toWarehouseId"
        FROM "stock_transfer_receipts" r JOIN "stock_transfers" t ON t."id" = r."stockTransferId" WHERE ${by("r")}`,
      Prisma.sql`SELECT 'transfers', 'transfer_event', e."id", e."createdAt", t."transferNumber", t."id",
        e."type" || COALESCE(' · ' || e."notes", ''), NULL::numeric, NULL::int, t."fromWarehouseId", t."toWarehouseId"
        FROM "stock_transfer_events" e JOIN "stock_transfers" t ON t."id" = e."stockTransferId" WHERE ${by("e")}`,
      Prisma.sql`SELECT 'transfers', 'transfer_cost', c."id", c."createdAt", t."transferNumber", t."id",
        lt."name" || ' · ' || s."name", c."amount", NULL::int, t."fromWarehouseId", t."toWarehouseId"
        FROM "stock_transfer_costs" c JOIN "stock_transfers" t ON t."id" = c."stockTransferId"
        JOIN "landed_cost_types" lt ON lt."id" = c."typeId" JOIN "suppliers" s ON s."id" = c."paidToSupplierId" WHERE ${by("c")}`,
    ],
    expenses: [
      Prisma.sql`SELECT 'expenses', 'expense', e."id", e."createdAt", e."reference", e."id",
        ec."name" || ' · ' || e."description", e."amount", NULL::int, NULL::text, NULL::text
        FROM "expenses" e JOIN "expense_categories" ec ON ec."id" = e."categoryId" WHERE ${by("e")}`,
    ],
    master_data: [
      Prisma.sql`SELECT 'master_data', 'product', x."id", x."createdAt", x."sku", x."id", x."name", NULL::numeric, NULL::int, NULL::text, NULL::text FROM "products" x WHERE ${by("x")}`,
      Prisma.sql`SELECT 'master_data', 'category', x."id", x."createdAt", NULL, x."id", x."name", NULL::numeric, NULL::int, NULL::text, NULL::text FROM "categories" x WHERE ${by("x")}`,
      Prisma.sql`SELECT 'master_data', 'customer', x."id", x."createdAt", NULL, x."id", x."name", NULL::numeric, NULL::int, NULL::text, NULL::text FROM "customers" x WHERE ${by("x")}`,
      Prisma.sql`SELECT 'master_data', 'supplier', x."id", x."createdAt", NULL, x."id", x."name", NULL::numeric, NULL::int, NULL::text, NULL::text FROM "suppliers" x WHERE ${by("x")}`,
      Prisma.sql`SELECT 'master_data', 'warehouse', x."id", x."createdAt", NULL, x."id", x."name", NULL::numeric, NULL::int, x."id", NULL::text FROM "warehouses" x WHERE ${by("x")}`,
    ],
    admin: [
      Prisma.sql`SELECT 'admin', 'permission_change', x."id", x."createdAt", x."role"::text, NULL, x."module", NULL::numeric, NULL::int, NULL::text, NULL::text
        FROM "permission_change_logs" x WHERE ${by("x")}`,
    ],
  }
}

/** Page each kind of row opens (null: no page for it). */
function linkFor(kind: string, linkId: string | null): string | null {
  switch (kind) {
    case "sales_order":
    case "sales_delivery":
    case "sales_event":
      return linkId ? `/sales/${linkId}` : null
    case "customer_payment":
      return linkId ? `/sales/${linkId}` : "/payments"
    case "sales_return":
      return `/sales/returns/${linkId}`
    case "purchase_order":
    case "purchase_receive":
    case "purchase_adjustment":
      return `/purchases/${linkId}`
    case "supplier_payment":
      return linkId ? `/purchases/${linkId}` : "/payments"
    case "landed_cost":
    case "landed_cost_log":
      return `/landed-costs/${linkId}`
    case "purchase_return":
      return `/purchases/returns/${linkId}`
    case "stock_movement":
      return "/inventory/movements"
    case "transfer":
    case "transfer_receipt":
    case "transfer_event":
    case "transfer_cost":
      return `/transfers/${linkId}`
    case "expense":
      return "/expenses"
    case "product":
      return "/products"
    case "category":
      return "/categories"
    case "customer":
      return "/customers"
    case "supplier":
      return "/suppliers"
    case "warehouse":
      return `/warehouses/${linkId}`
    case "permission_change":
      return "/roles"
    default:
      return null
  }
}

interface ActivityRow {
  area: string
  kind: string
  id: string
  at: Date
  ref: string | null
  linkId: string | null
  detail: string | null
  amount: Prisma.Decimal | null
  quantity: number | null
  wh1: string | null
  wh2: string | null
}

export async function userActivityReport(f: UserActivityFilters) {
  const user = await prisma.user.findUnique({
    where: { id: f.userId },
    select: { id: true, username: true, name: true, role: true, status: true, createdAt: true },
  })
  if (!user) throw new HttpError(404, "User not found")

  const all = sources(f.userId, f.from, f.to)
  const selects = f.areas.flatMap((a) => all[a])
  const outer: Prisma.Sql[] = []
  if (f.warehouseId) outer.push(Prisma.sql`(a.wh1 = ${f.warehouseId} OR a.wh2 = ${f.warehouseId})`)
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    outer.push(Prisma.sql`(COALESCE(a.ref, '') ILIKE ${like} OR COALESCE(a.detail, '') ILIKE ${like})`)
  }
  const where = outer.length ? Prisma.sql`WHERE ${Prisma.join(outer, " AND ")}` : Prisma.empty
  // The column list names the columns whichever source comes first.
  const activity = Prisma.sql`WITH a(area, kind, id, at, ref, "linkId", detail, amount, quantity, wh1, wh2) AS (${Prisma.join(selects, " UNION ALL ")})
    SELECT * FROM a ${where}`

  const [rows, byKind, warehouses] = await Promise.all([
    prisma.$queryRaw<ActivityRow[]>`
      ${activity} ORDER BY at DESC, id LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    prisma.$queryRaw<{ area: string; kind: string; count: number; amount: Prisma.Decimal | null; quantity: number | null; first: Date; last: Date }[]>`
      SELECT s.area, s.kind, COUNT(*)::int AS count, SUM(s.amount) AS amount, SUM(s.quantity)::int AS quantity, MIN(s.at) AS first, MAX(s.at) AS last
      FROM (${activity}) s GROUP BY s.area, s.kind ORDER BY count DESC`,
    prisma.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ])

  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]))
  const byArea = new Map<string, { area: string; count: number; amount: Prisma.Decimal }>()
  for (const k of byKind) {
    const entry = byArea.get(k.area) ?? { area: k.area, count: 0, amount: new Prisma.Decimal(0) }
    entry.count += k.count
    if (k.amount) entry.amount = entry.amount.plus(k.amount)
    byArea.set(k.area, entry)
  }
  const total = byKind.reduce((s, k) => s + k.count, 0)

  return {
    user,
    filters: { from: f.from, to: f.to, areas: f.areas, warehouseId: f.warehouseId ?? null, q: f.q ?? null },
    totals: {
      count: total,
      first: byKind.length ? new Date(Math.min(...byKind.map((k) => new Date(k.first).getTime()))) : null,
      last: byKind.length ? new Date(Math.max(...byKind.map((k) => new Date(k.last).getTime()))) : null,
    },
    byArea: ACTIVITY_AREAS.map((a) => byArea.get(a)).filter(Boolean),
    byKind,
    rows: rows.map((r) => ({
      id: r.id,
      area: r.area,
      kind: r.kind,
      at: r.at,
      ref: r.ref,
      detail: r.detail,
      amount: r.amount,
      quantity: r.quantity,
      warehouse: [r.wh1, r.wh2].filter((w): w is string => !!w).map((w) => warehouseName.get(w) ?? w).join(" → ") || null,
      href: linkFor(r.kind, r.linkId),
    })),
    page: f.page,
    pageSize: f.pageSize,
    total,
  }
}

/** Users for the report's search box: username, name and role. */
export function activityUserOptions() {
  return prisma.user.findMany({
    select: { id: true, username: true, name: true, role: true, status: true },
    orderBy: [{ name: "asc" }],
  })
}

export function activityWarehouseOptions() {
  return prisma.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
}
