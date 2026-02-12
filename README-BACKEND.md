# Backend Setup with Prisma + Neon PostgreSQL

This project now includes a backend setup with Prisma ORM and Neon PostgreSQL database.

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `@prisma/client` - Prisma Client for database queries
- `prisma` - Prisma CLI (dev dependency)

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```env
DATABASE_URL="postgresql://neondb_owner:npg_NxX1Z4ApkITS@ep-broad-morning-aij4n46h-pooler.c-4.us-east-1.aws.neon.tech/wearhouse?sslmode=require&channel_binding=require"
```

**Important**: Never commit `.env.local` to git! It's already in `.gitignore`.

### 3. Generate Prisma Client

```bash
npm run db:generate
```

This generates the Prisma Client based on your schema.

### 4. Push Schema to Database

```bash
npm run db:push
```

This will create all tables in your Neon PostgreSQL database based on the Prisma schema.

### 5. (Optional) Run Migrations

If you prefer using migrations:

```bash
npm run db:migrate
```

This creates a migration file and applies it to the database.

### 6. (Optional) Open Prisma Studio

To view and edit your database visually:

```bash
npm run db:studio
```

This opens Prisma Studio at `http://localhost:5555`

## 📁 Database Schema

The Prisma schema (`prisma/schema.prisma`) includes all the tables:

- **users** - User accounts and roles
- **categories** - Product categories
- **products** - Product catalog
- **suppliers** - Supplier information
- **customers** - Customer information
- **warehouses** - Warehouse locations
- **stock** - Current stock levels
- **stock_movements** - Inventory movement history
- **purchase_orders** - Purchase order management
- **purchase_order_items** - Purchase order line items
- **supplier_payments** - Supplier payment tracking
- **sales_orders** - Sales order management
- **sales_order_items** - Sales order line items
- **customer_payments** - Customer payment tracking
- **stock_transfers** - Inter-warehouse transfers
- **stock_transfer_items** - Transfer line items
- **expense_categories** - Expense categorization
- **expenses** - Business expense records

## 🔧 Using Prisma Client

Import and use Prisma Client in your API routes or server actions:

```typescript
import { prisma } from "@/lib/prisma"

// Example: Get all users
const users = await prisma.user.findMany()

// Example: Create a user
const newUser = await prisma.user.create({
  data: {
    email: "user@example.com",
    name: "John Doe",
    role: "STUDENT",
  },
})
```

## 📝 Next Steps

1. **Create API Routes** - Add API routes in `app/api/` for database operations
2. **Create Server Actions** - Use Next.js Server Actions for mutations
3. **Replace Mock Data** - Update pages to fetch from database instead of mock data
4. **Add Authentication** - Integrate NextAuth.js for secure authentication
5. **Add Validation** - Use Zod for form and API validation

## 🛠️ Available Scripts

- `npm run db:generate` - Generate Prisma Client
- `npm run db:push` - Push schema changes to database (development)
- `npm run db:migrate` - Create and apply migrations (production)
- `npm run db:studio` - Open Prisma Studio GUI

## ⚠️ Important Notes

- Always run `npm run db:generate` after changing the Prisma schema
- Use `db:push` for quick development changes
- Use `db:migrate` for production deployments
- Never commit `.env.local` with real credentials
