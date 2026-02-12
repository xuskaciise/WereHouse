import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"

// Load environment variables from .env.local
try {
  const envPath = resolve(process.cwd(), ".env.local")
  const envFile = readFileSync(envPath, "utf-8")
  envFile.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=")
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "")
      process.env[key.trim()] = value
    }
  })
} catch (error) {
  console.warn("Could not load .env.local file")
}

const prisma = new PrismaClient()

async function clearDatabase() {
  console.log("🗑️  Clearing all data from database...")

  try {
    // Delete in reverse order of dependencies
    await prisma.expense.deleteMany()
    await prisma.expenseCategory.deleteMany()
    await prisma.stockTransferItem.deleteMany()
    await prisma.stockTransfer.deleteMany()
    await prisma.customerPayment.deleteMany()
    await prisma.supplierPayment.deleteMany()
    await prisma.salesOrderItem.deleteMany()
    await prisma.salesOrder.deleteMany()
    await prisma.purchaseOrderItem.deleteMany()
    await prisma.purchaseOrder.deleteMany()
    await prisma.stockMovement.deleteMany()
    await prisma.stock.deleteMany()
    await prisma.product.deleteMany()
    await prisma.category.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.supplier.deleteMany()
    await prisma.warehouse.deleteMany()
    await prisma.user.deleteMany()

    console.log("✅ All data cleared successfully!")
  } catch (error) {
    console.error("❌ Error clearing database:", error)
    throw error
  }
}

clearDatabase()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
