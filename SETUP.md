# 🚀 Backend Setup Guide

## Quick Start (local development)

### 1. Create the environment file

Copy `.env.example` to `.env` and fill in the values:

```env
DATABASE_URL="postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>?sslmode=require"
AUTH_SECRET="<generate-a-random-32-byte-secret>"   # npx auth secret  (or: openssl rand -base64 32)
ADMIN_USERNAME="admin"                              # used by the seed script
ADMIN_PASSWORD=""                                   # leave empty to generate a strong random one
```

### 2. Install dependencies

```bash
npm install
```

### 3. Apply database migrations

The schema is managed with **Prisma Migrate** (migrations live in `prisma/migrations` and are committed to git):

```bash
npm run db:migrate      # = prisma migrate dev  (development: applies + creates new migrations)
```

### 4. Create the first administrator

```bash
npm run db:seed
```

The seed creates (or re-approves) the ADMIN user named by `ADMIN_USERNAME`. If `ADMIN_PASSWORD` is empty, a strong random password is generated and printed **once** — store it in a password manager. Running the seed again never creates duplicates and never changes an existing password.

### 5. Start the development server

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the admin account.

## 📋 Available Commands

- `npm run db:generate` - Generate Prisma Client
- `npm run db:migrate` - Create/apply migrations in development (`prisma migrate dev`)
- `npm run db:deploy` - Apply pending migrations in production (`prisma migrate deploy`)
- `npm run db:seed` - Create the first ADMIN user (idempotent)
- `npm run db:studio` - Open Prisma Studio (database GUI)
- `npm run lint` - ESLint + check that every API route uses `withAuth()` / `publicRoute()`

## 🔄 Changing the schema

1. Edit `prisma/schema.prisma`
2. Run `npm run db:migrate -- --name <short-description>`
3. Commit the generated folder in `prisma/migrations/`

Never use `prisma db push` against a shared or production database — it has no migration history.

## 🚢 Production

`deploy.sh` (and the GitHub deploy workflow) run `prisma migrate deploy` through the `migrate` service in `docker-compose.yml` before starting the new app version:

```bash
docker compose --env-file .env.production run --rm migrate
```

Required production variables (see `.env.production.template`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true` (the app runs behind a reverse proxy) and `AUTH_URL` (public https URL).

> **Existing databases created with `db push`:** the migration history starts with a clean `init` migration (passwords are now bcrypt hashes, balances are calculated, money columns are `DECIMAL`). Point production at a new, empty database and run `migrate deploy` + `db:seed`, then re-create users (old plaintext passwords cannot be converted).

## 🔐 Secrets handling

- Real credentials must only live in `.env` (local) or `.env.production` (server) — both are git-ignored and excluded from the Docker build context. Use `.env.example` / `.env.production.template` as the reference.
- On the server, restrict the file: `chmod 600 .env.production` (owner read/write only), or inject the variables through your hosting platform's secret store instead of a file.
- The database credentials that were previously committed to this repository have been **rotated** and are no longer valid. They still exist in old git history, which is why rotation (not deletion) was the fix.
- If a credential is ever exposed again: rotate it first, then update `.env` / `.env.production`.
