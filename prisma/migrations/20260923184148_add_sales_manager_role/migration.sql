-- New role. Kept in its own migration: PostgreSQL cannot use a new enum
-- value in the same transaction that adds it (the next migration seeds it).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES_MANAGER' AFTER 'WAREHOUSE_MANAGER';
