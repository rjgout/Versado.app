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
# Toegankelijkheidsboom na een mislukte flow: laat zien wat de app werkelijk aanbiedt (tabs, labels, testIDs).
dump_ui() {
  if command -v adb >/dev/null 2>&1 && adb get-state >/dev/null 2>&1; then
    echo "::group::crash/logcat direct na mislukte flow $1"
    echo "proces: $(adb shell pidof app.versado.poc || echo GEEN-PROCES)"
    echo "-- crash-buffer"; adb logcat -b crash -d | tail -60
    echo "-- app-regels"; adb logcat -d | grep -E "FATAL EXCEPTION|E AndroidRuntime|ReactNativeJS|Fatal signal|SIGSEGV|app.versado.poc.*(died|crash)|ActivityManager.*(app.versado.poc)|InflateException|IllegalState|Theme" | tail -60
    echo "::endgroup::"
  fi
  echo "::group::UI-dump na mislukte flow $1"
  if command -v adb >/dev/null 2>&1 && adb get-state >/dev/null 2>&1; then
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml | tr '>' '>\n' | grep -oE '(text|content-desc|resource-id)="[^"]+"' | grep -v "^resource-id=\"android:" | sort -u | head -80
  else
    echo "-- simulatorlog (app, ATS, Keychain)"
    xcrun simctl spawn booted log show --last 15m --style compact --predicate 'process == "VersadoPoC" OR eventMessage CONTAINS "App Transport Security" OR eventMessage CONTAINS "errSecMissingEntitlement" OR eventMessage CONTAINS "-34018" OR eventMessage CONTAINS "NSURLSession" OR eventMessage CONTAINS "CFNetwork"' 2>/dev/null | grep -vE "com.apple.dt.xctest|automationmode|com.apple.xpc|launchservices|com.apple.log:" | tail -40
    maestro hierarchy 2>/dev/null | grep -oE '"(accessibilityText|title|label|text|resource-id|identifier)" *: *"[^"]+"' | sort -u | head -80
  fi
  echo "::endgroup::"
}
# Systeemtekstgrootte (Dynamic Type / lettergrootte van Android) voor de flow die de selectie bij grote systeemtekst test.
text_scale() {
  if command -v adb >/dev/null 2>&1 && adb get-state >/dev/null 2>&1; then
    adb shell settings put system font_scale "$([ "$1" = large ] && echo 1.6 || echo 1.0)"
  else
    xcrun simctl ui booted content_size "$([ "$1" = large ] && echo accessibility-extra-large || echo large)"
  fi
}
# Toegankelijkheidsboom als bewijs wat een schermlezer te zien krijgt (labels, rollen, aantikbare vlakken).
a11y_dump() {
  if command -v adb >/dev/null 2>&1 && adb get-state >/dev/null 2>&1; then
    adb shell uiautomator dump /sdcard/a11y.xml >/dev/null 2>&1 && adb shell cat /sdcard/a11y.xml > "$OUT/a11y-$1.xml" || true
  else
    maestro hierarchy > "$OUT/a11y-$1.json" 2>/dev/null || true
  fi
}
run_flow() { step "maestro $1"; maestro test --format junit --output "$OUT/$1.xml" --test-output-dir "$OUT/$1" "e2e/$1.yaml" || { fail=1; dump_ui "$1"; }; end; }

rm -f "$OUT/bob.signal"
npx tsx tests/native/peer.ts listen-bob "$OUT/bob.signal" > "$OUT/bob-listener.log" 2>&1 &
BOB=$!
npx tsx tests/native/trigger-server.ts > "$OUT/trigger.log" 2>&1 &
TRIG=$!
sleep 10
# Wacht tot de backend rustig is: de opstart-/compilatiepieken van een dev-server liepen op de trage runner voorbij de clienttijdslimiet (15 s).
quiet=0
for i in $(seq 1 60); do
  t=$(curl -s -o /dev/null -m 20 -H "Origin: https://localhost" -H "X-Versado-Client: native-v1" -w "%{time_total}" "$POC_BASE_URL/api/v1/native/capabilities" || echo 99)
  if awk "BEGIN{exit !($t < 0.8)}"; then quiet=$((quiet+1)); else quiet=0; fi
  [ "$quiet" -ge 4 ] && { echo "backend rustig na $((i*3)) s"; break; }
  sleep 3
done
run_flow 01-login-vandaag
run_flow 02-tabs-vrienden
run_flow 03-realtime-nieuw-verzoek
run_flow 04-accepteren
step "peer: server-effect + realtime op tweede client"; npx tsx tests/native/peer.ts verify "$OUT/bob.signal" || fail=1; end
run_flow 06-lezer-selectie-woord
run_flow 07-lezer-meerdere-verzen
run_flow 08-lezer-notitie-herladen
step "peer: lezer, server-effect van markeren en notitie"; npx tsx tests/native/peer.ts verify-reader present || fail=1; end
run_flow 09-lezer-lettergroottes
text_scale large; run_flow 10-lezer-systeemtekstgrootte; text_scale normal
run_flow 11-lezer-markering-wissen
step "peer: lezer, markering gewist op de server"; npx tsx tests/native/peer.ts verify-reader cleared || fail=1; end
# Architectuurproef rijke studielessen (als Gerda, account in de synthetische studiecollectie)
run_flow 12-studie-les-weergave
run_flow 13-studie-selectie-woord
run_flow 14-studie-blokken-markeren-notitie
step "peer: studieles, server-effect van markeren en notitie"; npx tsx tests/native/peer.ts verify-study present || fail=1; end
run_flow 15-studie-herladen
run_flow 16-studie-lettergroottes
run_flow 18-studie-tabelcel
run_flow 20-studie-toegankelijkheid
a11y_dump 20-studie-toegankelijkheid
text_scale large; run_flow 17-studie-systeemtekstgrootte; text_scale normal
run_flow 19-studie-markering-wissen
step "peer: studieles, markering gewist op de server"; npx tsx tests/native/peer.ts verify-study cleared || fail=1; end
run_flow 05-uitloggen-accountwissel
kill $BOB $TRIG 2>/dev/null
exit $fail
