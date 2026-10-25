-- Guard F-1 and F-4 writes (security audit C1) (Yung, 26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- Before this, a room login could call the database directly (with the public key in the app) and
-- move its own F-1 to active, mark it funded, change its bank details after approval, mark its own
-- F-4 approved, or delete any of its projects and reports.
--
-- Now, for anyone signed in below admin (rooms, localities, states, reps, working groups, support):
--   F-1 (err_projects)
--     - a new F-1 can only be a draft or pending; funding and portal fields start empty
--     - an F-1 can be edited only while it is draft, pending or returned for changes (feedback)
--     - the only status moves are: draft → pending, feedback → pending, feedback → draft
--       (and saving without changing status)
--     - funding status, grant, MOU, transfer, approval file, F-4/F-5 status and feedback link can't be changed
--     - the version only goes up by one, when a returned F-1 is sent again
--     - only a draft can be marked as a draft (so a submitted F-1 can't be turned into one and deleted)
--     - bank details and budget are therefore frozen from the moment F-2 screening finishes
--   F-4 (err_summary)
--     - review fields (review_status, comment, reviewer, receipt check) can't be set or changed
--     - an approved F-4 can't be edited
--   Deleting: only drafts (F-1 and F-4). A submitted F-4 can't be turned back into a draft.
--
-- Not affected: admins and superadmins, the partner portal (service role), and the app's own checked
-- database functions (F-2 votes, working-group decisions), which run as the database owner.
-- ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_is_restricted()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  -- current_user is 'authenticated' or 'anon' for direct API calls; it is the owner inside the
  -- app's SECURITY DEFINER functions, and 'service_role' for the portal.
  SELECT current_user IN ('authenticated', 'anon')
     AND coalesce(public.local_my_role(), '') NOT IN ('admin', 'superadmin');
$function$;

CREATE OR REPLACE FUNCTION public.guard_err_projects()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.guard_is_restricted() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'pending') NOT IN ('draft', 'pending') THEN
      RAISE EXCEPTION 'status_not_allowed' USING ERRCODE = '42501', DETAIL = NEW.status;
    END IF;
    -- Fields only the portal, admins or the review steps fill in start empty
    NEW.funding_status       := 'unassigned';
    NEW.version              := 1;
    NEW.current_feedback_id  := NULL;
    NEW.grant_serial         := NULL;
    NEW.grant_serial_id      := NULL;
    NEW.grant_id             := NULL;
    NEW.grant_call_id        := NULL;
    NEW.grant_grid_id        := NULL;
    NEW.grant_segment        := NULL;
    NEW.workplan_number      := NULL;
    NEW.mou_id               := NULL;
    NEW.approval_file_key    := NULL;
    NEW.approval_uploaded_by := NULL;
    NEW.date_transfer        := NULL;
    NEW.date_report_completed := NULL;
    NEW.completed_at         := NULL;
    NEW.f4_status            := 'waiting';
    NEW.f5_status            := 'waiting';
    RETURN NEW;
  END IF;

  -- UPDATE
  IF coalesce(OLD.status, '') NOT IN ('draft', 'pending', 'feedback') THEN
    RAISE EXCEPTION 'project_locked' USING ERRCODE = '42501', DETAIL = OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'    AND NEW.status = 'pending')
    OR (OLD.status = 'feedback' AND NEW.status IN ('pending', 'draft'))
  ) THEN
    RAISE EXCEPTION 'status_change_not_allowed' USING ERRCODE = '42501', DETAIL = OLD.status || ' -> ' || coalesce(NEW.status, 'null');
  END IF;

  IF coalesce(NEW.is_draft, false) AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'is_draft';
  END IF;

  -- A returned F-1 sent again gets the next version; nothing else changes it
  IF NEW.version IS DISTINCT FROM OLD.version AND NOT (
       NEW.status = 'pending' AND OLD.status IN ('draft', 'feedback')
       AND OLD.current_feedback_id IS NOT NULL
       AND NEW.version = coalesce(OLD.version, 1) + 1
  ) THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'version';
  END IF;

  IF NEW.funding_status        IS DISTINCT FROM OLD.funding_status        THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'funding_status'; END IF;
  IF NEW.current_feedback_id   IS DISTINCT FROM OLD.current_feedback_id   THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'current_feedback_id'; END IF;
  IF NEW.created_by            IS DISTINCT FROM OLD.created_by            THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'created_by'; END IF;
  IF NEW.grant_serial          IS DISTINCT FROM OLD.grant_serial
     OR NEW.grant_serial_id    IS DISTINCT FROM OLD.grant_serial_id
     OR NEW.grant_id           IS DISTINCT FROM OLD.grant_id
     OR NEW.grant_call_id      IS DISTINCT FROM OLD.grant_call_id
     OR NEW.grant_grid_id      IS DISTINCT FROM OLD.grant_grid_id
     OR NEW.grant_segment      IS DISTINCT FROM OLD.grant_segment
     OR NEW.workplan_number    IS DISTINCT FROM OLD.workplan_number       THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'grant'; END IF;
  IF NEW.mou_id                IS DISTINCT FROM OLD.mou_id
     OR NEW.date_transfer      IS DISTINCT FROM OLD.date_transfer         THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'mou'; END IF;
  IF NEW.approval_file_key     IS DISTINCT FROM OLD.approval_file_key
     OR NEW.approval_uploaded_by IS DISTINCT FROM OLD.approval_uploaded_by
     OR NEW.approval_uploaded_at IS DISTINCT FROM OLD.approval_uploaded_at THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'approval'; END IF;
  IF NEW.f4_status             IS DISTINCT FROM OLD.f4_status
     OR NEW.f5_status          IS DISTINCT FROM OLD.f5_status
     OR NEW.date_report_completed IS DISTINCT FROM OLD.date_report_completed
     OR NEW.completed_at       IS DISTINCT FROM OLD.completed_at          THEN RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'reporting'; END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS guard_err_projects ON public.err_projects;
CREATE TRIGGER guard_err_projects BEFORE INSERT OR UPDATE ON public.err_projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_err_projects();

CREATE OR REPLACE FUNCTION public.guard_err_summary()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.guard_is_restricted() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.review_status  := 'pending_review';
    NEW.review_comment := NULL;
    NEW.reviewed_at    := NULL;
    NEW.reviewed_by    := NULL;
    NEW.receipt_check  := NULL;
    RETURN NEW;
  END IF;

  IF OLD.review_status = 'approved' THEN
    RAISE EXCEPTION 'report_locked' USING ERRCODE = '42501';
  END IF;
  -- A submitted F-4 can't be turned back into a draft (drafts can be deleted)
  IF coalesce(OLD.is_draft, false) = false AND coalesce(NEW.is_draft, false) = true THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'is_draft';
  END IF;
  IF NEW.review_status  IS DISTINCT FROM OLD.review_status
     OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
     OR NEW.reviewed_at    IS DISTINCT FROM OLD.reviewed_at
     OR NEW.reviewed_by    IS DISTINCT FROM OLD.reviewed_by
     OR NEW.receipt_check  IS DISTINCT FROM OLD.receipt_check THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'review';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS guard_err_summary ON public.err_summary;
CREATE TRIGGER guard_err_summary BEFORE INSERT OR UPDATE ON public.err_summary
  FOR EACH ROW EXECUTE FUNCTION public.guard_err_summary();

-- The triggers call guard_is_restricted() as the signed-in user, so it stays callable (it only reads the caller's own role).
REVOKE ALL ON FUNCTION public.guard_err_projects(), public.guard_err_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_is_restricted() TO authenticated, anon;

-- Split the "write anything" rules: rooms may add and edit as before, but delete only drafts.
DROP POLICY IF EXISTS local_write ON public.err_projects;
CREATE POLICY local_insert ON public.err_projects FOR INSERT TO authenticated
  WITH CHECK (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true)
              OR (local_my_role() = 'base_err' AND created_by = (SELECT local_me.room_id::text FROM local_me() local_me(role, room_id, state_name, all_states, states))));
CREATE POLICY local_update ON public.err_projects FOR UPDATE TO authenticated
  USING (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true)
         OR (local_my_role() = 'base_err' AND created_by = (SELECT local_me.room_id::text FROM local_me() local_me(role, room_id, state_name, all_states, states))))
  WITH CHECK (local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true)
              OR (local_my_role() = 'base_err' AND created_by = (SELECT local_me.room_id::text FROM local_me() local_me(role, room_id, state_name, all_states, states))));
CREATE POLICY local_delete ON public.err_projects FOR DELETE TO authenticated
  USING ((local_can_access(COALESCE(emergency_room_id::text, err_id), local_room_state(COALESCE(emergency_room_id::text, err_id)), true)
          OR (local_my_role() = 'base_err' AND created_by = (SELECT local_me.room_id::text FROM local_me() local_me(role, room_id, state_name, all_states, states))))
         AND (local_my_role() IN ('admin', 'superadmin') OR status = 'draft'));

DROP POLICY IF EXISTS local_write ON public.err_summary;
CREATE POLICY local_insert ON public.err_summary FOR INSERT TO authenticated
  WITH CHECK (local_can_access_project(project_id, true));
CREATE POLICY local_update ON public.err_summary FOR UPDATE TO authenticated
  USING (local_can_access_project(project_id, true))
  WITH CHECK (local_can_access_project(project_id, true));
CREATE POLICY local_delete ON public.err_summary FOR DELETE TO authenticated
  USING (local_can_access_project(project_id, true)
         AND (local_my_role() IN ('admin', 'superadmin') OR coalesce(is_draft, false)));
