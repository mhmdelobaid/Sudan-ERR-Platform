# ERR file scanner (ClamAV)

Virus-scans every upload that passed the app's file check (`file_uploads.av_status = 'not_scanned'`).
Clean files are marked `clean`. An infected file is marked `infected` with its signature name, and its
stored copy is deleted. The database rules hide an infected file from everyone at once and stop any report
from pointing at it.

Files never leave your own systems: the job downloads from your Supabase with the service key and
scans locally.

## What it needs

- `SUPABASE_URL`: `https://ygjwdoptcegapipnukgh.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: the service role key. Keep it only in this job's secret settings.
- About 2 GB of memory (ClamAV's signature database is large).

## Option A: Google Cloud Run job, every 10 minutes (pay per run, usually a few dollars a month)

```
cd tools/clamav-scanner
gcloud run jobs deploy err-file-scanner --source . --region europe-west1 \
  --memory 2Gi --cpu 1 --task-timeout 15m \
  --set-env-vars SUPABASE_URL=https://ygjwdoptcegapipnukgh.supabase.co \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=err-supabase-service-key:latest
gcloud scheduler jobs create http err-file-scanner-every-10-min --location europe-west1 \
  --schedule "*/10 * * * *" --http-method POST \
  --uri "https://run.googleapis.com/v2/projects/PROJECT_ID/locations/europe-west1/jobs/err-file-scanner:run" \
  --oauth-service-account-email SCHEDULER_SA@PROJECT_ID.iam.gserviceaccount.com
```

Create the secret first: `printf '%s' '<service key>' | gcloud secrets create err-supabase-service-key --data-file=-`.

## Option B: any small always-on server (Fly.io, Render, a VPS)

Run the container with `--loop`. It scans every 5 minutes.

```
docker build -t err-file-scanner tools/clamav-scanner
docker run -d --restart unless-stopped -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... err-file-scanner --loop
```

## Check it works

1. Upload a test file in the app.
2. Within one run its row shows `av_status = clean`:

   ```
   select original_name, av_status, av_checked_at from file_uploads order by created_at desc limit 5;
   ```

3. Files still `not_scanned` after an hour mean the job isn't running.
