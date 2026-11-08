-- Secure file uploads (7 Nov 2026)
--
-- Every uploaded file goes through three places:
--   1. uploads-incoming  (private quarantine). A signed-in app user may only ADD a file, only in their own
--      folder (<user id>/...). Nobody can read, overwrite or delete there, not even the uploader.
--   2. The server route /api/files/finalize checks the file's real type, rebuilds it clean (photos re-drawn
--      as JPEG without hidden data or GPS, PDFs rebuilt with scripts, actions, attachments and forms removed),
--      and records it in public.file_uploads.
--   3. uploads-clean (private). Only the server writes here. People read a file only through a short-lived
--      signed link, and only if they may see that project.
-- Reports may only point at files that passed this check (triggers on receipts and err_program_files).
-- Photos and PDF only, at most 10 MB, enforced by Supabase itself.

-- 1. Buckets ---------------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('uploads-incoming', 'uploads-incoming', false, 10485760,
     ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('uploads-clean', 'uploads-clean', false, 10485760,
     ARRAY['image/jpeg', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Register of every upload (clean or rejected) ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.err_projects(id) ON DELETE CASCADE,
  uploaded_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('f4', 'f5', 'scan')),
  status          text NOT NULL CHECK (status IN ('clean', 'rejected')),
  reject_code     text,
  original_name   text,
  original_mime   text,
  original_size   integer,
  original_sha256 text,
  clean_path      text UNIQUE,
  clean_mime      text,
  clean_size      integer,
  clean_sha256    text,
  pages           integer,
  width           integer,
  height          integer,
  removed         text[] NOT NULL DEFAULT '{}',      -- what the cleaner took out (e.g. 'javascript', 'gps')
  av_status       text NOT NULL DEFAULT 'not_scanned'
                  CHECK (av_status IN ('not_scanned', 'clean', 'infected', 'error')),
  av_signature    text,
  av_checked_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_uploads_clean_has_path CHECK (status <> 'clean' OR clean_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS file_uploads_project_idx  ON public.file_uploads (project_id);
CREATE INDEX IF NOT EXISTS file_uploads_uploader_idx ON public.file_uploads (uploaded_by, created_at);
CREATE INDEX IF NOT EXISTS file_uploads_av_idx       ON public.file_uploads (av_status) WHERE av_status = 'not_scanned';

ALTER TABLE public.file_uploads ENABLE ROW LEVEL SECURITY;
-- Read: whoever may see the project. Writes: the server only (service role), so no write rules.
DROP POLICY IF EXISTS file_uploads_read ON public.file_uploads;
CREATE POLICY file_uploads_read ON public.file_uploads FOR SELECT TO authenticated
  USING (public.local_can_access_project(project_id, false));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.file_uploads FROM anon, authenticated;
REVOKE ALL ON public.file_uploads FROM anon;

-- 3. Storage rules ---------------------------------------------------------------------------------------
-- Quarantine: add only, own folder only, active app accounts only. No read, update or delete rules.
DROP POLICY IF EXISTS uploads_incoming_insert_own ON storage.objects;
CREATE POLICY uploads_incoming_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads-incoming'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.local_my_role() IS NOT NULL
  );

-- Clean files: read only when the register says clean, not infected, and the caller may see the project.
DROP POLICY IF EXISTS uploads_clean_read ON storage.objects;
CREATE POLICY uploads_clean_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads-clean'
    AND EXISTS (
      SELECT 1 FROM public.file_uploads f
      WHERE f.clean_path = storage.objects.name
        AND f.status = 'clean'
        AND f.av_status <> 'infected'
        AND public.local_can_access_project(f.project_id, false)
    )
  );

-- 4. Reports may only point at cleaned files ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_clean_file(p_path text, p_project uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_path IS NULL THEN
    RETURN;
  END IF;
  -- Server-side tools (service role, migrations) are trusted; app users are not.
  IF coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.file_uploads f
    WHERE f.clean_path = p_path
      AND f.status = 'clean'
      AND f.av_status <> 'infected'
      AND f.project_id = p_project
  ) THEN
    RAISE EXCEPTION 'file_not_cleaned' USING ERRCODE = '42501',
      HINT = 'Upload the file through the app so it is checked first.';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.require_clean_file(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_receipt_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    PERFORM public.require_clean_file(
      NEW.image_url,
      (SELECT e.project_id FROM public.err_expense e WHERE e.expense_id = NEW.expense_id));
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.guard_receipt_file() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_receipt_file ON public.receipts;
CREATE TRIGGER guard_receipt_file BEFORE INSERT OR UPDATE OF image_url ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_file();

CREATE OR REPLACE FUNCTION public.guard_program_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.file_url IS DISTINCT FROM OLD.file_url THEN
    PERFORM public.require_clean_file(
      NEW.file_url,
      (SELECT r.project_id FROM public.err_program_report r WHERE r.id = NEW.report_id));
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.guard_program_file() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_program_file ON public.err_program_files;
CREATE TRIGGER guard_program_file BEFORE INSERT OR UPDATE OF file_url ON public.err_program_files
  FOR EACH ROW EXECUTE FUNCTION public.guard_program_file();
