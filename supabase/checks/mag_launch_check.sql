-- Launch check for the live MAG database: READ ONLY (it only looks, it changes nothing).
-- Paste into the Supabase SQL editor of the live project and run. Every row says OK or MISSING.
-- Compares the live database with what the app on errapp.vercel.app needs (as built and tested on staging).

WITH
need_tables(name) AS (VALUES
  ('err_projects'),('emergency_rooms'),('states'),('users'),('err_summary'),('err_expense'),
  ('err_program_report'),('err_program_reach'),('project_feedback'),('funding_cycles'),
  ('cycle_state_allocations'),('feedback_tickets'),('f2_votes'),('f2_decisions'),('lcc_reviews'),
  ('project_comments'),('working_groups'),('working_group_members'),('project_working_groups')),
need_functions(name) AS (VALUES
  ('local_me'),('local_my_role'),('local_can_access'),('local_can_access_project'),('local_room_state'),
  ('local_room_locality'),('funding_pool_totals'),('feedback_ticket_record_sync'),
  ('f2_me'),('f2_project_state'),('f2_can_view'),('f2_lines'),('f2_quorum'),('f2_queue'),('f2_project'),('f2_cast_vote'),
  ('f3_can_view'),('f3_my_contracts'),('portal_screened_f1'),('portal_f1_payload'),
  ('wg_can_follow'),('wg_can_confirm'),('wg_lcc_status'),('wg_current_lcc'),('wg_projects'),('wg_project'),
  ('wg_project_core'),('wg_lcc_decide'),('wg_add_comment'),('wg_room_confirmations')),
need_roles(name) AS (VALUES ('base_err'),('locality_err'),('state_err'),('state_rep'),('lcc_wg'),('admin'),('support'),('superadmin')),
need_room_types(name) AS (VALUES ('state'),('locality'),('base')),
users_check AS (
  SELECT coalesce(string_agg(pg_get_constraintdef(c.oid), ' '), '') AS def FROM pg_constraint c
  WHERE c.conrelid = 'public.users'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%role%'),
rooms_check AS (
  SELECT coalesce(string_agg(pg_get_constraintdef(c.oid), ' '), '') AS def FROM pg_constraint c
  WHERE c.conrelid = 'public.emergency_rooms'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%type%')
SELECT '1 table' AS area, t.name AS item,
       CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS result
FROM need_tables t
UNION ALL
SELECT '2 function', f.name,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = f.name) THEN 'OK' ELSE 'MISSING' END
FROM need_functions f
UNION ALL
SELECT '3 user role allowed', r.name,
       CASE WHEN (SELECT def FROM users_check) = '' THEN 'no role check (any value allowed)'
            WHEN (SELECT def FROM users_check) LIKE '%''' || r.name || '''%' THEN 'OK' ELSE 'MISSING' END
FROM need_roles r
UNION ALL
SELECT '4 room type allowed', rt.name,
       CASE WHEN (SELECT def FROM rooms_check) = '' THEN 'no type check (any value allowed)'
            WHEN (SELECT def FROM rooms_check) LIKE '%''' || rt.name || '''%' THEN 'OK' ELSE 'MISSING' END
FROM need_room_types rt
UNION ALL
SELECT '5 column', 'err_projects.currency',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='err_projects' AND column_name='currency') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '5 column', 'states.locality_ar',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='states' AND column_name='locality_ar') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '6 status allowed', 'err_projects.status accepts screened',
       CASE
         WHEN (SELECT t.typtype FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
               WHERE a.attrelid = 'public.err_projects'::regclass AND a.attname = 'status') = 'e'
           THEN CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
                                  WHERE a.attrelid = 'public.err_projects'::regclass AND a.attname = 'status' AND e.enumlabel = 'screened')
                     THEN 'OK' ELSE 'MISSING (status list has no screened)' END
         WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.err_projects'::regclass AND c.contype = 'c'
                      AND pg_get_constraintdef(c.oid) ~ '[^_]status' AND pg_get_constraintdef(c.oid) NOT LIKE '%screened%')
           THEN 'MISSING (status check has no screened)'
         ELSE 'OK' END
UNION ALL
SELECT '7 data', 'states rows (staging has 189)', (SELECT count(*)::text FROM public.states)
UNION ALL
SELECT '7 data', 'rooms with no locality', (SELECT count(*)::text FROM public.emergency_rooms WHERE state_reference IS NULL)
UNION ALL
SELECT '7 data', 'users by role', (SELECT string_agg(role || '=' || n, ', ' ORDER BY role) FROM (SELECT role, count(*) n FROM public.users GROUP BY role) x)
UNION ALL
SELECT '7 data', 'open funding cycles', (SELECT count(*)::text FROM public.funding_cycles WHERE status = 'open')
UNION ALL
SELECT '8 access rules', 'RLS on ' || t.name,
       CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'table missing'
            WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t.name)::regclass) THEN 'OK (on)' ELSE 'OFF: anyone with the public key may read it' END
FROM (VALUES ('err_projects'),('err_summary'),('err_expense'),('err_program_report'),('err_program_reach'),('users'),('project_feedback'),('receipts')) t(name)
UNION ALL
SELECT '8 access rules', 'policies open to anonymous users on ' || p.tablename,
       'CHECK: ' || p.policyname || ' (' || p.cmd || ')'
FROM pg_policies p
WHERE p.schemaname = 'public' AND p.roles::text ~ '(anon|public)'
  AND p.tablename IN ('err_projects','err_summary','err_expense','err_program_report','err_program_reach','users','project_feedback','receipts')
ORDER BY 1, 2;
