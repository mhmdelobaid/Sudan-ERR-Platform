-- Supabase advisor quick fixes (26 Oct 2026)
-- ------------------------------------------------------------------------------------------------
-- 1. auth_rls_initplan: four rules called auth.uid() once per row. Wrapping it in (select ...) makes
--    Postgres work it out once per query. Same meaning, same rows.
-- 2. unindexed_foreign_keys: indexes on the columns the app filters and joins by (projects by room,
--    reports by project, votes by voter, ...). err_projects had only its primary key.
-- 3. guard_is_staff() could be called without a login. It only answers "is the caller portal staff",
--    but anon has no use for it. Signed-in users keep it: the C1 guard trigger calls it as them.
--
-- Left as they are, on purpose:
--   - rls_enabled_no_policy (64 tables): these are deny-all by design; the app reads them only through
--     its own functions.
--   - SECURITY DEFINER functions callable by signed-in users: they are the app's own RPCs and each checks
--     the caller's role inside; public_* (sign-up before login) are meant for anon.
--   - multiple_permissive_policies (local_read + local_write): merging them changes the access rules;
--     not a quick fix.
--   - no_primary_key: all in backup_other_app_20260930 (old website leftovers). Dropping it needs Yung's OK.
--   - leaked-password protection: Pro plan only.
-- ------------------------------------------------------------------------------------------------

-- 1. RLS rules: auth.uid() evaluated once per query ------------------------------------------------
DROP POLICY IF EXISTS local_self_read ON public.users;
CREATE POLICY local_self_read ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS local_self_insert ON public.users;
CREATE POLICY local_self_insert ON public.users FOR INSERT TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
    AND status = 'pending'
    AND role = ANY (ARRAY['locality_err', 'state_err'])
    AND EXISTS (
      SELECT 1 FROM public.emergency_rooms er
       WHERE er.id = users.err_id AND er.status = 'active'
         AND er.type = CASE users.role WHEN 'locality_err' THEN 'locality' ELSE 'state' END)
  );

DROP POLICY IF EXISTS feedback_tickets_read ON public.feedback_tickets;
CREATE POLICY feedback_tickets_read ON public.feedback_tickets FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'
                  AND u.role = ANY (ARRAY['support', 'admin', 'superadmin']))
  );

DROP POLICY IF EXISTS feedback_tickets_insert_own ON public.feedback_tickets;
CREATE POLICY feedback_tickets_insert_own ON public.feedback_tickets FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND sync_status = 'pending' AND github_issue_number IS NULL AND github_issue_url IS NULL
    AND EXISTS (SELECT 1 FROM public.users u
                 WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'
                   AND u.role = ANY (ARRAY['base_err', 'locality_err', 'state_err', 'state_rep', 'lcc_wg',
                                           'support', 'admin', 'superadmin']))
  );

-- 2. Indexes on the columns the app filters and joins by -------------------------------------------
CREATE INDEX IF NOT EXISTS err_projects_err_id_idx              ON public.err_projects (err_id);
CREATE INDEX IF NOT EXISTS err_projects_emergency_room_id_idx   ON public.err_projects (emergency_room_id);
CREATE INDEX IF NOT EXISTS err_projects_status_idx              ON public.err_projects (status);
CREATE INDEX IF NOT EXISTS err_projects_cycle_state_alloc_idx   ON public.err_projects (cycle_state_allocation_id);
CREATE INDEX IF NOT EXISTS err_projects_current_feedback_idx    ON public.err_projects (current_feedback_id);
CREATE INDEX IF NOT EXISTS err_projects_mou_id_idx              ON public.err_projects (mou_id);
CREATE INDEX IF NOT EXISTS err_projects_grant_call_id_idx       ON public.err_projects (grant_call_id);
CREATE INDEX IF NOT EXISTS err_summary_project_id_idx           ON public.err_summary (project_id);
CREATE INDEX IF NOT EXISTS err_summary_attachments_summary_idx  ON public.err_summary_attachments (summary_id);
CREATE INDEX IF NOT EXISTS err_expense_project_id_idx           ON public.err_expense (project_id);
CREATE INDEX IF NOT EXISTS err_expense_summary_id_idx           ON public.err_expense (summary_id);
CREATE INDEX IF NOT EXISTS err_expense_receipts_expense_idx     ON public.err_expense_receipts (expense_id);
CREATE INDEX IF NOT EXISTS receipts_expense_id_idx              ON public.receipts (expense_id);
CREATE INDEX IF NOT EXISTS err_program_report_project_id_idx    ON public.err_program_report (project_id);
CREATE INDEX IF NOT EXISTS err_program_reach_report_id_idx      ON public.err_program_reach (report_id);
CREATE INDEX IF NOT EXISTS err_program_files_report_id_idx      ON public.err_program_files (report_id);
CREATE INDEX IF NOT EXISTS err_project_documents_project_idx    ON public.err_project_documents (project_id);
CREATE INDEX IF NOT EXISTS project_feedback_project_id_idx      ON public.project_feedback (project_id);
CREATE INDEX IF NOT EXISTS project_feedback_fields_feedback_idx ON public.project_feedback_fields (feedback_id);
CREATE INDEX IF NOT EXISTS f2_votes_voter_id_idx                ON public.f2_votes (voter_id);
CREATE INDEX IF NOT EXISTS f2_decisions_feedback_id_idx         ON public.f2_decisions (feedback_id);
CREATE INDEX IF NOT EXISTS lcc_reviews_working_group_id_idx     ON public.lcc_reviews (working_group_id);
CREATE INDEX IF NOT EXISTS users_err_id_idx                     ON public.users (err_id);
CREATE INDEX IF NOT EXISTS users_auth_user_id_idx               ON public.users (auth_user_id);
CREATE INDEX IF NOT EXISTS emergency_rooms_state_reference_idx  ON public.emergency_rooms (state_reference);
CREATE INDEX IF NOT EXISTS mou_payment_conf_mou_id_idx          ON public.mou_payment_confirmations (mou_id);
CREATE INDEX IF NOT EXISTS mou_payment_conf_project_id_idx      ON public.mou_payment_confirmations (project_id);
CREATE INDEX IF NOT EXISTS working_group_members_user_id_idx    ON public.working_group_members (user_id);
CREATE INDEX IF NOT EXISTS feedback_tickets_user_id_idx         ON public.feedback_tickets (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_user_id_idx         ON public.audit_logs (actor_user_id);

-- 3. guard_is_staff(): signed-in only --------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.guard_is_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guard_is_staff() TO authenticated;
