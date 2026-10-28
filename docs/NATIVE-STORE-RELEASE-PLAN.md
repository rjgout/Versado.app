# Versado Mobile 1.0 — stuurdocument voor de store-release

Status: **voorstel ter beoordeling door de eigenaar**. Datum van de audit: 23 oktober 2026,
basis `origin/main` op `7da9c704` (inclusief de native-keten #170–#179 en #190).
Dit document wijzigt het bestaande pariteitsbeleid **niet** (zie
[NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md)): er zijn geen goedgekeurde web-only
uitzonderingen. Alles wat hieronder als "uitzondering" of "scopekeuze" staat, is een
beslispunt voor de eigenaar en geldt pas na uitdrukkelijke goedkeuring.

Het stuurdocument verwijst naar de architectuurdocumenten in plaats van ze te herhalen:
[PLATFORMEN.md](PLATFORMEN.md) (architectuur en doelmodel),
[NATIVE-FOUNDATION-PHASE-1.md](NATIVE-FOUNDATION-PHASE-1.md) (contracten en testbewijs),
[NATIVE-SOCKET-HARDENING.md](NATIVE-SOCKET-HARDENING.md) (realtime),
[APPLE-SIGN-IN-SETUP.md](APPLE-SIGN-IN-SETUP.md) (Apple), [NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md)
(volledige route-inventaris) en [NATIVE-MAIN-INTEGRATION-REVIEW.md](NATIVE-MAIN-INTEGRATION-REVIEW.md).

## 0. Kern in tien regels

1. De native app is vandaag een **technische proef**, geen productbasis voor een store-release:
   één lokale client van ca. 560 regels UI (6 bestanden), 17 native API-endpoints tegenover
   138 webpagina's en 233 routehandlers.
2. Wat werkt is **bewezen**: accountflows (inloggen, registreren, wachtwoordherstel,
   e-mailbevestiging, verplichte beveiligingsstappen), één leeslus (eerste hoofdstuk →
   tekst → bewust afronden), sessieherstel, privacy/cookies offline en realtime-authenticatie.
   Android-debug en iOS-simulator **compileren** op CI (iOS 26.5 SDK). Niets is op een
   echt toestel uitgevoerd.
3. Er is **geen** release-/distributieprofiel, geen signing, geen privacy manifest, geen
   werkende entitlements, geen deeplinks, geen native accountverwijdering, geen
   voorwaardenpagina en geen native push. Dat zijn objectieve blokkades (§2).
4. Volledige pariteit is een groot traject (§3). Het **kleinste zinvolle** pad bestaat uit
   vier mijlpalen: M0 toestelbewijs → M1 interne test (TestFlight intern, Play intern) →
   M2 externe test → M3 publieke Mobile 1.0 (§3.3).
5. **Kortste veilige route naar een installeerbare testversie** (M1) vraagt géén nieuwe
   functies: een expliciet distributieprofiel (WP1), release-engineering voor signing en
   buildnummers (WP2/WP3), een bereikbare testbackend met `NATIVE_API_ENABLED=1` (WP5 +
   eigenaar) en de Apple/Google-accounts van de eigenaar (§10).
6. Een publieke Mobile 1.0 vraagt daarnaast minimaal: native accountverwijdering + publieke
   verwijderpagina, voorwaarden, een echte native leer-/leeskern (Vandaag, Leren, lezer,
   oefeningen), store-assets en apparaattests (§4–§9).
7. `CAPACITOR_BUILD_PROFILE=release` blijft geblokkeerd. Een testkanaal is nooit een
   releasestatus: de bundel meldt `releaseApproved:false` en het kanaal is in de app zichtbaar.
8. De objectieve blokkades zijn uitleesbaar met `npm run native:store-readiness`
   (`--strict` faalt zolang er een niet-gewaiveerde blokkade openstaat). Dit script bewijst
   nooit dat iets op een toestel werkt.
9. Er is niets ingediend, gedeployed of gemerged; er zijn geen credentials gebruikt of verzonnen.
10. **WP1 (distributieprofielen) is geïmplementeerd** (§5.1); eerstvolgend zijn WP2 (iOS) en WP3 (Android) (§9). Voor een echte testbuild ontbreekt nog de backend-origin van de eigenaar (§5.1).

## 1. Huidige technische status

### 1.1 Bewijsmethode

Conclusies zijn gebaseerd op code die is gelezen, op tests die lokaal zijn uitgevoerd
(`npm run test:native`: 43 van 43 geslaagd; `npm run native:build`: lokale bundel van 2,2 MB;
store-readiness-script) en op de GitHub Actions-runs van 23 oktober 2026 (PR #187, head
`857cd549`: `native-foundation`, `native-parity`, `android-development` en `ios-simulator`
groen). Documentatie is alleen gebruikt waar de code de bewering bevestigt.

Legenda: **Werkt** = door een test of CI-run bewezen. **Compileert** = gebouwd, nooit op een
toestel uitgevoerd. **Ontbreekt** = in de repository niet aanwezig.

### 1.2 Wat er is

| Onderdeel | Status | Bewijs |
|---|---|---|
| Capacitor 8.5.2 met plugins app, browser, haptics, keyboard, share | Compileert | `package.json`, `ios/App/CapApp-SPM/Package.swift` |
| Lokale client (esbuild → `dist/native`, CSP, geen `server.url`) | Werkt (browser/Chromium en bundel-verificatie) | `scripts/native/build.ts`, `scripts/native/verify-distribution.mjs`, `tests/native-foundation.browser.mjs` |
| Eigen plugin `VersadoNative`: iOS Keychain, Android Keystore (AES-GCM), Sign in with Apple | Compileert | `ios/App/App/VersadoNativePlugin.swift`, `android/.../VersadoNativePlugin.java` |
| Native API `/api/v1/native/*`: 17 endpoints (capabilities, login, register, forgot/reset-password, verify-email, security-setup, refresh, logout, apple, account/password, me, today, chapters/:id, chapters/:id/complete, realtime/session) | Werkt (integratietests) | `src/lib/native/api.ts`, `tests/native-*.test.ts` |
| Eigen sessielaag (Bearer, refresh-rotatie, intrekking, versieverhoging bij wachtwoordwijziging) | Werkt | `src/lib/native/sessions.ts`, `tests/native-account.integration.test.ts` |
| Realtime: eenmalig handshakebewijs ≤ 60 s, per pakket sessiecontrole | Werkt (twee-proces-tests) | `docs/NATIVE-SOCKET-HARDENING.md`, `tests/native-socket*.test.ts` |
| Gedeelde navigatiepoort met lokale hashgeschiedenis, Android-backknop-koppeling | Werkt (unit/browser) | `src/lib/native/navigation.ts`, `src/lib/platform.ts` |
| Android-debug-APK en iOS-simulatorapp inclusief controle van de verpakte assets | Compileert | CI-job `android-development`, `ios-simulator` |
| Telefoons portrait-only (iPhone via Info.plist, Android via `MainActivity`) | Werkt in code, ongetest op toestel | `Info.plist`, `MainActivity.java` |

### 1.3 Wat de native client de gebruiker nu laat doen

Aanmelden, registreren, wachtwoordherstel aanvragen en afronden, e-mailbevestiging, verplichte
wachtwoord-/TOTP-setup, uitloggen, taal kiezen, wachtwoord wijzigen, Apple koppelen
(alleen iOS, standaard uit), privacy en cookies lezen (offline), en een **Vandaag-scherm met één
knop**: het eerste hoofdstuk van de actieve bron ("Doorgaan"). Dat hoofdstuk toont de verzen en
laat de gebruiker het bewust als gelezen markeren (`/today` en `/chapters/:id`). Er is geen
cursuslijst, geen echte voortgang, geen oefening, geen audio, geen XP-weergave, geen
navigatiebalk, geen spel en geen sociale functie. De voorwaarden-knop is uitgeschakeld zolang
`NATIVE_TERMS_URL` ontbreekt (`NativeFoundation.tsx`).

### 1.4 Hoe groot is de kloof

De gegenereerde inventaris ([NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md)) telt 138 pagina's,
233 fysieke routehandlers, 412 JSX-modules en 12 profielschermen. De native API dekt 17
endpoints, de native UI 6 bestanden. Van de ca. 20 functiegebieden in de matrix is er geen
enkel **volledig** native bruikbaar; één (accountflows) is voor het grootste deel aanwezig.

### 1.5 Projectstatus per platform (gelezen uit de projectbestanden)

| Onderwerp | iOS | Android |
|---|---|---|
| Identiteit | `app.versado.app` | `app.versado.app` |
| Versie | `MARKETING_VERSION 0.1.0`, `CURRENT_PROJECT_VERSION 1` (hard in project) | `versionName 0.1.0` / `versionCode 1`; **sinds deze PR injecteerbaar** (`VERSADO_VERSION_*`) |
| Minimale OS | iOS 15.0 (Apple-eis: ≥ 13 vanaf 9 sep 2026 — voldaan) | `minSdk 24`, `targetSdk 36` (Play-eis: 36 vanaf 31 aug 2026 — voldaan) |
| SDK/toolchain op CI | iPhoneSimulator 26.5 SDK (Xcode 26-eis van Apple voldaan op CI) | JDK 21, SDK 36 |
| Signing | `CODE_SIGN_STYLE = Automatic`, geen Team, geen provisioning | **sinds deze PR**: release-signing alleen uit `VERSADO_UPLOAD_KEYSTORE_*`; zonder sleutel blijft de build ongetekend |
| Entitlements | Alleen `SignInWithApple.entitlements.example`; `CODE_SIGN_ENTITLEMENTS` niet gezet → capability niet actief | n.v.t. |
| Privacy manifest | **Ontbreekt** (`PrivacyInfo.xcprivacy`) | n.v.t. (Data safety in Play Console) |
| Deeplinks | Geen associated domains, geen AASA | Geen `autoVerify`-intent-filter, geen `assetlinks.json` |
| Pushpermissies | Geen | Geen |
| Iconen en splash | Ander beeld dan de PWA-iconen en het lijkt het sjabloonbeeld van Capacitor (visuele beoordeling; eigenaar bevestigt), sjabloon-splash | Sjabloon-launcher en -splash (idem) |
| Release-build in CI | **Sinds deze PR** een unsigned `archive` voor echte apparaten met SDK-controle | **Sinds deze PR** een unsigned `bundleRelease` (AAB) |
| Minificatie | n.v.t. | `minifyEnabled false` (bewuste keuze nodig, zie WP3) |

## 2. Objectieve releaseblokkades

`npm run native:store-readiness` leest deze status uit de repository. Kolom "Type": **code** =
oplossen met een PR; **eigenaar** = vereist een handeling buiten de code; **besluit** = eerst een
beslissing. Een blokkade met "alleen bij …" geldt alleen als die functie in de gekozen scope zit.

| Id (script) | Blokkade | Type | Werkpakket |
|---|---|---|---|
| `distribution-profile` | Gescheiden distributieprofielen `local-internal` en `local-store-test` naast het geblokkeerde `release` (**opgelost in WP1**) | code | WP1 |
| `distribution-origins-configured` | De eigenaar heeft de toegestane HTTPS-backend-origins voor intern en store-test nog niet vastgelegd in `scripts/native/distribution-origins.json` (lijsten zijn leeg: distributiebuilds weigeren te bouwen) | eigenaar | WP1 |
| `ios-privacy-manifest` | `PrivacyInfo.xcprivacy` staat nu in het app-target (**code opgelost in WP2**); de dataverzameling/privacylabels in App Store Connect blijven een besluit van de eigenaar (D5/D8) | code + besluit | WP2 |
| `ios-testflight-workflow` | Beschermde handmatige workflow voor een ondertekende TestFlight-IPA (**opgelost in WP2**; draaien vereist de secrets van de eigenaar) | code | WP2 |
| `ios-entitlements` | Geen echt entitlements-bestand gekoppeld (alleen nodig voor Apple-login/associated domains) | code + besluit | WP2 |
| `ios-export-compliance` | `ITSAppUsesNonExemptEncryption` niet beantwoord | eigenaar bevestigt antwoord | WP2 |
| `ios-ci-archive` | Geen CI-bewijs voor een iOS-archive voor echte apparaten | code | **WP0 (deze PR)** |
| `android-version-injectable` | Versiecode/-naam hard gecodeerd | code | **WP0 (deze PR)** |
| `android-release-signing` | Geen release-signing vanuit CI-secrets | code | **WP0 (deze PR)** |
| `android-ci-bundle` | Geen CI-bewijs voor een Android App Bundle-release-build | code | **WP0 (deze PR)** |
| `android-play-test-workflow` | Beschermde handmatige workflow voor een getekende Play-testbundel (**opgelost in WP3**; draaien vereist de secrets van de eigenaar) | code | WP3 |
| `android-app-links` | Geen `autoVerify`-intent-filter | code + eigenaar (fingerprint) | WP7 |
| `well-known-association` | Geen `apple-app-site-association` / `assetlinks.json` | code + eigenaar (Team ID, fingerprint) | WP7 |
| `native-account-deletion` | Accountverwijdering niet vanuit de native app te starten | code | WP4 |
| `web-account-deletion` | Geen publieke verwijderpagina (Google Play vraagt een weblink) | code + besluit | WP4 |
| `terms-of-use` | Geen voorwaardenpagina | besluit + eigenaar (juridische tekst) | WP4 |
| `apple-token-revocation` | Sign in with Apple: tokenintrekking en server-naar-server-meldingen ontbreken (alleen bij `apple-signin`) | code | WP4 |
| `min-version-policy` | Backend kent geen minimaal ondersteunde native versie | code | WP5 |
| `native-push` | Geen APNs/FCM (alleen bij `push`) | code + eigenaar | WP12 |
| `device-test-report` | Geen enkel rapport met echte apparaattests | eigenaar (toestellen) + code | WP15 |

### 2.1 Guards (moeten waar blijven)

Een falende guard is een regressie en laat de CI falen. Ze bewaken dat de releasepoort dicht blijft en dat
er geen credentials in git komen.

| Id (script) | Wat er bewaakt wordt |
|---|---|
| `release-profile-blocked` | Het profiel komt uitsluitend uit `scripts/native/profiles.cjs`; `PROFILE_IDS` bevat geen `release` en geen enkele omgevingsvariabele opent het; `release` blijft geweigerd |
| `bundle-never-release-approved` | De lokale bundel schrijft altijd `releaseApproved:false` |
| `android-signing-refuses-probe` | Gradle en `android-release-guard.mjs` tekenen alleen een niet-compileproef `local-store-test`/`play-test`-bundel; de release-workflow is alleen handmatig en bevat geen Play-upload |
| `ios-signing-refuses-probe` | `ios-release-guard.mjs` archiveert alleen een niet-compileproef `local-store-test`/`testflight`-bundel; de iOS-workflow is alleen handmatig en exporteert zonder App Store Connect-upload |
| `bundle-identity-consistent` | Eén bundle-/applicatie-ID `app.versado.app` in Capacitor, Android en iOS |
| `phones-portrait` | Telefoons portrait-only (iPhone via Info.plist, Android via `MainActivity`) |
| `android-target-sdk` | `targetSdkVersion` ≥ 36 (Google Play, vanaf 31 augustus 2026) |
| `ios-deployment-target` | iOS-deploymentdoel ≥ 13 (Apple, vanaf 9 september 2026) |
| `no-credentials-in-git` | Geen `.p8`, `.p12`, `.mobileprovision`, `.keystore`, `.jks`, `.cer`, `.pem`, `google-services.json` of `GoogleService-Info.plist` in `ios/` en `android/` |

### 2.2 Aanvullende blokkades (handmatig bijhouden)

Het script kan deze niet uit bestanden afleiden:

| Id | Blokkade | Type |
|---|---|---|
| `scope-parity` | Het beleid vereist volledige pariteit; een kleinere Mobile 1.0 vraagt een expliciet goedgekeurde uitzondering (§3.3) | besluit |
| `store-accounts` | Apple Developer Program, Google Play Console, App ID/app-record en teamrollen: toestand onbekend in de repository | eigenaar |
| `brand-assets` | Native iconen en splash lijken sjabloonbeelden en zijn niet de PWA-iconen (visuele beoordeling); definitieve Versado-identiteit, screenshots, beschrijving en feature graphic ontbreken | eigenaar/ontwerp |
| `review-access` | Apple (2.1) en Google vragen een werkend testaccount en een live backend tijdens review | eigenaar |
| `backend-native-enabled` | `NATIVE_API_ENABLED` en `NATIVE_SESSION_SECRET` staan standaard uit; een bereikbare testbackend met Redis (realtime) is nodig | eigenaar (NAS/uitrol) |
| `content-rights-stores` | Schrifttekst, audio, kindercursus en lofzangen zijn "met toestemming" gebruikt (zie `CLAUDE.md`, `docs/hymns/01-SOURCE-AUDIT.md`); bevestig dat dit ook voor distributie via de stores geldt | eigenaar |
| `crash-monitoring` | Geen crash-/foutrapportage; store-eigen rapportage (Xcode Organizer, Android vitals) vraagt geen SDK en is het aanbevolen startpunt | besluit |

Geen blokkade meer (geverifieerd): Xcode 26/iOS 26 SDK op CI, iOS-deploymentdoel, Android
targetSdk 36, 16 KB-paginagrootte (geen eigen native code, zie §3.4), één app-ID.

## 3. Functiepariteit en de kleinste zinvolle Mobile 1.0

### 3.1 Matrix

Categorieën: **1** volledig native bruikbaar · **2** gedeeltelijk · **3** alleen via de webapp ·
**4** nog niet geïmplementeerd (geen native contract/scherm én geen eigen fundament) ·
**5** releaseblokkerend. De kolom "Voorstel" is een scopevoorstel, geen besluit.

| Gebied | Categorie | Wat er is (bewijs) | Wat ontbreekt | Voorstel |
|---|---|---|---|---|
| Vandaag en dagelijkse activiteiten | 2 + 5 | `/today` geeft één activiteit: eerste hoofdstuk van de actieve bron | Dagelijkse doelen, acties, echte "doorgaan"-logica, kaartvoorkeuren, hoofdnavigatie | In M2/1.0 (WP8) |
| Leren, cursussen, leesvoortgang | 4 + 5 | Alleen "hoofdstuk als gelezen markeren" (`/chapters/:id/complete`) | Cursussen, leerpaden, inschrijven, hervatten, voortgangsweergave | In M2/1.0 (WP9) |
| Schriftlezer, oefeningen, hoofdstukaudio | 2 + 5 | Verzen tonen (max. 499 per hoofdstuk), afronden | Oefeningen (server-uitgedeelde sets), annotaties, leespositie, audio (geautoriseerde Range-stream + lifecycle) | Lezer + oefeningen in M2/1.0 (WP10); audio: besluit (WP11) |
| CFM en FSY | 3 | Niets native | Studielezer, zes stappen, annotaties, weekselectie | Besluit: optie B (§3.3) |
| Spelen en multiplayer | 3 (fundament 2) | Realtime-handshake en sockettests; geen speltransport of scherm | Elk spelcontract en elk scherm (Woordzoeker, Scrabble, Slimste Heilige, Live quiz, Legpuzzel, Vliegende gids, Mysteries, Dorp) | Na 1.0 of conform uitzonderingsbesluit (WP17) |
| Vrienden, groepen, sociaal | 3 | Niets native | Alle sociale contracten, uitnodigingslinks | Na 1.0 of uitzondering (WP18) |
| Prestaties, XP, reeksen, beloningen | 3 | Server is de bron; native toont niets | Weergave en celebratie-regels | Basisweergave bij Vandaag/profiel (WP8/WP13) |
| Profiel, avatars, instellingen | 2 | Taal, wachtwoord wijzigen, Apple koppelen | Profielbeheer, avatar/gids, thema, meldingsvoorkeuren, 12 profielschermen | Minimaal in M2/1.0 (WP13) |
| Registratie, login, herstel, verwijderen | 2 + 5 | Registreren, inloggen, TOTP-setup, herstel, e-mailbevestiging (CI-integratietests) | **Account verwijderen**, onboarding, legacy-verificatiemail opnieuw aanvragen, algemeen TOTP-beheer | Verwijderen verplicht voor elke store-release (WP4) |
| Pushnotificaties | 4 | Alleen webpush (VAPID); geen APNs/FCM-model | Alles | Besluit; standaard buiten 1.0 (WP12) |
| Deeplinks | 2 + 5 | Lokale verwerking van reset-/bevestigingslinks met exacte origincontrole | Universal Links, App Links, uitnodigingen, meldingen | Reset/verify/uitnodiging in M2 (WP7) |
| Privacy, voorwaarden, offline, fouten | 2 + 5 | Privacy en cookies offline lokaal; lokale shell start zonder backend; offlinemelding en opnieuw proberen | Voorwaarden, juridische links in de store, foutstaten per scherm | Voorwaarden in WP4; foutstaten per WP |
| Beheer (`/adminbackend`) | 3 | Niets native | Alle beheerfuncties | Besluit: web-only voor beheerders (§3.3, D3) |

### 3.2 Wat "volwaardig" hier niet betekent

Een link naar de website, een WebView op `server.url` of een lege route telt niet als native
equivalent ([NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md)). Apple vraagt bovendien dat een app
"features, content, and UI" biedt "that elevate it beyond a repackaged website" (richtlijn 4.2).
De huidige proef voldoet daar niet aan; de voorgestelde kern in §3.3 is daarvoor bedoeld.

### 3.3 Voorstel: mijlpalen en scope

| Mijlpaal | Doel | Inhoud | Wat het wel/niet bewijst |
|---|---|---|---|
| **M0 Toestelbewijs** | Eerste echte installatie, ontwikkelbuild | Bestaande Foundation. iOS via Xcode op een toestel (eigen Team), Android debug-APK | Keychain/Keystore, WebView-layout, lifecycle, toetsenbord, backknop op een echt toestel. Geen distributie |
| **M1 Interne test** | TestFlight (intern) en Play (intern) | Foundation + distributieprofiel + ondertekende CI-builds + testbackend. Geen nieuwe functies | Distributieketen en signing werken. Apple noemt review alleen voor externe testers; Google meldt dat interne tests niet altijd de volledige beleids- en beveiligingsreview doorlopen |
| **M2 Externe test** | TestFlight extern, Play gesloten test | "Lees- en leerkern" (hieronder) + accountverwijdering + juridisch + store-metadata | Eerste beoordeling door Apple/Google, eerste echte gebruikers |
| **M3 Mobile 1.0** | Publieke release | M2 + volledige apparaattestmatrix + akkoord op uitzonderingen of verdere pariteit | Pas hier mag "Versado is beschikbaar in de store" |

**Voorgestelde kern ("Lees- en leerkern", optie A):** account (registreren, inloggen, herstel,
verplichte beveiliging, **verwijderen**), Vandaag, Leren (cursussen kiezen, hervatten,
leesvoortgang), Schriftlezer met server-uitgedeelde oefeningen en server-bepaalde XP/reeks,
profiel en instellingen (taal, wachtwoord, privacy, voorwaarden), offline-/foutafhandeling.
**Optie B** voegt de CFM-leeservaring toe (grootste inhoudelijke meerwaarde, maar de zwaarste
lezer: zes stappen, annotaties, weekselectie). **Optie C** is volledige pariteit (alle 138 pagina's).

Alles buiten de gekozen optie is **native achterstand** en moet zo gedocumenteerd, gemeld en in de
store-beschrijving niet beloofd worden. Spelen/multiplayer, sociaal, competitie, Dorp, beheer, push en
lofzangen vallen in optie A buiten 1.0. Zonder expliciet akkoord op die uitzonderingen blijft het
beleid "volledige pariteit" van kracht en is optie C de enige toegestane route naar M3.

### 3.4 Beslispunten voor de eigenaar

| Id | Beslissing | Aanbeveling |
|---|---|---|
| D1 | Scope van M2/M3: optie A, B of C | A voor M2, B of C voor M3 na zicht op de testresultaten |
| D2 | Goedkeuring van platformuitzonderingen (alles buiten de gekozen optie), vastgelegd in NATIVE-FEATURE-PARITY.md | Alleen expliciet per gebied, met teruglooptermijn |
| D3 | Beheer (`/adminbackend`) web-only voor beheerders | Ja; geen publieksfunctie |
| D4 | Sign in with Apple in 1.0? Alleen eigen accounts: de Apple-eis 4.8 ("equivalent login service") geldt dan niet. Zit het erin, dan zijn tokenintrekking en S2S-meldingen verplicht | Niet in 1.0 (uitgeschakeld laten; minder blokkades) |
| D5 | Testbackend voor TestFlight/Play: productie of aparte testomgeving | Aparte testomgeving met demo-account (Apple 2.1(a)) |
| D6 | Push in 1.0 | Nee |
| D7 | Hoofdstukaudio in 1.0 en bij welke offline-/downloadstrategie | Streamen met login; geen downloads in 1.0 |
| D8 | Voorwaarden: tekst, URL, taal; privacyverklaring is `/privacy` | Eigenaar levert tekst; WP4 bouwt de pagina |
| D9 | Appversie: de repository gebruikt 0.x tot de eerste stabiele release (`CLAUDE.md`); wordt de store-release 1.0.0? | 1.0.0 pas bij M3 |
| D10 | Apple Developer-/Play-accounttype (persoon of organisatie) | Organisatie indien mogelijk (zie §7: testeisen) |
| D11 | Crashrapportage: alleen store-eigen (Xcode Organizer, Android vitals), geen SDK | Ja |
| D12 | Native iconen en splash: definitieve Versado-beelden | Ontwerp levert; zie `docs/VERSADO-DESIGN.md` |
| D13 | Content- en licentiecontrole voor distributie via stores (`content-rights-stores`) | Eigenaar bevestigt schriftelijk |

## 4. Technische releasevoorwaarden

Geverifieerd op 23 oktober 2026 tegen officiële documentatie (bronnen en nog openstaande
verificaties in §11). Capacitor: `server.url` is bedoeld voor live-reload, niet voor productie;
zie [PLATFORMEN.md](PLATFORMEN.md) voor de gekozen hybride architectuur.

### 4.1 iOS

| Onderwerp | Vereiste / feit | Huidige staat | Actie |
|---|---|---|---|
| Xcode/SDK | Uploads vanaf 28 april 2026 met Xcode 26 en iOS 26 SDK | CI bouwt met iPhoneSimulator 26.5 SDK; nieuwe CI-stap controleert SDK ≥ 26 | Xcode-versie vastzetten in de release-workflow (WP2) |
| Minimale iOS | Apps die vanaf 9 september 2026 worden geüpload moeten iOS 13 of hoger targeten | iOS 15.0 | Geen |
| Bundle-ID en versie | Unieke bundle-ID; oplopend buildnummer per upload | `app.versado.app`; versie hard in project | Versie uit `package.json`, buildnummer uit CI-run via `xcodebuild`-argumenten (WP2) |
| Signing en provisioning | App Store-distributieprofiel via Team | Automatic signing zonder Team; geen profielen | Eigenaar: Developer Program, App ID, API-sleutel voor CI; WP2 |
| Sign in with Apple | Entitlement + REST-intrekking van tokens + S2S-meldingen (Apple: accountverwijdering) | Code aanwezig, entitlement niet gekoppeld, intrekking ontbreekt | D4; WP2/WP4 |
| Universal Links | `apple-app-site-association` op de backend + associated domains | Ontbreekt | WP7 (Team ID van de eigenaar) |
| Keychain | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` voor het refreshgeheim | Geïmplementeerd, nooit op toestel getest | Toestelbewijs M0 |
| Lifecycle/achtergrond | Sockets sluiten, audio, sessieherstel | Klassiek `AppDelegate`/`SceneDelegate` zonder aanpassing | Toesteltests (WP15) |
| Privacy manifest | Verplicht voor "required reason"-API's, ook van SDK's, sinds 1 mei 2024 | `PrivacyInfo.xcprivacy` ontbreekt | Bepalen via Xcode privacyrapport; deklaratie van verzamelde gegevens volgt uit D5/D8 (WP2) |
| Export compliance | Versleuteling (HTTPS) beantwoorden in Info.plist of App Store Connect | `ITSAppUsesNonExemptEncryption` ontbreekt | Eigenaar bevestigt antwoord (WP2) |
| Capaciteit apparaten | `UIRequiredDeviceCapabilities` bevat `armv7` (sjabloon) | Niet gecontroleerd tegen de huidige Apple-eisen | Controleren en herzien in WP2 |
| App Store Connect/TestFlight | Intern: ≤ 100 gebruikers met toegang tot de content; extern: ≤ 10.000; eerste build per groep gaat naar App Review; builds 90 dagen testbaar | Niet ingericht | Eigenaar; zie §6 |
| EU-handelaarsstatus | Zonder trader status vallen apps in de EU uit de store | Niet bekend | Eigenaar (D10) |
| Leeftijdsclassificatie | Nieuwe leeftijdsvragen (sinds 31 jan 2026) beantwoorden | Niet bekend | Eigenaar (WP16) |

### 4.2 Android

| Onderwerp | Vereiste / feit | Huidige staat | Actie |
|---|---|---|---|
| Target SDK | Nieuwe apps en updates targeten vanaf 31 augustus 2026 Android 16 (API 36); uitstel tot 1 november 2026 mogelijk | `targetSdk 36` | Geen |
| App Bundle | Nieuwe apps publiceren met een Android App Bundle (AAB) | CI bouwt nu een unsigned `bundleRelease` | WP3: signed AAB in release-workflow |
| Signing | Play App Signing met een uploadsleutel | Release-signing leest `VERSADO_UPLOAD_KEYSTORE_*`; geen sleutel in git (guard) | Eigenaar maakt de uploadsleutel; WP3 |
| Versiebeheer | Oplopende `versionCode` per upload | `VERSADO_VERSION_CODE`/`_NAME` injecteerbaar | CI-runnummer als code (WP3) |
| Android Keystore | AES-GCM sleutel in `AndroidKeyStore` | Geïmplementeerd, nooit op toestel getest | Toestelbewijs M0 |
| App Links | `assetlinks.json` met release-fingerprint + `autoVerify`-intent-filter | Ontbreekt | WP7 (fingerprint van de Play-ondertekening) |
| Terugknop | Systeem-back via `App.backButton` → router, anders afsluiten | Aanwezig in `platform.ts`; predictive back niet beoordeeld | Toesteltest (WP15) |
| Achtergrondgedrag | Sockets/audio bij achtergrond | Niet getest | WP15 |
| 16 KB-paginagrootte | Apps met target ≥ 35 moeten dit ondersteunen; Java/Kotlin-only apps doen dat al; updates zonder ondersteuning worden vanaf 1 februari 2027 geweigerd | Geen eigen native bibliotheken in de repository | Controleren in de Play pre-launch-rapportage |
| Testtracks | Intern: ≤ 100 testers; gesloten: lijsten tot 2.000 gebruikers; open | Niet ingericht | Eigenaar; zie §7 |
| Nieuwe persoonlijke accounts | Voor productietoegang: gesloten test met ≥ 12 testers gedurende 14 aaneengesloten dagen (accounts aangemaakt na 13 nov 2023) | Accounttype onbekend | D10; plan de 14 dagen vroeg in |

### 4.3 Beide platformen

| Onderwerp | Vereiste | Huidige staat | Actie |
|---|---|---|---|
| Accountverwijdering | Apple 5.1.1(v): verwijdering vanuit de app starten, volledige accountrecord, geen mailen/bellen; Google: in-app pad **en** weblink | Alleen web (`DELETE /api/account`); native en publieke pagina ontbreken | WP4 |
| Privacyverklaring en voorwaarden | Openbare URL's; privacy in de store-metadata | `/privacy` en `/cookies` bestaan (ook lokaal in de app); voorwaarden ontbreken | WP4, D8 |
| Contentrechten | Aantoonbare rechten voor tekst, audio, afbeeldingen, lofzangen | Zie `content-rights-stores` | Eigenaar (D13) |
| Storemetadata | Naam, beschrijving, screenshots, iconen, leeftijdsclassificatie, privacylabels/Data safety, supportcontact | Ontbreekt | WP16 |
| Netwerk/offline | Lokale shell start zonder backend; fouten zichtbaar | Aanwezig; per scherm uitbreiden | Elk WP |
| Toegankelijkheid | VoiceOver/TalkBack, grote tekst, contrast | Webregels bestaan (`docs/LAYOUT.md`); niet op toestel getest | WP15 |
| Beveiligde opslag | Keychain/Keystore voor het refreshgeheim; access-token alleen in geheugen | Geïmplementeerd | Toestelbewijs |
| Backendcompatibiliteit | Oudere appversies blijven werken; te oude app krijgt een nette update-melding | `capabilities.apiVersion = 1`; geen minimumversie | WP5 |
| Updatestrategie | Servercontent zonder store-update; clientcode alleen via store (geen verborgen remote code) | Beschreven in `PLATFORMEN.md` | WP5 legt de afspraak vast |

## 5. Distributieprofielen en reproduceerbare builds

De bestaande blokkade in `capacitor.config.ts` blijft. Voorgesteld wordt een **afzonderlijk, expliciet
profiel per distributiekanaal** (WP1). Voorwaarden gelden in code, niet in een handleiding:

| Kanaal | Profiel | Backend | Signing | Zichtbaar in de app | `releaseApproved` |
|---|---|---|---|---|---|
| Development | `local-development` (bestaat) | HTTPS of loopback | geen / debug | "Development" | `false` |
| Interne apparaatbuild | `local-internal` (nieuw) | alleen HTTPS-origin uit een allowlist (`NATIVE_ALLOWED_API_ORIGINS`), nooit cleartext | development- of ad-hoc-signing | "Intern" | `false` |
| TestFlight / Play-test | `local-store-test` (nieuw) | alleen allowlist-origin met bereikbare `capabilities`; alleen in CI-omgeving | distributieprofiel / uploadsleutel uit secrets | "Testversie" + kanaal | `false` |
| Productierelease | `release` | — | — | — | blijft **geweigerd** tot alle blokkades uit `native:store-readiness --strict` zijn opgelost én de eigenaar de wijziging expliciet goedkeurt |

Regels: elk testprofiel schrijft `channel` in `dist/native/build.json`; `verify-distribution.mjs` (voorheen
`verify-development.mjs`) vergelijkt kanaal, origin en assets met de verpakte bundel; een testkanaal
verschijnt nooit als "release". De guards in `scripts/native/store-readiness.mjs` falen zodra het profiel
`release` zou accepteren of de bundel zichzelf goedkeurt. **De tabel hierboven is het ontwerp; §5.1 beschrijft
wat WP1 daadwerkelijk heeft gebouwd** (de allowlist staat in een gecommit bestand i.p.v. `NATIVE_ALLOWED_API_ORIGINS`,
zodat de eigenaar de origins reviewbaar vastlegt en er geen tweede bron bestaat).

Reproduceerbare builds (WP2/WP3): één workflow per platform met `workflow_dispatch`, beschermde
GitHub-omgeving en secrets van de eigenaar. Versie uit `package.json`, buildnummer uit het CI-runnummer
(`VERSADO_VERSION_CODE` voor Android; `CURRENT_PROJECT_VERSION` voor iOS). **Deze PR levert alleen
compileproeven zonder signing, upload of artifact.**

Voorgestelde secretnamen (de eigenaar maakt en vult ze; er zijn geen waarden verzonnen):
`APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64), `ANDROID_UPLOAD_KEYSTORE_B64`,
`ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`, optioneel
`PLAY_SERVICE_ACCOUNT_JSON`. Deze worden pas in WP2/WP3 gebruikt.

### 5.1 WP1 — gerealiseerd (distributieprofielen)

**Eén bron van waarheid:** `scripts/native/profiles.cjs` (CommonJS, omdat de Capacitor-CLI `capacitor.config.ts`
als CJS evalueert). `capacitor.config.ts`, `scripts/native/build.ts`, `verify-distribution.mjs` en de tests lezen
alle profielregels daar; er is geen tweede lijst.

| Profiel | Gebruik | Backend | Kanaal | Zichtbaar in de app | `releaseApproved` |
|---|---|---|---|---|---|
| `remote-preview` | Capacitor als venster op een remote preview (ongewijzigd) | `CAPACITOR_SERVER_URL` | `remote-preview` | n.v.t. | n.v.t. |
| `local-development` | Lokale bundel voor ontwikkeling (ongewijzigd; HTTPS of loopback-HTTP met `NATIVE_ALLOW_LOCAL_HTTP_API=1`) | `NATIVE_API_BASE_URL` | `development` | nee | `false` |
| `local-internal` | Interne apparaatbuild | HTTPS-origin uit allowlist `internal` | `internal` | banner "Interne build" | `false` |
| `local-store-test` | TestFlight / Play-test | HTTPS-origin uit allowlist `store-test` | `testflight` (alleen iOS) of `play-test` (alleen Android) | banner "Testversie" | `false` |
| `release` | — | — | — | — | **geblokkeerd**; geen omgevingsvariabele of flag opent dit |

**Origin-regels voor distributieprofielen:** exacte, genormaliseerde `https://host[:poort]`; geen wildcard,
credentials, pad/query/fragment, IP-adres, loopback of gereserveerd domein; geen HTTP en geen cleartext
(`NATIVE_ALLOW_LOCAL_HTTP_API`/`CAPACITOR_ALLOW_CLEARTEXT` worden geweigerd); geen `CAPACITOR_SERVER_URL`. De
origin moet voorkomen in `scripts/native/distribution-origins.json` (`internal` resp. `store-test`); een lege lijst,
ontbrekende of onbekende origin weigert de build met een eigenaartaak, zonder standaardwaarde. De CSP in de
bundel (`connect-src` met alleen die origin) blokkeert daarnaast elke redirect naar een andere host.

**Compileproef (alleen CI):** `NATIVE_COMPILE_PROBE=1` accepteert uitsluitend `https://example.invalid` (RFC 2606),
zodat CI de volledige keten kan bouwen zonder een testdomein te verzinnen. Zulke bundels staan in `build.json`
als `compileProbe:true`, tonen dat in de bouwmelding en zijn nooit uploadbaar.

**Buildmetadata (`dist/native/build.json`, schemaVersion 2):** `appId`, `profile`, `channel`, `distribution`,
`compileProbe`, `apiOrigin`, `version`, `buildNumber`, `sourceCommit`, `releaseApproved:false` en de SHA-256 van
elk bundelbestand. Bij `npx cap sync` controleert `capacitor.config.ts` dat de bundel bij het gevraagde profiel
past (een verouderde of andersoortige bundel weigert); de verificatie vergelijkt daarna de verpakte assets
(Android `assets/public`, iOS `App/public`) byte voor byte met de bron en met de hashes.

**Verificatiecontract per profiel** (`node scripts/native/verify-distribution.mjs <android|ios> [map]`):
app-ID `app.versado.app`; kanaal en platform kloppen; origin gelijk in `build.json`, CSP en `index.js`;
geen externe scripts/stylesheets; geen onverwachte bestanden; `capacitor.config.json` zonder `server.url`,
met `server.cleartext=false` voor distributie en zonder development-instellingen; geen `usesCleartextTraffic`/
`debuggable`/`NSAllowsArbitraryLoads`; geen geheimen in de verpakte bestanden; `releaseApproved:false`.

**Bouwcommando's** (voorbeeld; de waarden voor `NATIVE_API_BASE_URL` moeten eerst in de allowlist staan):

```bash
# development (ongewijzigd)
CAPACITOR_BUILD_PROFILE=local-development NATIVE_API_BASE_URL=<https-origin> npm run native:build
# interne build
CAPACITOR_BUILD_PROFILE=local-internal NATIVE_API_BASE_URL=<origin uit allowlist internal> \
  NATIVE_DISTRIBUTION_CHANNEL=internal NATIVE_APP_VERSION=0.1.0 NATIVE_BUILD_NUMBER=7 npm run native:build
# store-test (testflight voor iOS, play-test voor Android)
CAPACITOR_BUILD_PROFILE=local-store-test NATIVE_API_BASE_URL=<origin uit allowlist store-test> \
  NATIVE_DISTRIBUTION_CHANNEL=testflight NATIVE_APP_VERSION=0.1.0 NATIVE_BUILD_NUMBER=7 npm run native:build
npx cap sync <ios|android> && npm run native:verify -- <ios|android>
```

Vereiste omgevingsvariabelen: `CAPACITOR_BUILD_PROFILE`, `NATIVE_API_BASE_URL`; voor distributie ook
`NATIVE_APP_VERSION` (x.y.z) en `NATIVE_BUILD_NUMBER` (geheel getal, store-test verplicht), `NATIVE_DISTRIBUTION_CHANNEL`
(store-test) en een bepaalbare broncommit (`GITHUB_SHA` of git-checkout). Optioneel: `NATIVE_BUILD_OUTDIR` (binnen `dist/` of de tijdelijke map).

**Intern versus store-test:** intern = ad-hoc/development-signing en eigen toestellen, eigen allowlist, kanaal
`internal`; store-test = distributiesigning en upload door de eigenaar in WP2/WP3, andere allowlist, kanaal per
platform, versie en buildnummer verplicht. Een origin uit de ene lijst wordt voor het andere profiel geweigerd.

**Nog open voor de eigenaar (geen oplossing met een onveilige standaard):** de HTTPS-origin(s) van de testbackend
in `scripts/native/distribution-origins.json` (reviewbare PR, blokkade `distribution-origins-configured`) en de
overige taken uit §10. Tot dat moment bouwt CI uitsluitend compileproeven.

**Testresultaten WP1:** `npm run test:native` (56, incl. 13 nieuwe profieltests: positief en negatief voor alle vier
profielen, geblokkeerd release, onbekende/HTTP-origins, ontbrekende configuratie, metadata, verpakte assets),
`npm run test:native:store-readiness`, `npm run test:native:parity`, `npm run native:parity:check`, `tsc`,
i18n-check; CI: native-platform-builds bouwt voor Android en iOS de profielen development, internal en store-test
(compileproef), controleert dat `release` faalt, bouwt de ongetekende AAB (play-test) en de iOS-archive (testflight).

**Afhankelijkheden voor WP2 (iOS):** gebruikt `local-store-test` + kanaal `testflight`, `NATIVE_BUILD_NUMBER` →
`CURRENT_PROJECT_VERSION`, allowlist-origin, privacy manifest/entitlements (blokkades WP2), Apple-secrets van de
eigenaar. **WP3 (Android):** `local-store-test` + `play-test`, `NATIVE_BUILD_NUMBER` → `VERSADO_VERSION_CODE`, uploadsleutel
uit secrets, allowlist-origin.

### 5.2 CI-compilebewijs versus echte ondertekende distributiebuilds

Een groene CI betekent **niet** dat er een distributiebuild bestaat. Het onderscheid is bewust hard:

| | CI-compilebewijs (elke PR/push) | Echte ondertekende distributiebuild (handmatig) |
|---|---|---|
| Doel | Bewijzen dat de keten compileert en dat de poorten werken | Een installeerbaar artifact voor TestFlight of Play-test |
| Backend-origin | Alleen `https://example.invalid` (`compileProbe:true`) | Een origin uit de allowlist (`distribution-origins.json`) |
| Signing | Geen; of een wegwerpsleutel die in de runner ontstaat en verdwijnt | Uploadsleutel/API-sleutel uit de beschermde omgeving |
| Artifact | Geen distributieartifact (debug-APK/simulatorzip als compileproef) | Getekende AAB of IPA, 7 dagen bewaard, sha256 in de samenvatting |
| Start | Automatisch | Alleen `workflow_dispatch` vanaf `main`, omgeving met goedkeurders |
| Upload naar store | Nooit | Nooit door de workflow; de eigenaar plaatst het artifact handmatig |
| Wat het bewijst | Compilatie, poortgedrag (weigert probe/intern/foute versie), privacy manifest en versie in het archief | Pas na de eerste echte run en een toesteltest (M0/M1) |

Een compileproef wordt in elke laag geweigerd voor tekenen of archiveren: Gradle (`GradleException`), `android-release-guard.mjs` /
`ios-release-guard.mjs`, en de CI bewijst dat met een wegwerpsleutel respectievelijk een probe-archief. Workflowinvoer wordt nooit
in shelltekst geïnterpoleerd (alleen via `env`, met voorafgaande validatie) en secrets staan alleen in de stap die ze gebruikt.
Open veiligheidspunten voor de eigenaar: beperk de App Store Connect API-sleutel tot de minimaal nodige rol (`-allowProvisioningUpdates`
mag certificaten en profielen aanmaken), zet vereiste goedkeurders op beide omgevingen, en overweeg een vastgezette uploadcertificaat-vingerafdruk
zodra de sleutel bestaat.

## 6. TestFlight-traject (iOS)

| Stap | Wie | Resultaat |
|---|---|---|
| 1. Apple Developer Program, Team, rollen; App ID `app.versado.app` | Eigenaar | Team ID; capabilities naar keuze (D4) |
| 2. App-record in App Store Connect (naam, primaire taal, bundle-ID, SKU); handelaarsstatus (EU) | Eigenaar | App-record |
| 3. API-sleutel voor CI (Issuer ID, Key ID, `.p8`) en secrets in GitHub | Eigenaar | Secrets (§5) |
| 4. WP1 + WP2 mergen: distributieprofiel, versies, privacy manifest, entitlements, signed archive-workflow | Claude/Codex, eigenaar keurt goed | Reproduceerbare `.ipa` |
| 5. Workflow uploadt naar App Store Connect | Workflow, eigenaar start | Build in TestFlight |
| 6. Interne testers (App Store Connect-gebruikers, ≤ 100); Apple koppelt review aan het uitnodigen van externe testers | Eigenaar | M1 |
| 7. Exportvraag, testinformatie, testaccount; eerste externe groep → eerste build gaat naar App Review | Eigenaar | M2 (≤ 10.000 externe testers, 90 dagen per build) |

### 6.1 WP2 — voorbereid (iOS-releasetechniek)

Alles wat zonder eigenaarsbeslissing kan, is gebouwd; wat een beslissing of account vereist, staat hieronder als open punt.

**Gerealiseerd**
- `ios/App/App/PrivacyInfo.xcprivacy` (geen tracking, geen tracking-domeinen, geen toegang tot "required reason"-API's vanuit
  de app-code; Capacitor levert zijn eigen manifesten) en opgenomen in het app-target (Resources). Een test bewaakt dat het in `project.pbxproj` staat.
- `UIRequiredDeviceCapabilities` is `arm64` (was het sjabloonwaarde `armv7`, ongeldig voor een iOS 15+ arm64-binary).
- `scripts/native/ios-release-guard.mjs before|after`: archiveert alleen een niet-compileproef `local-store-test`/`testflight`-bundel met echte
  HTTPS-origin, versie en buildnummer gelijk aan `NATIVE_APP_VERSION`/`NATIVE_BUILD_NUMBER` en `sourceCommit` = `GITHUB_SHA`; achteraf
  controle van het archief (`CFBundleIdentifier`, `CFBundleShortVersionString`, `CFBundleVersion`, `public/build.json`, privacy manifest, geen `CAPACITOR_DEBUG`).
- `.github/workflows/native-ios-release.yml`: alleen `workflow_dispatch`, alleen vanaf `main`, omgeving `ios-testflight`; controleert SDK ≥ 26 en pint optioneel
  Xcode via variabele `IOS_XCODE_APP`; archiveert met `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`/`DEVELOPMENT_TEAM` als argumenten (nooit in git) en
  ondertekent via de App Store Connect API-sleutel (tijdelijk bestand met `umask 077`, altijd verwijderd); exporteert met `destination export`.
  **Geen upload naar App Store Connect.**
- CI (`native-platform-builds`): de poort weigert het compileproef-archief, en het echte archief bevat de juiste versie, het bundel-ID en het privacy manifest.

**Secrets en variabelen (omgeving `ios-testflight`, door de eigenaar):** `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64);
variabelen `NATIVE_STORE_TEST_API_ORIGIN` en optioneel `IOS_XCODE_APP`. Het buildnummer is het workflow-runnummer (oplopend per upload).

**Open voor de eigenaar (bewust niet ingevuld):**
- `ITSAppUsesNonExemptEncryption`: de eigenaar bevestigt het exportantwoord (de app gebruikt uitsluitend HTTPS/standaardversleuteling van het systeem; de sleutel in Info.plist is een juridische verklaring en wordt niet door code gekozen).
- Entitlements: Sign in with Apple en associated domains pas na D4 en het Team ID (`SignInWithApple.entitlements.example` blijft een voorbeeld).
- Privacylabels in App Store Connect en de eventuele aanvulling van `NSPrivacyCollectedDataTypes` (D5/D8).
- Apple Developer-account, Team ID, App ID, App Store Connect-record en API-sleutel; testbackend-origin (NAS-teststack, DNS, TLS) en allowlist-PR.

**Route naar M0 (iOS):** build met `local-development` via Xcode op een eigen toestel (eigen Team in Xcode, automatic signing; dit is geen distributie), controle van Keychain,
WebView-layout/safe areas, toetsenbord, lifecycle en offline herstel; vastleggen in `docs/NATIVE-DEVICE-TEST-REPORT.md`. De CI kan dit niet vervangen (geen toestel, geen Team).
Het workflow kan pas worden gecontroleerd zodra de eigenaar de secrets heeft ingesteld; tot dan bewijst CI alleen de poorten en een ongetekend archief.

## 7. Google Play-testtraject (Android)

| Stap | Wie | Resultaat |
|---|---|---|
| 1. Play Console-account en verificatie; accounttype (D10) | Eigenaar | Account |
| 2. App aanmaken; Play App Signing inschakelen; uploadsleutel genereren (`keytool`) en als secret opslaan | Eigenaar | Uploadsleutel (nooit in git) |
| 3. WP1 + WP3 mergen: distributieprofiel, signed `bundleRelease`-workflow | Claude/Codex, eigenaar keurt goed | Signed AAB |
| 4. Eerste upload naar **interne test** (≤ 100 testers; Google: "might not be subject to standard Play policy or security reviews") | Eigenaar of workflow | M1 |
| 5. App content invullen: privacyverklaring, Data safety (incl. accountverwijdering en weblink), contentclassificatie, doelgroep, app-toegang (testaccount) | Eigenaar | Vereist voor M2 |
| 6. **Gesloten test**: ≥ 12 testers, 14 aaneengesloten dagen bij een persoonlijk account na 13 nov 2023 | Eigenaar | Toegang tot productie |
| 7. Pre-launch-rapportage controleren (16 KB, crashes, toegankelijkheid) | Claude/Codex + eigenaar | M2 |

### 7.1 WP3 — gerealiseerd (Android-releasetechniek)

**Besluit eigenaar (testbackend):** een afzonderlijke HTTPS-testbackend op de NAS. Er is bewust géén URL ingevuld en de
productie-origin staat nergens in de allowlist; `distribution-origins.json` blijft leeg (veilige blokkering actief) totdat
teststack, DNS en TLS zijn ingericht. Dat is een eigenaartaak (blokkade `distribution-origins-configured`).

**Signing en poorten (drie lagen, dezelfde regels):**
1. `android/app/build.gradle`: ondertekent alleen als `VERSADO_UPLOAD_KEYSTORE_PATH` gezet is, en dan alleen wanneer
   `build.json` in de assets bij `local-store-test`/`play-test` hoort, `compileProbe:false`, `releaseApproved:false`,
   een echte HTTPS-origin heeft en `buildNumber`/`version` gelijk zijn aan `VERSADO_VERSION_CODE`/`VERSADO_VERSION_NAME`;
   anders `GradleException`. Zonder sleutel blijft de release ongetekend (geen terugval op de debugsleutel).
2. `scripts/native/android-release-guard.mjs before|after`: dezelfde regels vóór het bouwen, plus controle dat de
   metadata in dist en assets gelijk zijn en dat `sourceCommit` gelijk is aan `GITHUB_SHA`; achteraf `jarsigner`-verificatie,
   afkeuring van ongetekend of debug-getekend, en de sha256.
3. `.github/workflows/native-android-release.yml`: uitsluitend `workflow_dispatch`, uitsluitend vanaf `main`, in de beschermde
   omgeving `android-play-test`. Controleert de aanwezigheid van secrets zonder waarden te tonen, schrijft de sleutel met
   `umask 077` naar de runner-temp en verwijdert hem altijd, bouwt `bundleRelease`, controleert de bundel en bewaart het
   artifact zeven dagen. **Er is geen Play-upload**: de eigenaar plaatst de bundel handmatig in de interne test.

**Secrets en variabelen (de eigenaar maakt ze aan in omgeving `android-play-test`, met vereiste goedkeurders):**
`ANDROID_UPLOAD_KEYSTORE_B64` (base64 van de uploadsleutel), `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
`ANDROID_UPLOAD_KEY_PASSWORD`; variabele (niet geheim) `NATIVE_STORE_TEST_API_ORIGIN`. De versiecode is het workflow-runnummer
(monotoon stijgend), de versienaam de invoer `app_version`. Geen waarden in git of logs.

**Minificatie-besluit:** R8 blijft voorlopig uit (`minifyEnabled false`) totdat M0 op een echt toestel de plugin
(`VersadoNative`, Keystore) en Capacitor onder R8 heeft bewezen; een niet op toestel getest R8-profiel is een groter risico dan
een iets grotere bundel. Heroverwegen vóór M2. Manifest: `allowBackup=false`, geen `usesCleartextTraffic`, geen `debuggable`.

**CI-bewijs:** `native-platform-builds` bouwt per push de ongetekende AAB (play-test, compileproef), bewijst dat een
geldige wegwerpsleutel een compileproef **niet** tekent (guard en Gradle), en doorloopt de volledige signingketen met een
wegwerpsleutel en een tijdelijke, niet-gecommitte allowlist-aanvulling in de runner; het resultaat wordt gecontroleerd en weggegooid.
Lokaal: `npm run test:native:android-release` (echte `jarsigner`-controle met een wegwerpsleutel).

**Route naar M0 (eerste echte toesteltest, Android):**
1. Debug-APK via `native-platform-builds` of lokaal (`local-development`) op een telefoon én een tablet installeren.
2. Controleren: Keystore-opslag, WebView-layout/safe areas, toetsenbord, terugknop, lifecycle (achtergrond/voorgrond), offline herstel,
   portrait op telefoon en landscape op tablet; resultaten vastleggen in `docs/NATIVE-DEVICE-TEST-REPORT.md`.
3. Zodra de testbackend en de signingsecrets bestaan: workflow `native-android-release` starten, AAB plaatsen in de interne Play-test (M1).
Voor M0 zelf zijn geen signingsleutels of backend nodig als de debugbuild naar een lokale of tijdelijke testbackend wijst
(`local-development`, expliciet HTTPS of loopback-HTTP).

**Eigenaartaken WP3:** Play Console-account en app-record, Play App Signing, uploadsleutel genereren en als secrets opslaan,
omgeving `android-play-test` met goedkeurders, `NATIVE_STORE_TEST_API_ORIGIN` na inrichting van de NAS-teststack, en de allowlist-PR.

## 8. Vereiste fysieke apparaattests

Geen enkele test hieronder is vandaag uitgevoerd. De resultaten komen in `docs/NATIVE-DEVICE-TEST-REPORT.md`
(`device-test-report`); een Chromium- of simulatortest vervangt dit nooit.

| Apparaat (minimaal) | OS |
|---|---|
| iPhone, klein scherm (320 pt breed) en een recent model | laagst ondersteunde (iOS 15) en nieuwste |
| iPad (beide richtingen) | nieuwste |
| Android-telefoon (twee fabrikanten) | laagst praktische (API 24+) en Android 16 |
| Android-tablet (beide richtingen) | Android 16 |

Testlijst per apparaat: koude start zonder netwerk; login/logout; sessie na herstart en na herinstallatie
(Keychain/Keystore); verlopen/ingetrokken sessie; achtergrond ↔ voorgrond (sockets, audio);
toetsenbord en safe areas; 200% tekst en lange vertaling (nl/en/de/fr/es); VoiceOver/TalkBack;
Android-backknop en predictive back; reset-/bevestigingslink; netwerkverlies midden in een actie;
accountverwijdering; (indien in scope) audio op de achtergrond, push, Sign in with Apple, deeplinks.

## 9. Werkpakketten en volgorde

Afhankelijkheden: WP0 → WP1 → (WP2 ∥ WP3 ∥ WP5) → M1. WP4 en WP6 → WP8/9/10/13 → M2. WP7 na
WP1 en de eigenaargegevens. WP15/16 lopen mee en sluiten M2/M3 af.

**WP0 — Dit PR: plan, releasegate, voorbereidingen (klaar ter beoordeling)**
- Scope: dit document, `scripts/native/store-readiness.mjs` + test, Android-versie/-signing uit omgeving,
  CI-compileproeven (unsigned AAB, iOS-archive met SDK-controle), verwijzingen in `PLATFORMEN.md` en `CLAUDE.md`.
- Acceptatie: guards groen; blokkades zichtbaar; geen gedragswijziging van de app; CI groen.
- Tests: `npm run test:native:store-readiness`, `native:parity:check`, bestaande native-jobs.
- Blokkades: geen nieuwe.

**WP1 — Distributieprofielen (geïmplementeerd; zie §5.1)**
- Doel: expliciete kanalen zonder `release` te openen (§5).
- Afhankelijk van: WP0, D5 (backendorigin).
- Scope: `capacitor.config.ts` (`DISTRIBUTION_PROFILES`), `scripts/native/build.ts` (`channel`, allowlist),
  `verify-development.mjs` is hernoemd naar `verify-distribution.mjs`, zichtbaar kanaal in de app, guards bijwerken.
- Acceptatie: `release` blijft een fout; testprofielen weigeren cleartext, onbekende origin en ontbrekende
  versie; `build.json` bevat kanaal en `releaseApproved:false`; verpakte assets gelijk aan `dist/native`.
- Tests: uitbreiding van `tests/native-foundation.test.ts` (profielvalidatie), negatieve CI-controles, readiness-test.
- Blokkades: backendorigin van de eigenaar.

**WP2 — iOS-releasetechniek (voorbereid; zie §6.1)**
- Afhankelijk van: WP1; eigenaar: Team, API-sleutel.
- Scope: versie uit `package.json`/CI, entitlements (alleen indien D4/D8), `PrivacyInfo.xcprivacy`,
  `ITSAppUsesNonExemptEncryption`, `UIRequiredDeviceCapabilities` herzien, vastgezette Xcode,
  `workflow_dispatch` voor signed archive + upload.
- Acceptatie: signed IPA reproduceerbaar uit CI; Xcode-archive-validatie zonder waarschuwingen over privacy;
  geen secrets in git (guard).
- Tests: archive op CI, `native:store-readiness`, handmatige installatie op een toestel (M0).
- Blokkades: Team ID, privacylabels (D5/D8).

**WP3 — Android-releasetechniek (geïmplementeerd; zie §7.1)**
- Afhankelijk van: WP1; eigenaar: uploadsleutel.
- Scope: `bundleRelease` signed in een beschermde workflow, versiecode uit CI-runnummer, minificatie-besluit
  (R8 aan/uit met ProGuard-regels voor Capacitor), manifesthardening, optioneel upload naar interne test.
- Acceptatie: signed AAB reproduceerbaar; Play accepteert de upload; geen sleutels in git.
- Tests: `bundleRelease` op CI, installatie van een bundletool-APK-set op een toestel.
- Blokkades: uploadsleutel en Play-account.

**WP4 — Accountlevenscyclus en juridisch**
- Afhankelijk van: bestaande `src/lib/accountDeletion.ts`; D4, D8.
- Scope: native `DELETE /api/v1/native/account` met herauthenticatie (wachtwoord/TOTP) en intrekking van
  alle sessies/sockets, native scherm "Account verwijderen", publieke pagina `/account-verwijderen`
  zonder app, pagina `/voorwaarden`, links in de app en in de store-metadata, (indien D4) Apple-tokenintrekking
  en S2S-meldingen.
- Acceptatie: verwijdering werkt vanuit de app én zonder app; sessies ongeldig; PendingRegistration-opruiming;
  geen blinde retry; teksten in alle `uiReady`-talen.
- Tests: native-account-integratietest (uitbreiden), rechten-/replaytest, browsertest op 320 px en 200%.
- Blokkades: juridische tekst (eigenaar).

**WP5 — Backend- en versiebeleid**
- Scope: `minimumNativeVersion` en kanaal in `capabilities`, update-melding in de app, checklist voor
  `NATIVE_API_ENABLED`, `NATIVE_SESSION_SECRET`, Redis en toegestane origins, afspraak over server- versus
  clientwijzigingen (zonder verborgen remote code), observability zonder tokenlogging.
- Acceptatie: oude app krijgt een duidelijke melding; nieuwe server blijft versie 1 bedienen.
- Tests: contracttests voor `capabilities`, oude-client-simulatie.
- Blokkades: uitrol is voor de eigenaar.

**WP6 — Native shell en datalaag (basis voor WP8–WP14)**
- Scope: hoofdnavigatie (Vandaag, Leren, Spelen, Vrienden — alleen schermen met echte inhoud),
  native adapters voor `useLiveQuery`/`liveMutation`, contentcontext, foutstaten, loadingstaten.
- Acceptatie: geen doelloze navigatieknoppen; contentwissel en taalwissel via één plek;
  offline en netwerkherstel zonder losse refreshlogica.
- Tests: navigatie-, data- en layouttests (320 px, 200%), live-data-regels.

**WP7 — Deeplinks**
- Scope: `apple-app-site-association`, `assetlinks.json`, associated domains, `autoVerify`-intent-filters,
  routes voor reset, bevestiging en uitnodigingen, geweigerde onbekende routes.
- Blokkades: Team ID en Play-ondertekeningsfingerprint van de eigenaar.

**WP8 — Vandaag**: echte Vandaag-kaarten, dagelijkse doelen, reeks/XP-weergave (alleen lezen),
doorgaan-logica. **WP9 — Leren**: cursussen, leerpaden, hervatten, leesvoortgang uit één bron.
**WP10 — Schriftlezer en oefeningen**: verzen, oefensessies (`issueExerciseSession`/`submitExerciseSession`),
server-bepaalde XP/reeks, leespositie. Voor WP8–WP10 geldt: één leervoortgang-bron, nooit een eigen XP-formule
(`docs/LEERVOORTGANG.md`).

**WP11 — Hoofdstukaudio (afhankelijk van D7 en de lopende audio-PR's)**: geautoriseerde Range-stream met
sessie, achtergrond-/lifecyclegedrag, `playableAudioUrl()`-regel, respect voor `ChapterAudioCheck` (#187).

**WP12 — Native push (alleen bij D6)**: apart apparaattokenmodel, APNs/FCM, permissieflow, intrekking bij
uitloggen, privacy-documentatie. **WP13 — Profiel en instellingen**: taal, thema, gids/avatar, meldingsvoorkeuren
(zonder push), privacyschermen. **WP14 — CFM/FSY (alleen optie B/C)**: studielezer volgens
`docs/CFM-PERSOONLIJKE-STUDIE.md`, zonder tweede annotatiesysteem.

**WP15 — Apparaattestcampagne en toegankelijkheid**: §8 uitvoeren, rapport `docs/NATIVE-DEVICE-TEST-REPORT.md`.
**WP16 — Store-listing**: screenshots, beschrijving, privacylabels/Data safety, leeftijdsclassificatie,
reviewnotities en testaccount, supportcontact (eigenaar levert inhoud).

**WP17/WP18 — Spelen en sociaal (pariteit na 1.0 of conform D2)**: per spel/gebied één PR met contract,
scherm, replay-/rechtentests en toesteltest; realtime via de bestaande handshake.

Wat de release niet mag vertragen: nieuwe audiofuncties, speluitbreidingen en cosmetische verbeteringen
(zie WP11, WP17, WP18) worden pas ingepland na M2, tenzij de eigenaar ze in D1/D7 in de scope zet.

### 9.1 Compatibiliteit met lopende PR's

| PR | Raakpunt met Mobile 1.0 | Gevolg |
|---|---|---|
| #187 Contentbeheer V2 | Alleen beheer, import en migratie `20261127120000_content_beheer_v2` (additief). Native API ongewijzigd. Importers behouden hoofdstuk-id's en gebruikersvoortgang; audiotijden kunnen `NEEDS_REVIEW` krijgen | Native moet hoofdstuk-id's als stabiel behandelen; WP11 leest de audiocontrolestatus |
| #175 Onderhoudsimage | Cursusherstel op de server | Geen raakvlak |
| #166 Kaartmenu iPhone Safari | Webgedrag van kaartmenu's | WP9 hergebruikt `ContentCard`/`SortableList` en erft de oplossing |
| #165 Design contract Figma/Rive | Visuele richtlijnen voor schermen | Native schermen (WP6–WP14) volgen het ontwerpcontract; geen tijdelijke mascottes |
| #188 Integratietest | Native-keten is inmiddels gemerged | Kan worden gesloten (besluit eigenaar) |

## 10. Wat alleen de eigenaar kan doen

1. Apple Developer Program, Team, rollen, App ID `app.versado.app`, capabilities, App Store Connect-record,
   handelaarsstatus (EU), leeftijdsvragen, privacylabels.
2. Google Play Console-account, verificatie, app-record, Play App Signing, uploadsleutel (nooit in git),
   Data safety, contentclassificatie, doelgroep, app-toegang, trader-/EU-gegevens indien gevraagd.
3. GitHub-secrets en beschermde omgevingen aanmaken (§5); geen waarden delen met de repository.
4. Testbackend inrichten: `NATIVE_API_ENABLED=1`, `NATIVE_SESSION_SECRET` (≥ 32 tekens), Redis, `APP_URL`,
   toegestane native origins; een demo-account voor reviewers. Uitrol blijft een eigenaarshandeling.
5. Beslissingen D1–D13 (§3.4), inclusief de goedkeuring van uitzonderingen in NATIVE-FEATURE-PARITY.md.
6. Juridische teksten (voorwaarden), supportcontact, schriftelijke bevestiging van contentrechten.
7. Definitieve iconen, splash, screenshots en storebeschrijving (ontwerp).
8. Fysieke apparaten en testers (§8) en het gesloten testtraject van 14 dagen indien van toepassing.
9. Indienen bij Apple en Google, en de uiteindelijke publicatiebeslissing. Er is niets ingediend.

## 11. Storechecklist

| Item | Apple | Google |
|---|---|---|
| Build | Xcode 26, iOS 26 SDK, deploymentdoel ≥ 13 | AAB, targetSdk 36, Play App Signing |
| Versie | Oplopend buildnummer | Oplopende `versionCode` |
| Accounts | Developer Program, trader status (EU) | Console-account, verificatie |
| Privacy | Privacylabels, `PrivacyInfo.xcprivacy`, privacy-URL | Data safety, privacy-URL |
| Accountverwijdering | In de app (5.1.1(v)) | In de app + weblink |
| Review-toegang | Demo-account, backend live (2.1(a)) | App-toegang met testaccount |
| Content | Rechten aantoonbaar, leeftijdsclassificatie | Contentclassificatie, doelgroep |
| Assets | Icoon 1024, screenshots, beschrijving | Icoon 512, feature graphic, screenshots |
| Export/encryptie | `ITSAppUsesNonExemptEncryption` | n.v.t. |
| Tests | TestFlight intern/extern | Interne, gesloten (en open) test |

Bronnen (geraadpleegd op 23 oktober 2026): Apple — Upcoming requirements
(`developer.apple.com/news/upcoming-requirements`), App Review Guidelines (2.1, 4.2, 4.8, 5.1.1(v)),
Offering account deletion in your app (`developer.apple.com/support/offering-account-deletion-in-your-app`),
TestFlight overview (App Store Connect Help). Google — Target API level requirements
(`developer.android.com/google/play/requirements/target-sdk`), Android App Bundle
(`developer.android.com/guide/app-bundle`), 16 KB page sizes (`developer.android.com/guide/practices/page-sizes`),
Test requirements for new personal accounts (Play Console Help 14151465), Account deletion requirements
(Play Console Help 13327111), Testing tracks (Play Console Help 9845334). Capacitor — `cap build`
(`capacitorjs.com/docs/cli/commands/build`).

**Niet (volledig) geverifieerd en door de eigenaar of in WP te bevestigen:** de precieze schermafmetingen en
aantallen voor screenshots in App Store Connect en Play Console; of Xcode-privacyrapport extra
"required reason"-declaraties vraagt voor de gebruikte Capacitor-pakketten; de actuele Play-regels voor de
EU-handelaarsverklaring; de status van de Apple- en Play-accounts van de eigenaar; of `armv7` in
`UIRequiredDeviceCapabilities` nog aanvaard wordt.

## 12. Acceptatievoorwaarden voor publieke publicatie (M3)

Alle voorwaarden zijn controleerbaar; geen enkele mag worden overgeslagen of verborgen:

1. `npm run native:store-readiness -- --strict` slaagt; alleen blokkades met een uitdrukkelijke, vastgelegde
   waiver (D4/D6) mogen gewaiveerd zijn en de store-beschrijving noemt die functies niet.
2. Het pariteitsdocument vermeldt per gebied de echte status; elke uitzondering heeft een expliciet
   eigenaarsakkoord (D2) of is gebouwd.
3. `docs/NATIVE-DEVICE-TEST-REPORT.md` bevat de volledige matrix van §8 met echte resultaten en gesloten bevindingen.
4. Native accountverwijdering en de publieke verwijderpagina zijn op toestellen getest; voorwaarden en privacy staan online.
5. CI is groen op de release-commit: native compilatie, archive/bundle, pariteit, security, contenttests.
6. Backend: `minimumNativeVersion` getest, rollback- en updatebeleid vastgelegd, geen tokens in logs.
7. Privacylabels en Data safety komen overeen met de werkelijke gegevensstromen.
8. Store-assets, iconen en teksten zijn definitief en eigendom/gelicentieerd; contentrechten bevestigd (D13).
9. TestFlight/Play-testtrajecten zijn doorlopen (inclusief de 14 dagen indien van toepassing) zonder open blokkerende bevindingen.
10. De eigenaar geeft schriftelijk akkoord op de indiening; productie-uitrol en indiening zijn eigenaarshandelingen.

## 12.1 Gerelateerde voorstellen en plannen

- Scope en tijdelijke pariteitsuitzonderingen voor optie B: `docs/NATIVE-MOBILE-1-0-OPTIE-B.md` (voorstel, nog niet doorgevoerd).
- WP4 ontwerp accountverwijdering en juridische toegang: `docs/NATIVE-WP4-ACCOUNTVERWIJDERING.md` (ontwerp ter goedkeuring).
- NAS-teststack: `docs/NAS-TESTSTACK-PLAN.md` (plan; geen origin ingevuld).

## 13. Eindadvies: eerste werkpakket

Begin met **WP1 (distributieprofielen)**: het is klein, onafhankelijk van productbeslissingen behalve de
backendorigin (D5), en het ontgrendelt WP2, WP3 en WP5. Start parallel de eigenaarstaken uit §10 (accounts,
API-sleutels, uploadsleutel, testbackend): zij zijn de werkelijke kritieke pad voor M1. Plan M0 (een toestel met
de bestaande Foundation) zo snel mogelijk, omdat dat de grootste onbewezen aannames (Keychain, Keystore,
WebView-layout, lifecycle) in één dag beantwoordt.
