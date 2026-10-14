-- Working-group feedback with the confirmation (Yung, 14 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- A working group confirms a screened project and can add a note (feedback) with it. The project
-- still goes on to the intermediate partner; the note travels with it:
--   * the partner reads it in portal_screened_f1(...) -> payload.lcc.note (already there)
--   * the room reads it on its project-status page through wg_room_confirmations(ids) below
-- Notes are stored in lcc_reviews.note (wg_lcc_decide's p_note).
-- ------------------------------------------------------------------------------------------------

-- Working-group confirmations (with their notes) for projects the caller may see in the app
-- (own room / own state / admin's states — the same rule as the rest of the app, local_can_access_project).
CREATE OR REPLACE FUNCTION public.wg_room_confirmations(p_project_ids uuid[])
RETURNS TABLE(project_id uuid, decided_at timestamptz, note text, decided_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.project_id, r.decided_at, r.note, u.display_name
  FROM public.lcc_reviews r
  JOIN public.err_projects p ON p.id = r.project_id AND r.project_version = coalesce(p.version, 1)
  LEFT JOIN public.users u ON u.id = r.decided_by
  WHERE r.project_id = ANY (p_project_ids)
    AND r.decision = 'approved'
    AND public.local_can_access_project(r.project_id, false)
$$;

REVOKE ALL ON FUNCTION public.wg_room_confirmations(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wg_room_confirmations(uuid[]) TO authenticated;
