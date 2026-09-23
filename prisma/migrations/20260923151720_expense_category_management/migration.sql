-- Expense category management: case-insensitive unique names (nameKey =
-- lower(trim(name)), maintained by the API) and an isActive flag so a
-- category that is used by expenses can be deactivated instead of deleted.
BEGIN;

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameKey" TEXT;

-- Backfill. If existing names differ only in case/spaces, the oldest keeps the
-- plain key and the others get the id appended, so this cannot fail; renaming
-- one of them later gives it a normal key.
UPDATE "expense_categories" AS c
SET "nameKey" = CASE WHEN d.rn = 1 THEN d.k ELSE d.k || '#' || c."id" END
FROM (
  SELECT "id", lower(btrim("name")) AS k,
         row_number() OVER (PARTITION BY lower(btrim("name")) ORDER BY "createdAt", "id") AS rn
  FROM "expense_categories"
) AS d
WHERE d."id" = c."id";

ALTER TABLE "expense_categories" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_nameKey_key" ON "expense_categories"("nameKey");

COMMIT;
