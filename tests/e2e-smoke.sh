#!/usr/bin/env bash
# Checks the submission gate: port 3000 serves the app, not a default page.
set -euo pipefail
BASE="${1:-http://localhost:3000}"

for i in $(seq 1 60); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done

curl -fsS "$BASE/healthz" | grep -q '"ok":true'
curl -fsS "$BASE/" | grep -q "Vidya Vaani"
curl -fsS "$BASE/api/config" | grep -q '"demoMode"'
curl -fsS "$BASE/app.js" >/dev/null
curl -fsS "$BASE/vendor/jsqr.js" >/dev/null
echo "smoke check passed for $BASE"
