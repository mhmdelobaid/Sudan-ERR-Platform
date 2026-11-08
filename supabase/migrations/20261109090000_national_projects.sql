-- National projects and their working groups (Yung, 9 Nov 2026)
--
-- A national project (Direct Fund / الدعم المباشر first; later WRR, the Forum…) IS a working group:
-- one group per project, whose members are marked program, finance, reporting or external comms.
--   * The superadmin opens each project to chosen states and can close it to new requests.
--   * A base ERR picks the project on its F1, from the projects open in its room's state. Required to send.
--   * Working-group members follow only their own project's F1s after F2 (all states, read-only), and only
--     they acknowledge them. The superadmin follows all of them, and can move an F1 to another project.
--   * Existing F1s are all given Direct Fund (stage 1 runs on Direct Fund only).
--
-- Reads and writes go through the functions below; the new table has RLS on with no rules.

-- 1. Tables and columns ------------------------------------------------------------------------------
ALTER TABLE public.working_groups
  ADD COLUMN IF NOT EXISTS accepts_f1 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.working_groups.accepts_f1 IS 'Open for new F1 requests. Closing keeps the project and its F1s visible to its working group.';

CREATE TABLE IF NOT EXISTS public.working_group_states (
  working_group_id uuid NOT NULL REFERENCES public.working_groups(id) ON DELETE CASCADE,
  state_name text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES public.users(id),
  PRIMARY KEY (working_group_id, state_name)
);
ALTER TABLE public.working_group_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.working_group_states FROM anon, authenticated;

ALTER TABLE public.working_group_members
  ADD COLUMN IF NOT EXISTS member_function text;
ALTER TABLE public.working_group_members DROP CONSTRAINT IF EXISTS working_group_members_function_check;
ALTER TABLE public.working_group_members
  ADD CONSTRAINT working_group_members_function_check
  CHECK (member_function IS NULL OR member_function IN ('program', 'finance', 'reporting', 'comms'));

ALTER TABLE public.err_projects
  ADD COLUMN IF NOT EXISTS working_group_id uuid REFERENCES public.working_groups(id);
CREATE INDEX IF NOT EXISTS err_projects_working_group_id_idx ON public.err_projects (working_group_id);

-- 2. Direct Fund: open in every state, and every existing F1 belongs to it ---------------------------
INSERT INTO public.working_group_states (working_group_id, state_name)
SELECT g.id, s.state_name
FROM public.working_groups g
CROSS JOIN (SELECT DISTINCT state_name FROM public.states WHERE state_name IS NOT NULL) s
WHERE g.name_en = 'Direct Fund'
ON CONFLICT DO NOTHING;

UPDATE public.working_groups SET sort_order = CASE WHEN name_en = 'Direct Fund' THEN 1 ELSE 100 END WHERE sort_order = 0;

UPDATE public.err_projects
SET working_group_id = (SELECT id FROM public.working_groups WHERE name_en = 'Direct Fund' LIMIT 1)
WHERE working_group_id IS NULL;

-- 3. Checks on F1 writes -----------------------------------------------------------------------------
-- Required when an F1 is sent; must be open in the F1's state when a room (or the app's server key on
-- a room's behalf) picks or changes it. Staff (superadmin, admin, support, partner) may move it anywhere.
-- The trigger runs as the caller (so it knows who is writing); the lookup it needs runs as the owner.
CREATE OR REPLACE FUNCTION public.fund_project_check(p_group_id uuid, p public.err_projects)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN g.id IS NULL OR NOT g.is_active THEN 'project_not_found'
    WHEN NOT g.accepts_f1
      OR NOT EXISTS (SELECT 1 FROM public.working_group_states ws
                     WHERE ws.working_group_id = g.id AND ws.state_name = public.f2_project_state(p))
      THEN 'project_not_open'
    ELSE 'ok' END
  FROM (SELECT 1) x LEFT JOIN public.working_groups g ON g.id = p_group_id
$$;

CREATE OR REPLACE FUNCTION public.guard_err_projects_wg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  restricted boolean := current_user NOT IN ('postgres', 'supabase_admin') AND NOT public.guard_is_staff();
  verdict text;
BEGIN
  IF restricted
     AND NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending')
     AND NEW.working_group_id IS NULL THEN
    RAISE EXCEPTION 'project_required' USING ERRCODE = '23502';
  END IF;

  IF NEW.working_group_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.working_group_id IS DISTINCT FROM OLD.working_group_id) THEN
    verdict := public.fund_project_check(NEW.working_group_id, NEW);
    IF verdict = 'project_not_found' OR (restricted AND verdict = 'project_not_open') THEN
      RAISE EXCEPTION '%', verdict USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_err_projects_wg ON public.err_projects;
CREATE TRIGGER guard_err_projects_wg
  BEFORE INSERT OR UPDATE OF working_group_id, status ON public.err_projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_err_projects_wg();

-- 4. Working groups follow only their own project ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.wg_member_of_project(p_project_id uuid, p_program_only boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.f2_me() me
    JOIN public.working_group_members m ON m.user_id = me.user_id
    JOIN public.working_groups g ON g.id = m.working_group_id AND g.is_active
    JOIN public.err_projects p ON p.id = p_project_id AND p.working_group_id = m.working_group_id
    WHERE me.role = 'lcc_wg'
      AND (NOT p_program_only OR m.member_function = 'program'))
$$;

CREATE OR REPLACE FUNCTION public.wg_can_follow(p public.err_projects)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(p.is_draft, false) = false
     AND p.status IN ('screened', 'approved', 'active', 'completed')
     AND (coalesce((SELECT me.role = 'superadmin' FROM public.f2_me() me), false)
          OR public.wg_member_of_project(p.id, false))
$$;

CREATE OR REPLACE FUNCTION public.wg_can_confirm(p public.err_projects)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT me.role = 'lcc_wg' FROM public.f2_me() me), false)
     AND p.status = 'screened'
     AND coalesce(p.is_draft, false) = false
     AND public.wg_lcc_status(p) = 'waiting'
     AND public.wg_member_of_project(p.id, false)
$$;

-- The acknowledgement now records which project's working group gave it
CREATE OR REPLACE FUNCTION public.wg_lcc_decide(p_project_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.err_projects; me record;
BEGIN
  SELECT * INTO me FROM public.f2_me();
  IF me.user_id IS NULL OR me.role <> 'lcc_wg' THEN
    RAISE EXCEPTION 'only_working_groups_confirm' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_decision, '') <> 'approved' THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.wg_can_follow(p) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p.status <> 'screened' THEN
    RAISE EXCEPTION 'project_not_screened' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lcc_reviews WHERE project_id = p.id AND project_version = coalesce(p.version, 1)) THEN
    RAISE EXCEPTION 'already_decided' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lcc_reviews (project_id, project_version, working_group_id, decision, note, decided_by)
  VALUES (p.id, coalesce(p.version, 1), p.working_group_id, 'approved', nullif(btrim(coalesce(p_note, '')), ''), me.user_id);
  RETURN jsonb_build_object('decision', 'approved', 'status', p.status);
END
$$;

-- Each F1 row on the working-group screens carries its project
CREATE OR REPLACE FUNCTION public.wg_project_core(p public.err_projects)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'project_name', p.project_name, 'state', public.f2_project_state(p), 'locality', p.locality,
    'status', p.status, 'funding_status', p.funding_status, 'version', coalesce(p.version, 1),
    'currency', p.currency, 'submitted_at', p.submitted_at, 'project_objectives', p.project_objectives,
    'intended_beneficiaries', p.intended_beneficiaries, 'estimated_beneficiaries', p.estimated_beneficiaries,
    'estimated_timeframe', p.estimated_timeframe, 'program_officer_name', p.program_officer_name,
    'finance_officer_name', p.finance_officer_name, 'reporting_officer_name', p.reporting_officer_name,
    'room_name', er.name, 'room_name_ar', er.name_ar, 'room_code', er.err_code,
    'total_budget', coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
    'fund_project_id', g.id, 'fund_project_en', g.name_en, 'fund_project_ar', g.name_ar)
  FROM (SELECT 1) x
  LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
  LEFT JOIN public.working_groups g ON g.id = p.working_group_id
$$;

-- 5. Lists for the app -------------------------------------------------------------------------------
-- Names of all projects (labels on F1 views); any active app user.
CREATE OR REPLACE FUNCTION public.fund_projects()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar,
                                               'accepts_f1', g.accepts_f1) ORDER BY g.sort_order, g.name_en), '[]'::jsonb)
  FROM public.working_groups g
  WHERE g.is_active AND EXISTS (SELECT 1 FROM public.f2_me())
$$;

-- Projects a room can request funds from: open, and open in that room's state.
CREATE OR REPLACE FUNCTION public.fund_projects_for_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar)
                            ORDER BY g.sort_order, g.name_en), '[]'::jsonb)
  FROM public.working_groups g
  WHERE g.is_active AND g.accepts_f1
    AND EXISTS (SELECT 1 FROM public.f2_me())
    AND EXISTS (
      SELECT 1 FROM public.working_group_states ws
      JOIN public.emergency_rooms er ON er.id = p_room_id
      JOIN public.states s ON s.id = er.state_reference
      WHERE ws.working_group_id = g.id AND ws.state_name = s.state_name)
$$;

-- 6. Superadmin: projects, states and members ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fund_project_require_superadmin()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid;
BEGIN
  SELECT me.user_id INTO uid FROM public.f2_me() me WHERE me.role = 'superadmin';
  IF uid IS NULL THEN
    RAISE EXCEPTION 'superadmin_only' USING ERRCODE = '42501';
  END IF;
  RETURN uid;
END
$$;

CREATE OR REPLACE FUNCTION public.fund_projects_admin()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fund_project_require_superadmin();
  RETURN jsonb_build_object(
    'projects', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar, 'is_active', g.is_active,
        'accepts_f1', g.accepts_f1, 'sort_order', g.sort_order,
        'states', coalesce((SELECT jsonb_agg(ws.state_name ORDER BY ws.state_name)
                            FROM public.working_group_states ws WHERE ws.working_group_id = g.id), '[]'::jsonb),
        'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
                               'user_id', m.user_id, 'name', u.display_name, 'email', au.email,
                               'function', m.member_function, 'is_lead', m.is_lead, 'status', u.status)
                             ORDER BY m.is_lead DESC, u.display_name)
                             FROM public.working_group_members m
                             JOIN public.users u ON u.id = m.user_id
                             LEFT JOIN auth.users au ON au.id = m.user_id
                             WHERE m.working_group_id = g.id), '[]'::jsonb),
        'f1_count', (SELECT count(*) FROM public.err_projects p
                     WHERE p.working_group_id = g.id AND coalesce(p.is_draft, false) = false))
        ORDER BY g.is_active DESC, g.sort_order, g.name_en)
      FROM public.working_groups g), '[]'::jsonb),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.display_name, 'email', au.email)
                       ORDER BY u.display_name)
      FROM public.users u LEFT JOIN auth.users au ON au.id = u.id
      WHERE u.role = 'lcc_wg' AND u.status = 'active'), '[]'::jsonb),
    'states', coalesce((
      SELECT jsonb_agg(jsonb_build_object('state_name', x.state_name, 'state_name_ar', x.state_name_ar)
                       ORDER BY x.state_name)
      FROM (SELECT state_name, min(state_name_ar) AS state_name_ar FROM public.states
            WHERE state_name IS NOT NULL GROUP BY state_name) x), '[]'::jsonb));
END
$$;

CREATE OR REPLACE FUNCTION public.fund_project_save(
  p_id uuid, p_name_en text, p_name_ar text, p_accepts_f1 boolean, p_is_active boolean, p_states text[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := public.fund_project_require_superadmin(); gid uuid; bad text;
BEGIN
  IF btrim(coalesce(p_name_en, '')) = '' OR btrim(coalesce(p_name_ar, '')) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;
  SELECT s INTO bad FROM unnest(coalesce(p_states, '{}')) s
  WHERE NOT EXISTS (SELECT 1 FROM public.states st WHERE st.state_name = s) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown_state' USING ERRCODE = '22023', DETAIL = bad;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.working_groups (name_en, name_ar, is_active, accepts_f1, created_by, sort_order)
    VALUES (btrim(p_name_en), btrim(p_name_ar), coalesce(p_is_active, true), coalesce(p_accepts_f1, true), uid,
            coalesce((SELECT max(sort_order) FROM public.working_groups), 0) + 1)
    RETURNING id INTO gid;
  ELSE
    UPDATE public.working_groups
    SET name_en = btrim(p_name_en), name_ar = btrim(p_name_ar),
        is_active = coalesce(p_is_active, is_active), accepts_f1 = coalesce(p_accepts_f1, accepts_f1)
    WHERE id = p_id
    RETURNING id INTO gid;
    IF gid IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  DELETE FROM public.working_group_states
  WHERE working_group_id = gid AND state_name <> ALL (coalesce(p_states, '{}'));
  INSERT INTO public.working_group_states (working_group_id, state_name, added_by)
  SELECT gid, s, uid FROM unnest(coalesce(p_states, '{}')) s
  ON CONFLICT DO NOTHING;
  RETURN gid;
END
$$;

CREATE OR REPLACE FUNCTION public.fund_project_member_set(
  p_group_id uuid, p_user_id uuid, p_function text, p_is_lead boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := public.fund_project_require_superadmin();
BEGIN
  IF p_function NOT IN ('program', 'finance', 'reporting', 'comms') THEN
    RAISE EXCEPTION 'invalid_function' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.working_groups WHERE id = p_group_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND role = 'lcc_wg') THEN
    RAISE EXCEPTION 'not_a_working_group_account' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.working_group_members (working_group_id, user_id, is_lead, member_function, added_by)
  VALUES (p_group_id, p_user_id, coalesce(p_is_lead, false), p_function, uid)
  ON CONFLICT (working_group_id, user_id)
  DO UPDATE SET member_function = EXCLUDED.member_function, is_lead = EXCLUDED.is_lead;
END
$$;

CREATE OR REPLACE FUNCTION public.fund_project_member_remove(p_group_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fund_project_require_superadmin();
  DELETE FROM public.working_group_members WHERE working_group_id = p_group_id AND user_id = p_user_id;
END
$$;

CREATE OR REPLACE FUNCTION public.fund_project_move_f1(p_project_id uuid, p_group_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fund_project_require_superadmin();
  UPDATE public.err_projects SET working_group_id = p_group_id WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
END
$$;

-- 7. Who may call what --------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guard_err_projects_wg() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.fund_projects()',
    'public.fund_projects_for_room(uuid)',
    'public.fund_project_check(uuid, public.err_projects)',
    'public.fund_project_require_superadmin()',
    'public.fund_projects_admin()',
    'public.fund_project_save(uuid, text, text, boolean, boolean, text[])',
    'public.fund_project_member_set(uuid, uuid, text, boolean)',
    'public.fund_project_member_remove(uuid, uuid)',
    'public.fund_project_move_f1(uuid, uuid)',
    'public.wg_member_of_project(uuid, boolean)',
    'public.wg_can_follow(public.err_projects)',
    'public.wg_can_confirm(public.err_projects)',
    'public.wg_lcc_decide(uuid, text, text)',
    'public.wg_project_core(public.err_projects)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$$;
