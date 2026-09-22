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

A push to `main` (or a manual run) of `.github/workflows/deploy.yml`:

1. builds two images and pushes them to GHCR, tagged with the commit SHA:
   `ghcr.io/xuskaciise/warehouse:<sha>` (app) and `:<sha>-migrator` (Prisma migrations);
2. waits for approval on the `production` environment (if reviewers are configured);
3. copies `docker-compose.yml`, `deploy.sh` and `scripts/backup-warehouse-db.sh` to `/root/SIU_WAREHOUSE` (no git checkout on the server);
4. pulls both images on the VPS with the job's short-lived token (a temporary Docker config, so other projects' registry logins are untouched);
5. runs `./deploy.sh deploy <sha>` on the VPS:
   warehouse-only `pg_dump` backup (deploy stops if it fails) → `prisma migrate deploy` (deploy stops if it fails) →
   switch the app container to the new image → health check on `http://127.0.0.1:3009/api/health` →
   automatic rollback to the previous image if the health check fails.

Manual operations on the VPS (every compose command needs `IMAGE_TAG`):

```bash
cd /root/SIU_WAREHOUSE
export IMAGE_TAG=$(cat .deployed-image-tag)
docker compose --env-file .env.production ps
./deploy.sh rollback                       # previous app image (database unchanged)
scripts/backup-warehouse-db.sh manual      # ad-hoc backup -> /var/backups/db/warehouse-deploy/
```

Required production variables (see `.env.production.template`): `DATABASE_URL`, `POSTGRES_*`, `APP_PORT=3009`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true` and `AUTH_URL`. `deploy.sh` refuses to deploy if any is missing.

Required GitHub secrets: `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (the server's pinned SSH host key line).

> **Existing databases created with `db push`:** `migrate deploy` refuses to run on them (error P3005) until the one-time transition script has converted and baselined the database, so a deploy can never silently damage such a database.

## 🔐 Secrets handling

- Real credentials must only live in `.env` (local) or `.env.production` (server) — both are git-ignored and excluded from the Docker build context. Use `.env.example` / `.env.production.template` as the reference.
- On the server, restrict the file: `chmod 600 .env.production` (owner read/write only), or inject the variables through your hosting platform's secret store instead of a file.
- The database credentials that were previously committed to this repository have been **rotated** and are no longer valid. They still exist in old git history, which is why rotation (not deletion) was the fix.
- If a credential is ever exposed again: rotate it first, then update `.env` / `.env.production`.
