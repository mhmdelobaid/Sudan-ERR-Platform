-- State exchange rates, and the national project on F2 (10 Nov 2026).
--
-- 1. Exchange rate at state level. Decision (Yung, 10 Nov): the PARTNER sets each state's rate (SDG per 1 USD),
--    and a FINANCE member of a national working group acknowledges it. A new rate applies right away; the
--    acknowledgement records that the working group checked it. Every rate and acknowledgement is kept.
--    The F1 has no rate field: AI uploads use the state's rate, and every F1 records the rate of its state when it
--    is sent (err_projects.exchange_rate), so later screens and the portal use the same number.
-- 2. The national project (Direct Fund, ...) on F2: the queue and the project screen carry its name.
--    (The portal feed and the working-group pages already carry it: wg_project_core, 9 Nov.)

-- 1a. Current rate per state, and its history --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.state_exchange_rates (
  state_name       text PRIMARY KEY,
  sdg_per_usd      numeric NOT NULL CHECK (sdg_per_usd > 0 AND sdg_per_usd < 1000000),
  set_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at  timestamptz
);
CREATE TABLE IF NOT EXISTS public.state_exchange_rate_history (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state_name       text NOT NULL,
  sdg_per_usd      numeric NOT NULL,
  set_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at  timestamptz
);
CREATE INDEX IF NOT EXISTS state_exchange_rate_history_state_idx
  ON public.state_exchange_rate_history (state_name, set_at DESC);

ALTER TABLE public.state_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_exchange_rate_history ENABLE ROW LEVEL SECURITY;
-- Any active app account may read the current rates (they're not secret). Changes only through the functions below.
DROP POLICY IF EXISTS state_rates_read ON public.state_exchange_rates;
CREATE POLICY state_rates_read ON public.state_exchange_rates FOR SELECT TO authenticated
  USING (public.local_my_role() IS NOT NULL);
-- History: the partner, the working groups and admins. (local_my_role() leaves partner accounts out by design,
-- so this has its own check.)
CREATE OR REPLACE FUNCTION public.rate_can_see_history()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
                   AND u.role IN ('partner', 'lcc_wg', 'admin', 'superadmin'))
$$;
REVOKE ALL ON FUNCTION public.rate_can_see_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_can_see_history() TO authenticated, service_role;
DROP POLICY IF EXISTS state_rate_history_read ON public.state_exchange_rate_history;
CREATE POLICY state_rate_history_read ON public.state_exchange_rate_history FOR SELECT TO authenticated
  USING (public.rate_can_see_history());
REVOKE ALL ON public.state_exchange_rates, public.state_exchange_rate_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.state_exchange_rates, public.state_exchange_rate_history FROM authenticated;

-- Who may do what (active accounts only)
CREATE OR REPLACE FUNCTION public.rate_can_set()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active' AND u.role = 'partner')
$$;
CREATE OR REPLACE FUNCTION public.rate_can_acknowledge()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.working_group_members m
    JOIN public.working_groups g ON g.id = m.working_group_id AND g.is_active
    JOIN public.users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.user_id = auth.uid() AND m.member_function = 'finance')
$$;
REVOKE ALL ON FUNCTION public.rate_can_set(), public.rate_can_acknowledge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_can_set(), public.rate_can_acknowledge() TO authenticated, service_role;

-- 1b. Every state with its current rate (null when not set yet), and what the caller may do -----------------
DROP FUNCTION IF EXISTS public.state_rates();
CREATE FUNCTION public.state_rates()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'can_set', public.rate_can_set(),
    'can_acknowledge', public.rate_can_acknowledge(),
    'states', coalesce(jsonb_agg(jsonb_build_object(
           'state_name', s.state_name, 'state_name_ar', s.state_name_ar,
           'sdg_per_usd', r.sdg_per_usd, 'set_at', r.set_at, 'set_by_name', u.display_name,
           'acknowledged_at', r.acknowledged_at, 'acknowledged_by_name', a.display_name)
         ORDER BY s.state_name), '[]'::jsonb))
  FROM (SELECT DISTINCT ON (state_name) state_name, state_name_ar
          FROM public.states WHERE state_name IS NOT NULL ORDER BY state_name, state_name_ar NULLS LAST) s
  LEFT JOIN public.state_exchange_rates r ON r.state_name = s.state_name
  LEFT JOIN public.users u ON u.id = r.set_by
  LEFT JOIN public.users a ON a.id = r.acknowledged_by
  WHERE EXISTS (SELECT 1 FROM public.f2_me())
$$;
REVOKE ALL ON FUNCTION public.state_rates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.state_rates() TO authenticated, service_role;

-- 1c. The partner sets a state's rate (it applies at once and waits for the working group's acknowledgement) --
DROP FUNCTION IF EXISTS public.state_rate_set(text, numeric);
CREATE FUNCTION public.state_rate_set(p_state text, p_rate numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.rate_can_set() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.states WHERE state_name = p_state) THEN
    RAISE EXCEPTION 'state_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate >= 1000000 THEN
    RAISE EXCEPTION 'invalid_rate' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.state_exchange_rates (state_name, sdg_per_usd, set_by, set_at, acknowledged_by, acknowledged_at)
  VALUES (p_state, p_rate, auth.uid(), now(), NULL, NULL)
  ON CONFLICT (state_name) DO UPDATE SET sdg_per_usd = EXCLUDED.sdg_per_usd, set_by = EXCLUDED.set_by,
    set_at = EXCLUDED.set_at, acknowledged_by = NULL, acknowledged_at = NULL;
  INSERT INTO public.state_exchange_rate_history (state_name, sdg_per_usd, set_by, set_at)
  VALUES (p_state, p_rate, auth.uid(), now());
  RETURN jsonb_build_object('state_name', p_state, 'sdg_per_usd', p_rate, 'set_at', now());
END
$$;
REVOKE ALL ON FUNCTION public.state_rate_set(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.state_rate_set(text, numeric) TO authenticated, service_role;

-- 1c'. A finance member of a national working group acknowledges the current rate ---------------------------
CREATE OR REPLACE FUNCTION public.state_rate_acknowledge(p_state text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.state_exchange_rates;
BEGIN
  IF NOT public.rate_can_acknowledge() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.state_exchange_rates WHERE state_name = p_state FOR UPDATE;
  IF r.state_name IS NULL THEN
    RAISE EXCEPTION 'rate_not_set' USING ERRCODE = 'P0002';
  END IF;
  IF r.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_acknowledged' USING ERRCODE = '23505';
  END IF;
  UPDATE public.state_exchange_rates SET acknowledged_by = auth.uid(), acknowledged_at = now()
   WHERE state_name = p_state;
  UPDATE public.state_exchange_rate_history SET acknowledged_by = auth.uid(), acknowledged_at = now()
   WHERE id = (SELECT id FROM public.state_exchange_rate_history
                WHERE state_name = p_state AND set_at = r.set_at ORDER BY id DESC LIMIT 1);
  RETURN jsonb_build_object('state_name', p_state, 'sdg_per_usd', r.sdg_per_usd, 'acknowledged_at', now());
END
$$;
REVOKE ALL ON FUNCTION public.state_rate_acknowledge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.state_rate_acknowledge(text) TO authenticated, service_role;

-- 1d. Each F1 records its state's rate when it is sent ------------------------------------------------------
ALTER TABLE public.err_projects ADD COLUMN IF NOT EXISTS exchange_rate numeric;
COMMENT ON COLUMN public.err_projects.exchange_rate IS
  'SDG per 1 USD: the rate of the project''s state when the F1 was sent (state_exchange_rates). Null if none was set.';

CREATE OR REPLACE FUNCTION public.stamp_f1_exchange_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.is_draft, false) = false AND NEW.exchange_rate IS NULL THEN
    NEW.exchange_rate := (SELECT r.sdg_per_usd FROM public.state_exchange_rates r
                          WHERE r.state_name = public.f2_project_state(NEW));
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.stamp_f1_exchange_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_f1_exchange_rate ON public.err_projects;
CREATE TRIGGER stamp_f1_exchange_rate BEFORE INSERT OR UPDATE OF is_draft ON public.err_projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_f1_exchange_rate();

-- The portal feed and working-group pages: the rate the F1 was sent with
CREATE OR REPLACE FUNCTION public.wg_project_core(p err_projects)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('id', p.id, 'project_name', p.project_name, 'state', public.f2_project_state(p), 'locality', p.locality,
    'status', p.status, 'funding_status', p.funding_status, 'version', coalesce(p.version, 1), 'currency', p.currency, 'submitted_at', p.submitted_at,
    'project_objectives', p.project_objectives, 'intended_beneficiaries', p.intended_beneficiaries, 'estimated_beneficiaries', p.estimated_beneficiaries,
    'estimated_timeframe', p.estimated_timeframe, 'program_officer_name', p.program_officer_name, 'finance_officer_name', p.finance_officer_name,
    'reporting_officer_name', p.reporting_officer_name, 'room_name', er.name, 'room_name_ar', er.name_ar, 'room_code', er.err_code,
    'total_budget', coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
    'fund_project_id', g.id, 'fund_project_en', g.name_en, 'fund_project_ar', g.name_ar,
    'exchange_rate', p.exchange_rate)
  FROM (SELECT 1) x LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id LEFT JOIN public.working_groups g ON g.id = p.working_group_id $function$;

-- 2a. F2 queue: + the national project ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.f2_queue();
CREATE FUNCTION public.f2_queue()
 RETURNS TABLE(id uuid, project_name text, state text, locality text, room_name text, room_name_ar text,
               submitted_at timestamp without time zone, version integer, status text, currency text,
               total_budget numeric, estimated_beneficiaries integer, votes_count integer, quorum integer,
               i_voted boolean, decision_outcome text, decided_at timestamp with time zone,
               fund_project_id uuid, fund_project_en text, fund_project_ar text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.project_name, public.f2_project_state(p), p.locality, er.name, er.name_ar,
         p.submitted_at, coalesce(p.version, 1), p.status, p.currency,
         coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
         p.estimated_beneficiaries,
         (SELECT count(*)::int FROM public.f2_votes v
           WHERE v.project_id = p.id AND v.project_version = coalesce(p.version,1)
             AND public.f2_vote_counts(v.voter_id, p)),
         public.f2_quorum(),
         EXISTS (SELECT 1 FROM public.f2_votes v WHERE v.project_id = p.id AND v.project_version = coalesce(p.version,1)
                 AND v.voter_id = auth.uid()),
         d.outcome, d.decided_at,
         g.id, g.name_en, g.name_ar
  FROM public.err_projects p
  LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
  LEFT JOIN public.working_groups g ON g.id = p.working_group_id
  LEFT JOIN LATERAL (SELECT outcome, decided_at FROM public.f2_decisions d
                     WHERE d.project_id = p.id ORDER BY decided_at DESC LIMIT 1) d ON true
  WHERE coalesce(p.is_draft, false) = false
    AND public.f2_can_view(p)
    AND (p.status = 'pending' OR d.outcome IS NOT NULL)
  ORDER BY (p.status = 'pending') DESC, p.submitted_at ASC NULLS LAST
$function$;
REVOKE ALL ON FUNCTION public.f2_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.f2_queue() TO authenticated, service_role;

-- 2b. F2 project screen: + the national project and the rate ---------------------------------------------
CREATE OR REPLACE FUNCTION public.f2_project(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p   public.err_projects;
  me  record;
  ver integer;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT public.f2_can_view(p) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO me FROM public.f2_me();
  ver := coalesce(p.version, 1);

  RETURN jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'project_name', p.project_name, 'state', public.f2_project_state(p),
      'locality', p.locality, 'status', p.status, 'version', ver, 'currency', p.currency,
      'submitted_at', p.submitted_at, 'project_objectives', p.project_objectives,
      'intended_beneficiaries', p.intended_beneficiaries,
      'estimated_beneficiaries', p.estimated_beneficiaries,
      'estimated_timeframe', p.estimated_timeframe,
      'program_officer_name', p.program_officer_name,
      'finance_officer_name', p.finance_officer_name,
      'reporting_officer_name', p.reporting_officer_name,
      'room_name', (SELECT name FROM public.emergency_rooms WHERE id = p.emergency_room_id),
      'room_name_ar', (SELECT name_ar FROM public.emergency_rooms WHERE id = p.emergency_room_id),
      'fund_project_id', p.working_group_id,
      'fund_project_en', (SELECT name_en FROM public.working_groups WHERE id = p.working_group_id),
      'fund_project_ar', (SELECT name_ar FROM public.working_groups WHERE id = p.working_group_id),
      'exchange_rate', p.exchange_rate
    ),
    'lines', public.f2_lines(p),
    'quorum', public.f2_quorum(),
    'votes_count', (SELECT count(*) FROM public.f2_votes v
                     WHERE v.project_id = p.id AND v.project_version = ver AND public.f2_vote_counts(v.voter_id, p)),
    'can_vote', (me.role = 'state_rep' AND p.status = 'pending' AND coalesce(p.is_draft,false) = false
                   AND NOT public.f2_is_own_locality(p)),
    'own_locality', (me.role = 'state_rep' AND public.f2_is_own_locality(p)),
    'me', me.user_id,
    'ballots', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'voter_id', v.voter_id, 'voter_name', u.display_name, 'is_me', v.voter_id = me.user_id,
        'counts', public.f2_vote_counts(v.voter_id, p),
        'line_votes', v.line_votes, 'overall_note', v.overall_note, 'updated_at', v.updated_at
      ) ORDER BY v.created_at)
      FROM public.f2_votes v JOIN public.users u ON u.id = v.voter_id
      WHERE v.project_id = p.id AND v.project_version = ver), '[]'::jsonb),
    'decision', (
      SELECT to_jsonb(d) - 'voter_ids' FROM public.f2_decisions d
      WHERE d.project_id = p.id ORDER BY d.decided_at DESC LIMIT 1)
  );
END $function$;
