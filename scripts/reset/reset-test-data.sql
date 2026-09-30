-- Test-data reset: deletes ALL business data and all users except one admin.
--
-- Keeps: that admin, role permissions and their change log, settings
-- (incl. payment methods / prefixes) and landed cost types (restored to the
-- five defaults). Re-seeds default expense categories.
--
-- Never run this file directly: use scripts/reset/reset-test-data.sh, which
-- takes a verified backup first and sets the parameters below. It runs as one
-- DO block inside one transaction (plain SQL, works with psql and node-pg):
--   reset.mode        'dry-run' (read-only: counts + confirmation token) or 'apply'
--   reset.keep_admin  username of the APPROVED ADMIN to keep
--   reset.token       apply only: the token printed by the dry-run. It is a
--                     hash of all row counts, so any change after the dry-run
--                     makes the apply refuse.
-- Every table not in keep_tables is truncated (no CASCADE: a table with a
-- foreign key into a truncated table that is not truncated itself makes the
-- reset fail instead of silently losing data). keep_tables must equal
-- RESET_KEEP_TABLES in lib/reset-tables.ts (checked by `npm run lint`).
DO $reset$
DECLARE
  keep_tables text[] := ARRAY['users', 'role_permissions', 'permission_change_logs', 'settings', 'landed_cost_types', 'accounts'];
  -- Must not change during the reset.
  guarded_tables text[] := ARRAY['role_permissions', 'permission_change_logs', 'settings'];
  run_mode text := current_setting('reset.mode', true);
  keep_admin text := current_setting('reset.keep_admin', true);
  given_token text := current_setting('reset.token', true);
  admin_id text;
  all_tables text[];
  delete_tables text[];
  tbl text;
  n bigint;
  counts_text text := '';
  before_counts jsonb := '{}';
  token text;
  other_users bigint;
BEGIN
  IF run_mode IS NULL OR run_mode NOT IN ('dry-run', 'apply') THEN
    RAISE EXCEPTION 'reset.mode must be dry-run or apply';
  END IF;
  IF keep_admin IS NULL OR keep_admin = '' THEN
    RAISE EXCEPTION 'reset.keep_admin is not set';
  END IF;

  SELECT array_agg(table_name::text ORDER BY table_name) INTO all_tables
  FROM information_schema.tables
  WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations';

  SELECT array_agg(t ORDER BY t) INTO delete_tables
  FROM unnest(all_tables) AS t WHERE t <> ALL (keep_tables);

  IF run_mode = 'apply' THEN
    -- Nothing may change between the token check and the commit.
    EXECUTE 'LOCK TABLE ' || (SELECT string_agg(format('%I', t), ', ') FROM unnest(all_tables) AS t) || ' IN ACCESS EXCLUSIVE MODE';
  END IF;

  SELECT id INTO admin_id FROM users WHERE username = keep_admin AND role = 'ADMIN' AND status = 'APPROVED';
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'user "%" not found or not an APPROVED ADMIN - nothing changed', keep_admin;
  END IF;
  SELECT count(*) INTO other_users FROM users WHERE id <> admin_id;

  RAISE NOTICE '---- rows BEFORE ----';
  FOREACH tbl IN ARRAY all_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I', tbl) INTO n;
    before_counts := before_counts || jsonb_build_object(tbl, n);
    counts_text := counts_text || tbl || '=' || n || ';';
    RAISE NOTICE '%  %', rpad(tbl, 34), n;
  END LOOP;
  token := left(md5(counts_text || 'admin=' || admin_id), 12);

  RAISE NOTICE '---- plan ----';
  RAISE NOTICE 'keep admin "%", delete % other user(s)', keep_admin, other_users;
  RAISE NOTICE 'keep: %', array_to_string(keep_tables, ', ');
  RAISE NOTICE 'truncate % table(s): %', cardinality(delete_tables), array_to_string(delete_tables, ', ');
  RAISE NOTICE 'restore the 5 default landed cost types, seed 9 default expense categories';

  IF run_mode = 'dry-run' THEN
    RAISE NOTICE 'DRY RUN - nothing changed. Confirmation token: %', token;
    RETURN;
  END IF;

  IF given_token IS DISTINCT FROM token THEN
    RAISE EXCEPTION 'confirmation token does not match the current data (run the dry-run again) - nothing changed';
  END IF;

  EXECUTE 'TRUNCATE TABLE ' || (SELECT string_agg(format('%I', t), ', ') FROM unnest(delete_tables) AS t) || ' RESTART IDENTITY';

  DELETE FROM users WHERE id <> admin_id;

  -- Landed cost types: back to the defaults of the landed_costs migration.
  DELETE FROM landed_cost_types
  WHERE id NOT IN ('lct_shipment', 'lct_customs_clearance', 'lct_transportation', 'lct_commission', 'lct_other');
  INSERT INTO landed_cost_types (id, name, "nameKey", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
    ('lct_shipment', 'Shipment', 'shipment', true, 1, now(), now()),
    ('lct_customs_clearance', 'Customs & Clearance', 'customs & clearance', true, 2, now(), now()),
    ('lct_transportation', 'Transportation', 'transportation', true, 3, now(), now()),
    ('lct_commission', 'Commission', 'commission', true, 4, now(), now()),
    ('lct_other', 'Other', 'other', true, 5, now(), now())
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "nameKey" = EXCLUDED."nameKey",
    "isActive" = true, "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();

  -- Default expense categories (editable on the Expense Categories page).
  INSERT INTO expense_categories (id, name, "nameKey", description, "isActive", "userId", "createdAt", "updatedAt") VALUES
    ('ec_rent', 'Rent', 'rent', 'Warehouse, shop and office rent', true, admin_id, now(), now()),
    ('ec_salaries', 'Salaries & Wages', 'salaries & wages', 'Staff salaries, wages and allowances', true, admin_id, now(), now()),
    ('ec_utilities', 'Utilities', 'utilities', 'Electricity and water', true, admin_id, now(), now()),
    ('ec_internet_phone', 'Internet & Phone', 'internet & phone', 'Internet, airtime and phone bills', true, admin_id, now(), now()),
    ('ec_transport', 'Transport & Fuel', 'transport & fuel', 'Local transport, delivery and fuel (not purchase landed costs)', true, admin_id, now(), now()),
    ('ec_repairs', 'Repairs & Maintenance', 'repairs & maintenance', 'Repairs of buildings, vehicles and equipment', true, admin_id, now(), now()),
    ('ec_office', 'Office Supplies', 'office supplies', 'Stationery, printing and cleaning supplies', true, admin_id, now(), now()),
    ('ec_fees', 'Bank & Mobile Money Fees', 'bank & mobile money fees', 'Bank charges and EVC Plus / ZAAD / E-Dahab fees', true, admin_id, now(), now()),
    ('ec_other', 'Other', 'other', 'Anything that fits no other category', true, admin_id, now(), now());

  -- Chart of accounts is kept; the automatic accounts of the deleted expense
  -- categories go, and each default category gets its own expense account.
  DELETE FROM accounts WHERE "systemKey" IS NULL AND id LIKE 'acc_exp_%';
  INSERT INTO accounts (id, code, name, type, "group", "updatedAt")
  SELECT 'acc_exp_' || c.id, (6000 + row_number() OVER (ORDER BY c.name))::text, c.name, 'EXPENSE', 'OPERATING_EXPENSE', now()
  FROM expense_categories c
  ON CONFLICT DO NOTHING;
  UPDATE expense_categories c SET "accountId" = 'acc_exp_' || c.id
  WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = 'acc_exp_' || c.id);

  -- Guards: configuration unchanged, exactly the one admin left.
  FOREACH tbl IN ARRAY guarded_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I', tbl) INTO n;
    IF n <> (before_counts ->> tbl)::bigint THEN
      RAISE EXCEPTION 'guard: % changed (% -> %) - rolled back', tbl, before_counts ->> tbl, n;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM users) <> 1 OR NOT EXISTS (SELECT 1 FROM users WHERE id = admin_id AND role = 'ADMIN') THEN
    RAISE EXCEPTION 'guard: the kept admin is missing - rolled back';
  END IF;

  RAISE NOTICE '---- rows AFTER (before -> after) ----';
  FOREACH tbl IN ARRAY all_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I', tbl) INTO n;
    RAISE NOTICE '%  % -> %', rpad(tbl, 34), before_counts ->> tbl, n;
  END LOOP;
  RAISE NOTICE 'APPLIED (commits when this statement finishes)';
END
$reset$;
