-- Sign-up picks the locality, not a room name (Yung, 26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Before login, a locality member chooses state → "locality room" → their locality. The app finds
-- the locality's room from that. If the locality has no room in the app yet, the page offers to
-- request one (public_propose_room). Returns names and ids only (audit H4).
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_localities(p_state_name text)
RETURNS TABLE(locality_id uuid, locality text, locality_ar text, room_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.id, s.locality, s.locality_ar,
         (SELECT er.id FROM public.emergency_rooms er
           WHERE er.state_reference = s.id AND er.type = 'locality' AND er.status = 'active'
           ORDER BY er.created_at NULLS LAST LIMIT 1)
    FROM public.states s
   WHERE s.state_name = p_state_name AND s.locality IS NOT NULL
   ORDER BY coalesce(s.locality_ar, s.locality);
$function$;
REVOKE ALL ON FUNCTION public.public_localities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_localities(text) TO anon, authenticated;
