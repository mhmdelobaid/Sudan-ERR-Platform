-- Dashboard for everyone at their own level (Yung, 14 Oct 2026)
-- ------------------------------------------------------------------------------------------------
--   base_err            own room
--   state_err           own state
--   state_rep           own state, read only        (20261005150000_state_rep_dashboard.sql)
--   admin / support     their visible states (all if can_see_all_states)
--   lcc_wg              ALL states, read only        <- added here (national / LCC level)
--   superadmin          all states
-- Working-group members never get write access through these rules: every write rule asks for
-- local_can_access(..., true), which is false for lcc_wg.
-- ------------------------------------------------------------------------------------------------

-- 1. Working-group members count as signed-in app users for the shared access rules
CREATE OR REPLACE FUNCTION public.local_me()
RETURNS TABLE(role text, room_id uuid, state_name text, all_states boolean, states text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT u.role, u.err_id, s.state_name, coalesce(u.can_see_all_states, false), coalesce(u.visible_states, '{}')
  FROM public.users u
  LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
  LEFT JOIN public.states s ON s.id = er.state_reference
  WHERE u.id = auth.uid() AND u.status = 'active'
    AND u.role IN ('base_err','state_err','support','admin','superadmin','state_rep','lcc_wg')
$function$;

-- 2. Working-group members read (never write) every state
CREATE OR REPLACE FUNCTION public.local_can_access(room_ref text, state_ref text, for_write boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((
    SELECT CASE me.role
      WHEN 'superadmin' THEN true
      WHEN 'base_err'   THEN room_ref IS NOT NULL AND room_ref = me.room_id::text
      WHEN 'state_err'  THEN (room_ref IS NOT NULL AND room_ref = me.room_id::text)
                             OR (me.state_name IS NOT NULL AND state_ref = me.state_name)
      WHEN 'state_rep'  THEN NOT for_write AND me.state_name IS NOT NULL AND state_ref = me.state_name
      WHEN 'lcc_wg'     THEN NOT for_write
      WHEN 'admin'      THEN me.all_states OR state_ref = ANY (me.states)
      WHEN 'support'    THEN NOT for_write AND (me.all_states OR state_ref = ANY (me.states))
      ELSE false END
    FROM public.local_me() me), false)
$function$;

-- 3. Funding pool totals: working-group members read every state's figures
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.funding_pool_totals(uuid[])') IS NOT NULL THEN
    d := pg_get_functiondef('public.funding_pool_totals(uuid[])'::regprocedure);
    IF position('''lcc_wg''' in d) = 0 THEN
      d := replace(d, $q$'admin', 'superadmin', 'state_rep')$q$, $q$'admin', 'superadmin', 'state_rep', 'lcc_wg')$q$);
      d := replace(d, $q$(v_role = 'superadmin' OR v_all$q$, $q$(v_role IN ('superadmin', 'lcc_wg') OR v_all$q$);
      EXECUTE d;
    END IF;
  END IF;
END $$;
