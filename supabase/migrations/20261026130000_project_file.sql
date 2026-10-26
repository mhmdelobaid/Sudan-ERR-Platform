-- Project file: F1 to F5 of one project, to view and print (Yung, 26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- One read-only record per project for the "ملف المشروع" page and its PDF button. Anyone who can
-- already see the project in the app gets it: its room and locality and state (local access), the
-- state reps of that state (F2), its working groups, admins, support, and the F3 viewers.
--
-- Left out on purpose (decided 26 Oct): bank details and phone numbers, in every step.
--   project_file(project_id)   jsonb: project, lines (F1), f2, lcc, f3, f4 (with expenses), f5 (with reach)
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.project_file(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  p public.err_projects;
  v_local boolean;
BEGIN
  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  v_local := public.local_can_access_project(p.id, false);
  IF NOT (v_local
          OR (coalesce(p.is_draft, false) = false
              AND (public.f2_can_view(p) OR public.wg_can_follow(p) OR public.wg_admin_can_view(p) OR public.f3_can_view(p)))) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    -- F1 (no phones, no bank details)
    'project', public.wg_project_core(p) || jsonb_build_object(
        'date', p.date, 'is_draft', coalesce(p.is_draft, false),
        'additional_support', p.additional_support,
        'sector_primary', p."Sector_Primary", 'sector_secondary', p."Sector_Secondary",
        'grant_serial', p.grant_serial, 'locality_ar', (SELECT s.locality_ar FROM public.states s
                                                         JOIN public.emergency_rooms er ON er.state_reference = s.id
                                                        WHERE er.id = p.emergency_room_id),
        'state_ar', (SELECT s.state_name_ar FROM public.states s
                       JOIN public.emergency_rooms er ON er.state_reference = s.id WHERE er.id = p.emergency_room_id)),
    'lines', public.f2_lines(p),
    -- F2 screening decision and the reps' ballots
    'f2', public.wg_f2_record(p),
    -- Working-group acknowledgement
    'lcc', (SELECT jsonb_build_object('decision', l->>'decision', 'note', l->>'note', 'decided_at', l->>'decided_at',
                                      'decided_by_name', l->>'decided_by_name',
                                      'working_group_name_ar', l->>'working_group_name_ar',
                                      'working_group_name_en', l->>'working_group_name_en')
              FROM (SELECT public.wg_current_lcc(p) AS l) x WHERE x.l IS NOT NULL),
    'lcc_status', public.wg_lcc_status(p),
    -- F3 contract (no bank details or contacts)
    'f3', (SELECT jsonb_build_object('mou_code', m.mou_code, 'partner_name', m.partner_name, 'err_name', m.err_name,
                                     'total_amount', m.total_amount, 'start_date', m.start_date, 'end_date', m.end_date,
                                     'transfer_date', coalesce(m.transfer_date, p.date_transfer),
                                     'exchange_rate', m.exchange_rate, 'has_signed_copy', m.signed_mou_file_key IS NOT NULL)
             FROM public.mous m WHERE m.id = p.mou_id),
    -- F4 financial reports with their expenses
    'f4', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', s.id, 'report_date', s.report_date, 'total_grant', s.total_grant, 'total_expenses', s.total_expenses,
              'total_other_sources', s.total_other_sources, 'remainder', s.remainder, 'review_status', s.review_status,
              'excess_expenses', s.excess_expenses, 'surplus_use', s.surplus_use, 'lessons', s.lessons, 'training', s.training,
              'expenses', coalesce((SELECT jsonb_agg(jsonb_build_object(
                              'activity', e.expense_activity, 'description', e.expense_description, 'amount', e.expense_amount,
                              'payment_date', e.payment_date, 'payment_method', e.payment_method, 'receipt_no', e.receipt_no)
                            ORDER BY e.payment_date NULLS LAST, e.expense_id)
                            FROM public.err_expense e WHERE e.summary_id = s.id AND coalesce(e.is_draft, false) = false), '[]'::jsonb))
            ORDER BY s.report_date NULLS LAST)
            FROM public.err_summary s WHERE s.project_id = p.id AND coalesce(s.is_draft, false) = false), '[]'::jsonb),
    -- F5 programme reports with their activities and reach
    'f5', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', r.id, 'report_date', r.report_date, 'reporting_person', r.reporting_person,
              'positive_changes', r.positive_changes, 'negative_results', r.negative_results,
              'unexpected_results', r.unexpected_results, 'lessons_learned', r.lessons_learned, 'suggestions', r.suggestions,
              'reach', coalesce((SELECT jsonb_agg(jsonb_build_object(
                          'activity_name', x.activity_name, 'location', x.location, 'start_date', x.start_date, 'end_date', x.end_date,
                          'individuals', x.individual_count, 'households', x.household_count, 'male', x.male_count,
                          'female', x.female_count, 'under18_male', x.under18_male, 'under18_female', x.under18_female,
                          'disabilities', x.people_with_disabilities)
                        ORDER BY x.start_date NULLS LAST)
                        FROM public.err_program_reach x WHERE x.report_id = r.id AND coalesce(x.is_draft, false) = false), '[]'::jsonb))
            ORDER BY r.report_date NULLS LAST)
            FROM public.err_program_report r WHERE r.project_id = p.id AND coalesce(r.is_draft, false) = false), '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.project_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_file(uuid) TO authenticated;
