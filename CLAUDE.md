# Working rules for this repository

## Communication
- Explain plans and summaries to the user **in Somali**. Code, commit
  messages, comments and identifiers stay in English.
- For non-trivial features: present the plan first (in Somali) and wait for
  approval before implementing.

## Databases — never mix them up
| Name | Where | Used for |
|------|-------|----------|
| **Dev** | `.env` → Neon `ep-icy-glade-…` | `npm run dev`, `prisma migrate dev`, local testing |
| **Staging** | `.env.staging` → Neon `ep-patient-bonus-…` | test data only; transition rehearsals (`prisma/transition/rehearsal/`) |
| **Production** | PostgreSQL container `siu_warehouse-db-1` on the VPS (`/root/SIU_WAREHOUSE`, host `db`) | the live site https://warehouse.siulabs.so |

- Never run migrations, seeds, resets or ad-hoc writes against production by
  hand. Production schema changes only happen through `./deploy.sh deploy`
  (called by the Deploy workflow), which backs up, runs `prisma migrate
  deploy`, switches the app and rolls back on a failed health check.
- Before touching a database from a script, check its host (print the host
  only, never the URL).

## Schema changes
- Only via `npx prisma migrate dev --name <kebab-name>` against the dev DB,
  and commit the generated `prisma/migrations/<timestamp>_<name>/`.
- **Never** use `prisma db push`, and never edit a migration that is already
  on `main`.
- Money is `Decimal(12,2)` and all server arithmetic uses `lib/money.ts`
  (never JS floats). Stock changes go through `lib/stock.ts`; quantities may
  never go negative (CHECK constraints in the DB as well).

## API routes and auth
- Every `app/api/**/route.ts` handler is wrapped in `withAuth()` (or
  `publicRoute()` for deliberate public endpoints) from `lib/api.ts`;
  `npm run lint` enforces this (`scripts/check-route-guards.mjs`).
- Role checks use the shared helpers in `lib/auth-guard.ts`
  (`withAuth(..., { roles })`, `requireRole`, `ownershipWhere`). Validate
  everything on the server and never trust client-computed totals.
- Multi-step writes (stock + movements + orders) run in one
  `prisma.$transaction(..., TX_OPTIONS)` with row locks where races matter.

## Before every push
```
npx tsc --noEmit
npm run lint
npm run build
```
All three must pass. Pushing to `main` deploys to production automatically
(`.github/workflows/deploy.yml`); after a push, confirm the deploy succeeded
and `https://warehouse.siulabs.so/api/health` returns ok. Feature work goes on a
branch and is merged into `main` only when ready.

## Secrets
- Never print, log or commit secrets: `.env`, `.env.staging`,
  `.env.production`, `DATABASE_URL`, `AUTH_SECRET`, SSH keys, tokens.
  When a value must be checked, print only whether it is set, or its host.
- The VPS is reached with `ssh -i ~/.ssh/siu_vps -o IdentitiesOnly=yes
  root@187.124.191.23` (host key pinned). Only touch the `siu_warehouse`
  compose project there; other projects on the VPS are off limits.
