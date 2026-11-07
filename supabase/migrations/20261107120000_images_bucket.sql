-- Storage for F4 and F5 photos and files on the launch database (7 Nov 2026). NOT APPLIED until Yung says so.
--
-- The app uploads receipt photos and supporting files to a bucket named "images": services/uploadImages.ts,
-- components/forms/ReportForm/upload/performUpload.ts, components/forms/ProgramReportForm/upload/performUpload.ts,
-- and offline mode (services/offlineSync.ts). The launch database ("Sudan ERRs", ygjwdoptcegapipnukgh) had no
-- such bucket, so every one of those uploads failed.
--
-- Private bucket (recommended): receipts carry names and amounts, and nothing in the app opens them by a public
-- link. Only signed-in, active app users can add files (under projects/, the folder the app writes to) or read
-- them; nobody can change or delete a file through the API. Portal staff with the server key read everything and
-- can make time-limited links. The links the app saves in receipts.image_url keep the file's path, so a signed
-- link can always be made from them.
-- If the portal needs plain public links instead: set public = true below (anyone with a link can then open it).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('images', 'images', false, 20971520)          -- 20 MB per file
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS images_add_app_users ON storage.objects;
CREATE POLICY images_add_app_users ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'images'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active')
  );

DROP POLICY IF EXISTS images_read_app_users ON storage.objects;
CREATE POLICY images_read_app_users ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'images'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active')
  );
