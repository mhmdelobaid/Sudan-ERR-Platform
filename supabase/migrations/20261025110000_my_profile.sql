-- My profile (Yung, 25 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- A page where every signed-in person sees their own account (name, email, role, room, locality,
-- state, what they can see) and changes their display name. Email, role and room stay with the admins.
--
--   me_profile()          the caller's own account
--   me_update_name(name)  change the caller's display name (logged in audit_logs)
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.me_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
           'id', u.id, 'display_name', u.display_name, 'email', a.email,
           'role', u.role, 'status', coalesce(u.status, 'pending'),
           'room_name', er.name, 'room_name_ar', er.name_ar, 'room_type', er.type, 'err_code', er.err_code,
           'locality', s.locality, 'locality_ar', s.locality_ar, 'state', s.state_name, 'state_ar', s.state_name_ar,
           'can_see_all_states', coalesce(u.can_see_all_states, false), 'visible_states', coalesce(u.visible_states, '{}'),
           'position', i.position, 'created_at', u.created_at, 'last_sign_in_at', a.last_sign_in_at)
    INTO v
    FROM public.users u
    JOIN auth.users a ON a.id = u.id
    LEFT JOIN public.um_invites i ON i.user_id = u.id
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference
   WHERE u.id = auth.uid();
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.me_update_name(p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  me     uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_old  text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  SELECT display_name INTO v_old FROM public.users WHERE id = me AND coalesce(status, 'pending') = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old IS NOT DISTINCT FROM v_name THEN RETURN jsonb_build_object('display_name', v_name); END IF;

  UPDATE public.users SET display_name = v_name, updated_at = now() WHERE id = me;
  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (me, 'profile_update', 'user', me, jsonb_build_object('display_name', v_old),
          jsonb_build_object('display_name', v_name), jsonb_build_object('source', 'err_app_profile'));
  RETURN jsonb_build_object('display_name', v_name);
END $function$;

REVOKE ALL ON FUNCTION public.me_profile(), public.me_update_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.me_profile(), public.me_update_name(text) TO authenticated;
