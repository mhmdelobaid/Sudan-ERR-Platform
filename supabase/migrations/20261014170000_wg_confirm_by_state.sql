-- Working groups confirm screened F-1s before they go to the intermediate partner (Yung, 14 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Flow: base room -> F-1 -> F-2 at locality / state (reps) -> working groups -> intermediate partner.
-- Working groups do NOT screen (no F-2). They see the F-2 result and confirm they have seen it and
-- are OK with it. One confirmation by any working-group member (lcc_wg) is enough; there are no
-- groups or assignments to set up. Only confirmed projects are ready for the partner
-- (portal_screened_f1('approved')).
-- The confirmation is stored in lcc_reviews (decision 'approved', working_group_id empty).
-- ------------------------------------------------------------------------------------------------

-- Status of the working-group step for one project:
--   approved   = confirmed by a working-group member (current version)
--   waiting    = passed F-2 (screened) and not confirmed yet
--   not_needed = any other status (older projects, or not at that stage)
CREATE OR REPLACE FUNCTION public.wg_lcc_status(p public.err_projects)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT decision FROM public.lcc_reviews WHERE project_id = p.id AND project_version = coalesce(p.version, 1)),
    CASE WHEN p.status = 'screened' THEN 'waiting' ELSE 'not_needed' END)
$$;

-- Can the caller confirm this project now?
CREATE OR REPLACE FUNCTION public.wg_can_confirm(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT me.role = 'lcc_wg' FROM public.f2_me() me), false)
     AND p.status = 'screened'
     AND coalesce(p.is_draft, false) = false
     AND public.wg_lcc_status(p) = 'waiting'
$$;

-- List for the working-group screen (the page groups it by state)
CREATE OR REPLACE FUNCTION public.wg_projects()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'state', (row->>'needs_my_decision')::boolean DESC, row->>'submitted_at' DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT public.wg_project_core(p) || jsonb_build_object(
             'state_ar', (SELECT s.state_name_ar FROM public.states s WHERE s.state_name = public.f2_project_state(p) LIMIT 1),
             'groups', '[]'::jsonb,
             'i_am_program', false,
             'lcc_status', public.wg_lcc_status(p),
             'lcc', public.wg_current_lcc(p),
             'needs_my_decision', public.wg_can_confirm(p),
             'f2_outcome', (SELECT d.outcome FROM public.f2_decisions d WHERE d.project_id = p.id ORDER BY d.decided_at DESC LIMIT 1),
             'f4_count', (SELECT count(*) FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false),
             'f5_count', (SELECT count(*) FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false),
             'comments_count', (SELECT count(*) FROM public.project_comments c WHERE c.project_id = p.id)) AS row
    FROM public.err_projects p
    WHERE public.wg_can_follow(p)
  ) t
$$;

-- One project
CREATE OR REPLACE FUNCTION public.wg_project(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.err_projects;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT (public.wg_can_follow(p) OR public.wg_admin_can_view(p)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'project', public.wg_project_core(p),
    'lines', public.f2_lines(p),
    'groups', '[]'::jsonb,
    'f2', public.wg_f2_record(p),
    'lcc', public.wg_current_lcc(p),
    'lcc_status', public.wg_lcc_status(p),
    'can_decide', public.wg_can_confirm(p),
    'f4', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', s.id, 'report_date', s.report_date, 'total_grant', s.total_grant, 'total_expenses', s.total_expenses,
              'remainder', s.remainder, 'review_status', s.review_status, 'lessons', s.lessons,
              'expense_count', (SELECT count(*) FROM public.err_expense e WHERE e.summary_id = s.id AND coalesce(e.is_draft, false) = false))
            ORDER BY s.report_date DESC NULLS LAST)
            FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false), '[]'::jsonb),
    'f5', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', r.id, 'report_date', r.report_date, 'reporting_person', r.reporting_person,
              'positive_changes', r.positive_changes, 'negative_results', r.negative_results,
              'lessons_learned', r.lessons_learned, 'suggestions', r.suggestions,
              'reach', (SELECT jsonb_build_object(
                          'individuals', coalesce(sum(x.individual_count), 0), 'households', coalesce(sum(x.household_count), 0),
                          'male', coalesce(sum(x.male_count), 0), 'female', coalesce(sum(x.female_count), 0),
                          'under18_male', coalesce(sum(x.under18_male), 0), 'under18_female', coalesce(sum(x.under18_female), 0),
                          'disabilities', coalesce(sum(x.people_with_disabilities), 0), 'activities', count(*))
                        FROM public.err_program_reach x WHERE x.report_id = r.id AND coalesce(x.is_draft, false) = false))
            ORDER BY r.report_date DESC NULLS LAST)
            FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false), '[]'::jsonb),
    'comments', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', c.id, 'topic', c.topic, 'body', c.body, 'created_at', c.created_at,
              'author_name', u.display_name, 'is_me', c.author_id = auth.uid())
            ORDER BY c.created_at)
            FROM public.project_comments c JOIN public.users u ON u.id = c.author_id
            WHERE c.project_id = p.id), '[]'::jsonb)
  );
END $$;

-- Confirm: "we have seen the F-2 result and we are OK with it" -> ready for the intermediate partner.
-- Kept under its old name so the API stays the same; only 'approved' is accepted.
CREATE OR REPLACE FUNCTION public.wg_lcc_decide(p_project_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
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
  VALUES (p.id, coalesce(p.version, 1), NULL, 'approved', nullif(btrim(coalesce(p_note, '')), ''), me.user_id);

  RETURN jsonb_build_object('decision', 'approved', 'status', p.status);
END $$;

REVOKE ALL ON FUNCTION public.wg_can_confirm(public.err_projects) FROM PUBLIC, anon, authenticated;
