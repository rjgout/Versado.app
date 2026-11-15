#!/bin/bash
# Bewijs voor de native tabbalk: bouwt de meetapp (tests/ios-glass-harness) tegen de iOS 26 SDK, start hem
# in een echte iOS 26-simulator en maakt screenshots per architectuur en weergave. Alleen op macOS (CI).
# Uitvoer: $1 (standaard ./glass-evidence). Een screenshot is bewijs van wat de simulator toont; het is
# geen fysieke-toestelacceptatie en geen vervanging van een controle op een echt toestel.
set -euo pipefail
OUT="${1:-glass-evidence}"; mkdir -p "$OUT"
WORK="$(mktemp -d)"; APP="$WORK/Harness.app"; mkdir -p "$APP"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x86_64"
xcrun --sdk iphonesimulator swiftc -swift-version 5 -sdk "$SDK" -target "$ARCH-apple-ios26.0-simulator" \
  ios/App/App/NativeTabBarPolicy.swift ios/App/App/NativeTabBar.swift tests/ios-glass-harness/main.swift -o "$APP/Harness"
# AccentColor uit dezelfde asset catalog als de echte app.
xcrun actool ios/App/App/Assets.xcassets --compile "$APP" --platform iphonesimulator --minimum-deployment-target 26.0 \
  --app-icon "" --output-partial-info-plist "$WORK/assets.plist" >/dev/null 2>&1 || echo "actool: geen assets (AccentColor valt terug op systeemblauw)"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Harness</string>
<key>CFBundleIdentifier</key><string>app.versado.glassharness</string>
<key>CFBundleName</key><string>Harness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>26.0</string>
<key>UILaunchScreen</key><dict/>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c "import json,sys; r=[x for x in json.load(sys.stdin)['runtimes'] if x.get('isAvailable') and x['identifier'].split('iOS-')[-1].startswith('26')]; print(r[-1]['identifier'] if r else '')")"
[ -n "$RUNTIME" ] || { echo "Geen iOS 26-simulatorruntime beschikbaar"; xcrun simctl list runtimes; exit 1; }
DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17"
xcrun simctl list devicetypes | grep -q "iPhone-17" || DEVICE_TYPE="$(xcrun simctl list devicetypes -j | python3 -c "import json,sys; print([d['identifier'] for d in json.load(sys.stdin)['devicetypes'] if 'iPhone' in d['name']][-1])")"
UDID="$(xcrun simctl create versado-glass "$DEVICE_TYPE" "$RUNTIME")"
trap 'xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true; xcrun simctl delete "$UDID" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
{ echo "runtime: $RUNTIME"; echo "device: $DEVICE_TYPE"; xcodebuild -version; } > "$OUT/omgeving.txt"
# Oorzaak van de lege screenshots in de eerste proefruns: de meetapp heeft een leeg `UILaunchScreen` (wit) en een
# screenshot na een vaste wachttijd kan het witte lanceerscherm of (na een crash) het startscherm vangen. Daarom
# wacht dit script op `ready.json`, dat de app pas schrijft als de inhoud getekend is en de balk een hoogte heeft.
# Geen bewijs binnen de tijd, een balk zonder hoogte of een gecrashte app = harde fout (screenshot blijft als
# *-MISLUKT.png bewaard); er wordt nooit stilzwijgend een slecht screenshot als goed bewaard.
FAILED=0
launch() { # variant stijl bestandsnaam
  xcrun simctl terminate "$UDID" app.versado.glassharness >/dev/null 2>&1 || true
  sleep 2
  local container; container="$(xcrun simctl get_app_container "$UDID" app.versado.glassharness data 2>/dev/null || true)"
  [ -z "$container" ] || rm -f "$container/Documents/ready.json"
  xcrun simctl launch --stdout="$OUT/$3.log" --stderr="$OUT/$3.err" "$UDID" app.versado.glassharness -variant "$1" -style "$2" >/dev/null
  container="$(xcrun simctl get_app_container "$UDID" app.versado.glassharness data)"
  local waited=0
  until [ -f "$container/Documents/ready.json" ]; do
    sleep 0.5; waited=$((waited + 1))
    if [ "$waited" -ge 90 ]; then
      xcrun simctl io "$UDID" screenshot "$OUT/$3-MISLUKT.png" || true
      echo "MISLUKT: $3 meldde niet 'klaar' binnen 45 s (app gecrasht of inhoud niet getekend)" | tee -a "$OUT/omgeving.txt"
      FAILED=1; return 0
    fi
  done
  cp "$container/Documents/ready.json" "$OUT/$3.ready.json"
  sleep 1
  xcrun simctl io "$UDID" screenshot "$OUT/$3.png"
  python3 - "$OUT/$3.ready.json" "$3" <<'PY' || FAILED=1
import json, sys
info = json.load(open(sys.argv[1]))
if not (info.get("barHeight", 0) >= 1 and info.get("webLoaded")):
    print(f"MISLUKT: {sys.argv[2]}: balk zonder hoogte of inhoud niet geladen: {info}")
    sys.exit(1)
if info["variant"] == "standalone":
    heights = info.get("remeasuredHeights", [])
    if info.get("tabBarCount") != 1 or not heights or any(abs(h - info["barHeight"]) > 0.5 for h in heights):
        print(f"MISLUKT: {sys.argv[2]}: na didBecomeActive tabBarCount={info.get('tabBarCount')} hoogtes={heights} (verwacht 1 balk en {info['barHeight']})")
        sys.exit(1)
print(f"ok: {sys.argv[2]}: balkhoogte {info['barHeight']} pt")
PY
}
launch standalone light warmup; rm -f "$OUT"/warmup.*
FAILED=0
for variant in standalone controller; do
  for style in light dark; do launch "$variant" "$style" "$variant-$style"; done
done
# Toegankelijkheidsinstellingen op de standalone-variant.
for setting in "increase_contrast" "reduce_transparency"; do
  xcrun simctl ui "$UDID" "$setting" enabled >/dev/null 2>&1 || { echo "simctl ui $setting niet beschikbaar" >> "$OUT/omgeving.txt"; continue; }
  launch standalone light "standalone-light-$setting"
  xcrun simctl ui "$UDID" "$setting" disabled >/dev/null 2>&1 || true
done
ls -l "$OUT"
[ "$FAILED" -eq 0 ] || { echo "Minstens één opname mislukt: zie $OUT/omgeving.txt"; exit 1; }
