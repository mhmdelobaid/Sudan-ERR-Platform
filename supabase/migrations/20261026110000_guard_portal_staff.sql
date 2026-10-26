-- C1 guard: let portal staff through (Yung, 26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- The partner portal (Mutual-Aid-Portal) writes most project changes as the signed-in portal user
-- (anon key + session cookie, see src/lib/sbRoute.ts), not with the service key. The first version
-- of the guard (20261026090000) let only admin and superadmin through, so portal staff with the
-- support or partner role would have been blocked from approving, assigning grants and MOUs.
--
-- Now: superadmin, admin, support and partner accounts pass. Room-side accounts (base, locality,
-- state, state reps, working groups) stay guarded. Portal users are matched on users.id or
-- users.auth_user_id, because portal-created users may differ there.
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE (u.id = auth.uid() OR u.auth_user_id = auth.uid())
       AND coalesce(u.status, 'active') = 'active'
       AND u.role IN ('superadmin', 'admin', 'support', 'partner'));
$function$;

-- Must stay SECURITY INVOKER: current_user has to be the caller's role ('authenticated'), not the
-- function owner, or every write would pass.
CREATE OR REPLACE FUNCTION public.guard_is_restricted()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $function$
  SELECT current_user IN ('authenticated', 'anon') AND NOT public.guard_is_staff();
$function$;

REVOKE ALL ON FUNCTION public.guard_is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_is_staff() TO authenticated, anon;
