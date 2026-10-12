-- State reps: read-only dashboard access for their own state.
-- A rep belongs to a room (users.err_id); that room's state is the state they screen in F-2
-- and the state they now see on the dashboard. Reps never get write access through these rules.

-- 1. Reps count as signed-in app users for the shared access rules
CREATE OR REPLACE FUNCTION public.local_me()
RETURNS TABLE(role text, room_id uuid, state_name text, all_states boolean, states text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT u.role, u.err_id, s.state_name, coalesce(u.can_see_all_states, false), coalesce(u.visible_states, '{}')
  FROM public.users u
  LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
  LEFT JOIN public.states s ON s.id = er.state_reference
  WHERE u.id = auth.uid() AND u.status = 'active' AND u.role IN ('base_err','state_err','support','admin','superadmin','state_rep')
$function$;

-- 2. Reps read (never write) rooms and projects in their own state
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
      WHEN 'admin'      THEN me.all_states OR state_ref = ANY (me.states)
      WHEN 'support'    THEN NOT for_write AND (me.all_states OR state_ref = ANY (me.states))
      ELSE false END
    FROM public.local_me() me), false)
$function$;

-- 3. Funding pool totals: let reps read their own state's figures
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.funding_pool_totals(uuid[])') IS NOT NULL THEN
    d := pg_get_functiondef('public.funding_pool_totals(uuid[])'::regprocedure);
    IF position('''state_rep''' in d) = 0 THEN
      d := replace(d, $q$('base_err', 'state_err', 'support', 'admin', 'superadmin')$q$,
                      $q$('base_err', 'state_err', 'support', 'admin', 'superadmin', 'state_rep')$q$);
      EXECUTE d;
    END IF;
  END IF;
END $$;
