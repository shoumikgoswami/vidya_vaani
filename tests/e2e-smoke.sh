#!/usr/bin/env bash
# Checks the submission gate: port 3000 serves the app, not a default page.
set -euo pipefail
BASE="${1:-http://localhost:3000}"

for i in $(seq 1 60); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done

curl -fsS "$BASE/healthz" | grep '"ok":true' >/dev/null
curl -fsS "$BASE/" | grep "Vidya Vaani" >/dev/null
curl -fsS "$BASE/api/config" | grep '"demoMode"' >/dev/null
curl -fsS "$BASE/app.js" >/dev/null
curl -fsS "$BASE/vendor/jsqr.js" >/dev/null
curl -fsS "$BASE/manifest.webmanifest" | grep '"standalone"' >/dev/null
curl -fsS "$BASE/sw.js" >/dev/null
curl -fsS -o /dev/null "$BASE/img/icon-512.png"
echo "smoke check passed for $BASE"
