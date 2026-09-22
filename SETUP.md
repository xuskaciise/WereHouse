# 🚀 Backend Setup Guide

## Quick Start

### 1. Create Environment File

Create a `.env.local` file in the root directory:

```env
DATABASE_URL="postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>?sslmode=require"
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

## 🔐 Secrets handling

- Real credentials must only live in `.env` (local) or `.env.production` (server) — both are git-ignored and excluded from the Docker build context. Use `.env.example` / `.env.production.template` as the reference.
- On the server, restrict the file: `chmod 600 .env.production` (owner read/write only), or inject the variables through your hosting platform's secret store instead of a file.
- The database credentials that were previously committed to this repository have been **rotated** and are no longer valid. They still exist in old git history, which is why rotation (not deletion) was the fix.
- If a credential is ever exposed again: rotate it first, then update `.env` / `.env.production`.
