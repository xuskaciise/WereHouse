#!/usr/bin/env node
/**
 * Creates load-test users and data on the STAGING database only:
 * N approved STUDENT users (lt_student_001...), each with one warehouse, one
 * category, 10 products and their stock. Re-running replaces the previous
 * load-test data. The usernames and the shared password are written to
 * scripts/loadtest/users.local.json (gitignored) for run.mjs.
 *
 * Usage: node scripts/loadtest/seed-staging.mjs [count=150]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const STAGING_HOST_PREFIX = "ep-patient-bonus-"
const PREFIX = "lt_student_"
const COUNT = Number(process.argv[2] ?? 150)
const HERE = dirname(fileURLToPath(import.meta.url))

const url = readFileSync(".env.staging", "utf8").match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)?.[1]
if (!url) throw new Error("no DATABASE_URL in .env.staging")
const host = new URL(url).host
if (!host.startsWith(STAGING_HOST_PREFIX)) throw new Error(`refusing: ${host.split(".")[0]} is not the staging database`)
console.log("target host:", host.split(".")[0])
process.env.DATABASE_URL = url

const { PrismaClient } = await import("@prisma/client")
const bcrypt = (await import("bcryptjs")).default
const prisma = new PrismaClient()

try {
  const old = await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })
  const oldIds = old.map((u) => u.id)
  if (oldIds.length) {
    await prisma.stock.deleteMany({ where: { userId: { in: oldIds } } })
    await prisma.product.deleteMany({ where: { userId: { in: oldIds } } })
    await prisma.category.deleteMany({ where: { userId: { in: oldIds } } })
    await prisma.warehouse.deleteMany({ where: { userId: { in: oldIds } } })
    await prisma.user.deleteMany({ where: { id: { in: oldIds } } })
    console.log(`removed ${oldIds.length} previous load-test users and their data`)
  }

  const password = randomBytes(12).toString("base64url")
  const passwordHash = await bcrypt.hash(password, 12)
  const n = (i) => String(i + 1).padStart(3, "0")
  const users = Array.from({ length: COUNT }, (_, i) => ({
    id: `${PREFIX}${n(i)}`,
    username: `${PREFIX}${n(i)}`,
    name: `Load Test ${n(i)}`,
    passwordHash,
    role: "STUDENT",
    status: "APPROVED",
  }))
  await prisma.user.createMany({ data: users })
  await prisma.warehouse.createMany({
    data: users.map((u, i) => ({ id: `lt_wh_${n(i)}`, name: `LT Warehouse ${n(i)}`, code: `LTWH${n(i)}`, city: "Mogadishu", userId: u.id })),
  })
  await prisma.category.createMany({
    data: users.map((u, i) => ({ id: `lt_cat_${n(i)}`, name: `LT Category ${n(i)}`, userId: u.id })),
  })
  const products = users.flatMap((u, i) =>
    Array.from({ length: 10 }, (_, j) => ({
      id: `lt_p_${n(i)}_${j}`,
      name: `LT Product ${n(i)}-${j}`,
      sku: `LT-${n(i)}-${j}`,
      categoryId: `lt_cat_${n(i)}`,
      costPrice: "5.00",
      sellingPrice: "7.50",
      userId: u.id,
    }))
  )
  await prisma.product.createMany({ data: products })
  await prisma.stock.createMany({
    data: products.map((p, k) => ({
      productId: p.id,
      warehouseId: `lt_wh_${n(Math.floor(k / 10))}`,
      quantity: 100,
      avgCost: "5.0000",
      userId: p.userId,
    })),
  })

  writeFileSync(join(HERE, "users.local.json"), JSON.stringify({ password, usernames: users.map((u) => u.username) }, null, 2))
  console.log(`created ${COUNT} users, ${COUNT} warehouses, ${COUNT} categories, ${products.length} products with stock`)
  console.log("credentials written to scripts/loadtest/users.local.json")
} finally {
  await prisma.$disconnect()
}
