# 🚀 Backend Setup Guide

## Quick Start

### 1. Create Environment File

Create a `.env.local` file in the root directory:

```env
DATABASE_URL="postgresql://neondb_owner:npg_NxX1Z4ApkITS@ep-broad-morning-aij4n46h-pooler.c-4.us-east-1.aws.neon.tech/wearhouse?sslmode=require&channel_binding=require"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Generate Prisma Client

```bash
npm run db:generate
```

### 4. Push Schema to Database

This will create all tables in your Neon PostgreSQL database:

```bash
npm run db:push
```

### 5. (Optional) Seed Database

Populate the database with initial data:

```bash
npm install tsx --save-dev
npm run db:seed
```

### 6. Start Development Server

```bash
npm run dev
```

## 📋 Available Commands

- `npm run db:generate` - Generate Prisma Client
- `npm run db:push` - Push schema to database (quick development)
- `npm run db:migrate` - Create migration (for production)
- `npm run db:studio` - Open Prisma Studio (database GUI)
- `npm run db:seed` - Seed database with initial data

## 🗄️ Database Schema

The Prisma schema includes:

- **users** - User accounts with roles
- **categories** - Product categories
- **products** - Product catalog
- **suppliers** - Supplier information
- **customers** - Customer information
- **warehouses** - Warehouse locations
- **stock** - Current stock levels
- **stock_movements** - Inventory movement history
- **purchase_orders** - Purchase order management
- **sales_orders** - Sales order management
- **payments** - Customer and supplier payments
- **stock_transfers** - Inter-warehouse transfers
- **expenses** - Business expenses

## 🔌 API Routes

Example API routes are available at:

- `GET /api/users` - Get all users
- `POST /api/users` - Create a user
- `GET /api/users/[id]` - Get user by ID
- `PUT /api/users/[id]` - Update user
- `DELETE /api/users/[id]` - Delete user

## 📝 Next Steps

1. **Replace Mock Data** - Update pages to use API routes or Server Actions
2. **Add Authentication** - Implement secure login with NextAuth.js
3. **Add Validation** - Use Zod for API and form validation
4. **Add More API Routes** - Create routes for products, orders, etc.

## ⚠️ Important

- Never commit `.env.local` to git
- Always run `db:generate` after schema changes
- Use `db:push` for development, `db:migrate` for production
