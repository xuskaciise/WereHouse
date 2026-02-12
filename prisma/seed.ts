import { PrismaClient, Role, StockStatus, MovementType, OrderStatus } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Seeding database...")
  console.log("⚠️  Note: Seed script is empty. Add data manually or through the UI.")
  return

  // Create Categories
  const electronics = await prisma.category.upsert({
    where: { name: "Electronics" },
    update: {},
    create: {
      name: "Electronics",
      description: "Electronic devices and components",
    },
  })

  const textbooks = await prisma.category.upsert({
    where: { name: "Textbooks" },
    update: {},
    create: {
      name: "Textbooks",
      description: "Educational textbooks and materials",
    },
  })

  const furniture = await prisma.category.upsert({
    where: { name: "Furniture" },
    update: {},
    create: {
      name: "Furniture",
      description: "Office and classroom furniture",
    },
  })

  // Create Users
  const admin = await prisma.user.upsert({
    where: { email: "admin@university.edu" },
    update: {},
    create: {
      email: "admin@university.edu",
      name: "Admin User",
      username: "admin",
      role: Role.ADMIN,
    },
  })

  const manager = await prisma.user.upsert({
    where: { email: "manager@university.edu" },
    update: {},
    create: {
      email: "manager@university.edu",
      name: "Alex Johnson",
      username: "manager",
      role: Role.WAREHOUSE_MANAGER,
    },
  })

  // Create Warehouses
  const centralWarehouse = await prisma.warehouse.upsert({
    where: { code: "CD-001" },
    update: {},
    create: {
      name: "Central Distribution",
      code: "CD-001",
      address: "North Industrial Zone, BLD 4",
      city: "Chicago",
      state: "IL",
      zipCode: "60611",
      country: "USA",
      capacity: 50000,
    },
  })

  // Create Products
  const macbook = await prisma.product.upsert({
    where: { sku: "EDU-ELC-001" },
    update: {},
    create: {
      name: "MacBook Pro 14\"",
      sku: "EDU-ELC-001",
      description: "High-performance laptop for students",
      categoryId: electronics.id,
      costPrice: 1450.0,
      sellingPrice: 1999.0,
      reorderLevel: 10,
    },
  })

  const textbook = await prisma.product.upsert({
    where: { sku: "EDU-TXT-042" },
    update: {},
    create: {
      name: "Business Ethics 10th Ed",
      sku: "EDU-TXT-042",
      description: "Business ethics textbook",
      categoryId: textbooks.id,
      costPrice: 45.0,
      sellingPrice: 89.99,
      reorderLevel: 20,
    },
  })

  // Create Stock
  await prisma.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: macbook.id,
        warehouseId: centralWarehouse.id,
      },
    },
    update: {},
    create: {
      productId: macbook.id,
      warehouseId: centralWarehouse.id,
      quantity: 42,
      reservedQuantity: 2,
      status: StockStatus.IN_STOCK,
    },
  })

  await prisma.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: textbook.id,
        warehouseId: centralWarehouse.id,
      },
    },
    update: {},
    create: {
      productId: textbook.id,
      warehouseId: centralWarehouse.id,
      quantity: 12,
      reservedQuantity: 0,
      status: StockStatus.LOW_STOCK,
    },
  })

  console.log("✅ Database seeded successfully!")
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error("❌ Error seeding database:", e)
    await prisma.$disconnect()
    process.exit(1)
  })
