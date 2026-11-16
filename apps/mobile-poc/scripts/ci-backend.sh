#!/usr/bin/env bash
# Start de echte backend (server.ts) tegen een wegwerp-Postgres/Redis met synthetische accounts.
# Draait vanuit de repo-root; verwacht DATABASE_URL, REDIS_URL en de overige testvariabelen in de omgeving.
set -euo pipefail
npm run db:generate
npx prisma migrate deploy
npx tsx apps/mobile-poc/scripts/seed-synthetic.ts
# De dev-server compileert routes bij het eerste verzoek (meerdere seconden): warm ze op, zodat de eerste echte
# verzoeken uit de app of de tweede client niet door een koude compilatie in een timeout lopen.
warm() {
  local H=(-H "Origin: https://localhost" -H "X-Versado-Client: native-v1" -H "content-type: application/json")
  local B=http://127.0.0.1:3100/api/v1/native
  local tok
  tok=$(curl -s -X POST "$B/login" "${H[@]}" -d '{"identifier":"carol@example.invalid","password":"'"${POC_PASSWORD:-PocPassw0rd!2026}"'"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || true)
  [ -n "$tok" ] || return 0
  for p in today-overview games/friends; do curl -s -o /dev/null "$B/$p" "${H[@]}" -H "authorization: Bearer $tok"; done
  curl -s -o /dev/null -X POST "$B/realtime/session" "${H[@]}" -H "authorization: Bearer $tok" -d '{}'
  # De eerste accepteer-aanroep compileert de route en laadt de beloningscontrole; op een trage runner verliep daarbij de
  # interactieve transactie (5 s) en gaf de backend een 500. Daarom eenmalig doorlopen met een los opwarmpaar (Erin -> Frank).
  local ftok fid
  ftok=$(curl -s -X POST "$B/login" "${H[@]}" -d '{"identifier":"frank@example.invalid","password":"'"${POC_PASSWORD:-PocPassw0rd!2026}"'"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || true)
  [ -n "$ftok" ] || return 0
  fid=$(curl -s "$B/games/friends" "${H[@]}" -H "authorization: Bearer $ftok" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['incoming'][0]['friendshipId'])" 2>/dev/null || true)
  [ -n "$fid" ] && curl -s -o /dev/null -m 60 -X POST "$B/games/friends/$fid/accept" "${H[@]}" -H "authorization: Bearer $ftok" -d '{}'
  return 0
}
nohup npx tsx server.ts > "${BACKEND_LOG:-/tmp/backend.log}" 2>&1 &
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -H "Origin: https://localhost" -H "X-Versado-Client: native-v1" -w "%{http_code}" http://127.0.0.1:3100/api/v1/native/capabilities || true)
  [ "$code" = "200" ] && { warm; echo "backend gereed"; exit 0; }
  sleep 2
done
echo "backend startte niet"; tail -50 "${BACKEND_LOG:-/tmp/backend.log}"; exit 1
