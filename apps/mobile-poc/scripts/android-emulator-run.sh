#!/usr/bin/env bash
# Draait binnen android-emulator-runner: installeert de app, start hem en voert de e2e-flows uit.
set -uo pipefail
export PATH="$HOME/.maestro/bin:$PATH"
cd "$(dirname "$0")/.."
adb install -r "$1" || exit 1
adb shell getprop ro.build.version.release | sed 's/^/Android /'
adb logcat -G 16M; adb logcat -c
adb shell am start -n app.versado.poc/.MainActivity || exit 1
sleep 20
# Diagnose vóór de flows: leeft het proces, wat staat er op het scherm, wat meldt React Native?
echo "::group::diagnose na start"
echo "pid: $(adb shell pidof app.versado.poc || echo GEEN-PROCES)"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml | tr '>' '>\n' | grep -oE '(text|content-desc|resource-id)="[^"]+"' | sort -u | head -60
adb logcat -d -t 3000 | grep -E "ReactNativeJS|AndroidRuntime|FATAL|ReactNative:|SoLoader|Hermes|app.versado.poc" | tail -80
curl -s -o /dev/null -w "backend vanaf runner: %{http_code}\n" -H "Origin: https://localhost" -H "X-Versado-Client: native-v1" http://127.0.0.1:3100/api/v1/native/capabilities
adb shell "curl -s -m 5 -o /dev/null -w 'backend vanaf emulator: %{http_code}' http://10.0.2.2:3100/ || echo 'curl niet beschikbaar in emulator'" 
echo "::endgroup::"
E2E_OUT=e2e-results/android ./scripts/e2e.sh; rc=$?
adb logcat -d -t 4000 > e2e-results/android/logcat.txt 2>&1 || true
echo "::group::logcat na flows (gefilterd)"; grep -E "ReactNativeJS|AndroidRuntime|FATAL" e2e-results/android/logcat.txt | tail -60; echo "::endgroup::"
echo "::group::backend-log (websocket/auth)"; grep -iE "socket|origin|403|401|native" "${BACKEND_LOG:-/dev/null}" | tail -40; echo "::endgroup::"
adb exec-out screencap -p > e2e-results/android/final.png 2>/dev/null || true
exit $rc
