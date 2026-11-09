-- The "images" bucket becomes server-only (10 Nov 2026).
--
-- It was opened on 9 Nov as a stop-gap: any active app user could add files under projects/ and read every
-- file in it, from any state. From now on:
--   - files people send from the reporting forms and offline mode go through the secure upload
--     (uploads-incoming -> /api/files/finalize -> uploads-clean, see 20261107140000_secure_uploads.sql);
--   - the F1/F4/F5 wizard routes keep their files in "images", but only after rebuilding them clean
--     (services/cleanBeforeStore.ts), and only the server (service role) reads or writes there, after checking
--     the caller may see the project. People open those files through short-lived signed links.
-- So nobody needs a storage rule on "images" any more.
DROP POLICY IF EXISTS images_add_app_users ON storage.objects;
DROP POLICY IF EXISTS images_read_app_users ON storage.objects;

UPDATE storage.buckets SET public = false WHERE id = 'images';
