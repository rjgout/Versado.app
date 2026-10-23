# Versado op web, PWA, iOS en Android

## Actuele functiepariteit

De volledige actuele inventaris, migratiestatus per functie, routes, API's,
componentgrenzen, rechten, offline-/platformeisen en bewijsblokkades staan in
[NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md). De bijbehorende broncheck
voorkomt dat nieuwe routes ongemerkt buiten de inventaris vallen; zij bewijst
geen werkende native schermen. De historische audit hieronder is geen actuele
route- of functie-dekking.

Een nieuwe feature is pas functioneel afgerond op web/PWA én iOS/iPadOS/Android,
of na een expliciete goedgekeurde platformuitzondering in de pariteitsmatrix.
Brede native schermmigratie volgt de bestaande hybride architectuur. De eigenaar
heeft op 21 oktober 2026 de gedeelde navigatie- en datalaag per functie goedgekeurd:
bestaande componenten krijgen web/native adapters en expliciete native contracten.
Er komt geen algemene bearer-bypass of build-time Next.js-shim.
Release en publicatie blijven afzonderlijk geblokkeerd tot de verplichte
technische tests, echte apparaten en onafhankelijke acceptatie zijn afgerond.

De gedeelde navigatiepoort is aangesloten op de webshell en een lokale
hashrouter voor de bestaande Foundation-schermen en privacy/cookies. Juridische
inhoud en vertalingen zijn gedeeld, ook offline. Volledige Vandaag/Leren/Spelen/
Vrienden, data-adapters en overige routes blijven open in de matrix. Browser-
controle of route-registratie is geen apparaatacceptatie.

De eerste gedeelde accountdatapoort bedient het bestaande wachtwoordformulier
via web/native adapters en één backendservice. De eigenaar heeft een eenmalige,
vijf minuten geldige native setup-challenge goedgekeurd voor verplichte wachtwoord-
en beheerder-TOTP-stappen. Die geeft geen gewone API-toegang; na voltooiing volgt
pas een sessie. Zie de matrix voor contracten, migratie en werkelijk testbewijs.
Wachtwoordherstel voltooit lokaal via een apart versie-1-contract en dezelfde
backendservice als web. De bestaande resetmail kan lokaal worden geplakt; een
ontvangen OS-link gaat door dezelfde exacte backend-origin-/tokenvalidatie. Alleen
het lokale `/reset-password` komt in geschiedenis; het bewijs blijft in geheugen.
Na reset volgt opnieuw inloggen inclusief bestaande TOTP/verplichte setup. Universal/
App Links vereisen nog eigenaarconfiguratie en apparaatbewijs. Algemeen TOTP-beheer,
account wissen, onboarding en volledige profielpariteit blijven open.

## Architectuurbesluit

Versado blijft één product, één datamodel en één gedeelde codebase. De
platformen zijn:

```text
Versado
├── webbrowser / PWA: Next.js SSR + bestaande webpush
├── iOS / iPadOS: Capacitor-native distributie
└── Android: Capacitor-native distributie
```

De definitieve native doelarchitectuur is een **hybride client/servermodel**:

- de native app bevat een lokale, store-releasebare client-shell en de
  stabiele UI/assets die voor startup en foutafhandeling nodig zijn;
- de Versado-server blijft de backend voor accounts, content, voortgang, XP,
  sociale functies, rankings, spelvalidatie en realtime-spellen;
- web/PWA mag de bestaande SSR-rendering blijven gebruiken;
- native en web delen componenten, domeinlogica en API-contracten. Er komt
  geen tweede native frontendcodebase of tweede accountsysteem.

Die doelarchitectuur is bewust nog niet als grote migratie uitgevoerd. De
huidige repository is daarvoor nog niet client-side genoeg: de native shell
zou anders een kunstmatige kopie van alle pagina's en logica nodig hebben.
Native Foundation fase 1 voegt daarnaast een beperkte **local-development**-client
toe. Remote-preview blijft bestaan. Beide zijn ontwikkelprofielen; geen van beide
is een productie- of storeprofiel.

De keuze is dus niet: `server.url` stiekem als eindarchitectuur laten staan.
De keuze is: de bestaande server-rendered app behouden, remote preview
expliciet begrenzen, en de lokale native client/API-grens gecontroleerd
uitwerken voordat een store-release wordt toegestaan.

## Historische repository-audit

De audit is uitgevoerd tegen commit `388ca8a` op `main`.

### Werkelijke runtimegrenzen

- Next.js 16 App Router, TypeScript strict, React 19 en Tailwind.
- `server.ts` start Next.js via `tsx` en koppelt Socket.io aan dezelfde HTTP
  server. De scheduler en gameserver worden vóór `app.prepare()` geladen.
- PostgreSQL via Prisma bevat alle gebruikers-, content-, voortgangs-,
  XP-, sociale en speldata. Redis ondersteunt de Socket.io-adapter.
- Er zijn 60 pagina's en 173 API-routehandlers. Er is geen middlewarebestand
  en er zijn geen Server Actions (`"use server"`).
- De meeste ingelogde pagina's zijn Server Components die direct Prisma lezen
  en via `redirect()` authenticatie- en toestandsbeslissingen nemen.
- Client components gebruiken relatieve `fetch()`-calls naar de bestaande
  `/api/*`-routes. Live-spellen gebruiken Socket.io op `/socket.io` met
  credentials.
- Audio loopt deels via ingelogde serverroutes met Range-support; podcastaudio
  kan van externe bronnen komen. De hoofdstukaudio wordt op de eigen server
  gespiegeld wanneer dat beschikbaar is.
- `layout.tsx` leest request headers, cookies, branding, gebruikersdata,
  contentcontext en competitiegegevens server-side. Ook de manifest-, favicon-
  en sitemap/robots-logica is server- of origin-afhankelijk.

### Authenticatie

De bestaande auth is één cookiegebaseerd systeem:

- JWT in `httpOnly` cookie `bvm_session`;
- `Secure` in productie, `SameSite=Lax`, `Path=/`, levensduur 30 dagen;
- `SESSION_SECRET` op de server; wachtwoorden met bcrypt;
- sessieversie in de database maakt wachtwoordwijziging/-reset direct
  ongeldig op andere apparaten;
- optionele/verplichte TOTP voor beheerders;
- geen gevoelige tokens in `localStorage`;
- geen OAuth- of externe identity-providerflow aanwezig.

Dit werkt nu in native omdat de WebView dezelfde HTTPS-origin laadt als de
webapp. Een lokale client op `capacitor://localhost` of een vergelijkbare
lokale origin krijgt die cookie niet zomaar bij cross-origin API-calls.
Daarvoor is een expliciete native authvariant nodig, met bijvoorbeeld korte
access-tokens plus veilige native opslag, refresh/revocation en CSRF-/origin-
regels. Die keuze mag niet impliciet uit de huidige cookieflow ontstaan.

### PWA en webpush

De PWA blijft eersteklas:

- `/api/branding/manifest` levert het dynamische manifest;
- `public/sw.js` registreert webpush en cachet bewust geen pagina's of
  ingelogde data;
- `pwaInstall.ts` handelt Android-installatie en iOS standalone af;
- de bestaande VAPID/Web Push-flow gebruikt browser `PushManager` en de
  bestaande `/api/push/*`-routes.

Native push is een ander kanaal. APNs/FCM-device tokens mogen niet als
Web Push subscriptions worden opgeslagen. Native push blijft daarom uit tot
er een apart tokenmodel, providerconfiguratie, permissieflow en privacy-
documentatie is.

### Native bridge en navigatie

`src/lib/platform.ts` is de centrale adapter voor platformdetectie, share,
externe browser en haptics. `NativeAppBridge.tsx` koppelt lifecycle, launch
URLs, URL-openingen en Android systeem-back aan de bestaande Next-router.

Er is geen `allowNavigation` ingesteld. Capacitor opent externe links via de
systeembrowser; alleen dezelfde Versado-origin wordt aan de interne router
doorgegeven. Interne browserback, `SubpageBackBar` en
`NavigationScroll` blijven de webbron van waarheid.

Safe areas lopen centraal via `--vs-safe-area-*`; de vaste balken, het
toetsenbord (`data-keyboard`) en grote tekst volgen `docs/LAYOUT.md`. Het
layoutgedrag is alleen in Chromium op de web-build gemeten; een WKWebView of
Android WebView is niet getest. De huidige native projecten
vragen alleen internettoegang; er zijn geen camera-, locatie-, tracking- of
pushpermissies toegevoegd.

## Vergelijking van de modellen

### A — remote native shell

De huidige app laadt `https://versado.app` in Capacitor.

Sterk:

- bestaande SSR, cookie-auth, API's, Prisma en Socket.io blijven intact;
- één deployment en één runtimegedrag;
- contentupdates verschijnen zonder native rebuild.

Zwak:

- zonder netwerk is er geen app-UI;
- serveruitval wordt een WebView-loadfout, behalve de lokale foutpagina;
- de native appcode en serverdeployment hebben geen onafhankelijke
  releasegrens;
- Capacitor documenteert `server.url` als bedoeld voor live-reload en niet
  voor productie;
- Apple beoordeelt of een app verder gaat dan een opnieuw verpakte website;
  Google vereist stabiele, betekenisvolle appfunctionaliteit.

Conclusie: geschikt voor gecontroleerde preview en lokale ontwikkeling,
niet verantwoord als definitieve storearchitectuur.

### B — volledige lokale webbundle

Dit is met de huidige code niet realistisch. `next export` zou niet alleen de
60 pagina's moeten renderen, maar ook de directe Prisma-lezingen, redirects,
cookie-auth, 173 muterende API-routes, audio-autorisatie, manifest/branding,
Socket.io en dynamische spelstaat vervangen. De custom server kan niet als
database- en Node-runtime in een iOS/Android-webbundle worden meegenomen.

Conclusie: alleen mogelijk na een grote herschrijving en dus niet als veilige
wijziging in deze opdracht.

### C — hybride lokale client met remote backend

Dit is de juiste eindrichting. De lokale native client kan offline starten,
een eigen laad-/netwerkstatus tonen en serverdata via stabiele API-contracten
ophalen. Content en configuratie blijven servergestuurd; app-code blijft
onderhevig aan store releases.

De migratie is echter groter dan alleen Capacitor configureren. De huidige
Server Components moeten geleidelijk gedeelde clientfeatures worden, en de
native auth moet worden ontworpen. Een aparte gekopieerde iOS- of Android-
frontend zou de verkeerde oplossing zijn.

Conclusie: doelarchitectuur C, gefaseerd te implementeren; geen destructieve
static-exportmigratie nu.

## Wat deze wijziging nu afdwingt

De Capacitor-configuratie heeft geen standaard productie-URL meer.

Voor een preview moet het profiel en de URL expliciet worden gezet:

```bash
CAPACITOR_BUILD_PROFILE=remote-preview \
CAPACITOR_SERVER_URL=https://versado.app \
npm run cap:sync
```

Voor lokale ontwikkeling:

```bash
CAPACITOR_BUILD_PROFILE=remote-preview \
CAPACITOR_SERVER_URL=http://192.168.1.20:3000 \
CAPACITOR_ALLOW_CLEARTEXT=true \
npm run cap:sync
```

De scripts `cap:sync:remote-preview`, `cap:sync:remote-preview:ios` en
`cap:sync:remote-preview:android` zijn gemaksscripts voor de officiële
Versado-preview-URL. De algemene `cap:sync*`-scripts vereisen juist expliciete
environment variables. `CAPACITOR_BUILD_PROFILE=release` wordt momenteel
geweigerd, zodat niemand per ongeluk een remote WebView als store-release
bouwt.

De Capacitor `errorPath` wijst naar `public/native-error.html`. Bij een
netwerk- of startupfout ziet een native gebruiker een lokale, safe-area-
bewuste Versado-fallback met opnieuw-proberen; dit maakt de remote preview
bruikbaarder maar verandert haar niet in offline functionaliteit.

## Client/servergrens voor de vervolgfase

De bestaande `/api/*`-routes zijn functioneel al de backendgrens, maar nog
niet als versieerbaar native contract ontworpen. De vervolgfase moet eerst
een kleine, stabiele kern vastleggen voor:

- sessie/account en logout;
- profiel, instellingen en contentcontext;
- cursussen, hoofdstukken, oefeningen en voortgang;
- XP, reeks, competitie, vrienden en groepen;
- notificatie-inbox;
- spelstatus en servergevalideerde spelacties;
- realtime-verbinding en reconnectgedrag.

Bestaande routes mogen daarachter blijven bestaan. Er is geen reden om de
hele API in één keer te herschrijven. Nieuwe native contracten krijgen een
expliciete versie-/authregel en server-side autorisatie blijft de bron van
waarheid.

## Assets, startup en offline

- Kleine branding-, icon- en shell-assets horen in de native bundle.
- Grote mascotte-/illustratiecollecties, audio en veranderlijke content
  blijven server-assets; alleen expliciet veilige cachelagen mogen die later
  lokaal bewaren.
- Geen gebruikersdata of auth-token in een PWA-cache zetten.
- De huidige PWA cachet bewust niets. Native preview heeft alleen de lokale
  foutfallback; echte offline lessen of voortgang zijn nog niet beloofd.
- De uiteindelijke lokale client moet cold start, langzaam netwerk,
  backenduitval, hervatten en verlopen auth als normale UI-staten behandelen.

## Updates

Store-releases bevatten executable/native code en wijzigingen aan de lokale
client. Serverdeployments mogen content, vragen, events, configuratie en
serverlogica wijzigen zonder native rebuild zolang er geen nieuwe executable
code buiten de store om wordt geladen. Een remote webupdate mag dus nooit als
verborgen mechanisme worden gebruikt om nieuwe native executable functionaliteit
aan review te onttrekken.

## Deeplinks

De uiteindelijke strategie gebruikt dezelfde HTTPS-links op web en native:

- iOS Universal Links via `apple-app-site-association`;
- Android App Links via `assetlinks.json`;
- native routeverwerking via `App.getLaunchUrl()` en `appUrlOpen`;
- webgebruikers blijven dezelfde URL in de browser openen.

De associatiebestanden worden pas uitgerold wanneer Apple Team ID, signing en
Android release fingerprint definitief zijn. Voorbeelden van uitnodigingen,
groepen, cursussen, spellen en notificaties moeten vervolgens per route worden
getest. Zie de [officiële Capacitor deep-linkdocumentatie](https://capacitorjs.com/docs/guides/deep-links).

## Ontwikkelstandaard

Elke nieuwe feature wordt vóór implementatie beoordeeld op web, PWA, iOS,
Android, telefoon, tablet en desktop, met safe areas, touch, toetsenbord,
dark mode, toegankelijkheid, netwerk/resume, browserback, Android systeem-back
en deeplinks. Native gedrag loopt via `src/lib/platform.ts` of een centrale
adapter. Nieuwe directe Capacitor-checks in pagina's zijn geen standaard.

Nieuwe features moeten bovendien aangeven:

1. welke server/API-data nodig is;
2. wat zichtbaar blijft bij langzaam of afwezig netwerk;
3. of de functie webpush of native push nodig heeft;
4. of een wijziging webdeploy, native sync of een store-release vereist;
5. welke auth-, privacy- en permissie-impact bestaat.

## Releasevoorbereiding

Nog niet ingevuld en bewust niet verzonnen:

- Apple Developer Team ID, signing, APNs, privacyverklaringen, metadata,
  screenshots en accountverwijderingsbeoordeling;
- Google Play Console, signing/app signing, FCM, Data Safety, metadata,
  screenshots en accountverwijderingsbeoordeling;
- definitieve native iconen/splash-assets;
- Universal/App Links-associatiebestanden;
- native push en native auth-contract;
- offline productbeslissing: alleen startup/error fallback, of ook offline
  lezen/oefenen met synchronisatie.

Capacitor documenteert dat `server.url` voor live-reload bedoeld is en niet
voor productie. Apple noemt als eis dat de app meer moet bieden dan een
opnieuw verpakte website; Google vereist stabiele, betekenisvolle
functionaliteit. Lees vóór publicatie de actuele [Capacitor-configuratie](https://capacitorjs.com/docs/config),
[Apple App Review Guidelines 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)
en [Google Play Functionality, content and user experience](https://support.google.com/googleplay/android-developer/answer/9898783).

## Lokale workflow

Web/PWA blijft:

```bash
npm run dev
npm run build
npm start
```

Native preview:

```bash
CAPACITOR_BUILD_PROFILE=remote-preview CAPACITOR_SERVER_URL=https://versado.app npm run cap:sync
npm run cap:open:ios
npm run cap:open:android
```

`cap sync` is nodig na wijzigingen in web-assets, Capacitor-configuratie,
plugins of native projectconfiguratie. Een server-/contentdeploy zonder lokale
clientwijziging vraagt geen sync en geen store-release. Xcode is nodig voor
iOS signing, simulator en echte iPhone/iPad; Android Studio plus Android SDK
is nodig voor Android emulator/device en signing.

De huidige omgeving bevat geen `xcodebuild` en geen Java/Android SDK. Native
builds zijn hier daarom niet geclaimd als geslaagd.

## Exacte eerste iPhone-test

1. Installeer op de Mac Node 22+, Xcode en de bijbehorende iOS Simulator/SDK.
2. Clone Versado, voer `npm ci` en `npm run db:generate` uit.
3. Synchroniseer expliciet de preview:
   `CAPACITOR_BUILD_PROFILE=remote-preview CAPACITOR_SERVER_URL=https://versado.app npm run cap:sync:ios`.
4. Open met `npm run cap:open:ios` het workspace/project in Xcode.
5. Kies het `App`-target, stel onder Signing & Capabilities je eigen Team in
   en gebruik een simulator of aangesloten iPhone met Developer Mode.
6. Run eerst op een simulator en controleer cold start, login/logout, terug,
   deeplink-events, share, externe links, keyboard, safe areas, audio en
   netwerkuitval.
7. Test daarna op de echte iPhone. Dit is een remote preview, geen bewijs
   voor App Store-readiness; voer dezelfde test uit na een echte lokale-client
   migratie voordat je archiveert of indient.


## Native Foundation fase 1 — actuele uitbreiding

Zie [architectuur, contracten en testbewijs](NATIVE-FOUNDATION-PHASE-1.md) en
[Apple Developer-configuratie](APPLE-SIGN-IN-SETUP.md). De oudere inventaris hierboven
beschrijft de uitgangssituatie; de volledige Next.js-app blijft servergedreven.

De lokale entry `src/components/native/entry.tsx` bundelt gedeelde React-componenten,
vertalingen, design tokens en assets. Geen Next.js-export en geen tweede domeinlaag.
De beperkte verticale proef is aanmelden → Vandaag-leeskaart → hoofdstuk → bewust
als gelezen markeren → sessie herstellen. De volledige planner, onboarding,
studielezer, spellen, realtime en overige schermen moeten nog gericht migreren.

```sh
NATIVE_API_BASE_URL=https://versado.app npm run native:build
CAPACITOR_BUILD_PROFILE=local-development npx cap sync
# Remote-preview blijft expliciet beschikbaar:
CAPACITOR_BUILD_PROFILE=remote-preview CAPACITOR_SERVER_URL=https://versado.app npx cap sync
```

De eerste opdracht bouwt uitsluitend lokale bestanden; zij doet geen productiecall.
Gebruik voor echte ontwikkeltests een eigen backend. Lokale HTTP-backends vereisen
expliciet `NATIVE_ALLOW_LOCAL_HTTP_API=1`; dit is geen releaseconfiguratie.

Backend: `NATIVE_API_ENABLED=1` en een afzonderlijk willekeurig
`NATIVE_SESSION_SECRET` van minimaal 32 tekens. Standaard blijft de API uit.
`/api/v1/native/*` accepteert uitsluitend de twee vaste Capacitor-origins,
`X-Versado-Client: native-v1` en eigen Bearer-tokens; webcookies geven geen native
rechten. Access-tokens leven vijf minuten; refreshsessies maximaal dertig dagen.
Refreshgeheimen staan alleen gehasht in PostgreSQL en versleuteld in native
platformopslag. Uitloggen trekt de sessie in; offline uitloggen bewaart uitsluitend
een veilige intrekkingsopdracht. Wachtwoordwijziging en accountverwijdering maken
native sessies ongeldig. Webauthenticatie en webpush blijven afzonderlijk werken.

De eigen Capacitor 8-bridge gebruikt iOS Keychain, Android Keystore/AES-GCM en
AuthenticationServices. Alleen de lokale app-origin mag platformgeheimen openen;
remote-preview krijgt deze bevoegdheid niet. JavaScript houdt access-tokens alleen
in geheugen. CSP begrenst de lokale bundle; een XSS blijft een serieus risico en
mag niet via onbetrouwbare scripts/HTML worden geïntroduceerd.

Telefoons zijn portrait-only; tablets ondersteunen beide richtingen. De gedeelde
platformadapter verzorgt lifecycle, keyboard-sluitactie, delen en haptics.
De lokale deeplinkondersteuning is voorlopig beperkt tot de vertrouwde
Vandaag-bestemming. Geen permissies voor native push toegevoegd.

Release blijft geblokkeerd totdat echte builds/apparaatvalidatie, Apple-configuratie,
accountlevenscyclus, juridische URLs en de resterende schermmigratie zijn beoordeeld.
Een geslaagde webbuild, Capacitor-sync of synthetische browserflow bewijst geen
werkende App Store-/Play Store-release.


## Automatische platformcompilatie voor development

[Native platformcompilatie](../.github/workflows/native-platform-builds.yml) bouwt
de lokale client op CI-runners met de benodigde SDK's: Android Debug met JDK 21/
SDK 36 en een iOS-simulatorapp met Xcode. De backend is uitsluitend de gereserveerde
`https://example.invalid`: deze artifacts zijn compileproeven, geen werkende
productie-installaties. Beide jobs gebruiken `local-development`, zonder
signingcredentials, App Store/Play-upload of deployment.

`scripts/native/verify-development.mjs` vergelijkt de gesynchroniseerde én echt
verpakte HTML/JS/CSS/buildmetadata met `dist/native`. Een remote `server.url`, een
afgekeurde profiel-/releasevlag of afwijkende assets laat de controle mislukken.
Android controleert de inhoud van de APK; iOS die van de gebouwde simulatorapp.
Artifacts blijven zeven dagen beschikbaar bij de betreffende workflowrun.

Deze controles leveren pas buildbewijs zodra de jobs op de gepushte commit groen
zijn. De lokale workspace heeft geen Android SDK of Xcode. De positieve controles
op beide gesynchroniseerde projecten en negatieve controles op remote-url,
assetafwijking en releasevlag zijn lokaal uitgevoerd. De eerste SDK-builds zijn beide geslaagd op appcodecommit
`e8714bbc7a8e7bb152ebf5f88aa4e9e4ca2254f7`; zie
[workflowrun 39654191278](https://github.com/rjgout/Versado.app/actions/runs/39654191278).
Android-APK en iOS-simulatorapp zijn werkelijk gecompileerd en hun verpakte assets
zijn gecontroleerd. Echte iPhone/iPad/Android-, Keychain/Keystore-, Apple- en
lifecycleacceptatie blijven aparte open gates. `release` blijft geblokkeerd.
