# ERR file scanner: ClamAV + a small Python job (standard library only).
FROM clamav/clamav-debian:stable
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY scan.py /app/scan.py
# Signatures are refreshed by freshclam at every start; bake a first copy into the image too.
RUN freshclam --quiet || true
ENTRYPOINT ["python3", "/app/scan.py"]
