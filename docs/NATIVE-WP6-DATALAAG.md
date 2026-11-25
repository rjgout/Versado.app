# WP6 deel 1 — gedeelde querykern op develop

Integratiebasis: `develop` **e5f9efce099a570c3d9a4c5685c7e2a6eb308e6c**.
Bron: [draft-PR #230](https://github.com/rjgout/Versado.app/pull/230),
`ed015bad46c422f8b60901245f4fa9901b3c98a6`. Die PR blijft ongemoeid.
Dit is alleen de gedeelde datalaag voor de bestaande lokale hoofdstuklezer;
geen volledige Vandaag-, Leren-, CFM- of native migratie.

## Overgenomen en aangepast

- `queryHooks.ts` bevat de bestaande React-querykern zonder webcookiesockets of
  Next-navigatie. `hooks.ts` blijft de publieke webadapter met dezelfde exports,
  ContentScope-/ContentView-contexten en dezelfde browserstore.
- `NativeDataRuntime` en `NativeDataProvider` gebruiken dezelfde `LiveDataStore`,
  scopes en eventnamen. Eén geheugenstore per native client; geen extra opslag,
  sessiesysteem, API-endpoint, mutatiewachtrij of beloningsberekening.
- De bestaande hoofdstuklezer gebruikt de gedeelde hook voor deduplicatie,
  loading-/foutstatus, gerichte invalidatie en focus/online/hervatten.
  Accountwissel/logout verhoogt de epoch en wist de store; concrete hoofdstuk-ID,
  account en epoch bepalen de native query-identiteit.
- De integratie volgt de huidige `NativeFoundation`: `internalAccess`, de
  enrollmentkaart, Access-foutafhandeling, lokale router, Apple/login,
  verplichte beveiligingssetup, herstelcodes, sessierotatie en duurzame
  logoutintenties blijven behouden. Native HTTP en OS-opslag zijn niet gewijzigd.
- Realtime vereist **beide** voorwaarden:
  `features.includes("realtime-ticket-v1") && client.realtimeSupported`.
  De interne Access-build maakt geen Socket.IO-client aan, ook niet wanneer de
  backend de capability aanbiedt. Geen bypass of nieuwe socketauthenticatie.
- Een gerichte browserregressie vond dat `contentScoped` samen met
  `keepPreviousData` oude SSR-tekst kon tonen na een bronwissel. De gedeelde hook
  sluit vorige data nu uit voor bron-/taalgebonden queries, zoals het bestaande
  hookcontract voorschrijft. Niet-contentgebonden pagination behoudt zijn contract.
- Afronden gebruikt uitsluitend de bestaande servermutatie. Pas na bevestiging
  volgt `activityCompleted`-invalidatie. Netwerkfouten geven geen offline XP,
  reeks, leesafronding of automatische schrijfretry. Na een gevalideerde POST-bevestiging
  wordt de serverstatus direct in dezelfde account-/hoofdstuk-/epochcache gezet.
  De actie- en epochcontroles blijven gelden; een mislukte verificatie-GET maakt
  de opslagbevestiging niet ongedaan. De bestaande invalidatie start de hercontrole
  zonder de knopactie daarop te laten wachten; er is geen aparte voortgangsstatus.

Niet overgenomen: de elf workflowwijzigingen uit #230, Dockerfile-/heapcorrecties,
oude scroll-/navigatiefix, main-upgrade/databaseherstel, endpoints of migraties.
De npm-testkoppeling en geïsoleerde browserrunner zijn wel aangepast zodat de
bestaande CI ook de nieuwe gedeelde data- en browserregressies uitvoert.

## Verificatie

De werkelijk uitgevoerde resultaten, definitieve commit en Actions-links staan
bij de integratie-PR; de oude groene checks van #230 gelden niet als bewijs.

- `npm run test:native`: bestaande sessie-/auth-/Access-tests plus de gedeelde
  data-, webarchitectuur- en contentwisseltests via `test:native:data`.
- `tests/native-data.browser.mjs`: echte React-hooks met een gesimuleerde lees-API;
  bron-/taal-/SSR-isolatie, querydedupe, concrete hoofdstukidentiteit, accountwissel
  met vertraagde antwoorden, foutstatus, focus en hervatten. Geen productie-API.
- De bestaande geïsoleerde ketentest voert account-/2FA-/logout-, web/native
  browser- en socketregressies uit. De Access-browserproef simuleert expliciet
  native platformdetectie terwijl de backend realtime aanbiedt: login, lezen,
  herstart, hervatten, accountwissel en credentialintrekking mogen geen
  WebSocket-handshake of crash veroorzaken. Credentials blijven buiten de browser.
- De native browserproef gebruikt echte browser-offlinemodus: één transportaanroep,
  geen backendmutatie, leesafronding, XP of reeksactie; onlineherstel verstuurt geen
  uitgestelde schrijfactie. Alleen een nieuwe bewuste klik rondt online af.
  Aanvullende regressies bevestigen een echte POST-commit gevolgd door een GET-fout,
  en A→logout→B terwijl het vervolgantwoord nog loopt. Het late READ-antwoord van A
  verandert de ongelezen status van B niet en veroorzaakt geen tweede POST.
- TypeScript, ESLint, schone productiebuild, content-/focus-/layouttests,
  native bundel/distributiepoorten, pariteitsinventaris en beide platformbuilds
  worden voor deze nieuwe integratie gecontroleerd.

Het browserharnas simuleert de native bridge/vault en OS-lifecycle. Het is geen
fysiek Keychain-, Keystore-, Apple- of Cloudflare-bewijs.

## Volgende fysieke iPhone-acceptatie

De **eigenaar** heeft bij [PR #233](https://github.com/rjgout/Versado.app/pull/233)
de eerdere Foundation-build fysiek bevestigd: installatie, Cloudflare Service
Auth, Versado-login, verplichte 2FA en sessieherstel na volledig afsluiten.
Deze bevindingen zijn geen toestelacceptatie van de nieuwe WP6-integratie.

Na onafhankelijke review en afzonderlijk eigenaarbesluit:

1. Bouw/installeer de exacte beoordeelde WP6-commit als `local-internal` voor
   `https://dev.versado.app`, met `NATIVE_INTERNAL_ACCESS=1`; volg de bestaande
   [Access-handleiding](NATIVE-CLOUDFLARE-ACCESS.md). Bewaar bestaande appgegevens;
   servicecredentials uitsluitend via de native systeemdialoog beheren.
2. Controleer bestaande toegang, login en verplichte 2FA. Open een testhoofdstuk,
   sluit de app volledig af en open opnieuw: sessie en actuele eigen data herstellen.
3. Wissel tussen twee concrete hoofdstukken, zet de app op de achtergrond en
   hervat. Controleer dat tekst en loading-/foutstatus bij het juiste hoofdstuk horen.
4. Log A uit, log B in en controleer dat geen tekst of gegevens van A zichtbaar
   blijven. Herhaal tijdens een trage verbinding en na heropening.
5. Test netwerkverlies en herstel: geen automatische afronding of beloning.
   Rond daarna bewust online af en controleer de bevestigde serverstatus.
6. Controleer de Access-kaart en lokale juridische/terugnavigatie, grote tekst
   en dat realtime zichtbaar uitgeschakeld blijft. Credentials ontbreken of
   intrekken mag refresh-/logoutintenties niet wissen; geldigheid/intrekking
   van echte tokens is een afzonderlijke Cloudflare-eigenaarshandeling.

Volledige contentkiezer, Vandaag, Leren en CFM blijven vervolgwerk. Geen formele
pariteitsuitzondering, releasegoedkeuring, merge, deployment of productiehandeling.
