-- Locality acknowledgement of an F1 ("تم الاطلاع") (Yung, 20 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- The base ERR sends the F1; the locality sees it and acknowledges it. The acknowledgement does NOT
-- block anything: the F1 reaches the state and the reps' F2 either way. Everyone who can see the F1
-- (the room, its locality and state, reps, working groups, admins) sees whether and when the locality
-- acknowledged it.
--
--   locality_ack(project)      a locality user of the F1's own locality acknowledges it (once per F1)
--   locality_acks(projects[])  the acknowledgements of the given F1s the caller may see
-- ------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.f1_locality_acks (
  project_id       uuid PRIMARY KEY REFERENCES public.err_projects(id) ON DELETE CASCADE,
  acknowledged_by  uuid NOT NULL REFERENCES public.users(id),
  acknowledged_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.f1_locality_acks ENABLE ROW LEVEL SECURITY;   -- no rules: only the functions below read or write it

CREATE OR REPLACE FUNCTION public.locality_ack(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  me   record;
  p    public.err_projects;
  room text;
  done public.f1_locality_acks;
BEGIN
  SELECT * INTO me FROM public.local_me();
  IF me.role IS DISTINCT FROM 'locality_err' THEN
    RAISE EXCEPTION 'only_locality_acknowledges' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.err_projects WHERE id = p_project_id;
  room := coalesce(p.emergency_room_id::text, p.err_id);
  IF p.id IS NULL OR coalesce(p.is_draft, false)
     OR public.local_room_locality(room) IS DISTINCT FROM public.local_room_locality(me.room_id::text) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.f1_locality_acks (project_id, acknowledged_by)
  VALUES (p.id, auth.uid())
  ON CONFLICT (project_id) DO NOTHING;

  SELECT * INTO done FROM public.f1_locality_acks WHERE project_id = p.id;
  RETURN jsonb_build_object('project_id', done.project_id, 'acknowledged_at', done.acknowledged_at,
                            'acknowledged_by_name', (SELECT display_name FROM public.users WHERE id = done.acknowledged_by));
END $function$;

CREATE OR REPLACE FUNCTION public.locality_acks(p_project_ids uuid[])
RETURNS TABLE(project_id uuid, acknowledged_at timestamptz, acknowledged_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT a.project_id, a.acknowledged_at, u.display_name
  FROM public.f1_locality_acks a
  JOIN public.err_projects p ON p.id = a.project_id
  LEFT JOIN public.users u ON u.id = a.acknowledged_by
  WHERE a.project_id = ANY (p_project_ids)
    AND (public.local_can_access_project(p.id, false) OR public.f2_can_view(p) OR public.wg_can_follow(p))
$function$;

REVOKE ALL ON FUNCTION public.locality_ack(uuid), public.locality_acks(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locality_ack(uuid), public.locality_acks(uuid[]) TO authenticated;
