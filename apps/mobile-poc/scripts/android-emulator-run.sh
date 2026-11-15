#!/usr/bin/env bash
# Draait binnen android-emulator-runner: installeert de app, start hem en voert de e2e-flows uit.
set -uo pipefail
export PATH="$HOME/.maestro/bin:$PATH"
cd "$(dirname "$0")/.."
adb install -r "$1" || exit 1
adb shell getprop ro.build.version.release | sed 's/^/Android /'
adb shell am start -n app.versado.poc/.MainActivity || exit 1
sleep 5
E2E_OUT=e2e-results/android ./scripts/e2e.sh; rc=$?
adb logcat -d -t 2000 > e2e-results/android/logcat.txt 2>&1 || true
adb exec-out screencap -p > e2e-results/android/final.png 2>/dev/null || true
exit $rc
