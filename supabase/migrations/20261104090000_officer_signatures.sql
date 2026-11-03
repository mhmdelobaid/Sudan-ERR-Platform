-- Officer signatures, part 1 (4 Nov 2026, decided by Yung). Replaces the unapplied 3 Nov F3-only draft.
--
-- Each room has a program officer, a finance officer and a reporting officer (the three F1 signers).
-- Each officer saves their drawn signature once in their account (حسابي); signing a document is then one tap
-- and copies that signature onto the document, so redrawing it later never changes past documents.
-- Who signs what (Yung, 4 Nov):
--   F1 work plan        program + reporting + finance   (part 3: before it goes to the locality)
--   F3 contract (MOU)   program + finance               (this part: after the partner signs; payment waits)
--   F4 financial report finance                         (part 2: before it goes to review)
--   F5 program report   reporting                       (part 2: before it goes to review)
--
-- 1. users.officer_position: 'program' | 'finance' | 'reporting'. Set from the import list's "position"
--    column (um_officer_position) or by a superadmin in User Management.
-- 2. user_signatures: one saved signature per account (PNG data URL). Locked: only functions read it.
--    me_set_signature(png) saves or replaces it; me_profile() shows it to its owner.
-- 3. document_signatures: one row per document and officer position, with the signature copied in.
--    doc_required_positions(type), doc_signatures(type, id), doc_fully_signed(type, id).
-- 4. sign_document(type, id): the caller must hold one of that document's officer positions, belong to the
--    document's room, have a saved signature, and not have signed it yet. Part 1 handles 'f3' only.
-- 5. my_signatures(): what is waiting for the caller's signature, and what they signed recently.
-- 6. F3: f3_my_contracts, project_file and the payment gate read document_signatures. A new
--    mou_payment_confirmations row, or mous.transfer_date / payment_confirmation_file set for the first
--    time, is refused ('room_signatures_missing') until the program and finance officers have signed.
--    Emergency override from the SQL editor only, inside one transaction:
--      SET LOCAL app.skip_signature_gate = 'on';
--    "Partner signed" = mous.signed_mou_file_key is set, or mous.signatures has a 'partner' key
--    (to confirm with the portal team).

-- 1. Officer position on accounts ------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS officer_position text;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_officer_position_check;
ALTER TABLE public.users ADD CONSTRAINT users_officer_position_check
  CHECK (officer_position IS NULL OR officer_position IN ('program', 'finance', 'reporting'));

-- The import list's free-text position -> officer position (English or Arabic).
CREATE OR REPLACE FUNCTION public.um_officer_position(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN lower(p) ~ '(financ|مالي)' THEN 'finance'
    WHEN lower(p) ~ '(report|تقارير)' THEN 'reporting'
    WHEN lower(p) ~ '(program|برامج)' THEN 'program'
    ELSE NULL END
$function$;

-- Accounts already imported: fill the position from what their list said.
UPDATE public.users u SET officer_position = public.um_officer_position(i.position)
  FROM public.um_invites i
 WHERE i.user_id = u.id AND u.officer_position IS NULL AND public.um_officer_position(i.position) IS NOT NULL;

-- 2. Saved signature per account -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_signatures (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  signature_png text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_signatures FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sig_png_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT coalesce(length(p) BETWEEN 200 AND 300000 AND p ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$', false)
$function$;

CREATE OR REPLACE FUNCTION public.me_set_signature(p_png text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  me      uuid := auth.uid();
  had_one boolean;
BEGIN
  IF me IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND status = 'active') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sig_png_ok(p_png) THEN RAISE EXCEPTION 'invalid_signature' USING ERRCODE = '22023'; END IF;
  SELECT true INTO had_one FROM public.user_signatures WHERE user_id = me;
  INSERT INTO public.user_signatures (user_id, signature_png, updated_at) VALUES (me, p_png, now())
  ON CONFLICT (user_id) DO UPDATE SET signature_png = EXCLUDED.signature_png, updated_at = now();
  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (me, CASE WHEN had_one THEN 'signature_replace' ELSE 'signature_save' END, 'user', me, NULL, NULL,
          jsonb_build_object('source', 'err_app_profile'));
  RETURN jsonb_build_object('has_signature', true, 'signature_png', p_png, 'signature_updated_at', now());
END $function$;

-- 3. Signatures on documents -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_signatures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type         text NOT NULL CHECK (doc_type IN ('f1', 'f3', 'f4', 'f5')),
  doc_id           uuid NOT NULL,
  officer_position text NOT NULL CHECK (officer_position IN ('program', 'finance', 'reporting')),
  user_id          uuid NOT NULL REFERENCES public.users(id),
  signer_name      text NOT NULL,
  room_id          uuid REFERENCES public.emergency_rooms(id),
  signature_png    text NOT NULL,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, doc_id, officer_position)
);
CREATE INDEX IF NOT EXISTS document_signatures_user_idx ON public.document_signatures (user_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS document_signatures_room_idx ON public.document_signatures (room_id);
ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_signatures FROM anon, authenticated;

-- A deleted document takes its signatures with it (doc_id has no foreign key: it points at several tables).
CREATE OR REPLACE FUNCTION public.doc_signatures_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  DELETE FROM public.document_signatures WHERE doc_type = TG_ARGV[0] AND doc_id = OLD.id;
  RETURN OLD;
END $function$;
DROP TRIGGER IF EXISTS doc_signatures_cleanup ON public.mous;
CREATE TRIGGER doc_signatures_cleanup AFTER DELETE ON public.mous
  FOR EACH ROW EXECUTE FUNCTION public.doc_signatures_cleanup('f3');

CREATE OR REPLACE FUNCTION public.doc_required_positions(p_doc_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_doc_type
    WHEN 'f1' THEN ARRAY['program', 'reporting', 'finance']
    WHEN 'f3' THEN ARRAY['program', 'finance']
    WHEN 'f4' THEN ARRAY['finance']
    WHEN 'f5' THEN ARRAY['reporting']
    ELSE ARRAY[]::text[] END
$function$;

CREATE OR REPLACE FUNCTION public.doc_signatures(p_doc_type text, p_doc_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(jsonb_object_agg(s.officer_position,
           jsonb_build_object('name', s.signer_name, 'signed_at', s.signed_at, 'image', s.signature_png)), '{}'::jsonb)
  FROM public.document_signatures s WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id
$function$;

CREATE OR REPLACE FUNCTION public.doc_fully_signed(p_doc_type text, p_doc_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(public.doc_required_positions(p_doc_type)) AS need(pos)
     WHERE NOT EXISTS (SELECT 1 FROM public.document_signatures s
                        WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id AND s.officer_position = need.pos))
    AND cardinality(public.doc_required_positions(p_doc_type)) > 0
$function$;

CREATE OR REPLACE FUNCTION public.f3_partner_signed(m public.mous)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  -- coalesce: an empty signatures field must read as "not signed", never as unknown
  SELECT coalesce(m.id IS NOT NULL AND (m.signed_mou_file_key IS NOT NULL
         OR (jsonb_typeof(m.signatures) = 'object' AND m.signatures ? 'partner')), false)
$function$;

-- 4. Sign ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_document(p_doc_type text, p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  me    public.users;
  v_png text;
  m     public.mous;
BEGIN
  SELECT * INTO me FROM public.users WHERE id = auth.uid() AND status = 'active';
  IF me.id IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_doc_type IS NULL OR cardinality(public.doc_required_positions(p_doc_type)) = 0 THEN
    RAISE EXCEPTION 'invalid_document' USING ERRCODE = '22023';
  END IF;
  IF me.officer_position IS NULL OR NOT (me.officer_position = ANY (public.doc_required_positions(p_doc_type))) THEN
    RAISE EXCEPTION 'not_a_signer' USING ERRCODE = '42501';
  END IF;
  SELECT signature_png INTO v_png FROM public.user_signatures WHERE user_id = me.id;
  IF v_png IS NULL THEN RAISE EXCEPTION 'no_saved_signature' USING ERRCODE = '22023'; END IF;
  IF me.err_id IS NULL THEN RAISE EXCEPTION 'not_your_room' USING ERRCODE = '42501'; END IF;

  IF p_doc_type = 'f3' THEN
    SELECT * INTO m FROM public.mous WHERE id = p_doc_id FOR UPDATE;
    IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.err_projects p
                    WHERE p.mou_id = m.id AND coalesce(p.emergency_room_id::text, p.err_id) = me.err_id::text) THEN
      RAISE EXCEPTION 'not_your_room' USING ERRCODE = '42501';
    END IF;
    IF NOT public.f3_partner_signed(m) THEN RAISE EXCEPTION 'partner_not_signed' USING ERRCODE = '22023'; END IF;
  ELSE
    -- F1, F4 and F5 come in parts 2 and 3.
    RAISE EXCEPTION 'invalid_document' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.document_signatures
              WHERE doc_type = p_doc_type AND doc_id = p_doc_id AND officer_position = me.officer_position) THEN
    RAISE EXCEPTION 'already_signed' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.document_signatures (doc_type, doc_id, officer_position, user_id, signer_name, room_id, signature_png)
  VALUES (p_doc_type, p_doc_id, me.officer_position, me.id, coalesce(nullif(btrim(me.display_name), ''), '—'), me.err_id, v_png);

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (me.id, 'document_sign', p_doc_type, p_doc_id, NULL,
          jsonb_build_object('position', me.officer_position, 'room_id', me.err_id),
          jsonb_build_object('source', 'err_app'));

  RETURN jsonb_build_object('doc_type', p_doc_type, 'doc_id', p_doc_id,
                            'signatures', public.doc_signatures(p_doc_type, p_doc_id),
                            'complete', public.doc_fully_signed(p_doc_type, p_doc_id));
END $function$;

-- 5. What is waiting for my signature --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_signatures()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  me public.users;
  v_has boolean;
BEGIN
  SELECT * INTO me FROM public.users WHERE id = auth.uid() AND status = 'active';
  IF me.id IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  v_has := EXISTS (SELECT 1 FROM public.user_signatures WHERE user_id = me.id);
  RETURN jsonb_build_object(
    'me', jsonb_build_object('officer_position', me.officer_position, 'has_signature', v_has,
                             'room_name', (SELECT er.name FROM public.emergency_rooms er WHERE er.id = me.err_id),
                             'room_name_ar', (SELECT er.name_ar FROM public.emergency_rooms er WHERE er.id = me.err_id)),
    'queue', coalesce((
      SELECT jsonb_agg(q.item ORDER BY q.sort_date DESC NULLS LAST)
      FROM (
        -- F3: contracts of my room the partner has signed and I haven't
        SELECT DISTINCT ON (m.id)
               jsonb_build_object('doc_type', 'f3', 'doc_id', m.id, 'project_id', p.id,
                                  'project_name', coalesce(p.project_name, p.project_objectives),
                                  'title', m.mou_code, 'partner_name', m.partner_name,
                                  'amount', m.total_amount, 'currency', p.currency,
                                  'room_name', er.name, 'room_name_ar', er.name_ar,
                                  'date', m.created_at, 'signatures', public.doc_signatures('f3', m.id)) AS item,
               m.created_at AS sort_date
          FROM public.mous m
          JOIN public.err_projects p ON p.mou_id = m.id
          LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
         WHERE me.officer_position = ANY (public.doc_required_positions('f3'))
           AND me.err_id IS NOT NULL
           AND coalesce(p.emergency_room_id::text, p.err_id) = me.err_id::text
           AND public.f3_partner_signed(m)
           AND NOT EXISTS (SELECT 1 FROM public.document_signatures s
                            WHERE s.doc_type = 'f3' AND s.doc_id = m.id AND s.officer_position = me.officer_position)
         ORDER BY m.id, p.submitted_at DESC NULLS LAST
      ) q), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'doc_type', s.doc_type, 'doc_id', s.doc_id, 'signed_at', s.signed_at,
               'title', CASE s.doc_type WHEN 'f3' THEN (SELECT m.mou_code FROM public.mous m WHERE m.id = s.doc_id) END,
               'project_id', CASE s.doc_type WHEN 'f3' THEN (SELECT p.id FROM public.err_projects p WHERE p.mou_id = s.doc_id LIMIT 1) END,
               'project_name', CASE s.doc_type WHEN 'f3' THEN (SELECT coalesce(p.project_name, p.project_objectives)
                                                                FROM public.err_projects p WHERE p.mou_id = s.doc_id LIMIT 1) END)
             ORDER BY s.signed_at DESC)
      FROM (SELECT * FROM public.document_signatures WHERE user_id = me.id ORDER BY signed_at DESC LIMIT 10) s), '[]'::jsonb));
END $function$;

-- 6. F3: contracts list, payment gate --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.f3_my_contracts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH me AS (
    SELECT u.id, u.err_id, u.officer_position,
           EXISTS (SELECT 1 FROM public.user_signatures us WHERE us.user_id = u.id) AS has_signature
      FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
  )
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'has_mou')::boolean DESC, row->>'start_date' DESC NULLS LAST, row->>'submitted_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name, 'project_objectives', p.project_objectives,
      'state', public.f2_project_state(p), 'locality', p.locality, 'status', p.status,
      'submitted_at', p.submitted_at, 'currency', p.currency,
      'room_name', er.name, 'room_name_ar', er.name_ar,
      'total_budget', coalesce((SELECT sum((l->>'total')::numeric) FROM jsonb_array_elements(public.f2_lines(p)) l), 0),
      'has_mou', m.id IS NOT NULL,
      'mou_id', m.id,
      'mou_code', m.mou_code, 'partner_name', m.partner_name, 'total_amount', m.total_amount,
      'start_date', m.start_date, 'end_date', m.end_date,
      'transfer_date', coalesce(m.transfer_date, p.date_transfer), 'exchange_rate', m.exchange_rate,
      'has_signed_copy', m.signed_mou_file_key IS NOT NULL,
      'partner_signed', coalesce(public.f3_partner_signed(m), false),
      'signatures', CASE WHEN m.id IS NULL THEN '{}'::jsonb ELSE public.doc_signatures('f3', m.id) END,
      'my_position', (SELECT officer_position FROM me),
      'my_has_signature', coalesce((SELECT has_signature FROM me), false),
      'can_sign', CASE
          WHEN m.id IS NOT NULL AND coalesce(public.f3_partner_signed(m), false)
           AND (SELECT officer_position FROM me) = ANY (public.doc_required_positions('f3'))
           AND coalesce(p.emergency_room_id::text, p.err_id) = (SELECT err_id::text FROM me)
           AND NOT EXISTS (SELECT 1 FROM public.document_signatures s
                            WHERE s.doc_type = 'f3' AND s.doc_id = m.id AND s.officer_position = (SELECT officer_position FROM me))
          THEN (SELECT officer_position FROM me) END,
      'grant_serial', p.grant_serial) AS row
    FROM public.err_projects p
    LEFT JOIN public.mous m ON m.id = p.mou_id
    LEFT JOIN public.emergency_rooms er ON er.id = p.emergency_room_id
    WHERE coalesce(p.is_draft, false) = false
      AND (p.mou_id IS NOT NULL OR p.status IN ('screened', 'approved'))
      AND public.f3_can_view(p)
  ) t
$function$;

CREATE OR REPLACE FUNCTION public.guard_mou_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_mou uuid;
BEGIN
  IF coalesce(current_setting('app.skip_signature_gate', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'mou_payment_confirmations' THEN
    v_mou := coalesce(NEW.mou_id, (SELECT p.mou_id FROM public.err_projects p WHERE p.id = NEW.project_id));
  ELSIF (NEW.transfer_date IS NOT NULL AND OLD.transfer_date IS NULL)
     OR (NEW.payment_confirmation_file IS NOT NULL AND OLD.payment_confirmation_file IS NULL) THEN
    v_mou := NEW.id;
  END IF;
  IF v_mou IS NOT NULL AND NOT public.doc_fully_signed('f3', v_mou) THEN
    RAISE EXCEPTION 'room_signatures_missing' USING ERRCODE = 'P0001',
      HINT = 'The room''s program officer and finance officer must both sign the MOU in the ERR app before the payment is recorded.';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS guard_mou_payment ON public.mou_payment_confirmations;
CREATE TRIGGER guard_mou_payment BEFORE INSERT ON public.mou_payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.guard_mou_payment();
DROP TRIGGER IF EXISTS guard_mou_payment ON public.mous;
CREATE TRIGGER guard_mou_payment BEFORE UPDATE OF transfer_date, payment_confirmation_file ON public.mous
  FOR EACH ROW EXECUTE FUNCTION public.guard_mou_payment();

-- 7. Account functions that now carry the officer position and the saved signature ------------------

CREATE OR REPLACE FUNCTION public.me_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
           'id', u.id, 'display_name', u.display_name, 'email', a.email,
           'role', u.role, 'status', coalesce(u.status, 'pending'),
           'room_name', er.name, 'room_name_ar', er.name_ar, 'room_type', er.type, 'err_code', er.err_code,
           'locality', s.locality, 'locality_ar', s.locality_ar, 'state', s.state_name, 'state_ar', s.state_name_ar,
           'can_see_all_states', coalesce(u.can_see_all_states, false), 'visible_states', coalesce(u.visible_states, '{}'),
           'position', i.position, 'officer_position', u.officer_position,
           'has_signature', us.user_id IS NOT NULL, 'signature_png', us.signature_png, 'signature_updated_at', us.updated_at,
           'created_at', u.created_at, 'last_sign_in_at', a.last_sign_in_at)
    INTO v
    FROM public.users u
    JOIN auth.users a ON a.id = u.id
    LEFT JOIN public.um_invites i ON i.user_id = u.id
    LEFT JOIN public.user_signatures us ON us.user_id = u.id
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference
   WHERE u.id = auth.uid();
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.um_users()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.um_require_superadmin();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', u.id, 'display_name', u.display_name, 'email', a.email,
             'role', u.role, 'status', coalesce(u.status, 'pending'),
             'err_id', u.err_id, 'room_name', er.name, 'room_name_ar', er.name_ar, 'room_type', er.type, 'err_code', er.err_code,
             'locality', s.locality, 'locality_ar', s.locality_ar, 'state', s.state_name, 'state_ar', s.state_name_ar,
             'can_see_all_states', coalesce(u.can_see_all_states, false), 'visible_states', coalesce(u.visible_states, '{}'),
             'created_at', u.created_at, 'last_sign_in_at', a.last_sign_in_at,
             'position', i.position, 'officer_position', u.officer_position, 'imported_at', i.imported_at,
             'last_link_at', i.last_link_at, 'last_link_method', i.last_link_method, 'link_count', coalesce(i.link_count, 0),
             'is_me', u.id = auth.uid())
           ORDER BY u.created_at DESC NULLS LAST)
    FROM public.users u
    LEFT JOIN auth.users a ON a.id = u.id
    LEFT JOIN public.um_invites i ON i.user_id = u.id
    LEFT JOIN public.emergency_rooms er ON er.id = u.err_id
    LEFT JOIN public.states s ON s.id = er.state_reference), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.um_import_user(
  p_user_id uuid, p_email text, p_name text, p_role text, p_err_id uuid, p_position text, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  actor  uuid := public.um_require_superadmin();
  v_p    text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_user_id AND lower(a.email) = lower(btrim(p_email))) THEN
    RAISE EXCEPTION 'login_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'email_exists' USING ERRCODE = '23505';
  END IF;
  v_p := public.um_import_role_problem(p_role, p_err_id);
  IF v_p IS NOT NULL THEN RAISE EXCEPTION '%', v_p USING ERRCODE = '22023'; END IF;

  INSERT INTO public.users (id, auth_user_id, err_id, display_name, role, status, created_at, officer_position)
  VALUES (p_user_id, p_user_id, p_err_id, v_name, p_role, 'pending', now(), public.um_officer_position(p_position));

  INSERT INTO public.um_invites (user_id, email, position, batch_id, imported_by)
  VALUES (p_user_id, lower(btrim(p_email)), nullif(btrim(coalesce(p_position, '')), ''), p_batch, actor);

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (actor, 'user_import', 'user', p_user_id, NULL,
          jsonb_build_object('role', p_role, 'status', 'pending', 'err_id', p_err_id, 'display_name', v_name),
          jsonb_build_object('source', 'err_app_user_management', 'batch_id', p_batch, 'position', p_position));

  RETURN jsonb_build_object('id', p_user_id, 'status', 'pending');
END $function$;

CREATE OR REPLACE FUNCTION public.um_update_user(p_user_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  actor   uuid := public.um_require_superadmin();
  old_u   public.users;
  new_u   public.users;
  v_role  text;
  v_room  uuid;
  v_type  text;
  bad_key text;
BEGIN
  SELECT * INTO old_u FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF old_u.id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_changes' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO bad_key FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('role','status','err_id','display_name','can_see_all_states','visible_states','officer_position') LIMIT 1;
  IF bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_changes' USING ERRCODE = '22023', DETAIL = bad_key;
  END IF;
  -- A superadmin can't lock themselves out
  IF p_user_id = actor AND (p_changes ? 'role' OR p_changes ? 'status') THEN
    RAISE EXCEPTION 'cannot_change_self' USING ERRCODE = '42501';
  END IF;

  v_role := coalesce(p_changes->>'role', old_u.role);
  IF v_role NOT IN ('base_err','locality_err','state_err','state_rep','lcc_wg','support','admin','superadmin','partner') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'status' AND (p_changes->>'status') NOT IN ('pending','active','suspended') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  v_room := CASE WHEN p_changes ? 'err_id' THEN nullif(p_changes->>'err_id', '')::uuid ELSE old_u.err_id END;
  IF v_room IS NOT NULL THEN
    SELECT type INTO v_type FROM public.emergency_rooms WHERE id = v_room;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  -- Room rules (checked when the role or the room changes)
  IF p_changes ? 'role' OR p_changes ? 'err_id' THEN
    IF v_role IN ('base_err','locality_err','state_err','state_rep') AND v_room IS NULL THEN
      RAISE EXCEPTION 'room_required' USING ERRCODE = '22023';
    END IF;
    IF (v_role = 'base_err' AND v_type <> 'base')
       OR (v_role = 'locality_err' AND v_type <> 'locality')
       OR (v_role = 'state_err' AND v_type <> 'state') THEN
      RAISE EXCEPTION 'room_type_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF nullif(p_changes->>'officer_position', '') IS NOT NULL
     AND (p_changes->>'officer_position') NOT IN ('program','finance','reporting') THEN
    RAISE EXCEPTION 'invalid_position' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users SET
    role               = v_role,
    status             = CASE WHEN p_changes ? 'status' THEN p_changes->>'status' ELSE status END,
    err_id             = v_room,
    display_name       = CASE WHEN p_changes ? 'display_name' THEN nullif(btrim(p_changes->>'display_name'), '') ELSE display_name END,
    can_see_all_states = CASE WHEN p_changes ? 'can_see_all_states' THEN (p_changes->>'can_see_all_states')::boolean ELSE can_see_all_states END,
    visible_states     = CASE WHEN p_changes ? 'visible_states'
                              THEN ARRAY(SELECT jsonb_array_elements_text(p_changes->'visible_states')) ELSE visible_states END,
    officer_position   = CASE WHEN p_changes ? 'officer_position' THEN nullif(p_changes->>'officer_position', '') ELSE officer_position END,
    updated_at         = now()
  WHERE id = p_user_id
  RETURNING * INTO new_u;

  INSERT INTO public.audit_logs (actor_user_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES (actor, 'user_update', 'user', p_user_id,
          jsonb_build_object('role', old_u.role, 'status', old_u.status, 'err_id', old_u.err_id, 'display_name', old_u.display_name,
                             'can_see_all_states', old_u.can_see_all_states, 'visible_states', old_u.visible_states, 'officer_position', old_u.officer_position),
          jsonb_build_object('role', new_u.role, 'status', new_u.status, 'err_id', new_u.err_id, 'display_name', new_u.display_name,
                             'can_see_all_states', new_u.can_see_all_states, 'visible_states', new_u.visible_states, 'officer_position', new_u.officer_position),
          jsonb_build_object('source', 'err_app_user_management'));

  RETURN jsonb_build_object('id', new_u.id, 'role', new_u.role, 'status', new_u.status, 'err_id', new_u.err_id,
                            'display_name', new_u.display_name, 'can_see_all_states', new_u.can_see_all_states,
                            'visible_states', new_u.visible_states, 'officer_position', new_u.officer_position);
END $function$;

-- Project file (PDF): the F3 part also carries the signatures.
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
                                     'exchange_rate', m.exchange_rate, 'has_signed_copy', m.signed_mou_file_key IS NOT NULL,
                                     'partner_signed', public.f3_partner_signed(m), 'signatures', public.doc_signatures('f3', m.id))
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

-- Grants -------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.um_officer_position(text), public.sig_png_ok(text), public.doc_signatures_cleanup(),
  public.doc_required_positions(text), public.doc_signatures(text, uuid), public.doc_fully_signed(text, uuid),
  public.f3_partner_signed(public.mous), public.guard_mou_payment(),
  public.me_set_signature(text), public.sign_document(text, uuid), public.my_signatures(), public.f3_my_contracts()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.um_officer_position(text), public.sig_png_ok(text), public.doc_signatures_cleanup(),
  public.doc_required_positions(text), public.doc_signatures(text, uuid), public.doc_fully_signed(text, uuid),
  public.f3_partner_signed(public.mous), public.guard_mou_payment() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.me_set_signature(text), public.sign_document(text, uuid), public.my_signatures(),
  public.f3_my_contracts() TO authenticated;
REVOKE ALL ON FUNCTION public.me_profile(), public.um_users(), public.um_update_user(uuid, jsonb),
  public.um_import_user(uuid, text, text, text, uuid, text, uuid), public.project_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.me_profile(), public.um_users(), public.um_update_user(uuid, jsonb),
  public.um_import_user(uuid, text, text, text, uuid, text, uuid), public.project_file(uuid) TO authenticated;

