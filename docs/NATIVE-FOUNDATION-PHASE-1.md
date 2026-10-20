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

## Migratie van overige schermen

Na deze proef per feature: serverdata achter versiecontract, gedeelde clientcomponent,
rechten-/reconnecttests, daarna native navigatie. Volgorde: onboarding en accountbeheer,
Vandaag/contentcontext, cursussen/StudyReader/annotaties, sociale schermen, daarna
realtime/spellen/audio. Socket.io vereist eigen native sessiehandshake; niet impliciet
het cookiecontract aanpassen. Native push volgt afzonderlijk. Geen offline
voortgangsqueue zonder apart servervalidatiecontract.

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
