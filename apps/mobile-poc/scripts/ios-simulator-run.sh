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
xcrun simctl install "$UDID" "$APP" || exit 1
xcrun simctl launch "$UDID" app.versado.poc || exit 1
sleep 8
mkdir -p e2e-results/ios
E2E_OUT=e2e-results/ios ./scripts/e2e.sh; rc=$?
xcrun simctl io "$UDID" screenshot e2e-results/ios/final.png || true
exit $rc
