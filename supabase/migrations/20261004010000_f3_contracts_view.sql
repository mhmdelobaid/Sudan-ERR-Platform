-- F-3 (contract / MOU), read-only for the app.
-- The MOU is made in the partner portal by the Partner team. Rooms only need to see it here:
-- code, partner, amount, dates, transfer, and whether a signed copy exists (in the portal).
-- mous has no read rules for app users, so this goes through one SECURITY DEFINER function
-- that checks the caller's scope itself:
--   base_err   their own room's projects
--   state_err  their room, plus every room in their state
--   admin / superadmin / support   their visible states (all if can_see_all_states / superadmin)
-- Listed: projects with an MOU, plus screened / approved ones still waiting for it (so a room can
-- follow F-3 progress). Nothing is written.

CREATE OR REPLACE FUNCTION public.f3_can_view(p public.err_projects)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN me.role = 'base_err' THEN
        u.err_id IS NOT NULL AND (coalesce(p.emergency_room_id::text, p.err_id) = u.err_id::text OR p.created_by = u.err_id::text)
      WHEN me.role = 'state_err' THEN
        (u.err_id IS NOT NULL AND coalesce(p.emergency_room_id::text, p.err_id) = u.err_id::text)
        OR (me.state_name IS NOT NULL AND public.f2_project_state(p) = me.state_name)
      WHEN me.role IN ('admin','superadmin','support') THEN
        me.all_states OR public.f2_project_state(p) = ANY (me.states)
      ELSE false END
    FROM public.f2_me() me JOIN public.users u ON u.id = me.user_id), false)
$$;

CREATE OR REPLACE FUNCTION public.f3_my_contracts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'has_mou')::boolean DESC, row->>'start_date' DESC NULLS LAST, row->>'submitted_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name, 'project_objectives', p.project_objectives,
      'state', public.f2_project_state(p), 'locality', p.locality, 'status', p.status,
      'submitted_at', p.submitted_at, 'currency', p.currency,
      'room_name', er.name, 'room_name_ar', er.name_ar,
      'total_budget', coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
      'has_mou', m.id IS NOT NULL,
      'mou_code', m.mou_code, 'partner_name', m.partner_name, 'total_amount', m.total_amount,
      'start_date', m.start_date, 'end_date', m.end_date,
      'transfer_date', coalesce(m.transfer_date, p.date_transfer), 'exchange_rate', m.exchange_rate,
      'has_signed_copy', m.signed_mou_file_key IS NOT NULL,
      'grant_serial', p.grant_serial) AS row
    FROM public.err_projects p
    LEFT JOIN public.mous m ON m.id = p.mou_id
    LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
    WHERE coalesce(p.is_draft, false) = false
      AND (p.mou_id IS NOT NULL OR p.status IN ('screened', 'approved'))
      AND public.f3_can_view(p)
  ) t
$$;

REVOKE ALL ON FUNCTION public.f3_can_view(public.err_projects), public.f3_my_contracts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f3_my_contracts() TO authenticated;
