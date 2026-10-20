-- User management, superadmin only (Yung, 20 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- One page in the app where a superadmin sees every user (name, email, role, room, locality, state,
-- status, last sign-in) and changes role, status, room, display name or visible states.
-- Every change is written to audit_logs (who, when, old and new values).
--
--   um_users()                     all users, for the list (superadmin only)
--   um_update_user(user, changes)  change one user (superadmin only)
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.um_require_superadmin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF (SELECT role FROM public.local_me()) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'only_superadmin' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END $function$;

CREATE OR REPLACE FUNCTION public.um_users()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.um_require_superadmin();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', u.id, 'display_name', u.display_name, 'email', a.email,
             'role', u.role, 'status', coalesce(u.status, 'pending'),
             'err_id', u.err_id, 'room_name', er.name, 'room_name_ar', er.name_ar, 'room_type', er.type, 'err_code', er.err_code,
             'locality', s.locality, 'locality_ar', s.locality_ar, 'state', s.state_name, 'state_ar', s.state_name_ar,
             'can_see_all_states', coalesce(u.can_see_all_states, false), 'visible_states', coalesce(u.visible_states, '{}'),
             'created_at', u.created_at, 'last_sign_in_at', a.last_sign_in_at,
             'is_me', u.id = auth.uid())
           ORDER BY u.created_at DESC NULLS LAST)
    FROM public.users u
    LEFT JOIN auth.users a ON a.id = u.id
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.um_update_user(p_user_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  actor   uuid := public.um_require_superadmin();
  old_u   public.users;
  new_u   public.users;
  v_role  text;
  v_room  uuid;
  v_type  text;
  bad_key text;
BEGIN
  SELECT * INTO old_u FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF old_u.id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_changes' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO bad_key FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('role','status','err_id','display_name','can_see_all_states','visible_states') LIMIT 1;
  IF bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_changes' USING ERRCODE = '22023', DETAIL = bad_key;
  END IF;
  -- A superadmin can't lock themselves out
  IF p_user_id = actor AND (p_changes ? 'role' OR p_changes ? 'status') THEN
    RAISE EXCEPTION 'cannot_change_self' USING ERRCODE = '42501';
  END IF;

  v_role := coalesce(p_changes->>'role', old_u.role);
  IF v_role NOT IN ('base_err','locality_err','state_err','state_rep','lcc_wg','support','admin','superadmin','partner') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'status' AND (p_changes->>'status') NOT IN ('pending','active','suspended') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  v_room := CASE WHEN p_changes ? 'err_id' THEN nullif(p_changes->>'err_id', '')::uuid ELSE old_u.err_id END;
  IF v_room IS NOT NULL THEN
    SELECT type INTO v_type FROM public.emergency_rooms WHERE id = v_room;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  -- Room rules (checked when the role or the room changes)
  IF p_changes ? 'role' OR p_changes ? 'err_id' THEN
    IF v_role IN ('base_err','locality_err','state_err','state_rep') AND v_room IS NULL THEN
      RAISE EXCEPTION 'room_required' USING ERRCODE = '22023';
    END IF;
    IF (v_role = 'base_err' AND v_type <> 'base')
       OR (v_role = 'locality_err' AND v_type <> 'locality')
       OR (v_role = 'state_err' AND v_type <> 'state') THEN
      RAISE EXCEPTION 'room_type_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.users SET
    role               = v_role,
    status             = CASE WHEN p_changes ? 'status' THEN p_changes->>'status' ELSE status END,
    err_id             = v_room,
    display_name       = CASE WHEN p_changes ? 'display_name' THEN nullif(btrim(p_changes->>'display_name'), '') ELSE display_name END,
    can_see_all_states = CASE WHEN p_changes ? 'can_see_all_states' THEN (p_changes->>'can_see_all_states')::boolean ELSE can_see_all_states END,
    visible_states     = CASE WHEN p_changes ? 'visible_states'
                              THEN ARRAY(SELECT jsonb_array_elements_text(p_changes->'visible_states')) ELSE visible_states END,
    updated_at         = now()
  WHERE id = p_user_id
  RETURNING * INTO new_u;

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (actor, 'user_update', 'user', p_user_id,
          jsonb_build_object('role', old_u.role, 'status', old_u.status, 'err_id', old_u.err_id, 'display_name', old_u.display_name,
                             'can_see_all_states', old_u.can_see_all_states, 'visible_states', old_u.visible_states),
          jsonb_build_object('role', new_u.role, 'status', new_u.status, 'err_id', new_u.err_id, 'display_name', new_u.display_name,
                             'can_see_all_states', new_u.can_see_all_states, 'visible_states', new_u.visible_states),
          jsonb_build_object('source', 'err_app_user_management'));

  RETURN jsonb_build_object('id', new_u.id, 'role', new_u.role, 'status', new_u.status, 'err_id', new_u.err_id,
                            'display_name', new_u.display_name, 'can_see_all_states', new_u.can_see_all_states,
                            'visible_states', new_u.visible_states);
END $function$;

REVOKE ALL ON FUNCTION public.um_require_superadmin(), public.um_users(), public.um_update_user(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.um_require_superadmin() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.um_users(), public.um_update_user(uuid, jsonb) TO authenticated;
