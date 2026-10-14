-- Locality level (Yung, 14 Oct 2026): base room -> LOCALITY -> state -> working groups (national)
-- ------------------------------------------------------------------------------------------------
-- New role 'locality_err': sees and works on every room in its locality.
-- A locality is one row of public.states (state + locality); each room points to one through
-- emergency_rooms.state_reference. So a locality user's area = all rooms with the same
-- state_reference as their own room.
--
-- The role must also be allowed by users_role_check: that change is in
-- 20261014210500_locality_role_check.sql (run it in the Supabase SQL editor; it drops and re-adds
-- the constraint, which the database tool won't run without a confirmation).
--
--   base_err      own room
--   locality_err  rooms in own locality (read and write)      <- new
--   state_err     own state
--   state_rep     own state, read only
--   admin/support their visible states
--   lcc_wg        all states, read only
--   superadmin    all
-- ------------------------------------------------------------------------------------------------

-- A room's locality (its states row)
CREATE OR REPLACE FUNCTION public.local_room_locality(room_ref text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT er.state_reference FROM public.emergency_rooms er
  WHERE room_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND er.id = room_ref::uuid
$function$;

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

CREATE OR REPLACE FUNCTION public.local_can_access(room_ref text, state_ref text, for_write boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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

-- F-3 (view my MOU): locality users see their locality's contracts
CREATE OR REPLACE FUNCTION public.f3_can_view(p err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN me.role = 'base_err' THEN
        u.err_id IS NOT NULL AND (coalesce(p.emergency_room_id::text, p.err_id) = u.err_id::text OR p.created_by = u.err_id::text)
      WHEN me.role = 'locality_err' THEN
        u.err_id IS NOT NULL AND (coalesce(p.emergency_room_id::text, p.err_id) = u.err_id::text
          OR public.local_room_locality(coalesce(p.emergency_room_id::text, p.err_id)) = public.local_room_locality(u.err_id::text))
      WHEN me.role = 'state_err' THEN
        (u.err_id IS NOT NULL AND coalesce(p.emergency_room_id::text, p.err_id) = u.err_id::text)
        OR (me.state_name IS NOT NULL AND public.f2_project_state(p) = me.state_name)
      WHEN me.role IN ('admin','superadmin','support') THEN
        me.all_states OR public.f2_project_state(p) = ANY (me.states)
      ELSE false END
    FROM public.f2_me() me JOIN public.users u ON u.id = me.user_id), false)
$function$;

-- Funding pool: locality users see their state's pool (funding is allocated per state)
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.funding_pool_totals(uuid[])') IS NOT NULL THEN
    d := pg_get_functiondef('public.funding_pool_totals(uuid[])'::regprocedure);
    IF position('''locality_err''' in d) = 0 THEN
      d := replace(d, $q$('base_err', 'state_err',$q$, $q$('base_err', 'locality_err', 'state_err',$q$);
      EXECUTE d;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.local_room_locality(text) FROM PUBLIC, anon, authenticated;

-- Working-group screen: state -> locality -> projects. Each project's locality comes from its room.
CREATE OR REPLACE FUNCTION public.wg_projects()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'state', row->>'room_locality', (row->>'needs_my_decision')::boolean DESC, row->>'submitted_at' DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT public.wg_project_core(p) || jsonb_build_object(
             'state_ar', (SELECT s.state_name_ar FROM public.states s WHERE s.state_name = public.f2_project_state(p) LIMIT 1),
             'room_locality', coalesce(loc.locality, p.locality),
             'room_locality_ar', loc.locality_ar,
             'groups', '[]'::jsonb,
             'i_am_program', false,
             'lcc_status', public.wg_lcc_status(p),
             'lcc', public.wg_current_lcc(p),
             'needs_my_decision', public.wg_can_confirm(p),
             'f2_outcome', (SELECT d.outcome FROM public.f2_decisions d WHERE d.project_id = p.id ORDER BY d.decided_at DESC LIMIT 1),
             'f4_count', (SELECT count(*) FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false),
             'f5_count', (SELECT count(*) FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false),
             'comments_count', (SELECT count(*) FROM public.project_comments c WHERE c.project_id = p.id)) AS row
    FROM public.err_projects p
    LEFT JOIN LATERAL (
      SELECT s.locality, s.locality_ar
      FROM public.emergency_rooms er JOIN public.states s ON s.id = er.state_reference
      WHERE er.id::text = coalesce(p.emergency_room_id::text, p.err_id)
      LIMIT 1) loc ON true
    WHERE public.wg_can_follow(p)
  ) t
$$;
