#!/usr/bin/env bash
# Kiest een iPhone-simulator, installeert de app, start hem en voert de e2e-flows uit.
set -uo pipefail
export PATH="$HOME/.maestro/bin:$PATH"
cd "$(dirname "$0")/.."
APP="$1"
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json,sys
d=json.load(sys.stdin)['devices']
rt=sorted([k for k in d if 'iOS' in k], key=lambda k:[int(x) for x in k.split('iOS-')[1].split('-')] if 'iOS-' in k else [0])
for k in reversed(rt):
    for dev in d[k]:
        if dev['name'].startswith('iPhone') and dev['isAvailable']:
            print(dev['udid']); sys.exit(0)
")
[ -n "$UDID" ] || { echo "geen iPhone-simulator"; exit 1; }
xcrun simctl list devices | grep "$UDID"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
echo "::group::ATS-instellingen in de gebouwde app"; plutil -p "$APP/Info.plist" | grep -A12 NSAppTransportSecurity || echo "geen NSAppTransportSecurity in Info.plist"; echo "::endgroup::"
xcrun simctl install "$UDID" "$APP" || exit 1
xcrun simctl launch "$UDID" app.versado.poc || exit 1
sleep 8
mkdir -p e2e-results/ios
# De XCTest-driver van Maestro start op de trage Intel-runner pas na enkele minuten: ruime timeout en voorverwarmen.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=900000
echo "::group::diagnose na start"
echo "app draait: $(xcrun simctl spawn "$UDID" launchctl list | grep -c app.versado.poc) regel(s) in launchctl"
xcrun simctl listapps "$UDID" | grep -A3 app.versado.poc | head -8
echo "::endgroup::"
echo "::group::warm-up Maestro-driver"
cat > e2e-results/ios/warmup.yaml <<'YAML'
appId: app.versado.poc
---
- launchApp
- extendedWaitUntil:
    visible:
      id: login-submit
    timeout: 120000
YAML
for i in 1 2 3; do maestro test e2e-results/ios/warmup.yaml && break || echo "warm-up poging $i mislukt"; done
echo "::endgroup::"
E2E_OUT=e2e-results/ios ./scripts/e2e.sh; rc=$?
xcrun simctl io "$UDID" screenshot e2e-results/ios/final.png || true
echo "::group::backend-log (websocket/auth)"; grep -iE "socket|origin|403|401|native" "${BACKEND_LOG:-/dev/null}" | tail -40; echo "::endgroup::"
exit $rc
