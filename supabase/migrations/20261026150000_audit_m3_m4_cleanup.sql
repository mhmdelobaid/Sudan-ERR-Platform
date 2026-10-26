-- Security audit follow-ups (26 Oct 2026): M3, M4 and part of L1
-- ------------------------------------------------------------------------------------------------
-- M3: the partner feed portal_screened_f1() gave an admin or support account every state's screened
--     F-1s, even when the account covers one state. Now:
--       - partner and superadmin still see every state;
--       - admin and support see only their own states, or every state if can_see_all_states.
--     (funding_pool_totals() was re-checked: it already returns only the caller's states.)
--
-- M4: the users update rule let an admin of one state widen an account to more states or to
--     "all states". A trigger now stops an admin, when updating users directly, from:
--       - turning on can_see_all_states unless the admin has it,
--       - adding a state the admin doesn't cover,
--       - changing id, auth_user_id, pin_hash, telegram_id, partner_id or created_at.
--     Superadmins, the app's own functions (um_*) and the service key are not affected.
--
-- L1: f2_own_locality_ids() and rls_auto_enable() could be called without a login; the unused wga_*
--     functions (the working-group admin page was removed on 12-14 Oct) are dropped.
-- ------------------------------------------------------------------------------------------------

-- M3 --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_screened_f1(p_lcc_status text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r      text;
  v_all  boolean;
  v_list text[];
BEGIN
  SELECT role, coalesce(can_see_all_states, false), coalesce(visible_states, '{}')
    INTO r, v_all, v_list
    FROM public.users WHERE id = auth.uid() AND status = 'active';
  IF r IS NULL OR r NOT IN ('partner','admin','superadmin','support') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(v.payload ORDER BY v.last_modified)
      FROM public.portal_f1_screened v
      JOIN public.err_projects p ON p.id = v.project_id
     WHERE (p_lcc_status IS NULL OR v.lcc_status = p_lcc_status)
       AND (r IN ('partner', 'superadmin') OR v_all OR public.f2_project_state(p) = ANY (v_list))
  ), '[]'::jsonb);
END $function$;

-- M4 --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_users_admin_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  me    record;
  added text;
BEGIN
  -- Only direct updates from the app's users (REST); definer functions and the service key run as other roles
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO me FROM public.local_me();
  IF me.role = 'superadmin' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash OR NEW.telegram_id IS DISTINCT FROM OLD.telegram_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501', DETAIL = 'users';
  END IF;

  IF coalesce(NEW.can_see_all_states, false) AND NOT coalesce(OLD.can_see_all_states, false)
     AND NOT coalesce(me.all_states, false) THEN
    RAISE EXCEPTION 'scope_too_wide' USING ERRCODE = '42501', DETAIL = 'can_see_all_states';
  END IF;

  IF NEW.visible_states IS DISTINCT FROM OLD.visible_states AND NOT coalesce(me.all_states, false) THEN
    SELECT s INTO added
      FROM unnest(coalesce(NEW.visible_states, '{}')) s
     WHERE s <> ALL (coalesce(OLD.visible_states, '{}'))
       AND s <> ALL (coalesce(me.states, '{}'))
     LIMIT 1;
    IF added IS NOT NULL THEN
      RAISE EXCEPTION 'scope_too_wide' USING ERRCODE = '42501', DETAIL = added;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_users_admin_scope ON public.users;
CREATE TRIGGER guard_users_admin_scope BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_admin_scope();

-- L1 --------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.f2_own_locality_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.f2_own_locality_ids() TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.wga_set_project_groups(uuid, uuid[], uuid);
DROP FUNCTION IF EXISTS public.wga_projects(text, text);
DROP FUNCTION IF EXISTS public.wga_remove_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.wga_add_member(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.wga_create_group(text, text);
DROP FUNCTION IF EXISTS public.wga_groups();
DROP FUNCTION IF EXISTS public.wga_require_admin();
