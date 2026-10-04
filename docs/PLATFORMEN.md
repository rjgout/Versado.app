# Versado op web, PWA, iOS en Android

Versado houdt één Next.js-codebase. Web, geïnstalleerde PWA, iOS/iPadOS en
Android zijn distributievormen van dezelfde server-rendered app. De native
projecten in `ios/` en `android/` zijn Capacitor-shells; ze bevatten geen
tweede router, contentlaag of businesslogica.

## Aangetroffen architectuur

- Next.js 16 App Router met een eigen `tsx`-server (`server.ts`) voor HTTP en
  Socket.io; de app is dynamisch en kan niet veilig als statische export worden
  gebouwd.
- PWA-installatie gebruikt `/api/branding/manifest`, `public/sw.js`,
  `ServiceWorkerRegister`, `pwaInstall.ts` en bestaande safe-area-marges.
- Web Push gebruikt VAPID en browser `PushManager` via `pushClient.ts`; de
  server bewaart web-pushsubscriptions en verstuurt ze vanuit `notify.ts`.
- Auth gebruikt een httpOnly JWT-cookie (`bvm_session`). Tokens staan niet in
  localStorage. De native shell laadt dezelfde HTTPS-origin, waardoor deze
  sessiearchitectuur behouden blijft.
- Lokale opslag is alleen voor niet-gevoelige voorkeuren, audio-instellingen,
  terugnavigatie en tijdelijke UI-staat. Er is geen native secure-storage-
  migratie nodig zolang de authenticatie cookie-gebaseerd blijft.
- Delen, audio, QR-codes, downloads, externe links en Socket.io bestaan al in
  de gedeelde webcomponenten. Camera/QR-scannen wordt niet door de app gebruikt;
  QR-codes worden getoond of als afbeelding gedownload.

## Capacitor-keuzes

De native projecten gebruiken Capacitor 8, omdat de huidige npm-resolutie
Capacitor 8.5.x levert en de repository Node 24 gebruikt. De officiële
platformen zijn toegevoegd met:

```text
@capacitor/core
@capacitor/app
@capacitor/browser
@capacitor/haptics
@capacitor/keyboard
@capacitor/share
@capacitor/ios
@capacitor/android
```

De vaste native identiteit is:

```text
Naam: Versado
Bundle ID / application ID: app.versado.app
```

Er was geen bestaande native identiteit om te behouden. De native shell laadt
standaard `https://versado.app`. Voor een lokale of andere deployment kan dit
bij het synchroniseren worden overschreven met `CAPACITOR_SERVER_URL`.

## Ontwikkelen

Installeer eerst de webdependencies en genereer de Prisma-client zoals voor
de webapp. Synchroniseer daarna de native projecten:

```bash
npm install
npm run db:generate
CAPACITOR_SERVER_URL=https://versado.app npm run cap:sync
```

Voor lokale ontwikkeling op een telefoon moet de Next.js-server vanaf het
toestel bereikbaar zijn. Gebruik een LAN-adres en zet cleartext alleen voor
die lokale ontwikkelsessie aan:

```bash
CAPACITOR_SERVER_URL=http://192.168.1.20:3000 \
CAPACITOR_ALLOW_CLEARTEXT=true \
npm run cap:sync
```

Zet voor productie nooit cleartext aan. `CAPACITOR_SERVER_URL` staat niet in
de web-build en verandert de PWA/service worker niet.

### iOS/iPadOS

Op een Mac met Xcode:

```bash
npm run cap:sync:ios
npm run cap:open:ios
```

Open in Xcode het `App`-target, kies een simulator of aangesloten apparaat,
stel signing in en druk op Run. De Capacitor 8-projecten gebruiken Swift
Package Manager; CocoaPods is niet nodig voor deze pluginset.

### Android

Met Android Studio en een Android SDK:

```bash
npm run cap:sync:android
npm run cap:open:android
```

Kies een emulator of aangesloten apparaat en run de `app`-configuratie. De
Android-shell gebruikt application ID `app.versado.app` en heeft nu alleen de
normale internettoegang die nodig is om de Versado-server te laden.

## Gedeelde platformlaag

`src/lib/platform.ts` is de herkenbare grens voor native gedrag:

- `appPlatform`, `isNativeApp`, `isIOSApp`, `isAndroidApp` — runtime-detectie;
- `shareContent` — native share sheet met web-share-fallback;
- `openExternalUrl` — native browser met webtabblad-fallback;
- `lightHaptic` — lichte haptische feedback, stil op web.

`NativeAppBridge.tsx` koppelt alleen op native de Capacitor lifecycle aan de
bestaande Next-router: Android back/back gesture, app-resume en URL-openingen.
De bestaande browserback, `SubpageBackBar` en `NavigationScroll` blijven de
bron voor web/PWA-navigatie.

## PWA, safe areas en installatie

De bestaande PWA blijft actief. De service worker cachet bewust niets en
blijft webpush afhandelen. Native apps krijgen geen PWA-installatiehint:
`isStandalone()` behandelt een Capacitor-shell als al geïnstalleerd.

Safe-area-ruimte loopt centraal via `--vs-safe-area-*` in `globals.css`. Deze
combineert browser `env(safe-area-inset-*)` met de CSS-insets die Capacitor 8
op Android kan injecteren. Nieuwe fixed headers, bottom bars, sheets en
fullscreen-lagen gebruiken deze variabelen; voeg geen pagina-specifieke
notch/home-indicator-correcties toe.

## Meldingen

De bestaande webpush blijft ongewijzigd en geldt voor browser/PWA. Native
push is bewust nog niet geactiveerd: APNs-credentials, FCM-configuratie,
privacyverklaringen en een servermodel voor native device tokens ontbreken
nog. Een volgende native push-fase moet de afleverkanalen expliciet scheiden:

```text
web/PWA       -> bestaande VAPID PushSubscription
iOS/Android   -> native device token via APNs/FCM
```

Installeer daarvoor pas `@capacitor/push-notifications` en native permissions
wanneer de Apple- en Google-configuratie klaarstaat. Gebruik nooit een webpush
subscription als APNs- of FCM-token.

## Deep links en externe links

De JavaScript-bridge kan een URL van dezelfde Versado-origin naar de bestaande
Next-router sturen. Universal Links en Android App Links zijn nog niet
productief geconfigureerd. Daarvoor zijn later nodig:

- Apple Team ID, signing en `apple-app-site-association` op de Versado-origin;
- Android signing fingerprint en `assetlinks.json` op dezelfde origin;
- native entitlements/intent filters in de projecten.

Externe FSY- en podcastlinks openen in native via de browserbridge. Interne
links blijven normale Next-links en blijven in dezelfde shell.

## Ontwikkelstandaard voor nieuwe features

Beoordeel iedere feature vóór implementatie op:

- webbrowser en geïnstalleerde PWA;
- iPhone, iPad, Android-telefoon en Android-tablet;
- desktopbreedte, touch, toetsenbord en landscape;
- safe areas, fixed elementen, modals en keyboard resize;
- browserback, Android systeem-back/back gesture en deeplinks;
- dark mode, reduced motion, toegankelijkheid en focus states;
- online/offline- en resume-gedrag als de feature netwerkdata gebruikt;
- native capabilities uitsluitend via `src/lib/platform.ts` of een nieuwe
  centrale adapter, nooit via verspreide `Capacitor.isNativePlatform()`-checks.

Gebruik gedeelde componenten en serverlogica. Voeg pas platformcode toe als
de webfallback en de UX op alle drie distributievormen duidelijk zijn.

## Publicatievoorbereiding

Nog niet ingevuld en bewust niet verzonnen:

- Apple Developer Team, signing certificates/profiles, APNs en App Store
  metadata/screenshots/privacy declarations;
- Google Play Console, upload key/app signing, FCM en Play metadata/data
  safety declarations;
- definitieve app-iconen/splash-assets van minimaal de native bronformaten;
- Universal/App Links-bestanden;
- native push en eventueel accountverwijderingsteksten voor store review.

De native projecten zijn dus technisch voorbereid, maar nog geen productie-
release. Controleer vóór publicatie ook App Store Guideline 4.2 en de
vergelijkbare Play Store-eisen rond zelfstandige functionaliteit.
