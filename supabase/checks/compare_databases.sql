-- Compare two databases: READ ONLY (it only looks, it changes nothing).
-- Run in the SQL editor of MAG, then of staging. Download each result as CSV
-- (mag.csv, staging.csv) and compare them. Same "fingerprint" = same object.
-- Data rows are not compared, only the structure, plus row counts per table.

SELECT kind, name, fingerprint FROM (
  -- 1 tables and their columns
  SELECT '1 table' AS kind, c.table_name AS name,
         md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable, ',' ORDER BY c.column_name)) AS fingerprint
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  GROUP BY c.table_name
  UNION ALL
  -- 2 each column (to see exactly which column differs)
  SELECT '2 column', c.table_name || '.' || c.column_name, c.data_type || ' null=' || c.is_nullable
  FROM information_schema.columns c WHERE c.table_schema = 'public'
  UNION ALL
  -- 3 functions (body hashed)
  SELECT '3 function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  UNION ALL
  -- 4 access rules
  SELECT '4 rule', tablename || ' / ' || policyname,
         md5(cmd || coalesce(qual, '') || coalesce(with_check, '') || array_to_string(roles, ','))
  FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  -- 5 access rules switched on per table
  SELECT '5 rules on', c.relname, CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  -- 6 triggers
  SELECT '6 trigger', t.tgrelid::regclass::text || ' / ' || t.tgname, md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname = 'public'
  UNION ALL
  -- 7 check constraints (allowed roles, room types, statuses...)
  SELECT '7 check', conrelid::regclass::text || ' / ' || conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace
  UNION ALL
  -- 8 views
  SELECT '8 view', viewname, md5(definition) FROM pg_views WHERE schemaname = 'public'
  UNION ALL
  -- 9 approximate row counts
  SELECT '9 rows', relname, n_live_tup::text FROM pg_stat_user_tables WHERE schemaname = 'public'
  UNION ALL
  -- 10 project statuses in use
  SELECT '10 status in use', coalesce(status, '(none)'), count(*)::text FROM public.err_projects GROUP BY status
) x
ORDER BY kind, name;
