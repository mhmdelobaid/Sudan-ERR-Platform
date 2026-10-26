-- Launch day: list the test data (READ-ONLY — this script changes nothing)
-- ------------------------------------------------------------------------------------------------
-- Run it in the Supabase SQL editor of the launch database before going live, and again after the
-- clean-up. Every row it shows is either test data to remove, or reference data to check by hand.
--
-- Test data is recognised by:
--   logins       email ends in @err.test, @err.local or @example.org / @example.com
--   rooms        name has "(TEST)" or Arabic name has "تجريبي", or code starts TEST- / ends -T / -T2
--   projects     name or objectives have "تجريبي", "(TEST)" or "test"; or the room is a test room
--   MOUs         partner "Test Partner Org", or the code has "TPO"
--   everything that hangs off a test project (F2 votes, decisions, F4, F5, comments, acks, feedback)
-- ------------------------------------------------------------------------------------------------

WITH
test_logins AS (
  SELECT id, email FROM auth.users
   WHERE email ILIKE '%@err.test' OR email ILIKE '%@err.local' OR email ILIKE '%@example.org' OR email ILIKE '%@example.com'
),
test_rooms AS (
  SELECT id FROM public.emergency_rooms
   WHERE name ILIKE '%(TEST)%' OR coalesce(name_ar, '') LIKE '%تجريبي%'
      OR coalesce(err_code, '') ILIKE 'TEST-%' OR coalesce(err_code, '') ~* '-T2?$'
),
test_projects AS (
  SELECT p.id FROM public.err_projects p
   WHERE coalesce(p.project_name, '') ~* '(تجريبي|\(TEST\)|\btest\b)'
      OR coalesce(p.project_objectives, '') LIKE '%تجريبي%'
      OR p.emergency_room_id IN (SELECT id FROM test_rooms)
      OR p.err_id IN (SELECT id::text FROM test_rooms)
),
counts AS (
  SELECT 'Logins (auth.users)' AS what,
         (SELECT count(*) FROM test_logins) AS test, (SELECT count(*) FROM auth.users) AS total
  UNION ALL SELECT 'App users (public.users)',
         (SELECT count(*) FROM public.users WHERE id IN (SELECT id FROM test_logins) OR err_id IN (SELECT id FROM test_rooms)),
         (SELECT count(*) FROM public.users)
  UNION ALL SELECT 'Emergency rooms', (SELECT count(*) FROM test_rooms), (SELECT count(*) FROM public.emergency_rooms)
  UNION ALL SELECT 'Projects (F1)', (SELECT count(*) FROM test_projects), (SELECT count(*) FROM public.err_projects)
  UNION ALL SELECT 'F2 votes', (SELECT count(*) FROM public.f2_votes WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.f2_votes)
  UNION ALL SELECT 'F2 decisions', (SELECT count(*) FROM public.f2_decisions WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.f2_decisions)
  UNION ALL SELECT 'Working-group acknowledgements', (SELECT count(*) FROM public.lcc_reviews WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.lcc_reviews)
  UNION ALL SELECT 'Locality acknowledgements', (SELECT count(*) FROM public.f1_locality_acks WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.f1_locality_acks)
  UNION ALL SELECT 'Project feedback (returns)', (SELECT count(*) FROM public.project_feedback WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.project_feedback)
  UNION ALL SELECT 'Project comments', (SELECT count(*) FROM public.project_comments WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.project_comments)
  UNION ALL SELECT 'F4 reports (err_summary)', (SELECT count(*) FROM public.err_summary WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.err_summary)
  UNION ALL SELECT 'F4 expenses (err_expense)', (SELECT count(*) FROM public.err_expense WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.err_expense)
  UNION ALL SELECT 'F5 reports', (SELECT count(*) FROM public.err_program_report WHERE project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.err_program_report)
  UNION ALL SELECT 'F5 reach rows', (SELECT count(*) FROM public.err_program_reach x JOIN public.err_program_report r ON r.id = x.report_id WHERE r.project_id IN (SELECT id FROM test_projects)), (SELECT count(*) FROM public.err_program_reach)
  UNION ALL SELECT 'MOUs (F3)', (SELECT count(*) FROM public.mous WHERE coalesce(partner_name, '') ILIKE '%test%' OR coalesce(mou_code, '') ILIKE '%TPO%'), (SELECT count(*) FROM public.mous)
  UNION ALL SELECT 'MOU payment confirmations', (SELECT count(*) FROM public.mou_payment_confirmations c JOIN public.mous m ON m.id = c.mou_id WHERE coalesce(m.partner_name, '') ILIKE '%test%' OR coalesce(m.mou_code, '') ILIKE '%TPO%'), (SELECT count(*) FROM public.mou_payment_confirmations)
  UNION ALL SELECT 'Working groups', (SELECT count(*) FROM public.working_groups WHERE coalesce(name_en, '') ILIKE '%test%' OR coalesce(name_ar, '') LIKE '%تجريبي%'), (SELECT count(*) FROM public.working_groups)
  UNION ALL SELECT 'Audit log rows', (SELECT count(*) FROM public.audit_logs WHERE actor_user_id IN (SELECT id FROM test_logins)), (SELECT count(*) FROM public.audit_logs)
)
SELECT what, test, total, total - test AS left_after_cleanup FROM counts;

-- Reference data: not removed by the clean-up. Check each list by hand on launch day.
SELECT 'states and localities' AS what, count(*) FROM public.states
UNION ALL SELECT 'planned activities (F1 options)', count(*) FROM public.planned_activities
UNION ALL SELECT 'expense categories (F1 options)', count(*) FROM public.expense_categories
UNION ALL SELECT 'funding cycles', count(*) FROM public.funding_cycles
UNION ALL SELECT 'cycle state allocations', count(*) FROM public.cycle_state_allocations
UNION ALL SELECT 'donors', count(*) FROM public.donors
UNION ALL SELECT 'partners', count(*) FROM public.partners
UNION ALL SELECT 'grant calls', count(*) FROM public.grant_calls;

-- The test logins themselves (to double-check nobody real is on the list)
SELECT a.email, u.role, u.display_name, er.name AS room
  FROM auth.users a
  LEFT JOIN public.users u ON u.id = a.id
  LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
 WHERE a.email ILIKE '%@err.test' OR a.email ILIKE '%@err.local' OR a.email ILIKE '%@example.org' OR a.email ILIKE '%@example.com'
 ORDER BY u.role, a.email;
