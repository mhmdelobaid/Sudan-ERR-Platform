-- F-2 screening by state reps (قرار فرز المشروع)
-- ------------------------------------------------------------------
-- Adds:
--   * role 'state_rep' on users (the reps committee; F-2 only)
--   * f2_votes      one ballot per rep per project version, a verdict on every F-1 line
--   * f2_decisions  the committee decision, written once quorum is reached
--   * RPCs f2_queue(), f2_project(uuid), f2_cast_vote(uuid, jsonb, text)
--
-- All reads/writes for reps go through SECURITY DEFINER functions that do
-- their own role + state checks, so this does not depend on the existing
-- RLS policies on err_projects (which differ between staging and live).
--
-- Rules (change in f2_quorum() / f2_cast_vote()):
--   quorum = 3 distinct state_rep ballots for the current project version
--   line outcome  = the verdict of a majority (at least 2 of the 3 reps). A single reject or
--                   condition does not send the F-1 back. A 1-1-1 split counts as 'conditional'.
--   overall       = all lines approve -> project status 'screened': passed F-2, sent to the portal
--                                        for final review; the Partner team makes the MOU (F-3) there.
--                                        Funding stays 'allocated'; the portal commits it.
--                   all lines reject  -> rejected
--                   anything else     -> conditional (returned to the room as feedback)
--
-- Later levels (not built yet): locality -> state -> LCC working groups -> portal. At those levels
-- only the program approves and the others go along with it.
--   a note is required on any line voted conditional or reject
--   reps can change their ballot until the decision is final
--   a resubmitted F-1 (version + 1) starts a fresh vote
-- ------------------------------------------------------------------

-- 1. Role -----------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'support','admin','superadmin','state_err','base_err','partner','state_rep'
]));

-- 2. Tables ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.f2_votes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  project_version integer NOT NULL DEFAULT 1,
  voter_id        uuid NOT NULL REFERENCES public.users(id),
  line_votes      jsonb NOT NULL,      -- [{key, verdict: approve|conditional|reject, note}]
  overall_note    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, project_version, voter_id)
);

CREATE TABLE IF NOT EXISTS public.f2_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  project_version integer NOT NULL DEFAULT 1,
  outcome         text NOT NULL CHECK (outcome IN ('approved','conditional','rejected')),
  line_outcomes   jsonb NOT NULL,      -- [{key, outcome, approve, conditional, reject, notes[]}]
  summary         text,
  quorum          integer NOT NULL,
  voter_ids       uuid[] NOT NULL,
  feedback_id     uuid REFERENCES public.project_feedback(id),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, project_version)
);

CREATE INDEX IF NOT EXISTS f2_votes_project_idx ON public.f2_votes (project_id, project_version);

-- No direct table access: everything goes through the functions below.
ALTER TABLE public.f2_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f2_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.f2_votes, public.f2_decisions FROM anon, authenticated;

-- 3. Helpers --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.f2_quorum() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

-- The calling user: role, state (from their room) and which states they may see.
CREATE OR REPLACE FUNCTION public.f2_me()
RETURNS TABLE(user_id uuid, role text, display_name text, state_name text, all_states boolean, states text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.role, u.display_name, s.state_name,
         coalesce(u.can_see_all_states, false) OR u.role = 'superadmin',
         coalesce(u.visible_states, '{}')
  FROM public.users u
  LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
  LEFT JOIN public.states s ON s.id = er.state_reference
  WHERE u.id = auth.uid() AND u.status = 'active'
$$;

-- A project's state: from its room, falling back to the free-text column.
CREATE OR REPLACE FUNCTION public.f2_project_state(p public.err_projects)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT s.state_name FROM public.emergency_rooms er JOIN public.states s ON s.id = er.state_reference
      WHERE er.id = coalesce(p.emergency_room_id,
              CASE WHEN p.err_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN p.err_id::uuid END)),
    p.state)
$$;

-- Can the caller see this project in the F-2 screens? (reps: own state; admins: their states)
CREATE OR REPLACE FUNCTION public.f2_can_view(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN me.role = 'state_rep' THEN me.state_name IS NOT NULL AND public.f2_project_state(p) = me.state_name
      WHEN me.role IN ('admin','superadmin') THEN me.all_states OR public.f2_project_state(p) = ANY (me.states)
      ELSE false END
    FROM public.f2_me() me), false)
$$;

-- The F-1 lines that get a verdict: one per planned activity
-- (or, for older F-1s without activities, one per expense row).
CREATE OR REPLACE FUNCTION public.f2_lines(p public.err_projects)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN jsonb_typeof(p.planned_activities) = 'array' AND jsonb_array_length(p.planned_activities) > 0 THEN (
      SELECT jsonb_agg(jsonb_build_object(
        'key', 'a' || (a.ord - 1),
        'kind', 'activity',
        'activity_id', a.v->>'selectedActivity',
        'location', a.v->>'location',
        'quantity', a.v->'quantity',
        'duration', a.v->'duration',
        'expenses', coalesce(a.v->'expenses', '[]'::jsonb),
        'total', coalesce((SELECT sum(coalesce(nullif(e->>'total','')::numeric, nullif(e->>'total_cost','')::numeric, 0))
                           FROM jsonb_array_elements(coalesce(a.v->'expenses','[]'::jsonb)) e), 0)
      ) ORDER BY a.ord)
      FROM jsonb_array_elements(p.planned_activities) WITH ORDINALITY a(v, ord))
    WHEN jsonb_typeof(p.expenses) = 'array' AND jsonb_array_length(p.expenses) > 0 THEN (
      SELECT jsonb_agg(jsonb_build_object(
        'key', 'e' || (x.ord - 1),
        'kind', 'expense',
        'expense_id', x.v->>'expense',
        'description', x.v->>'description',
        'frequency', x.v->'frequency',
        'unit_price', x.v->'unitPrice',
        'total', coalesce(nullif(x.v->>'total_cost','')::numeric, nullif(x.v->>'total','')::numeric, 0)
      ) ORDER BY x.ord)
      FROM jsonb_array_elements(p.expenses) WITH ORDINALITY x(v, ord))
    ELSE '[]'::jsonb END
$$;

-- 4. Queue ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.f2_queue()
RETURNS TABLE(
  id uuid, project_name text, state text, locality text, room_name text, room_name_ar text,
  submitted_at timestamp, version integer, status text, currency text,
  total_budget numeric, estimated_beneficiaries integer,
  votes_count integer, quorum integer, i_voted boolean, decision_outcome text, decided_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.project_name, public.f2_project_state(p), p.locality, er.name, er.name_ar,
         p.submitted_at, coalesce(p.version, 1), p.status, p.currency,
         coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
         p.estimated_beneficiaries,
         (SELECT count(*)::int FROM public.f2_votes v WHERE v.project_id = p.id AND v.project_version = coalesce(p.version,1)),
         public.f2_quorum(),
         EXISTS (SELECT 1 FROM public.f2_votes v WHERE v.project_id = p.id AND v.project_version = coalesce(p.version,1)
                 AND v.voter_id = auth.uid()),
         d.outcome, d.decided_at
  FROM public.err_projects p
  LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
  LEFT JOIN LATERAL (SELECT outcome, decided_at FROM public.f2_decisions d
                     WHERE d.project_id = p.id ORDER BY decided_at DESC LIMIT 1) d ON true
  WHERE coalesce(p.is_draft, false) = false
    AND public.f2_can_view(p)
    AND (p.status = 'pending' OR d.outcome IS NOT NULL)
  ORDER BY (p.status = 'pending') DESC, p.submitted_at ASC NULLS LAST
$$;

-- 5. One project, with every rep's ballot ---------------------------
CREATE OR REPLACE FUNCTION public.f2_project(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      'room_name_ar', (SELECT name_ar FROM public.emergency_rooms WHERE id = p.emergency_room_id)
    ),
    'lines', public.f2_lines(p),
    'quorum', public.f2_quorum(),
    'can_vote', (me.role = 'state_rep' AND p.status = 'pending' AND coalesce(p.is_draft,false) = false),
    'me', me.user_id,
    'ballots', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'voter_id', v.voter_id, 'voter_name', u.display_name, 'is_me', v.voter_id = me.user_id,
        'line_votes', v.line_votes, 'overall_note', v.overall_note, 'updated_at', v.updated_at
      ) ORDER BY v.created_at)
      FROM public.f2_votes v JOIN public.users u ON u.id = v.voter_id
      WHERE v.project_id = p.id AND v.project_version = ver), '[]'::jsonb),
    'decision', (
      SELECT to_jsonb(d) - 'voter_ids' FROM public.f2_decisions d
      WHERE d.project_id = p.id ORDER BY d.decided_at DESC LIMIT 1)
  );
END $$;

-- 6. Cast / update a ballot; finalize at quorum ---------------------
CREATE OR REPLACE FUNCTION public.f2_cast_vote(p_project_id uuid, p_line_votes jsonb, p_overall_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p          public.err_projects;
  me         record;
  ver        integer;
  lines      jsonb;
  line_keys  text[];
  vote_keys  text[];
  bad        int;
  n_votes    int;
  q          int := public.f2_quorum();
  outcomes   jsonb;
  n_lines    int;
  n_approve  int;
  n_reject   int;
  v_outcome  text;
  v_summary  text;
  fb_id      uuid;
  next_iter  int;
BEGIN
  SELECT * INTO me FROM public.f2_me();
  IF me.user_id IS NULL OR me.role <> 'state_rep' THEN
    RAISE EXCEPTION 'only_state_reps_can_vote' USING ERRCODE = '42501';
  END IF;

  -- Lock the project so two final ballots can't race each other.
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.f2_can_view(p) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(p.is_draft, false) OR p.status <> 'pending' THEN
    RAISE EXCEPTION 'project_not_pending' USING ERRCODE = '22023';
  END IF;
  ver := coalesce(p.version, 1);

  -- Validate the ballot: every line exactly once, a known verdict, a note when not approving.
  lines := public.f2_lines(p);
  SELECT coalesce(array_agg(l->>'key' ORDER BY l->>'key'), '{}') INTO line_keys FROM jsonb_array_elements(lines) l;
  IF array_length(line_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'project_has_no_lines' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_line_votes) <> 'array' THEN
    RAISE EXCEPTION 'invalid_ballot' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(v->>'key' ORDER BY v->>'key'), '{}') INTO vote_keys FROM jsonb_array_elements(p_line_votes) v;
  IF vote_keys IS DISTINCT FROM line_keys THEN
    RAISE EXCEPTION 'ballot_must_cover_every_line' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO bad FROM jsonb_array_elements(p_line_votes) v
   WHERE coalesce(v->>'verdict','') NOT IN ('approve','conditional','reject')
      OR (v->>'verdict' IN ('conditional','reject') AND btrim(coalesce(v->>'note','')) = '');
  IF bad > 0 THEN
    RAISE EXCEPTION 'note_required_for_conditional_or_reject' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.f2_votes (project_id, project_version, voter_id, line_votes, overall_note)
  VALUES (p.id, ver, me.user_id,
          (SELECT jsonb_agg(jsonb_build_object('key', v->>'key', 'verdict', v->>'verdict',
                                               'note', nullif(btrim(coalesce(v->>'note','')), '')))
             FROM jsonb_array_elements(p_line_votes) v),
          nullif(btrim(coalesce(p_overall_note, '')), ''))
  ON CONFLICT (project_id, project_version, voter_id)
  DO UPDATE SET line_votes = EXCLUDED.line_votes, overall_note = EXCLUDED.overall_note, updated_at = now();

  SELECT count(*) INTO n_votes FROM public.f2_votes WHERE project_id = p.id AND project_version = ver;
  IF n_votes < q THEN
    RETURN jsonb_build_object('finalized', false, 'votes_count', n_votes, 'quorum', q);
  END IF;

  -- Quorum reached: tally each line.
  WITH lv AS (
    SELECT l.ord, l.v AS line, bv->>'verdict' AS verdict, bv->>'note' AS note, u.display_name
    FROM jsonb_array_elements(lines) WITH ORDINALITY l(v, ord)
    JOIN public.f2_votes b ON b.project_id = p.id AND b.project_version = ver
    JOIN public.users u ON u.id = b.voter_id
    CROSS JOIN LATERAL jsonb_array_elements(b.line_votes) bv
    WHERE bv->>'key' = l.v->>'key'
  ), t AS (
    SELECT ord, line,
           count(*) FILTER (WHERE verdict = 'approve')     AS a,
           count(*) FILTER (WHERE verdict = 'conditional') AS c,
           count(*) FILTER (WHERE verdict = 'reject')      AS r,
           count(*) AS n,
           coalesce(jsonb_agg(jsonb_build_object('by', display_name, 'verdict', verdict, 'note', note))
                    FILTER (WHERE note IS NOT NULL), '[]'::jsonb) AS notes
    FROM lv GROUP BY ord, line
  )
  SELECT jsonb_agg(jsonb_build_object(
           'key', line->>'key', 'line_no', ord,
           'outcome', CASE WHEN a * 2 > n THEN 'approve' WHEN r * 2 > n THEN 'reject' ELSE 'conditional' END,
           'approve', a, 'conditional', c, 'reject', r, 'notes', notes,
           'label', coalesce(line->>'location', line->>'description', ''),
           'total', line->'total') ORDER BY ord)
    INTO outcomes FROM t;

  SELECT count(*),
         count(*) FILTER (WHERE o->>'outcome' = 'approve'),
         count(*) FILTER (WHERE o->>'outcome' = 'reject')
    INTO n_lines, n_approve, n_reject
    FROM jsonb_array_elements(outcomes) o;

  v_outcome := CASE WHEN n_approve = n_lines THEN 'approved'
                    WHEN n_reject  = n_lines THEN 'rejected'
                    ELSE 'conditional' END;

  -- Text the room sees: every line that wasn't approved, with the reps' notes.
  SELECT string_agg(
           format('البند %s%s: %s%s', o->>'line_no',
                  CASE WHEN coalesce(o->>'label','') <> '' THEN ' (' || (o->>'label') || ')' ELSE '' END,
                  CASE o->>'outcome' WHEN 'reject' THEN 'مرفوض' WHEN 'conditional' THEN 'موافقة بشرط' ELSE 'موافق' END,
                  coalesce(' — ' || (SELECT string_agg(n->>'note', ' / ') FROM jsonb_array_elements(o->'notes') n), '')),
           E'\n' ORDER BY (o->>'line_no')::int)
    INTO v_summary
    FROM jsonb_array_elements(outcomes) o
   WHERE o->>'outcome' <> 'approve';

  SELECT concat_ws(E'\n', v_summary,
           (SELECT string_agg(u.display_name || ': ' || b.overall_note, E'\n')
              FROM public.f2_votes b JOIN public.users u ON u.id = b.voter_id
             WHERE b.project_id = p.id AND b.project_version = ver AND b.overall_note IS NOT NULL))
    INTO v_summary;
  v_summary := nullif(v_summary, '');

  IF v_outcome = 'approved' THEN
    UPDATE public.err_projects
       SET status = 'screened',   -- the portal does the final review, commits the funding and makes the MOU
           last_modified = now()
     WHERE id = p.id;
  ELSE
    SELECT coalesce(max(iteration_number), 0) + 1 INTO next_iter FROM public.project_feedback WHERE project_id = p.id;
    INSERT INTO public.project_feedback (project_id, feedback_text, feedback_status, created_by, iteration_number)
    VALUES (p.id,
            coalesce(v_summary, CASE v_outcome WHEN 'rejected' THEN 'رفضت لجنة الممثلين المشروع' ELSE 'مطلوب مراجعة' END),
            CASE v_outcome WHEN 'rejected' THEN 'resolved' ELSE 'pending_changes' END,
            me.user_id, next_iter)
    RETURNING id INTO fb_id;

    INSERT INTO public.project_feedback_fields (feedback_id, field_name, feedback_text)
    SELECT fb_id, o->>'key',
           (SELECT string_agg(n->>'note', ' / ') FROM jsonb_array_elements(o->'notes') n)
      FROM jsonb_array_elements(outcomes) o
     WHERE o->>'outcome' <> 'approve' AND jsonb_array_length(o->'notes') > 0;

    UPDATE public.err_projects
       SET status = CASE v_outcome WHEN 'rejected' THEN 'rejected' ELSE 'feedback' END,
           current_feedback_id = fb_id,
           last_modified = now()
     WHERE id = p.id;
  END IF;

  INSERT INTO public.f2_decisions (project_id, project_version, outcome, line_outcomes, summary, quorum, voter_ids, feedback_id)
  VALUES (p.id, ver, v_outcome, outcomes, v_summary, q,
          (SELECT array_agg(voter_id) FROM public.f2_votes WHERE project_id = p.id AND project_version = ver),
          fb_id);

  RETURN jsonb_build_object('finalized', true, 'outcome', v_outcome, 'votes_count', n_votes, 'quorum', q);
END $$;

-- 7. Grants ---------------------------------------------------------
REVOKE ALL ON FUNCTION public.f2_me(), public.f2_project_state(public.err_projects),
  public.f2_can_view(public.err_projects), public.f2_lines(public.err_projects),
  public.f2_queue(), public.f2_project(uuid), public.f2_cast_vote(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.f2_queue(), public.f2_project(uuid),
  public.f2_cast_vote(uuid, jsonb, text) TO authenticated;
-- Supabase grants EXECUTE to authenticated by default; the helpers are internal only.
REVOKE ALL ON FUNCTION public.f2_me(), public.f2_project_state(public.err_projects),
  public.f2_can_view(public.err_projects), public.f2_lines(public.err_projects) FROM authenticated;

-- 8. Funding pool: a screened F-1 still holds its allocation as "pending" until the portal commits it.
--    (Patches the function from 20261001120000_funding_pool_totals.sql / 20261001130000_project_currency.sql.)
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.funding_pool_totals(uuid[])') IS NOT NULL THEN
    d := pg_get_functiondef('public.funding_pool_totals(uuid[])'::regprocedure);
    IF position('''screened''' in d) = 0 THEN
      d := replace(d, $q$AND p.status = 'pending'$q$, $q$AND p.status IN ('pending', 'screened')$q$);
      EXECUTE d;
    END IF;
  END IF;
END $$;
