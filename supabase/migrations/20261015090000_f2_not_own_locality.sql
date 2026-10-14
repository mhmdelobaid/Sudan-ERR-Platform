-- F2: reps don't vote on their own locality (Yung, 15 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Flow: base ERR sends F1 -> the locality sees it -> the state reps do F2 -> state -> working groups
-- acknowledge. F2 needs 3 rep votes (majority), and none of the 3 may come from the locality of the
-- room that sent the F1. A rep's locality is the locality of their own room (users.err_id ->
-- emergency_rooms.state_reference); a rep with no room has no locality and can vote on any F1 in the state.
-- ------------------------------------------------------------------------------------------------

-- 1. Is this F1 from the signed-in rep's own locality?
CREATE OR REPLACE FUNCTION public.f2_is_own_locality(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce((
    SELECT rep_loc.id IS NOT NULL
           AND rep_loc.id = public.local_room_locality(coalesce(p.emergency_room_id::text, p.err_id))
    FROM public.users u
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states rep_loc ON rep_loc.id = er.state_reference
    WHERE u.id = auth.uid()), false)
$function$;
REVOKE ALL ON FUNCTION public.f2_is_own_locality(public.err_projects) FROM PUBLIC, anon, authenticated;

-- 2. For the F2 queue: ids of the visible F1s the signed-in rep can't vote on (own locality)
CREATE OR REPLACE FUNCTION public.f2_own_locality_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(p.id), '{}')
  FROM public.err_projects p
  WHERE coalesce(p.is_draft, false) = false AND p.status = 'pending'
    AND public.f2_can_view(p) AND public.f2_is_own_locality(p)
$function$;
GRANT EXECUTE ON FUNCTION public.f2_own_locality_ids() TO authenticated;

-- 3. Voting refuses a rep's own locality; the project view says why the rep can't vote
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.f2_cast_vote(uuid, jsonb, text)'::regprocedure);
  IF position('own_locality' in d) = 0 THEN
    d := replace(d,
      $q$  IF coalesce(p.is_draft, false) OR p.status <> 'pending' THEN$q$,
      $q$  IF public.f2_is_own_locality(p) THEN
    RAISE EXCEPTION 'own_locality' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p.is_draft, false) OR p.status <> 'pending' THEN$q$);
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.f2_project(uuid)'::regprocedure);
  IF position('own_locality' in d) = 0 THEN
    d := replace(d,
      $q$'can_vote', (me.role = 'state_rep' AND p.status = 'pending' AND coalesce(p.is_draft,false) = false),$q$,
      $q$'can_vote', (me.role = 'state_rep' AND p.status = 'pending' AND coalesce(p.is_draft,false) = false
                   AND NOT public.f2_is_own_locality(p)),
    'own_locality', (me.role = 'state_rep' AND public.f2_is_own_locality(p)),$q$);
    EXECUTE d;
  END IF;
END $$;
