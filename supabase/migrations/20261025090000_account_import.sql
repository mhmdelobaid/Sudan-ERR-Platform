-- Account import, superadmin only (Yung, 25 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Agreed plan for launch accounts: localities send lists (name, email, position, room). A superadmin
-- imports them on the User Management page. Each person gets an account that is "pending" and has no
-- password anyone knows. An admin activates it, then sends the person a link (by email, or copied and
-- sent on WhatsApp) where they create their own password.
--
-- The app's API route creates the login itself (Supabase admin API, service key). These functions do
-- the checks and the public.users row, and keep a record of who was imported and which links were sent.
--
--   um_import_check(rows)          check a list before importing (no writes)
--   um_import_user(...)            add one imported person (pending) after their login was created
--   um_link_target(user)           email of an ACTIVE user, before a password link is made
--   um_link_sent(user, method)     record that a link was emailed or copied
--   um_users()                     now also returns position, import date and last link sent
-- ------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.um_invites (
  user_id          uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email            text NOT NULL,
  position         text,
  batch_id         uuid,
  imported_by      uuid,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  last_link_at     timestamptz,
  last_link_method text CHECK (last_link_method IN ('email', 'copy')),
  link_count       integer NOT NULL DEFAULT 0
);
ALTER TABLE public.um_invites ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER functions below read or write it.
REVOKE ALL ON public.um_invites FROM anon, authenticated;

-- Roles a list can give. Admin, superadmin and partner accounts are set up one by one, not imported.
CREATE OR REPLACE FUNCTION public.um_import_role_problem(p_role text, p_err_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_type text;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('base_err','locality_err','state_err','state_rep','lcc_wg','support') THEN
    RETURN 'invalid_role';
  END IF;
  IF p_err_id IS NOT NULL THEN
    SELECT type INTO v_type FROM public.emergency_rooms WHERE id = p_err_id;
    IF NOT FOUND THEN RETURN 'room_not_found'; END IF;
  END IF;
  IF p_role IN ('base_err','locality_err','state_err','state_rep') AND p_err_id IS NULL THEN
    RETURN 'room_required';
  END IF;
  IF (p_role = 'base_err' AND v_type <> 'base')
     OR (p_role = 'locality_err' AND v_type <> 'locality')
     OR (p_role = 'state_err' AND v_type <> 'state') THEN
    RETURN 'room_type_mismatch';
  END IF;
  RETURN NULL;
END $function$;

-- p_rows: [{ "row": 2, "name": "...", "email": "...", "role": "base_err", "err_id": "<uuid or null>" }, ...]
-- Returns [{ "row": 2, "email": "normalised", "problems": ["email_exists", ...] }, ...] in the same order.
CREATE OR REPLACE FUNCTION public.um_import_check(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r        jsonb;
  out_rows jsonb := '[]'::jsonb;
  v_email  text;
  v_room   uuid;
  v_probs  text[];
  v_p      text;
  seen     text[] := '{}';
BEGIN
  PERFORM public.um_require_superadmin();
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'invalid_rows' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_probs := '{}';
    v_email := lower(btrim(coalesce(r->>'email', '')));
    IF nullif(btrim(coalesce(r->>'name', '')), '') IS NULL THEN v_probs := array_append(v_probs, 'name_required'); END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_probs := array_append(v_probs, 'invalid_email');
    ELSE
      IF v_email = ANY (seen) THEN v_probs := array_append(v_probs, 'duplicate_in_list'); END IF;
      IF EXISTS (SELECT 1 FROM auth.users a WHERE lower(a.email) = v_email) THEN v_probs := array_append(v_probs, 'email_exists'); END IF;
      seen := seen || v_email;
    END IF;
    BEGIN
      v_room := nullif(r->>'err_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_room := NULL; v_probs := array_append(v_probs, 'room_not_found');
    END;
    v_p := public.um_import_role_problem(r->>'role', v_room);
    IF v_p IS NOT NULL AND NOT (v_p = ANY (v_probs))
       AND NOT (v_p = 'room_required' AND 'room_not_found' = ANY (v_probs)) THEN
      v_probs := v_probs || v_p;
    END IF;

    out_rows := out_rows || jsonb_build_object('row', r->'row', 'email', v_email, 'problems', to_jsonb(v_probs));
  END LOOP;
  RETURN out_rows;
END $function$;

-- Called by the API right after it created the login (auth.users) for this person.
CREATE OR REPLACE FUNCTION public.um_import_user(
  p_user_id uuid, p_email text, p_name text, p_role text, p_err_id uuid, p_position text, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  actor  uuid := public.um_require_superadmin();
  v_p    text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_user_id AND lower(a.email) = lower(btrim(p_email))) THEN
    RAISE EXCEPTION 'login_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'email_exists' USING ERRCODE = '23505';
  END IF;
  v_p := public.um_import_role_problem(p_role, p_err_id);
  IF v_p IS NOT NULL THEN RAISE EXCEPTION '%', v_p USING ERRCODE = '22023'; END IF;

  INSERT INTO public.users (id, auth_user_id, err_id, display_name, role, status, created_at)
  VALUES (p_user_id, p_user_id, p_err_id, v_name, p_role, 'pending', now());

  INSERT INTO public.um_invites (user_id, email, position, batch_id, imported_by)
  VALUES (p_user_id, lower(btrim(p_email)), nullif(btrim(coalesce(p_position, '')), ''), p_batch, actor);

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (actor, 'user_import', 'user', p_user_id, NULL,
          jsonb_build_object('role', p_role, 'status', 'pending', 'err_id', p_err_id, 'display_name', v_name),
          jsonb_build_object('source', 'err_app_user_management', 'batch_id', p_batch, 'position', p_position));

  RETURN jsonb_build_object('id', p_user_id, 'status', 'pending');
END $function$;

-- Before making a password link: only for active accounts.
CREATE OR REPLACE FUNCTION public.um_link_target(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_status text; v_email text;
BEGIN
  PERFORM public.um_require_superadmin();
  SELECT coalesce(u.status, 'pending'), a.email INTO v_status, v_email
    FROM public.users u JOIN auth.users a ON a.id = u.id WHERE u.id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'user_not_active' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('email', v_email);
END $function$;

CREATE OR REPLACE FUNCTION public.um_link_sent(p_user_id uuid, p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE actor uuid := public.um_require_superadmin(); v_email text; v_row public.um_invites;
BEGIN
  IF p_method NOT IN ('email', 'copy') THEN RAISE EXCEPTION 'invalid_changes' USING ERRCODE = '22023'; END IF;
  SELECT a.email INTO v_email FROM public.users u JOIN auth.users a ON a.id = u.id WHERE u.id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.um_invites (user_id, email, last_link_at, last_link_method, link_count)
  VALUES (p_user_id, lower(v_email), now(), p_method, 1)
  ON CONFLICT (user_id) DO UPDATE
     SET last_link_at = now(), last_link_method = p_method, link_count = public.um_invites.link_count + 1
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (actor, 'password_link', 'user', p_user_id, NULL, jsonb_build_object('method', p_method),
          jsonb_build_object('source', 'err_app_user_management'));

  RETURN jsonb_build_object('last_link_at', v_row.last_link_at, 'last_link_method', v_row.last_link_method, 'link_count', v_row.link_count);
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
             'position', i.position, 'imported_at', i.imported_at,
             'last_link_at', i.last_link_at, 'last_link_method', i.last_link_method, 'link_count', coalesce(i.link_count, 0),
             'is_me', u.id = auth.uid())
           ORDER BY u.created_at DESC NULLS LAST)
    FROM public.users u
    LEFT JOIN auth.users a ON a.id = u.id
    LEFT JOIN public.um_invites i ON i.user_id = u.id
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference), '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.um_import_role_problem(text, uuid), public.um_import_check(jsonb),
  public.um_import_user(uuid, text, text, text, uuid, text, uuid), public.um_link_target(uuid),
  public.um_link_sent(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.um_import_role_problem(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.um_import_check(jsonb), public.um_import_user(uuid, text, text, text, uuid, text, uuid),
  public.um_link_target(uuid), public.um_link_sent(uuid, text) TO authenticated;
