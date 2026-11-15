#!/usr/bin/env bash
# Start de echte backend (server.ts) tegen een wegwerp-Postgres/Redis met synthetische accounts.
# Draait vanuit de repo-root; verwacht DATABASE_URL, REDIS_URL en de overige testvariabelen in de omgeving.
set -euo pipefail
npm run db:generate
npx prisma migrate deploy
npx tsx apps/mobile-poc/scripts/seed-synthetic.ts
nohup npx tsx server.ts > "${BACKEND_LOG:-/tmp/backend.log}" 2>&1 &
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -H "Origin: https://localhost" -H "X-Versado-Client: native-v1" -w "%{http_code}" http://127.0.0.1:3100/api/v1/native/capabilities || true)
  [ "$code" = "200" ] && { echo "backend gereed"; exit 0; }
  sleep 2
done
echo "backend startte niet"; tail -50 "${BACKEND_LOG:-/tmp/backend.log}"; exit 1
