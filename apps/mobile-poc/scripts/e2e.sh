#!/usr/bin/env bash
# Draait de runtime-flows tegen de al geïnstalleerde app op een gebooten simulator/emulator.
# Vereist: draaiende testbackend (POC_BASE_URL), geseede synthetische accounts, `maestro` in PATH.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="${E2E_OUT:-e2e-results}"; mkdir -p "$OUT"
export POC_BASE_URL="${POC_BASE_URL:-http://127.0.0.1:3100}"
fail=0
step() { echo "::group::$1"; }
end() { echo "::endgroup::"; }
run_flow() { step "maestro $1"; maestro test --format junit --output "$OUT/$1.xml" --test-output-dir "$OUT/$1" "e2e/$1.yaml" || fail=1; end; }

rm -f "$OUT/bob.signal"
npx tsx tests/native/peer.ts listen-bob "$OUT/bob.signal" > "$OUT/bob-listener.log" 2>&1 &
BOB=$!
sleep 10
run_flow 01-login-vandaag
run_flow 02-tabs-vrienden
step "peer: Dave stuurt een verzoek"; npx tsx tests/native/peer.ts dave-request || fail=1; end
run_flow 03-realtime-nieuw-verzoek
run_flow 04-accepteren
step "peer: server-effect + realtime op tweede client"; npx tsx tests/native/peer.ts verify "$OUT/bob.signal" || fail=1; end
run_flow 05-uitloggen-accountwissel
kill $BOB 2>/dev/null
exit $fail
