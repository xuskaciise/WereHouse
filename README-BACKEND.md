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

Create a `.env` file in the root directory (see `.env.example`):

```env
DATABASE_URL="postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>?sslmode=require"
```

**Important**: Never commit `.env` to git! It's already in `.gitignore`. You also need `AUTH_SECRET` (see `.env.example`).

### 3. Generate Prisma Client

```bash
npm run db:generate
```

This generates the Prisma Client based on your schema.

### 4. Apply Migrations

```bash
npm run db:migrate
```

Applies the committed migrations in `prisma/migrations` (Prisma Migrate). Production uses `npm run db:deploy` (`prisma migrate deploy`). `prisma db push` is no longer used.

### 5. Create the First Admin

```bash
npm run db:seed
```

Creates the ADMIN user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (a random password is generated and printed once when `ADMIN_PASSWORD` is empty). Safe to run more than once.

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
5. **Add Validation** - Use Zod for form and API validation

## 🛠️ Available Scripts

- `npm run db:generate` - Generate Prisma Client
- `npm run db:migrate` - Create and apply migrations (development)
- `npm run db:deploy` - Apply pending migrations (production)
- `npm run db:seed` - Create the first ADMIN user
- `npm run db:studio` - Open Prisma Studio GUI

## ⚠️ Important Notes

- Always run `npm run db:generate` after changing the Prisma schema
- Every schema change needs a committed migration (`npm run db:migrate -- --name <change>`)
- Never commit `.env` / `.env.local` with real credentials
