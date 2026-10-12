-- Working groups without project assignment; LCC approval step switched off (Yung, 12 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- "The assign is not needed for now, it's only one project" -> after F-2 a project goes straight
-- to the portal. Working-group members (lcc_wg) follow EVERY project that has passed F-2
-- (screened, approved, active, completed): F-1 lines, the reps' votes, F-4 / F-5, and comments.
-- Projects that were assigned to a member's group stay visible as before.
-- wg_lcc_decide is switched off (raises lcc_step_off). Tables and admin functions are unchanged,
-- so assignment and LCC approval can be switched back on later by restoring the previous bodies
-- (20261003200000_lcc_working_groups.sql).
-- ------------------------------------------------------------------------------------------------

-- Can the caller follow this project? lcc_wg / superadmin: any project past F-2; or a member of an assigned group.
CREATE OR REPLACE FUNCTION public.wg_can_follow(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(p.is_draft, false) = false
     AND (
       (coalesce((SELECT me.role IN ('lcc_wg', 'superadmin') FROM public.f2_me() me), false)
         AND p.status IN ('screened', 'approved', 'active', 'completed'))
       OR public.wg_member_of_project(p.id, false)
     )
$$;

-- List for the working-group screen
CREATE OR REPLACE FUNCTION public.wg_projects()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'submitted_at' DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT public.wg_project_core(p) || jsonb_build_object(
             'groups', public.wg_project_groups(p.id),
             'i_am_program', false,
             'lcc_status', public.wg_lcc_status(p),
             'needs_my_decision', false,
             'f4_count', (SELECT count(*) FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false),
             'f5_count', (SELECT count(*) FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false),
             'comments_count', (SELECT count(*) FROM public.project_comments c WHERE c.project_id = p.id)) AS row
    FROM public.err_projects p
    WHERE public.wg_can_follow(p)
  ) t
$$;

-- One project: F-1 lines, F-2 record, F-4, F-5, comments
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
    'groups', public.wg_project_groups(p.id),
    'f2', public.wg_f2_record(p),
    'lcc', public.wg_current_lcc(p),
    'lcc_status', public.wg_lcc_status(p),
    'can_decide', false,
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

-- Comments: anyone who can follow the project, and admins who can see it
CREATE OR REPLACE FUNCTION public.wg_add_comment(p_project_id uuid, p_topic text, p_body text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.err_projects; c public.project_comments;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT (public.wg_can_follow(p) OR public.wg_admin_can_view(p)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN
    RAISE EXCEPTION 'comment_empty' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.project_comments (project_id, author_id, topic, body)
  VALUES (p.id, auth.uid(), CASE WHEN p_topic IN ('f1','f2','lcc','f4','f5') THEN p_topic ELSE 'general' END, left(btrim(p_body), 4000))
  RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;

-- LCC approval switched off for now
CREATE OR REPLACE FUNCTION public.wg_lcc_decide(p_project_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'lcc_step_off' USING ERRCODE = '42501';
END $$;

REVOKE ALL ON FUNCTION public.wg_can_follow(public.err_projects) FROM PUBLIC, anon, authenticated;
