-- Room list private before login (security audit H4) (Yung, 26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Before this, anyone with the app's public key could read every room (on MAG: every ERR in the
-- country, with codes and locations) and add rooms, without logging in.
--
-- Agreed 26 Oct: before login, the app goes down to locality level only. Base ERRs are never listed
-- or proposed before login; base members come in through the imported lists.
--
--   public_rooms(state)                    active state and locality rooms of one state: id and name only
--   public_room(id)                        one active state or locality room: id and name only
--   public_propose_room(name, type, loc)   propose a state or locality room (inactive until an admin
--                                          approves); checked name, no duplicates, max 10 an hour
--   emergency_rooms                        readable only when signed in; no direct inserts from the app
--   users self sign-up                     only into state or locality rooms
-- ------------------------------------------------------------------------------------------------

-- Signed-in only
ALTER POLICY local_read ON public.emergency_rooms TO authenticated;

-- No direct, unchecked room inserts; proposals go through public_propose_room()
DROP POLICY IF EXISTS local_propose_room ON public.emergency_rooms;

-- Self sign-up only into a state or locality room (base members are imported)
ALTER POLICY local_self_insert ON public.users
  WITH CHECK (id = auth.uid() AND status = 'pending'
              AND role IN ('locality_err', 'state_err')
              AND EXISTS (SELECT 1 FROM public.emergency_rooms er
                           WHERE er.id = err_id AND er.status = 'active'
                             AND er.type = CASE role WHEN 'locality_err' THEN 'locality' ELSE 'state' END));

CREATE OR REPLACE FUNCTION public.public_rooms(p_state_name text)
RETURNS TABLE(id uuid, name text, name_ar text, type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT er.id, er.name, er.name_ar, er.type
    FROM public.emergency_rooms er
    JOIN public.states s ON s.id = er.state_reference
   WHERE s.state_name = p_state_name
     AND er.status = 'active'
     AND er.type IN ('state', 'locality')
   ORDER BY er.type DESC, coalesce(er.name_ar, er.name);
$function$;

CREATE OR REPLACE FUNCTION public.public_room(p_id uuid)
RETURNS TABLE(id uuid, name text, name_ar text, type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT er.id, er.name, er.name_ar, er.type
    FROM public.emergency_rooms er
   WHERE er.id = p_id AND er.status = 'active' AND er.type IN ('state', 'locality');
$function$;

CREATE OR REPLACE FUNCTION public.public_propose_room(p_name text, p_type text, p_locality_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('state', 'locality') THEN
    RAISE EXCEPTION 'invalid_room_type' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) < 3 OR char_length(v_name) > 120 OR v_name ~ '[<>{}]' THEN
    RAISE EXCEPTION 'invalid_room_name' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.states WHERE id = p_locality_id) THEN
    RAISE EXCEPTION 'locality_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Same name already in that locality (active or waiting)
  IF EXISTS (SELECT 1 FROM public.emergency_rooms
              WHERE state_reference = p_locality_id
                AND (lower(name) = lower(v_name) OR lower(coalesce(name_ar, '')) = lower(v_name))) THEN
    RAISE EXCEPTION 'room_exists' USING ERRCODE = '23505';
  END IF;
  -- Keep a flood of proposals out of the admins' queue
  IF (SELECT count(*) FROM public.emergency_rooms
       WHERE status = 'inactive' AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too_many_proposals' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.emergency_rooms (name, name_ar, type, state_reference, status, created_at)
  VALUES (v_name, CASE WHEN v_name ~ '[؀-ۿ]' THEN v_name END, p_type, p_locality_id, 'inactive', now());
END $function$;

REVOKE ALL ON FUNCTION public.public_rooms(text), public.public_room(uuid), public.public_propose_room(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_rooms(text), public.public_room(uuid), public.public_propose_room(text, text, uuid) TO anon, authenticated;
