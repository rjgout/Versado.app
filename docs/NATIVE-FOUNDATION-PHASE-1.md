# Native Foundation fase 1 — ontwerp en verificatie

Basis: main `387d418d`. Web/PWA blijft Next.js; geen static export van de hele app.

## Audit en grens

`capacitor.config.ts` accepteerde uitsluitend remote-preview; `public` bevatte
geen lokale app. `src/app/layout.tsx`, `dashboard/page.tsx` en lespagina's lezen
Next headers/cookies en Prisma. `session.ts` en bestaande API's zijn cookiegebonden;
Socket.io gebruikt dezelfde websessie. Deze schermen worden niet stilzwijgend
voor native vrijgegeven. `platform.ts`, React, Versado-tokens en
`learning/contentProgress.ts` zijn herbruikbaar. `NativeAppBridge` gebruikt de
Next-router en blijft daarom uitsluitend de remote-preview/webbridge.
Registratie gebruikt `registration.createAccount`, inclusief cursuskoppeling;
TOTP en e-mailbevestiging mogen niet via native worden overgeslagen.
`public/sw.js` cachet geen privépagina's; Web Push blijft apart van toekomstige
APNs/FCM. Native krijgt geen pushpermissies. Bestaande onboarding blijft bestaan;
fase 1 geeft een beperkte leesproef, geen volledige onboardingmigratie.

## Vastgelegd implementatiecontract vóór uitbreiding

- Eén backend, database en User-identiteit; één gedeelde React/domeinbasis.
  Een afzonderlijke lokale **entry**, geen kopie van de Next-pagina's, wordt uit
  `src/components/native` gebundeld. Web blijft SSR en volledig bestaan.
- Alleen `/api/v1/native/*` accepteert native Bearer-auth. Bestaande cookie-API's
  krijgen geen algemene bearer-bypass. Exacte lokale Capacitor-origins, JSON,
  begrensde payloads, geen credential-CORS, `private, no-store`, geen willekeurige
  redirects. Native API standaard uit via `NATIVE_API_ENABLED`.
- Access JWT vijf minuten, apart afgeleide sleutel/purpose/audience; uitsluitend
  in geheugen. Refreshgeheim dertig dagen, uitsluitend Keychain/Keystore.
  Server bewaart alleen hashes en revocation; iedere accesscontrole raadpleegt
  sessie én User.sessionVersion. Wachtwoordwijziging, reset en accountverwijdering
  trekken native toegang daardoor ook in. Geen tokens/logpayloads loggen.
- Refreshrotatie onder rijlock. Exacte retry van dezelfde actie krijgt hetzelfde
  afgeleide geheim; hergebruik van de vorige generatie met andere actie trekt de
  sessie in. Eén geserialiseerde refreshqueue per client. Onbekende tokens mogen
  geen sessies van anderen intrekken. Offline logout bewaart alleen een beveiligd
  revocationverzoek; de client mag die sessie nooit opnieuw hervatten.
- Apple via eigen kleine AuthenticationServices-bridge, geen externe authplugin.
  JWKS uitsluitend van appleid.apple.com; RS256, issuer/audience/expiry/iat/nonce.
  Duurzame eenmalige challenge, statehash, korte TTL en eigenaarbinding bij link.
  Unieke provider + Team-scope + subject; tevens één Apple-identiteit per account
  per scope. Gelijk e-mailadres leidt nooit tot automatische koppeling.
- Apple-only User behoudt bestaande verplichte passwordHash (onbruikbaar willekeurig
  geheim) met expliciet `passwordLoginEnabled=false`. Geen onwerkbare resetmail.
  Nieuwe Apple-accounts vereisen een geverifieerd echt/relay-adres; bij ontbrekend
  adres wordt niets verzonnen. Latere e-mail-/naamwijzigingen wijzigen geen eigenaar.
  Koppelen/ontkoppelen vereist bestaande sessie en wachtwoord/TOTP-herauthenticatie;
  laatste inlogmethode mag niet verdwijnen. Bestaande accounts eerst bootstrap via
  de bestaande registratie; Apple maakt geen eerste beheeraccount.
- Additief: ExternalIdentity, NativeSession, NativeAuthChallenge en één veilige
  defaultkolom op User. Geen backfill van identiteiten of mutaties aan voortgang.
- Eerste verticale proef: login → Vandaag → toegankelijk hoofdstuk → expliciet
  afronden via bestaande completeChapterReading → heropenen. Geen tweede XP- of
  reeksimplementatie en geen offline beloningen.
- Lokale development en remote-preview zijn afzonderlijke profielen. Release blijft
  geblokkeerd tot echte device-/signing-/securityacceptatie. Ontbrekende Apple Team,
  audience, entitlements of signing betekenen geen werkende Apple-E2E-claim.

## Volledige native uitbreiding

De huidige vervolgopdracht omvat alle bestaande functies; zie
[NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md). Deze Foundation-proef is
alleen het uitgangspunt. De nieuwe inventaris houdt ontbrekende schermen,
contracten, veilige sessiewisselingen, realtime/media/push en apparaat-/storebewijs
expliciet open. Geen ontbrekende functie is als web-only uitzondering goedgekeurd.
De zelfstandige broncontrole is geen onafhankelijke audit of native-acceptatie.

## Sessiewisselingen na de proef

De client bewaakt nu sessiegeneraties vóór en na refresh, API-antwoorden en
provider-authenticatie. Read/wijzig/write is geserialiseerd; offline intrekkingen
blijven duurzaam naast een nieuw account staan. Late logoutbevestigingen wissen
geen nieuwe sessie. Een generatiewissel tijdens de native write maakt het late
paar uitsluitend een intrekkingsintentie. Zeven extra clientregressies bewaken dit;
ze vervangen geen fysieke Keychain/Keystore- of Apple-tests.

## Migratie van overige schermen

De eigenaar heeft de gedeelde navigatie- en datalaag per functie goedgekeurd
(21 oktober 2026), met expliciete native versiecontracten en stapsgewijs hergebruik
van de bestaande componenten. Geen build-time Next.js-compatibiliteitsshims.

Na deze proef per feature: serverdata achter versiecontract, gedeelde clientcomponent,
rechten-/reconnecttests, daarna native navigatie. Volgorde: onboarding en accountbeheer,
Vandaag/contentcontext, cursussen/StudyReader/annotaties, sociale schermen, daarna
realtime/spellen/audio. Socket.io vereist eigen native sessiehandshake; niet impliciet
het cookiecontract aanpassen. Native push volgt afzonderlijk. Geen offline
voortgangsqueue zonder apart servervalidatiecontract.

## Gedeelde navigatie na de proef

`AppNavigation` heeft afzonderlijke Next- en lokale adapters. De bestaande
Foundation-toestanden hebben lokale routes en delen geschiedenis met systeemterug;
lezen herstelt bij herladen. Privacy/cookies delen hun componenten met web en zijn
lokaal gebundeld. StickyHeader, ShellMetrics en focusmodi worden hergebruikt.
Volledige route-/functiepariteit en native data-adapters volgen per feature;
een geregistreerde proefroute is geen volledige webfunctie.

## Accountcontracten na de proef

De gedeelde accountdatapoort en wachtwoord-/QR-/herstelcodecomponenten hebben
web/native adapters. `account/password` gebruikt dezelfde actuele User-lock/
sessieversieservice als web en vereist native wachtwoord/TOTP-herauthenticatie.
Verplichte wachtwoord-/beheerder-TOTP-setup gebruikt het op 21 oktober 2026 door
de eigenaar goedgekeurde eenmalige challengebeleid: maximaal vijf minuten,
account/doel/versiegebonden, geen normale sessie of API-toegang tot voltooiing.
Na logout/heropening wordt uitsluitend de beveiligd bewaarde intrekking uitgevoerd.

De migratie `20261127120000_native_security_setup` voegt twee nullable challenge-
velden toe en breidt uitsluitend de intent-check uit. Eigen PostgreSQL/Redis en
rollback-/behoudtests controleren bestaande sessies, identiteiten en Apple-challenges.
De volledige accountlevenscyclus en fysieke apparaten blijven open in de matrix.

## Lokaal wachtwoordherstel

`PasswordResetForm` deelt de bestaande velden, styling en web-TOTP-stap met de
lokale app, met aparte data-adapters. Native `POST reset-password` accepteert alleen
`token` en `newPassword`, gebruikt dezelfde `resetPasswordWithToken` (eenmalig,
vervaltijd, User-lock, intrekking van overige resetlinks en sessieversie) en geeft
uitsluitend `{ok:true, reauthenticationRequired:true}` terug: geen sessie/cookie of
2FA-bypass. Dezelfde gedeelde IP-budgetnaam als web beschermt tegen kanaalwisselen.

In Wachtwoord vergeten → Resetlink openen kan de gebruiker de bestaande mail-URL
plakken. De parser aanvaardt uitsluitend de geconfigureerde backend-origin, het
exacte herstelpad en één token van de bestaande 43-tekensvorm. OS-launch-/openlinks
gebruiken dezelfde parser. De native hash/history bevatten alleen het lokale pad;
resetbewijzen blijven in werkgeheugen en verdwijnen bij verlaten/herladen/afronden.
Geen automatische login of herhaling van de mutatie. Na voltooiing kiest de
gebruiker Terug naar inloggen; de lokale sessie wordt dan veilig uitgelogd.

Universal Links / Android App Links, mail→OS-dispatch en echte apparaten zijn nog
niet geconfigureerd/bewezen. De plakflow werkt zonder die associaties; Chromium is
geen bewijs voor OS-dispatch, Keychain/Keystore of fysieke toetsenbordbediening.

## Lokale e-mailbevestiging

`POST verify-email` accepteert uitsluitend een begrensd mailbewijs en geeft alleen
`status: confirmed/already/expired/invalid`. De bestaande registratieclaim maakt
precies hetzelfde account met dezelfde cursus-/uitnodigingsregels; native krijgt
geen User, returnTo, cookie of NativeSession. Oude EMAIL_VERIFY-links bevestigen
het bestaande account via een atomische User-lock-/tokenclaimtransactie. Web
behoudt redirect/cookie voor nieuwe registraties en bevestigt oude links zonder
nieuwe cookie. Native vereist daarna gewone login met alle beveiligingspoorten.

`EmailConfirmationCard` is de bestaande web-uitkomstkaart; `MailLinkForm` deelt
lokale linkinvoer met reset. Dezelfde strikte backend-origin-/tokenparser bewaakt
plakken en OS-launch/open. Bevestigen vereist een expliciete actie; bewijs blijft
in geheugen. De runtime onderscheidt launch en nieuwe openacties om een oude
launchlink niet opnieuw te openen bij herbinden na een taalwijziging. Ontvangen
links na het opruimen van de vorige runtime worden genegeerd.

Een open registratie wordt bij native login alleen na juist wachtwoord herkend;
hermailing gebruikt de bestaande `resendPendingVerification` en mailgrens. Oude
onbevestigde accounts opnieuw mailen, onboarding, overige accountfuncties, echte
mail→OS-dispatch en fysieke apparaten blijven open.

## Native sockettransport

De eigenaar heeft een eenmalig bewijs van maximaal 60s goedgekeurd; zie het
[exacte contract en de levensduurcontroles](PLATFORMEN.md#native-realtime-eenmalig-handshakebewijs).
`socketTickets.ts` maakt een onvoorspelbaar bewijs en verbruikt de Redis-hashkey
atomair. `socketAuth.ts` scheidt de native handshake expliciet van webcookies.
`activeNativeSession` is dezelfde DB-bron voor API en verbonden native sockets;
het ticket geeft geen eigen verversbare sessie of andere rechten.

`NativeSocketConnection` haalt bij elke poging een vers bewijs op en bewaart het
alleen tot handshake-uitkomst. Een sessiegeneratiewissel sluit direct het oude
transport; late bewijzen kunnen de nieuwe gebruiker niet verbinden. Runtime-
herstel sluit aan op de bestaande lokale app. Webauthenticatie, Redis-adapter,
server-authoritative spelhandlers en bestaande gebruikersrooms blijven behouden.

De geïsoleerde runner start twee afzonderlijke processen met echte Next-routes en
de echte Socket.io-server op dezelfde eigen PostgreSQL/Redis. Gerichte tests staan
in `tests/native-socket.test.ts` en `tests/native-socket.integration.test.ts`.
De fixture heeft uitsluitend testevents; zij wordt nooit als appcode gebundeld.
Echte spelhervatting/HA en fysieke platforms moeten later per functie volgen.
Geen merge, deployment of onafhankelijke acceptatie door deze implementatie.

## Externe voorwaarden

Apple Team ID, Bundle ID/audience, Sign in with Apple capability en provisioning
moeten door de eigenaar worden ingesteld. Web/Android Apple OAuth vereist Services
ID, exacte HTTPS return URL, server-side codewisseling met Apple client-secret,
PKCE waar ondersteund, state/nonce en callbackbinding; is zonder deze configuratie
niet actief. Geen token in deeplink of querystring. Zie de configuratiehandleiding.

## API- en opslaginventaris

| Endpoint onder `/api/v1/native` | Contract |
| --- | --- |
| GET capabilities | Versie 1 en werkelijk geconfigureerde Apple-mogelijkheid |
| POST login, register, forgot-password | Begrensde invoer; bestaande accounts/mail/TOTP |
| POST verify-email | Bestaand eenmalig registratie-/EMAIL_VERIFY-bewijs; alleen status, geen sessie |
| POST reset-password | Bestaand eenmalig resetmailbewijs + nieuw wachtwoord; geen sessie, opnieuw inloggen |
| POST realtime/session | Actuele NativeSession; eenmalig Redis-handshakebewijs van maximaal 60s, geen tweede sessie |
| POST refresh, logout | Refreshgeheim + UUID actionId; rotatie/intrekking |
| POST apple/challenge, apple/complete | Eenmalige state/nonce, serververificatie |
| DELETE apple | Eigen account, actuele wachtwoord/TOTP-herauthenticatie |
| GET me, today | Eigen minimale accountdata, toegankelijke leesproef |
| GET chapters/:id, POST chapters/:id/complete | Centrale bronrechten en bestaande lees-/reeksservice |

Access JWT bevat uitsluitend account-/sessie-identiteit. API-versie, issuer en
purpose zijn gescheiden van de cookie-JWT. Preflight staat alleen de vaste native
origins toe; cookies worden niet gebruikt of meegestuurd. JSON-invoer maximaal
16 KiB, reacties bevatten nooit refreshhashes of ruwe databasefouten. Refreshreplay
wordt onder User → NativeSession-locks afgehandeld; revocation commit vóór foutresponse.
IP-/accountfailurelimieten beschermen login en tokenmutaties. Challenges hebben
vijf minuten geldigheid en een afzonderlijk aanvraagbudget. De huidige rate limiter
is per proces, overeenkomstig de bestaande single-serverarchitectuur; meerdere
replica's vereisen een gedeeld limietcontract vóór uitrol.

Native opslag gebruikt een vast Keychain-item (`WhenUnlockedThisDeviceOnly`) of
AES-GCM-ciphertext in private preferences met een Android Keystore-sleutel.
Android-backup is uitgeschakeld zodat ciphertext niet op een toestel zonder sleutel
wordt hersteld. Geen fallback naar onversleutelde opslag. Een laat login-/refresh-
antwoord kan logout niet terugdraaien; onzekere refresh behoudt dezelfde actionId.

Migratie `20261125120000_native_auth_foundation` voegt alleen drie tabellen, één enum,
relaties/indexen/constraints en User.passwordLoginEnabled (default true) toe.
Bestaande wachtwoordhashes en account-ID's blijven gelijk. Geen content-/progressie-
backfill. Apple-only accounts krijgen een onbruikbaar willekeurig wachtwoord en
kunnen de laatste inlogmethode niet verwijderen. De resetaanvraag blijft generiek;
de UI verwijst zulke gebruikers naar Apple in plaats van een onbruikbare resetflow.

## Uitrol en rollback (eigenaar; niet uitgevoerd)

1. Review migratie, tests en de open Apple-releaseblokkades. Maak via het bestaande
   eigenaarproces een databasebackup; dit document claimt geen nieuwe restoretest.
2. Bestaande Synology-containerstart voert `prisma migrate deploy` automatisch uit.
   Houd de nieuwe native API/Apple-flags uit bij een gewone web-uitrol; geen nieuwe
   publieke Apple-accounts of automatisch zichtbare content.
3. Test native activering eerst op een eigen backend met echte signing/apparaten.
   Serversecret blijft uitsluitend backendconfiguratie; backendorigin zit in de
   bundle en een verandering daarvan vereist opnieuw bundelen/synchroniseren.
4. Bij fout flags uitzetten en de vorige appimage terugplaatsen. Laat de additieve
   tabellen/kolom staan; oudere webcode blijft deze negeren. Geen DROP of terugzetten
   van gebruikersgegevens. Als ooit Apple-only accounts bestaan, mag een oude app
   niet als zelfstandige Apple-inlogoplossing worden gepresenteerd.
5. Een databaseherstel is een afzonderlijke eigenaarhandeling en verschilt van een
   appimage-rollback. Deze opdracht voert geen van beide op productie uit.

De uitgebreide handmatige Apple-stappen en resterende levenscyclusvoorwaarden staan
in [APPLE-SIGN-IN-SETUP.md](APPLE-SIGN-IN-SETUP.md). De permanente regels staan in
CLAUDE.md; AGENTS.md blijft dezelfde symlink. Geen tweede agentinstructiebestand.


## Feitelijke technische verificatie

| Controle | Resultaat |
| --- | --- |
| Native unit/contract/security | 12 geslaagd, 0 overgeslagen |
| Eigen PostgreSQL: native + bestaande registratie | 17 geslaagd, 0 overgeslagen |
| Contentrechten, learningregels, Focus/shell en live-data | 100 geslaagd, 0 overgeslagen |
| Prisma validate/generate, TypeScript | Geslaagd |
| ESLint | Geen errors; bestaande projectwaarschuwingen afzonderlijk zichtbaar |
| i18n | Check geslaagd; bestaande dekking en/de/fr/es 4137/4555; alle nieuwe teksten vertaald |
| Schone Next.js-productiebuild | Geslaagd; bestaande brede filesystem-tracingwaarschuwing |
| Lokale native bundle | Geslaagd; bestaande Tailwind mixed-unitswaarschuwing |
| Capacitor-sync | iOS + Android, local-development én remote-preview geslaagd |
| Chromium + echte productiebackend | Vier viewport-/themacombinaties geslaagd |

Browsermatrix: 320×844 licht/200%, 390×844 donker, 1280×900 Duits/licht,
844×390 Frans/donker. Offline cold start en netwerkherstel in alle vier;
Nederlandse functionele flows bewijzen login, serveropslag, reload, vernietigde/
heropende WebView, logout en veilige sessieopslagadapter zonder localStorage.
Screenshots en `results.json` worden als `native-foundation-browser` CI-artifact
bewaard, niet in Git. De browseradapter simuleert Keychain uitsluitend in eigen
servergeheugen; de backend gebruikt echte geïsoleerde PostgreSQL.

Migratiebewijs: 155 bestaande tabellen en hun oude kolommen/rijinhoud onveranderd,
449 bestaande constraints ongewijzigd; foutinjectie rolt volledig terug en twee
`migrate deploy`-uitvoeringen zijn veilig. Geen productiegegevens gebruikt.
De eerste testfixture hergebruikte onterecht dezelfde handle/discriminator; die
is uniek gemaakt. De browser vond een echte fetch-receiverfout, die is hersteld
met aanvullende unitregressie. Logoutcontrole wacht op bevestigde revocation,
zonder sleeps, retries of afgezwakte inhoudelijke asserties. De eerste CI-run vond
vervolgens een echte logout/reload-race: de UI bevestigde uitloggen vóór de
duurzame Keychain-intentie. De UI wacht nu op die opslagbevestiging; een extra
unitregressie blokkeert opslag expliciet en controleert de volgorde en offline herstel.

Niet uitgevoerd: Xcode/iOS-build, Android-build (geen Android SDK), simulator-/
apparaatvalidatie, echte Keychain/Keystore- en Apple Developer-E2E. Java 21 is
beschikbaar; dat is geen Android-toolchainbewijs. Geen storesubmissie, deployment,
productiemigratie of live tests. Geen verborgen skips in de hierboven genoemde tests.

De nieuwe CI-job voert dezelfde migratie-, auth- en browserflow uit op de gepushte
head. Definitieve CI-links/status worden in de draft-PR vastgelegd. Fase 1 levert
het veilige ontwikkelfundament en de beperkte leesproef; de releasegate blijft dicht.


## CI-platformcompilatie

De aanvullende workflow `native-platform-builds.yml` compileert Android Debug en
een ongetekende iOS-simulatorapp met echte SDK's op CI. Zij gebruikt alleen een
lokale developmentbundel met een gereserveerde, onbereikbare compile-backend.
Een digestcontrole vergelijkt de assets vóór en na verpakking met `dist/native`.
Beide SDK-runs zijn geslaagd op appcodecommit
`e8714bbc7a8e7bb152ebf5f88aa4e9e4ca2254f7` (run 39654191278);
zie PLATFORMEN voor de artifacts en actuele grens. Een compileprobe vervangt geen fysieke apparaat-/bridgeacceptatie,
onafhankelijke audit of releaseprofiel.
