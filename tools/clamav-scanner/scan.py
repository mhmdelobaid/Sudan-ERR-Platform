#!/usr/bin/env python3
"""
ERR file scanner: virus-scans every clean upload that hasn't been scanned yet.

Runs once and exits (schedule it every 5-10 minutes), or loops with --loop.
Needs only the Python standard library and ClamAV (clamscan + freshclam).

For each file_uploads row with status 'clean' and av_status 'not_scanned':
  - downloads the file from the private uploads-clean bucket,
  - scans it with ClamAV,
  - marks it 'clean', or 'infected' (with the signature name) and deletes the stored file.
An infected file is hidden from everyone at once by the storage and report rules, even before deletion.

Environment:
  SUPABASE_URL                 https://<project>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    service role key (keep it secret; only this job holds it)
  BATCH_SIZE                   optional, default 50
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BATCH = int(os.environ.get("BATCH_SIZE", "50"))
BUCKET = "uploads-clean"
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def call(method, path, body=None, extra=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(HEADERS, **(extra or {}))
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = res.read()
        return payload if raw else (json.loads(payload) if payload else None)


def pending():
    q = urllib.parse.urlencode({
        "select": "id,clean_path",
        "status": "eq.clean",
        "av_status": "eq.not_scanned",
        "order": "created_at.asc",
        "limit": str(BATCH),
    })
    return call("GET", f"/rest/v1/file_uploads?{q}") or []


def mark(file_id, status, signature=None):
    call("PATCH", f"/rest/v1/file_uploads?id=eq.{file_id}",
         {"av_status": status, "av_signature": signature,
          "av_checked_at": datetime.now(timezone.utc).isoformat()},
         extra={"Prefer": "return=minimal"})


def object_url(path):
    return f"/storage/v1/object/{BUCKET}/" + urllib.parse.quote(path)


def scan_dir(folder):
    """Returns {file name: signature} for infected files. Raises if ClamAV itself failed."""
    proc = subprocess.run(["clamscan", "--no-summary", "--infected", "--stdout", "-r", folder],
                          capture_output=True, text=True)
    if proc.returncode not in (0, 1):          # 0 = clean, 1 = something found, 2 = error
        raise RuntimeError(proc.stderr.strip() or "clamscan failed")
    found = {}
    for line in proc.stdout.splitlines():
        if line.endswith(" FOUND") and ": " in line:
            file_path, sig = line[:-len(" FOUND")].rsplit(": ", 1)
            found[os.path.basename(file_path)] = sig
    return found


def run_once():
    rows = pending()
    if not rows:
        print("nothing to scan")
        return 0
    with tempfile.TemporaryDirectory() as folder:
        by_name = {}
        for row in rows:
            name = row["id"]                       # saved under the row id, never the uploader's name
            try:
                data = call("GET", object_url(row["clean_path"]), raw=True)
            except urllib.error.HTTPError as e:
                print(f"{row['id']}: download failed ({e.code})")
                mark(row["id"], "error", f"download_{e.code}")
                continue
            with open(os.path.join(folder, name), "wb") as fh:
                fh.write(data)
            by_name[name] = row
        found = scan_dir(folder)
        for name, row in by_name.items():
            if name in found:
                mark(row["id"], "infected", found[name][:200])
                try:
                    call("DELETE", object_url(row["clean_path"]), raw=True)
                except urllib.error.HTTPError as e:
                    print(f"{row['id']}: delete failed ({e.code}); the file is already hidden by the rules")
                print(f"INFECTED {row['id']} {found[name]}")
            else:
                mark(row["id"], "clean")
    print(f"scanned {len(by_name)}, infected {len(found)}")
    return len(found)


def main():
    if not URL or not KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    subprocess.run(["freshclam", "--quiet"], check=False)   # latest virus signatures
    if "--loop" in sys.argv:
        while True:
            try:
                run_once()
            except Exception as e:                           # keep going; report and retry later
                print("scan round failed:", e)
            time.sleep(300)
    run_once()


if __name__ == "__main__":
    main()
