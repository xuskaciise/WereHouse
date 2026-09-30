import { type AccountGroup, type AccountType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { HttpError } from "@/lib/http-error"
import { type Money, Decimal, ZERO, sumMoney } from "@/lib/money"
import { type PermissionUser, hasPermission, isOwnScope } from "@/lib/permissions"

// Chart of accounts, account links (category / product / expense category)
// and the journal reports: journal list, account ledger, trial balance.

type Tx = Prisma.TransactionClient

export const GROUPS_BY_TYPE: Record<AccountType, AccountGroup[]> = {
  ASSET: ["CASH_AND_BANK", "RECEIVABLE", "INVENTORY", "OTHER_ASSET"],
  LIABILITY: ["PAYABLE", "TAX", "OTHER_LIABILITY"],
  EQUITY: ["EQUITY"],
  INCOME: ["SALES", "SALES_RETURNS", "OTHER_INCOME"],
  EXPENSE: ["COGS", "OPERATING_EXPENSE", "LOSS", "OTHER_EXPENSE"],
}

/** Debit-normal types: their balance is debit - credit (others: credit - debit). */
export const DEBIT_NORMAL: AccountType[] = ["ASSET", "EXPENSE"]

// --- Chart of accounts ----------------------------------------------------------------

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  const v = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  if (!v) {
    if (required) throw new HttpError(400, `${label} is required`)
    return null
  }
  if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`)
  return v
}

function parseCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
  if (!/^\d{3,6}$/.test(code)) throw new HttpError(400, "The account code must be 3 to 6 digits")
  return code
}

async function uniqueCode(code: string, exceptId?: string) {
  const other = await prisma.account.findUnique({ where: { code }, select: { id: true, name: true } })
  if (other && other.id !== exceptId) throw new HttpError(409, `Code ${code} is already used by "${other.name}"`)
}

export async function createAccount(body: any) {
  const type = body?.type as AccountType
  if (!(type in GROUPS_BY_TYPE)) throw new HttpError(400, "Choose a type: asset, liability, equity, income or expense")
  const group = (body?.group ?? GROUPS_BY_TYPE[type][0]) as AccountGroup
  if (!GROUPS_BY_TYPE[type].includes(group)) throw new HttpError(400, "This group does not belong to the chosen type")
  const code = parseCode(body?.code)
  await uniqueCode(code)
  return prisma.account.create({
    data: { code, type, group, name: text(body?.name, "Name", 100, true)!, description: text(body?.description, "Description", 300, false) },
  })
}

/** System accounts keep their type, group and active state; the name, code and description can change. */
export async function updateAccount(id: string, body: any) {
  const account = await prisma.account.findUnique({ where: { id } })
  if (!account) throw new HttpError(404, "Account not found")
  const data: Prisma.AccountUpdateInput = {}
  if (body?.name !== undefined) data.name = text(body.name, "Name", 100, true)!
  if (body?.description !== undefined) data.description = text(body.description, "Description", 300, false)
  if (body?.code !== undefined) {
    data.code = parseCode(body.code)
    await uniqueCode(data.code, id)
  }
  const used = await prisma.journalLine.count({ where: { accountId: id } })
  if (body?.type !== undefined || body?.group !== undefined) {
    const type = (body.type ?? account.type) as AccountType
    const group = (body.group ?? account.group) as AccountGroup
    if (!(type in GROUPS_BY_TYPE) || !GROUPS_BY_TYPE[type].includes(group)) throw new HttpError(400, "Invalid type / group")
    if (account.systemKey && (type !== account.type || group !== account.group)) {
      throw new HttpError(400, "The type of a system account cannot change")
    }
    if (used > 0 && type !== account.type) throw new HttpError(400, "The type of an account with journal lines cannot change")
    data.type = type
    data.group = group
  }
  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false")
    if (account.systemKey && !body.isActive) throw new HttpError(400, "System accounts are used by the automatic journals and cannot be deactivated")
    data.isActive = body.isActive
  }
  return prisma.account.update({ where: { id }, data })
}

/** Only unused, non-system accounts can be deleted; others are deactivated. */
export async function deleteAccount(id: string) {
  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          lines: true,
          categoryInventoryAccounts: true,
          categorySalesAccounts: true,
          categoryCogsAccounts: true,
          productInventoryAccounts: true,
          productSalesAccounts: true,
          productCogsAccounts: true,
          expenseCategories: true,
        },
      },
    },
  })
  if (!account) throw new HttpError(404, "Account not found")
  if (account.systemKey) throw new HttpError(400, "System accounts cannot be deleted")
  if (account._count.lines > 0) throw new HttpError(409, "The account has journal lines; deactivate it instead")
  const links = Object.entries(account._count).filter(([k, n]) => k !== "lines" && n > 0).length
  if (links > 0) throw new HttpError(409, "Categories, products or expense categories still use this account")
  await prisma.account.delete({ where: { id } })
}

/** Next free code 6001-6899 for an expense category account. */
async function nextExpenseCode(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ n: number | null }[]>`
    SELECT MAX("code"::int) AS n FROM "accounts" WHERE "code" ~ '^6[0-8][0-9][0-9]$'`
  const next = Math.max(6000, rows[0]?.n ?? 6000) + 1
  if (next > 6899) throw new HttpError(409, "No free expense account code left (6001-6899)")
  return String(next)
}

/** Creates the expense account of a new expense category and links it. */
export async function createExpenseAccountFor(tx: Tx, categoryId: string, name: string) {
  const account = await tx.account.create({
    data: { code: await nextExpenseCode(tx), name, type: "EXPENSE", group: "OPERATING_EXPENSE" },
  })
  await tx.expenseCategory.update({ where: { id: categoryId }, data: { accountId: account.id } })
}

// --- Account links ----------------------------------------------------------------------

const LINK_GROUP = { inventoryAccountId: "INVENTORY", salesAccountId: "SALES", cogsAccountId: "COGS" } as const
export type AccountLinks = Partial<Record<keyof typeof LINK_GROUP, string | null>>

/**
 * Account links from a category / product body. Only roles with
 * accounting:edit may change them; other roles' bodies are ignored.
 * null / "" = use the default.
 */
export async function parseAccountLinks(user: PermissionUser, body: any): Promise<AccountLinks> {
  const links: AccountLinks = {}
  if (!hasPermission(user, ["accounting", "edit"])) return links
  for (const [field, group] of Object.entries(LINK_GROUP) as [keyof typeof LINK_GROUP, AccountGroup][]) {
    if (body?.[field] === undefined) continue
    const id = body[field] ? String(body[field]) : null
    if (id) {
      const account = await prisma.account.findUnique({ where: { id }, select: { group: true, isActive: true, name: true } })
      if (!account) throw new HttpError(400, "Account not found")
      if (account.group !== group) throw new HttpError(400, `"${account.name}" cannot be used here (needs an account of group ${group.replace("_", " ").toLowerCase()})`)
      if (!account.isActive) throw new HttpError(400, `"${account.name}" is inactive`)
    }
    links[field] = id
  }
  return links
}

export async function parseExpenseAccountLink(user: PermissionUser, body: any): Promise<{ accountId?: string } > {
  if (!hasPermission(user, ["accounting", "edit"]) || !body?.accountId) return {}
  const account = await prisma.account.findUnique({ where: { id: String(body.accountId) }, select: { type: true, isActive: true } })
  if (!account || account.type !== "EXPENSE" || !account.isActive) throw new HttpError(400, "Choose an active expense account")
  return { accountId: String(body.accountId) }
}

// --- Reports -----------------------------------------------------------------------------

function day(value: string | null, endOfDay: boolean): Date | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Dates must be YYYY-MM-DD")
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
}
export function periodOf(params: URLSearchParams) {
  const from = day(params.get("from"), false)
  const to = day(params.get("to"), true)
  if (from && to && from > to) throw new HttpError(400, "from must be before to")
  return { from, to }
}

/** Journal entries visible to the user (OWN scope: entries of their own documents). */
function entryScope(user: PermissionUser): Prisma.Sql {
  return isOwnScope(user, "accounting") ? Prisma.sql`AND e."userId" = ${user.id}` : Prisma.empty
}

const dateSql = (from: Date | null, to: Date | null) =>
  Prisma.sql`${from ? Prisma.sql`AND e."date" >= ${from}` : Prisma.empty} ${to ? Prisma.sql`AND e."date" <= ${to}` : Prisma.empty}`

export async function listAccounts(user: PermissionUser) {
  const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } })
  const sums = await prisma.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT l."accountId", SUM(l."debit") AS debit, SUM(l."credit") AS credit
    FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE TRUE ${entryScope(user)} GROUP BY l."accountId"`
  const by = new Map(sums.map((s) => [s.accountId, s]))
  return accounts.map((a) => {
    const s = by.get(a.id)
    const debit = s?.debit ?? ZERO
    const credit = s?.credit ?? ZERO
    return { ...a, debit, credit, balance: DEBIT_NORMAL.includes(a.type) ? debit.minus(credit) : credit.minus(debit) }
  })
}

export async function trialBalance(user: PermissionUser, from: Date | null, to: Date | null) {
  const rows = await prisma.$queryRaw<{ id: string; code: string; name: string; type: AccountType; group: AccountGroup; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT a."id", a."code", a."name", a."type", a."group", SUM(l."debit") AS debit, SUM(l."credit") AS credit
    FROM "journal_lines" l
    JOIN "journal_entries" e ON e."id" = l."entryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE TRUE ${entryScope(user)} ${dateSql(from, to)}
    GROUP BY a."id", a."code", a."name", a."type", a."group"
    ORDER BY a."code"`
  const lines = rows
    .map((r) => {
      const net = new Decimal(r.debit).minus(r.credit)
      return { ...r, debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.neg() : ZERO, totalDebit: r.debit, totalCredit: r.credit }
    })
    .filter((r) => !r.debit.isZero() || !r.credit.isZero())
  const totalDebit = sumMoney(lines.map((l) => l.debit))
  const totalCredit = sumMoney(lines.map((l) => l.credit))
  return { from, to, lines, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) }
}

export async function accountLedger(user: PermissionUser, accountId: string, from: Date | null, to: Date | null) {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) throw new HttpError(404, "Account not found")
  const sign = DEBIT_NORMAL.includes(account.type) ? 1 : -1
  const opening = from
    ? await prisma.$queryRaw<{ net: Prisma.Decimal | null }[]>`
        SELECT SUM(l."debit" - l."credit") AS net FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
        WHERE l."accountId" = ${accountId} AND e."date" < ${from} ${entryScope(user)}`
    : [{ net: ZERO }]
  const lines = await prisma.$queryRaw<
    { id: string; entryId: string; entryNumber: string; date: Date; description: string; reference: string | null; sourceType: string; sourceId: string; memo: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal }[]
  >`
    SELECT l."id", e."id" AS "entryId", e."entryNumber", e."date", e."description", e."reference", e."sourceType", e."sourceId", l."memo", l."debit", l."credit"
    FROM "journal_lines" l JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${accountId} ${entryScope(user)} ${dateSql(from, to)}
    ORDER BY e."date", e."entryNumber"
    LIMIT 5000`
  const openingBalance = new Decimal(opening[0]?.net ?? 0).times(sign)
  let running: Money = openingBalance
  const rows = lines.map((l) => {
    running = running.plus(new Decimal(l.debit).minus(l.credit).times(sign))
    return { ...l, balance: running }
  })
  return {
    account,
    from,
    to,
    openingBalance,
    rows,
    totalDebit: sumMoney(lines.map((l) => l.debit)),
    totalCredit: sumMoney(lines.map((l) => l.credit)),
    closingBalance: running,
    truncated: lines.length >= 5000,
  }
}

export async function listJournal(user: PermissionUser, params: URLSearchParams) {
  const { from, to } = periodOf(params)
  const sourceType = params.get("sourceType") || null
  const q = params.get("q")?.trim() || null
  const page = Math.max(1, Number(params.get("page")) || 1)
  const pageSize = 50
  const where: Prisma.JournalEntryWhereInput = {
    ...(isOwnScope(user, "accounting") && { userId: user.id }),
    ...((from || to) && { date: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
    ...(sourceType && { sourceType }),
    ...(q && {
      OR: [
        { entryNumber: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
        { reference: { contains: q, mode: "insensitive" as const } },
      ],
    }),
  }
  const [total, entries] = await Promise.all([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { entryNumber: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, username: true } },
        lines: { include: { account: { select: { id: true, code: true, name: true } } }, orderBy: { debit: "desc" } },
      },
    }),
  ])
  return { total, page, pageSize, entries }
}
