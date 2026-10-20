-- Access rules baseline (15 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- The app's row-level access rules as they stand on staging (ygjwdoptcegapipnukgh), written down in one
-- file so any database (the live MAG database, or a fresh one) can be given exactly the same rules.
-- Until now most of these existed only in the staging database, not in the repo.
--
-- Run it AFTER all earlier migrations. It is safe to run more than once.
--
-- It REPLACES every existing rule on the tables below: old rules with other names are removed first,
-- because rules add up (any one rule that lets a row through is enough). On a database whose rules
-- you haven't reviewed, look at the list first:
--   SELECT tablename, policyname, cmd, roles, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
--
-- Three fixes compared with staging before 15 Oct (also applied to staging):
--   * users joining a locality room can register (local_self_insert allows locality_err);
--   * admins can activate locality users (local_admin_update allows locality_err);
--   * reps, locality users and working groups can send feedback tickets (feedback_tickets_insert_own).
-- ------------------------------------------------------------------------------------------------

-- 1. Helper functions the rules use (same as staging)
CREATE OR REPLACE FUNCTION public.local_me()
RETURNS TABLE(role text, room_id uuid, state_name text, all_states boolean, states text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT u.role, u.err_id, s.state_name, coalesce(u.can_see_all_states, false), coalesce(u.visible_states, '{}')
  FROM public.users u
  LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
  LEFT JOIN public.states s ON s.id = er.state_reference
  WHERE u.id = auth.uid() AND u.status = 'active'
    AND u.role IN ('base_err','locality_err','state_err','support','admin','superadmin','state_rep','lcc_wg')
$function$;

CREATE OR REPLACE FUNCTION public.local_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT role FROM public.local_me()
$function$;

CREATE OR REPLACE FUNCTION public.local_room_state(room_ref text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.state_name FROM public.emergency_rooms er JOIN public.states s ON s.id = er.state_reference
  WHERE room_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND er.id = room_ref::uuid
$function$;

CREATE OR REPLACE FUNCTION public.local_room_locality(room_ref text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT er.state_reference FROM public.emergency_rooms er
  WHERE room_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND er.id = room_ref::uuid
$function$;

CREATE OR REPLACE FUNCTION public.local_can_access(room_ref text, state_ref text, for_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((
    SELECT CASE me.role
      WHEN 'superadmin'   THEN true
      WHEN 'base_err'     THEN room_ref IS NOT NULL AND room_ref = me.room_id::text
      WHEN 'locality_err' THEN room_ref IS NOT NULL AND me.room_id IS NOT NULL
                               AND (room_ref = me.room_id::text
                                    OR public.local_room_locality(room_ref) = public.local_room_locality(me.room_id::text))
      WHEN 'state_err'    THEN (room_ref IS NOT NULL AND room_ref = me.room_id::text)
                               OR (me.state_name IS NOT NULL AND state_ref = me.state_name)
      WHEN 'state_rep'    THEN NOT for_write AND me.state_name IS NOT NULL AND state_ref = me.state_name
      WHEN 'lcc_wg'       THEN NOT for_write
      WHEN 'admin'        THEN me.all_states OR state_ref = ANY (me.states)
      WHEN 'support'      THEN NOT for_write AND (me.all_states OR state_ref = ANY (me.states))
      ELSE false END
    FROM public.local_me() me), false)
$function$;

CREATE OR REPLACE FUNCTION public.local_can_access_project(pid uuid, for_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((
    SELECT public.local_can_access(r.room_ref, public.local_room_state(r.room_ref), for_write)
        OR (public.local_my_role() = 'base_err' AND p.created_by = (SELECT room_id::text FROM public.local_me()))
    FROM public.err_projects p
    CROSS JOIN LATERAL (SELECT coalesce(p.emergency_room_id::text, p.err_id) AS room_ref) r
    WHERE p.id = pid), false)
$function$;

REVOKE ALL ON FUNCTION public.local_me(), public.local_my_role(), public.local_room_state(text),
  public.local_room_locality(text), public.local_can_access(text, text, boolean),
  public.local_can_access_project(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.local_me(), public.local_my_role(), public.local_room_state(text),
  public.local_can_access(text, text, boolean), public.local_can_access_project(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.local_room_locality(text) FROM authenticated;

-- 2. Row-level security on, and old rules removed, on every table this file covers
DO $$
DECLARE t text; pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['cycle_state_allocations', 'donors', 'emergency_rooms', 'err_expense', 'err_program_files', 'err_program_reach', 'err_program_report', 'err_projects', 'err_summary', 'expense_categories', 'feedback_tickets', 'funding_cycles', 'grant_call_state_allocations', 'grant_calls', 'grant_segments', 'planned_activities', 'project_feedback', 'receipts', 'sectors', 'states', 'users'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping %: table not found', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- 3. The rules
--   Reference lists (states, rooms, activities, expense types, sectors) are readable before login,
--   because registration needs them. Everything else asks local_can_access / local_can_access_project,
--   which apply the role levels: base own room; locality its rooms; state its state; reps their state,
--   read only; working groups all states, read only; admin/support their visible states; superadmin all.


-- cycle_state_allocations
CREATE POLICY local_read ON public.cycle_state_allocations AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() IS NOT NULL);

-- donors
CREATE POLICY local_read ON public.donors AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() IS NOT NULL);

-- funding_cycles
CREATE POLICY local_read ON public.funding_cycles AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() IS NOT NULL);

-- grant_call_state_allocations
CREATE POLICY local_read ON public.grant_call_state_allocations AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() IS NOT NULL);

-- grant_calls
CREATE POLICY local_read ON public.grant_calls AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() IS NOT NULL);

-- emergency_rooms
CREATE POLICY local_read ON public.emergency_rooms AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- expense_categories
CREATE POLICY local_read ON public.expense_categories AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- grant_segments
CREATE POLICY local_read ON public.grant_segments AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- planned_activities
CREATE POLICY local_read ON public.planned_activities AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- sectors
CREATE POLICY local_read ON public.sectors AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- states
CREATE POLICY local_read ON public.states AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- emergency_rooms
CREATE POLICY local_admin_update ON public.emergency_rooms AS PERMISSIVE FOR UPDATE TO authenticated
  USING (local_my_role() = ANY (ARRAY['admin','superadmin']) AND local_can_access(id::text, local_room_state(id::text), true))
  WITH CHECK (local_my_role() = ANY (ARRAY['admin','superadmin']) AND local_can_access(id::text, local_room_state(id::text), true));
CREATE POLICY local_propose_room ON public.emergency_rooms AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (status = 'inactive');

-- err_expense
CREATE POLICY local_read ON public.err_expense AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_can_access_project(project_id, false));
CREATE POLICY local_write ON public.err_expense AS PERMISSIVE FOR ALL TO authenticated
  USING (local_can_access_project(project_id, true))
  WITH CHECK (local_can_access_project(project_id, true));

-- err_program_report
CREATE POLICY local_read ON public.err_program_report AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_can_access_project(project_id, false));
CREATE POLICY local_write ON public.err_program_report AS PERMISSIVE FOR ALL TO authenticated
  USING (local_can_access_project(project_id, true))
  WITH CHECK (local_can_access_project(project_id, true));

-- err_summary
CREATE POLICY local_read ON public.err_summary AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_can_access_project(project_id, false));
CREATE POLICY local_write ON public.err_summary AS PERMISSIVE FOR ALL TO authenticated
  USING (local_can_access_project(project_id, true))
  WITH CHECK (local_can_access_project(project_id, true));

-- err_program_files
CREATE POLICY local_read ON public.err_program_files AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_files.report_id AND local_can_access_project(r.project_id, false)));
CREATE POLICY local_write ON public.err_program_files AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_files.report_id AND local_can_access_project(r.project_id, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_files.report_id AND local_can_access_project(r.project_id, true)));

-- err_program_reach
CREATE POLICY local_read ON public.err_program_reach AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_reach.report_id AND local_can_access_project(r.project_id, false)));
CREATE POLICY local_write ON public.err_program_reach AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_reach.report_id AND local_can_access_project(r.project_id, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM err_program_report r WHERE r.id = err_program_reach.report_id AND local_can_access_project(r.project_id, true)));

-- err_projects
CREATE POLICY local_read ON public.err_projects AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), false) OR (local_my_role() = 'base_err' AND created_by = (SELECT room_id::text FROM local_me())));
CREATE POLICY local_write ON public.err_projects AS PERMISSIVE FOR ALL TO authenticated
  USING (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true) OR (local_my_role() = 'base_err' AND created_by = (SELECT room_id::text FROM local_me())))
  WITH CHECK (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true) OR (local_my_role() = 'base_err' AND created_by = (SELECT room_id::text FROM local_me())));

-- feedback_tickets
CREATE POLICY feedback_tickets_insert_own ON public.feedback_tickets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND sync_status = 'pending' AND github_issue_number IS NULL AND github_issue_url IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.status = 'active' AND u.role = ANY (ARRAY['base_err','locality_err','state_err','state_rep','lcc_wg','support','admin','superadmin'])));
CREATE POLICY feedback_tickets_read ON public.feedback_tickets AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.status = 'active' AND u.role = ANY (ARRAY['support','admin','superadmin'])));

-- project_feedback
CREATE POLICY local_admin_insert ON public.project_feedback AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (local_my_role() = ANY (ARRAY['admin','superadmin']) AND local_can_access_project(project_id, true));
CREATE POLICY local_read ON public.project_feedback AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_can_access_project(project_id, false));
CREATE POLICY local_room_update ON public.project_feedback AS PERMISSIVE FOR UPDATE TO authenticated
  USING (local_can_access_project(project_id, true));

-- receipts
CREATE POLICY local_read ON public.receipts AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM err_expense e WHERE e.expense_id = receipts.expense_id AND local_can_access_project(e.project_id, false)));
CREATE POLICY local_write ON public.receipts AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM err_expense e WHERE e.expense_id = receipts.expense_id AND local_can_access_project(e.project_id, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM err_expense e WHERE e.expense_id = receipts.expense_id AND local_can_access_project(e.project_id, true)));

-- users
CREATE POLICY local_admin_update ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
  USING (local_my_role() = ANY (ARRAY['admin','superadmin']) AND local_can_access(err_id::text, local_room_state(err_id::text), true))
  WITH CHECK (local_my_role() = 'superadmin' OR (local_my_role() = 'admin' AND role = ANY (ARRAY['base_err','locality_err','state_err','support']) AND local_can_access(err_id::text, local_room_state(err_id::text), true)));
CREATE POLICY local_self_insert ON public.users AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND status = 'pending' AND role = ANY (ARRAY['base_err','locality_err','state_err']));
CREATE POLICY local_self_read ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY local_staff_read ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING (local_my_role() = ANY (ARRAY['support','admin','superadmin']) AND local_can_access(err_id::text, local_room_state(err_id::text), false));
