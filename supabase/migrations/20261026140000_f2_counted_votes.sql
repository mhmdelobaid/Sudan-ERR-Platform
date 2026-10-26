-- F-2: only count votes from reps who may still vote on the F-1 (26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Before: every ballot for the F-1's version counted toward the 3 votes, even when the rep had since
-- moved to the F-1's own locality, moved to another state, stopped being a rep or was deactivated.
--
-- Now a ballot counts only while its rep:
--   - is an active state_rep,
--   - is in the F-1's state, and
--   - is not in the F-1's own locality.
-- Ballots that don't count stay in the table (nothing is deleted). The rep screen shows them as
-- "not counted". Decisions already made are not changed.
--
-- Also: f2_quorum gets a fixed search_path (Supabase security check "function_search_path_mutable").
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.f2_quorum()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 3 $$;

-- Does this rep's ballot count for this F-1 right now?
CREATE OR REPLACE FUNCTION public.f2_vote_counts(p_voter uuid, p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT u.role = 'state_rep' AND u.status = 'active'
       AND s.state_name IS NOT NULL AND s.state_name = public.f2_project_state(p)
       AND NOT (s.id IS NOT NULL
                AND s.id = public.local_room_locality(coalesce(p.emergency_room_id::text, p.err_id)))
    FROM public.users u
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference
    WHERE u.id = p_voter), false)
$$;
REVOKE ALL ON FUNCTION public.f2_vote_counts(uuid, public.err_projects) FROM PUBLIC, anon, authenticated;

-- Cast a vote: same as before, but the count, the tally, the notes and the voter list use counted ballots only
CREATE OR REPLACE FUNCTION public.f2_cast_vote(p_project_id uuid, p_line_votes jsonb, p_overall_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.f2_can_view(p) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.f2_is_own_locality(p) THEN
    RAISE EXCEPTION 'own_locality' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p.is_draft, false) OR p.status <> 'pending' THEN
    RAISE EXCEPTION 'project_not_pending' USING ERRCODE = '22023';
  END IF;
  ver := coalesce(p.version, 1);

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

  SELECT count(*) INTO n_votes FROM public.f2_votes
   WHERE project_id = p.id AND project_version = ver AND public.f2_vote_counts(voter_id, p);
  IF n_votes < q THEN
    RETURN jsonb_build_object('finalized', false, 'votes_count', n_votes, 'quorum', q);
  END IF;

  WITH lv AS (
    SELECT l.ord, l.v AS line, bv->>'verdict' AS verdict, bv->>'note' AS note, u.display_name
    FROM jsonb_array_elements(lines) WITH ORDINALITY l(v, ord)
    JOIN public.f2_votes b ON b.project_id = p.id AND b.project_version = ver AND public.f2_vote_counts(b.voter_id, p)
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
             WHERE b.project_id = p.id AND b.project_version = ver AND b.overall_note IS NOT NULL
               AND public.f2_vote_counts(b.voter_id, p)))
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
          (SELECT array_agg(voter_id) FROM public.f2_votes
            WHERE project_id = p.id AND project_version = ver AND public.f2_vote_counts(voter_id, p)),
          fb_id);

  RETURN jsonb_build_object('finalized', true, 'outcome', v_outcome, 'votes_count', n_votes, 'quorum', q);
END $function$;

-- Queue: votes_count = counted ballots
CREATE OR REPLACE FUNCTION public.f2_queue()
RETURNS TABLE(id uuid, project_name text, state text, locality text, room_name text, room_name_ar text,
              submitted_at timestamp without time zone, version integer, status text, currency text,
              total_budget numeric, estimated_beneficiaries integer, votes_count integer, quorum integer,
              i_voted boolean, decision_outcome text, decided_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
         d.outcome, d.decided_at
  FROM public.err_projects p
  LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
  LEFT JOIN LATERAL (SELECT outcome, decided_at FROM public.f2_decisions d
                     WHERE d.project_id = p.id ORDER BY decided_at DESC LIMIT 1) d ON true
  WHERE coalesce(p.is_draft, false) = false
    AND public.f2_can_view(p)
    AND (p.status = 'pending' OR d.outcome IS NOT NULL)
  ORDER BY (p.status = 'pending') DESC, p.submitted_at ASC NULLS LAST
$function$;

-- Detail: every ballot, each marked counts true/false, plus votes_count (counted only)
CREATE OR REPLACE FUNCTION public.f2_project(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
