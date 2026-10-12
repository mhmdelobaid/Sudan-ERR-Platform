-- LCC working groups: project-based access, LCC-level approval, report comments, and the portal feed
-- ------------------------------------------------------------------------------------------------
-- Flow (Yung, 3 Oct 2026):
--   F-1 -> F-2 (3 reps, majority)  -> status 'screened'
--       -> LCC level: the project's PROGRAM working group approves (other working groups on the
--          project follow along: they can see it and comment, but don't decide)
--       -> partner portal: final review; the Partner team makes the MOU (F-3)
--
-- Adds:
--   * role 'lcc_wg' on users (national / LCC working-group members)
--   * working_groups, working_group_members        who is in which group
--   * project_working_groups                        groups running each project, one marked program lead
--                                                   (assigned per project by an admin)
--   * lcc_reviews                                   the program group's decision per project version
--   * project_comments                              notes on F-1/F-2/LCC/F-4/F-5 from working groups and admins
--   * RPCs for the working-group screen (wg_*), the admin screen (wga_*), and the portal (portal_*)
--
-- All tables have RLS on with no policies: everything goes through SECURITY DEFINER functions that
-- check the caller themselves, so this works the same on staging and live.
-- LCC approval does not change the project status (it stays 'screened'); the portal reads the
-- LCC decision from the feed and moves the project on.
-- ------------------------------------------------------------------------------------------------

-- 1. Role ----------------------------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'support','admin','superadmin','state_err','base_err','partner','state_rep','lcc_wg'
]));

-- 2. Tables --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.working_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en     text NOT NULL,
  name_ar     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.working_group_members (
  working_group_id uuid NOT NULL REFERENCES public.working_groups(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_lead          boolean NOT NULL DEFAULT false,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by         uuid REFERENCES public.users(id),
  PRIMARY KEY (working_group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.project_working_groups (
  project_id       uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  working_group_id uuid NOT NULL REFERENCES public.working_groups(id) ON DELETE CASCADE,
  is_program_lead  boolean NOT NULL DEFAULT false,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid REFERENCES public.users(id),
  PRIMARY KEY (project_id, working_group_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_working_groups_one_lead
  ON public.project_working_groups (project_id) WHERE is_program_lead;
CREATE INDEX IF NOT EXISTS project_working_groups_wg_idx ON public.project_working_groups (working_group_id);

CREATE TABLE IF NOT EXISTS public.lcc_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  project_version  integer NOT NULL DEFAULT 1,
  working_group_id uuid REFERENCES public.working_groups(id),
  decision         text NOT NULL CHECK (decision IN ('approved','returned')),
  note             text,
  decided_by       uuid REFERENCES public.users(id),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  feedback_id      uuid REFERENCES public.project_feedback(id),
  UNIQUE (project_id, project_version)
);

CREATE TABLE IF NOT EXISTS public.project_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES public.users(id),
  topic       text NOT NULL DEFAULT 'general' CHECK (topic IN ('f1','f2','lcc','f4','f5','general')),
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_comments_project_idx ON public.project_comments (project_id, created_at);

ALTER TABLE public.working_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.working_group_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_working_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lcc_reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_comments       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.working_groups, public.working_group_members, public.project_working_groups,
              public.lcc_reviews, public.project_comments FROM anon, authenticated;

-- 3. Helpers -------------------------------------------------------------------------------------
-- Is the caller an active admin / superadmin who may see this project's state? (reuses F-2 scoping)
CREATE OR REPLACE FUNCTION public.wg_admin_can_view(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT me.role IN ('admin','superadmin') AND public.f2_can_view(p) FROM public.f2_me() me), false)
$$;

-- Is the caller an active lcc_wg member of a group assigned to this project? (program_only: the lead group)
CREATE OR REPLACE FUNCTION public.wg_member_of_project(p_project_id uuid, p_program_only boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.f2_me() me
    JOIN public.working_group_members m ON m.user_id = me.user_id
    JOIN public.working_groups g ON g.id = m.working_group_id AND g.is_active
    JOIN public.project_working_groups pwg ON pwg.working_group_id = m.working_group_id
    WHERE me.role = 'lcc_wg' AND pwg.project_id = p_project_id
      AND (NOT p_program_only OR pwg.is_program_lead))
$$;

-- Latest LCC review for the project's current version
CREATE OR REPLACE FUNCTION public.wg_current_lcc(p public.err_projects)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(r) || jsonb_build_object(
           'decided_by_name', (SELECT display_name FROM public.users WHERE id = r.decided_by),
           'working_group_name_en', (SELECT name_en FROM public.working_groups WHERE id = r.working_group_id),
           'working_group_name_ar', (SELECT name_ar FROM public.working_groups WHERE id = r.working_group_id))
  FROM public.lcc_reviews r
  WHERE r.project_id = p.id AND r.project_version = coalesce(p.version, 1)
$$;

-- LCC status for one project: no_working_group | waiting | approved | returned
CREATE OR REPLACE FUNCTION public.wg_lcc_status(p public.err_projects)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.project_working_groups WHERE project_id = p.id AND is_program_lead)
      THEN 'no_working_group'
    ELSE coalesce((SELECT decision FROM public.lcc_reviews
                   WHERE project_id = p.id AND project_version = coalesce(p.version, 1)), 'waiting')
  END
$$;

-- Working groups on a project
CREATE OR REPLACE FUNCTION public.wg_project_groups(p_project_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar, 'is_program_lead', pwg.is_program_lead)
         ORDER BY pwg.is_program_lead DESC, g.name_en), '[]'::jsonb)
  FROM public.project_working_groups pwg JOIN public.working_groups g ON g.id = pwg.working_group_id
  WHERE pwg.project_id = p_project_id
$$;

-- F-2 decision + every rep's ballot for the project's latest decision
CREATE OR REPLACE FUNCTION public.wg_f2_record(p public.err_projects)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (to_jsonb(d) - 'voter_ids') || jsonb_build_object('ballots', coalesce((
           SELECT jsonb_agg(jsonb_build_object('voter_name', u.display_name, 'line_votes', v.line_votes,
                                               'overall_note', v.overall_note, 'voted_at', v.updated_at)
                            ORDER BY v.created_at)
           FROM public.f2_votes v JOIN public.users u ON u.id = v.voter_id
           WHERE v.project_id = d.project_id AND v.project_version = d.project_version), '[]'::jsonb))
  FROM public.f2_decisions d
  WHERE d.project_id = p.id
  ORDER BY d.decided_at DESC LIMIT 1
$$;

-- Project summary used by every screen
CREATE OR REPLACE FUNCTION public.wg_project_core(p public.err_projects)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'project_name', p.project_name, 'state', public.f2_project_state(p), 'locality', p.locality,
    'status', p.status, 'funding_status', p.funding_status, 'version', coalesce(p.version, 1),
    'currency', p.currency, 'submitted_at', p.submitted_at, 'project_objectives', p.project_objectives,
    'intended_beneficiaries', p.intended_beneficiaries, 'estimated_beneficiaries', p.estimated_beneficiaries,
    'estimated_timeframe', p.estimated_timeframe, 'program_officer_name', p.program_officer_name,
    'finance_officer_name', p.finance_officer_name, 'reporting_officer_name', p.reporting_officer_name,
    'room_name', er.name, 'room_name_ar', er.name_ar, 'room_code', er.err_code,
    'total_budget', coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0))
  FROM (SELECT 1) x LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
$$;

-- 4. Working-group screen ------------------------------------------------------------------------
-- Projects run by the caller's working groups (lcc_wg). Superadmins see every assigned project.
CREATE OR REPLACE FUNCTION public.wg_projects()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'needs_my_decision')::boolean DESC, row->>'submitted_at' DESC), '[]'::jsonb)
  FROM (
    SELECT public.wg_project_core(p) || jsonb_build_object(
             'groups', public.wg_project_groups(p.id),
             'i_am_program', public.wg_member_of_project(p.id, true),
             'lcc_status', public.wg_lcc_status(p),
             'needs_my_decision', p.status = 'screened' AND public.wg_member_of_project(p.id, true)
                                  AND public.wg_lcc_status(p) = 'waiting',
             'f4_count', (SELECT count(*) FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false),
             'f5_count', (SELECT count(*) FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false),
             'comments_count', (SELECT count(*) FROM public.project_comments c WHERE c.project_id = p.id)) AS row
    FROM public.err_projects p
    WHERE coalesce(p.is_draft, false) = false
      AND EXISTS (SELECT 1 FROM public.project_working_groups pwg WHERE pwg.project_id = p.id)
      AND (public.wg_member_of_project(p.id, false)
           OR (SELECT role FROM public.f2_me()) = 'superadmin')
  ) t
$$;

-- One project with everything a working group follows: F-1 lines, F-2 record, LCC decision,
-- F-4 and F-5 reports, comments.
CREATE OR REPLACE FUNCTION public.wg_project(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.err_projects;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT (public.wg_member_of_project(p.id, false) OR public.wg_admin_can_view(p)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'project', public.wg_project_core(p),
    'lines', public.f2_lines(p),
    'groups', public.wg_project_groups(p.id),
    'f2', public.wg_f2_record(p),
    'lcc', public.wg_current_lcc(p),
    'lcc_status', public.wg_lcc_status(p),
    'can_decide', p.status = 'screened' AND public.wg_member_of_project(p.id, true) AND public.wg_lcc_status(p) = 'waiting',
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

-- LCC-level decision by the project's program working group: approve, or return to the room with a note.
CREATE OR REPLACE FUNCTION public.wg_lcc_decide(p_project_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.err_projects; me record; wg uuid; ver int; fb_id uuid; next_iter int;
BEGIN
  SELECT * INTO me FROM public.f2_me();
  IF me.user_id IS NULL OR me.role <> 'lcc_wg' THEN
    RAISE EXCEPTION 'only_program_working_group_can_decide' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.wg_member_of_project(p.id, false) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.wg_member_of_project(p.id, true) THEN
    RAISE EXCEPTION 'only_program_working_group_can_decide' USING ERRCODE = '42501';
  END IF;
  IF p.status <> 'screened' THEN
    RAISE EXCEPTION 'project_not_screened' USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('approved', 'returned') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'returned' AND btrim(coalesce(p_note, '')) = '' THEN
    RAISE EXCEPTION 'note_required_to_return' USING ERRCODE = '22023';
  END IF;
  ver := coalesce(p.version, 1);
  IF EXISTS (SELECT 1 FROM public.lcc_reviews WHERE project_id = p.id AND project_version = ver) THEN
    RAISE EXCEPTION 'already_decided' USING ERRCODE = '22023';
  END IF;

  SELECT pwg.working_group_id INTO wg FROM public.project_working_groups pwg
   WHERE pwg.project_id = p.id AND pwg.is_program_lead;

  IF p_decision = 'returned' THEN
    SELECT coalesce(max(iteration_number), 0) + 1 INTO next_iter FROM public.project_feedback WHERE project_id = p.id;
    INSERT INTO public.project_feedback (project_id, feedback_text, feedback_status, created_by, iteration_number)
    VALUES (p.id, 'مجموعة العمل (LCC): ' || btrim(p_note), 'pending_changes', me.user_id, next_iter)
    RETURNING id INTO fb_id;
    UPDATE public.err_projects SET status = 'feedback', current_feedback_id = fb_id, last_modified = now() WHERE id = p.id;
  END IF;

  INSERT INTO public.lcc_reviews (project_id, project_version, working_group_id, decision, note, decided_by, feedback_id)
  VALUES (p.id, ver, wg, p_decision, nullif(btrim(coalesce(p_note, '')), ''), me.user_id, fb_id);

  RETURN jsonb_build_object('decision', p_decision, 'status', CASE WHEN p_decision = 'returned' THEN 'feedback' ELSE p.status END);
END $$;

-- Comment on a project (working groups on the project, and admins who can see it)
CREATE OR REPLACE FUNCTION public.wg_add_comment(p_project_id uuid, p_topic text, p_body text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.err_projects; c public.project_comments;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT (public.wg_member_of_project(p.id, false) OR public.wg_admin_can_view(p)) THEN
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

-- 5. Admin screen (admin / superadmin) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wga_require_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me record;
BEGIN
  SELECT * INTO me FROM public.f2_me();
  IF me.user_id IS NULL OR me.role NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'admins_only' USING ERRCODE = '42501';
  END IF;
  RETURN me.user_id;
END $$;

-- Groups with their members and how many projects each runs
CREATE OR REPLACE FUNCTION public.wga_groups()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.wga_require_admin();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar, 'is_active', g.is_active,
      'projects', (SELECT count(*) FROM public.project_working_groups pwg WHERE pwg.working_group_id = g.id),
      'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'user_id', u.id, 'display_name', u.display_name, 'email', au.email, 'is_lead', m.is_lead,
                     'role', u.role, 'status', u.status) ORDER BY m.is_lead DESC, u.display_name)
                   FROM public.working_group_members m
                   JOIN public.users u ON u.id = m.user_id
                   LEFT JOIN auth.users au ON au.id = u.id
                   WHERE m.working_group_id = g.id), '[]'::jsonb))
    ORDER BY g.name_en) FROM public.working_groups g), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.wga_create_group(p_name_en text, p_name_ar text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.wga_require_admin(); gid uuid;
BEGIN
  IF btrim(coalesce(p_name_en, '')) = '' AND btrim(coalesce(p_name_ar, '')) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.working_groups (name_en, name_ar, created_by)
  VALUES (coalesce(nullif(btrim(p_name_en), ''), btrim(p_name_ar)), nullif(btrim(coalesce(p_name_ar, '')), ''), uid)
  RETURNING id INTO gid;
  RETURN gid;
END $$;

-- Add a member by email. The account must already exist with the lcc_wg role (set by a superadmin).
CREATE OR REPLACE FUNCTION public.wga_add_member(p_group_id uuid, p_email text, p_is_lead boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.wga_require_admin(); target record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.working_groups WHERE id = p_group_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT u.id, u.role, u.status INTO target
  FROM auth.users au JOIN public.users u ON u.id = au.id
  WHERE lower(au.email) = lower(btrim(p_email));
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target.role <> 'lcc_wg' THEN
    RAISE EXCEPTION 'user_not_lcc_wg' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.working_group_members (working_group_id, user_id, is_lead, added_by)
  VALUES (p_group_id, target.id, coalesce(p_is_lead, false), uid)
  ON CONFLICT (working_group_id, user_id) DO UPDATE SET is_lead = EXCLUDED.is_lead;
  RETURN jsonb_build_object('user_id', target.id);
END $$;

CREATE OR REPLACE FUNCTION public.wga_remove_member(p_group_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.wga_require_admin();
  DELETE FROM public.working_group_members WHERE working_group_id = p_group_id AND user_id = p_user_id;
END $$;

-- Projects the admin may assign (their states; superadmin: all), newest first, optional search
CREATE OR REPLACE FUNCTION public.wga_projects(p_search text DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.wga_require_admin();
  RETURN coalesce((SELECT jsonb_agg(row ORDER BY row->>'submitted_at' DESC NULLS LAST) FROM (
    SELECT public.wg_project_core(p) || jsonb_build_object(
             'groups', public.wg_project_groups(p.id), 'lcc_status', public.wg_lcc_status(p)) AS row
    FROM public.err_projects p
    LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
    WHERE coalesce(p.is_draft, false) = false
      AND public.f2_can_view(p)
      AND (p_status IS NULL OR p.status = p_status)
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR p.project_name ILIKE '%' || btrim(p_search) || '%'
           OR er.name ILIKE '%' || btrim(p_search) || '%' OR er.name_ar ILIKE '%' || btrim(p_search) || '%'
           OR p.locality ILIKE '%' || btrim(p_search) || '%')
    ORDER BY p.submitted_at DESC NULLS LAST
    LIMIT 200) t), '[]'::jsonb);
END $$;

-- Set the working groups running a project (replaces the current set). The program lead must be one of them.
CREATE OR REPLACE FUNCTION public.wga_set_project_groups(p_project_id uuid, p_group_ids uuid[], p_program_lead uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := public.wga_require_admin(); p public.err_projects;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT public.f2_can_view(p) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  p_group_ids := coalesce(p_group_ids, '{}');
  IF array_length(p_group_ids, 1) IS NOT NULL AND (p_program_lead IS NULL OR NOT (p_program_lead = ANY (p_group_ids))) THEN
    RAISE EXCEPTION 'program_lead_required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_group_ids) gid WHERE NOT EXISTS (SELECT 1 FROM public.working_groups g WHERE g.id = gid)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.project_working_groups WHERE project_id = p.id AND NOT (working_group_id = ANY (p_group_ids));
  INSERT INTO public.project_working_groups (project_id, working_group_id, is_program_lead, assigned_by)
  SELECT p.id, gid, false, uid FROM unnest(p_group_ids) gid
  ON CONFLICT (project_id, working_group_id) DO NOTHING;
  UPDATE public.project_working_groups SET is_program_lead = false WHERE project_id = p.id AND is_program_lead;
  IF p_program_lead IS NOT NULL THEN
    UPDATE public.project_working_groups SET is_program_lead = true WHERE project_id = p.id AND working_group_id = p_program_lead;
  END IF;
  RETURN public.wg_project_groups(p.id);
END $$;

-- 6. Portal feed -----------------------------------------------------------------------------------
-- One row per screened F-1 with its F-2 record and LCC status, for the partner portal's final review.
CREATE OR REPLACE FUNCTION public.portal_f1_payload(p public.err_projects)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.wg_project_core(p) || jsonb_build_object(
    'lines', public.f2_lines(p),
    'f2', public.wg_f2_record(p),
    'groups', public.wg_project_groups(p.id),
    'lcc_status', public.wg_lcc_status(p),
    'lcc', public.wg_current_lcc(p),
    'emergency_room_id', p.emergency_room_id,
    'funding_cycle_id', p.funding_cycle_id,
    'cycle_state_allocation_id', p.cycle_state_allocation_id)
$$;

-- For the portal's server (service role): SELECT * FROM portal_f1_screened [WHERE lcc_status = 'approved']
CREATE OR REPLACE VIEW public.portal_f1_screened AS
  SELECT p.id AS project_id, public.wg_lcc_status(p) AS lcc_status, p.last_modified, public.portal_f1_payload(p) AS payload
  FROM public.err_projects p
  WHERE p.status = 'screened' AND coalesce(p.is_draft, false) = false;
REVOKE ALL ON public.portal_f1_screened FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.portal_f1_screened TO service_role;

-- For signed-in portal users (partner / admin / superadmin / support)
CREATE OR REPLACE FUNCTION public.portal_screened_f1(p_lcc_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text;
BEGIN
  SELECT role INTO r FROM public.users WHERE id = auth.uid() AND status = 'active';
  IF r IS NULL OR r NOT IN ('partner','admin','superadmin','support') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(v.payload ORDER BY v.last_modified)
                   FROM public.portal_f1_screened v
                   WHERE p_lcc_status IS NULL OR v.lcc_status = p_lcc_status), '[]'::jsonb);
END $$;

-- 7. Grants ----------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.wg_admin_can_view(public.err_projects), public.wg_member_of_project(uuid, boolean),
  public.wg_current_lcc(public.err_projects), public.wg_lcc_status(public.err_projects),
  public.wg_project_groups(uuid), public.wg_f2_record(public.err_projects), public.wg_project_core(public.err_projects),
  public.wga_require_admin(), public.portal_f1_payload(public.err_projects),
  public.wg_projects(), public.wg_project(uuid), public.wg_lcc_decide(uuid, text, text), public.wg_add_comment(uuid, text, text),
  public.wga_groups(), public.wga_create_group(text, text), public.wga_add_member(uuid, text, boolean),
  public.wga_remove_member(uuid, uuid), public.wga_projects(text, text), public.wga_set_project_groups(uuid, uuid[], uuid),
  public.portal_screened_f1(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.wg_projects(), public.wg_project(uuid), public.wg_lcc_decide(uuid, text, text), public.wg_add_comment(uuid, text, text),
  public.wga_groups(), public.wga_create_group(text, text), public.wga_add_member(uuid, text, boolean),
  public.wga_remove_member(uuid, uuid), public.wga_projects(text, text), public.wga_set_project_groups(uuid, uuid[], uuid),
  public.portal_screened_f1(text)
TO authenticated;
