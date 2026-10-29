# Native Cloudflare Access — interne development-builds

Deze uitbreiding is opt-in voor **`local-internal` + kanaal `internal` + exact
`https://dev.versado.app`**, met `NATIVE_INTERNAL_ACCESS=1`. Dit is geen publieke
release of store-testvoorziening. `store-test`, productie-origin en de bestaande
native request-origins blijven ongewijzigd. De eigenaar beheert Cloudflare en NAS;
Codex voert daar geen handelingen uit.

## Werking en grenzen

- De app toont een interne kaart **Interne toesteltoegang**. Toevoegen/vervangen
  opent een **native systeemdialoog**, met gemaskeerde velden voor Client-ID en
  Client Secret. Deze velden bestaan niet in de Versado-WebView. Er is geen
  JavaScript-setter of -getter voor servicecredentials; status geeft alleen
  `enabled` en `configured` terug. Annuleren wijzigt niets.
- iOS bewaart het paar in de afzonderlijke Keychain-service
  `app.versado.native.cloudflare.v1`, `WhenUnlockedThisDeviceOnly`. Android gebruikt
  de afzonderlijke Keystore-alias/preferences `versado-native-cloudflare-v1`,
  AES-GCM met willekeurige IV. De bestaande Versado-sessieopslag blijft apart.
- Alleen native code voegt `CF-Access-Client-Id` en `CF-Access-Client-Secret` toe.
  iOS gebruikt een ephemeral URLSession zonder cookiejar/cache; Android een
  eigen OkHttp-client zonder cookiejar/cache/redirects, met een totale calltimeout
  en zonder automatische herhaling van acties. Er wordt geen globale cookiehandler
  gewijzigd. De normale fetch- en webauthenticatie blijven buiten deze opt-in intact.
- De native code controleert onafhankelijk de lokale WebView-origin, de verpakte
  profielmetadata, de native pluginconfiguratie én het gehashte openbare
  `internal-access.json`. JavaScript kan die poorten niet met een verzoekparameter
  openen. Andere builds gebruiken eerder opgeslagen interne credentials niet;
  de plugin verwijdert de aparte credentialopslag bij een uitgeschakeld profiel.
- Alleen vaste GET/POST/DELETE-combinaties onder `/api/v1/native/` zijn toegestaan:
  capabilities, registratie, login, herstel/bevestiging, refresh/logout,
  beveiligingssetup, bestaande account-/Apple-acties, me/today en hoofdstuklezen/
  afronden. Geen queryparameters, willekeurige URL's, andere hosts, traversal of
  redirects. Het toekomstige WP4-accountverwijderpad is transportmatig toegestaan;
  de backendimplementatie wordt hiermee niet toegevoegd.
- Invoer is begrensd op 16 KiB en antwoord op 1 MiB. Native replies bevatten
  uitsluitend status en gevalideerde JSON-body, geen responseheaders. Letterlijke
  of JSON-geëscapete echo's van de servicecredentials worden geweigerd. Transport-
  en opslagfouten geven uitsluitend vaste foutcodes, geen native diagnostics.
- Een Access-401/403, HTML-loginpagina of redirect is geen verlopen Versado-sessie.
  De client bewaart refresh-/logoutintenties bij een Access-fout. Reeds native ingeplande requests van vóór
  credentialvervanging worden niet met nieuwe credentials uitgevoerd; late
  responses worden geweigerd. Een reeds door de backend gecommitte actie kan door
  lokaal wissen niet worden teruggedraaid.
- Toevoegen/vervangen/wissen logt lokaal uit via de **bestaande** Versado-client.
  Vóór wissen wordt serverlogout geprobeerd zolang de toegang nog bestaat.
  Bij ingetrokken toegang of netwerkverlies blijft serverintrekking duurzaam
  uitgesteld tot de toegang terug is. Een opslagfout wordt niet als succesvolle
  logout bevestigd. Enrollment maakt zelf geen Versado-gebruiker of sessie aan.

### Realtime is een expliciete blokkade

De huidige Socket.IO-client gebruikt de browser-WebSocket, die de serviceheaders
niet veilig kan toevoegen. Deze opt-in weigert daarom de socketfactory **vóór**
ticketuitgifte/handshake; `realtime/session` is niet door deze transportpoort
toegestaan. De UI vermeldt dit. Andere native profielen en webrealtime behouden
hun bestaande transport, eenmalige socketbewijzen en sessiecontroles.

Geen volledige native compatibiliteit claimen. Een later native Socket.IO-transport
vraagt afzonderlijke implementatie/review; geen servicesecret in een querystring,
socket-authpayload, JavaScript-header, cookie-export of algemene Access-bypass.

## Eigenaar: Cloudflare Zero Trust instellen

Dit zijn handmatige **wijzigende** eigenaarshandelingen; voer ze niet als
alleen-lezen controle uit. Ze zijn uitsluitend voor de bestaande dev-hostnaam.

1. **Behoud de website-app.** Laat de bestaande Access-applicatie voor
   `dev.versado.app` en de website-login intact. Wijzig geen productieapplicatie,
   DNS, NAS-route of bestaande website-policy voor deze uitbreiding.
2. **Maak een specifiek beschermde app.** Voeg bij Access-applicaties een
   self-hosted applicatie toe voor hostname `dev.versado.app` en pad
   `/api/v1/native/*`. Controleer dat deze specifiekere applicatie voor alle
   native endpoints geldt, in plaats van de browserlogin-policy op het hoofddomein.
3. **Service Auth, geen Bypass.** Voeg daar een **Service Auth**-policy toe met
   uitsluitend de individueel toegestane servicetokens. Geen `Everyone`, generieke
   Allow-/Bypass-regel of onbeschermde API-route als oplossing gebruiken.
4. **Eén credentialpaar per toestel/tester.** Maak onder servicecredentials/service
   tokens een afzonderlijke naam per intern testtoestel, met de kortst bruikbare
   geldigheidsduur. Bewaar de eenmalig getoonde Client-ID/Client Secret in het eigen
   beveiligde beheerproces. Geen echte waarden in GitHub, chat, issues, appbundels,
   terminalgeschiedenis, buildvariabelen, Versado-database of webopslag zetten.
5. **Enroll op het toestel.** Open de expliciet gebouwde interne app, kies
   **Toegang toevoegen of vervangen** en voer het paar in de systeemdialoog in.
   Dit bevestigt veilige opslag, geen geldigheid: die wordt pas bij elk echt
   API-verzoek door Access gecontroleerd. Log vervolgens met het gewone
   Versado-testaccount in; de edgecredential vervangt geen gebruikersauthenticatie.
6. **Roteren.** Maak een nieuw afzonderlijk paar, laat alleen dat toestel opnieuw
   enrollen, controleer de HTTP-flow en trek het oude token in. Test dat een
   nieuwe aanvraag met het oude paar geweigerd wordt. Er is geen automatische
   credentialdistributie of geheime fallback.
7. **Onmiddellijk intrekken.** Trek het betreffende servicetoken in Zero Trust in
   of verwijder zijn toelating uit de Service Auth-policy. Controleer nieuwe
   requests op het toestel: die moeten weigeren zonder browserloginredirect te
   volgen. Wis zo nodig ook lokaal via **Toegang wissen**. Intrekking is een
   Cloudflare-eigenaarshandeling, geen instelling in Versado.

### CORS, OPTIONS en Socket.IO

Native URLSession/OkHttp voeren geen browser-CORS-preflight uit. Voeg voor deze
transportlaag **geen** wildcard, publieke OPTIONS-uitzondering of API-bypass toe.
De backend blijft de exacte bestaande `Origin` verwachten (`capacitor://localhost`
op iOS, `https://localhost` op Android). De transportlaag verwacht dezelfde exacte
`Access-Control-Allow-Origin` op de doorgelaten backendresponse; override deze
header niet met een wildcard of een Access-loginresponse. CF-authheaders worden
door native code toegevoegd en komen niet in browser-CORS-aanvragen terecht.

Laat `/socket.io` achter de bestaande website-Access-bescherming. Voeg nu geen
native Service Auth-app of bypass voor Socket.IO toe: deze build opent daar geen
native verbinding. Een browserlogin in Safari/Chrome bewijst geen native toegang.

## Interne build maken (geen secrets nodig of toegestaan)

Dit wijzigt alleen lokale buildmappen; geen deployment. Gebruik een beoordeelde
commit en de bestaande M0-instructies voor installatie en ontwikkelondertekening.

```bash
export CAPACITOR_BUILD_PROFILE=local-internal
export NATIVE_DISTRIBUTION_CHANNEL=internal
export NATIVE_API_BASE_URL=https://dev.versado.app
export NATIVE_INTERNAL_ACCESS=1
npm run native:build
npx cap sync android
node scripts/native/verify-distribution.mjs android
# Op de Mac voor iOS met exact dezelfde vier openbare instellingen:
npx cap sync ios
node scripts/native/verify-distribution.mjs ios
```

De bouwvlag bevat geen credential. Bekende CF-credentialvariabelen worden als
bouwinvoer geweigerd. Alleen de opt-in schrijft `internal-access.json`; het bestand
bevat uitsluitend `{"enabled":true}` en valt onder de bestaande bundelhashcontrole.
Bij wisselen van profiel moet opnieuw worden gebouwd en gesynchroniseerd. Een
store-test- of compileproefbuild met de Access-vlag wordt geweigerd.

## Verificatie en eigenaaracceptatie

De werkelijk uitgevoerde resultaten en de exacte CI-head staan bij de PR. De
gerichte controles omvatten native/JS-profielpoorten, routeselectie, ontbrekende/
ongeldige credentials, headers uitsluitend native, redirectweigering, begrenzing,
credentialwissel tijdens requests, echo-afscherming, sessierotatie, pending logout,
een gesimuleerde Access-HTTP-poort vóór de echte geïsoleerde Versado-API, bestaande
account/socketregressies en Android/iOS-compilatie. Browserbewijs van de kaart
gebruikt een **gesimuleerde** native bridge/vault en vervangt geen Keychain- of
Keystore-toesteltest. De simulator wordt niet in de app gebundeld.

Nog door de eigenaar op **zowel Android als iPhone** uit te voeren:

- De echte Access-app/policy en individuele credentials instellen; zonder paar,
  met verkeerd paar en na intrekking veilig weigeren; met geldig paar capabilities,
  registratie/login, refresh, logout, herstel/bevestiging en lezen controleren.
- OS-enrollment annuleren/vervangen/wissen, herstart, schermvergrendeling,
  opslagfouten en netwerkverlies testen. Controleer dat geen servicecredential
  in WebView-inspectie, webopslag, app-/netwerklogs, screenshots of bundels verschijnt.
- De native systeemdialoog op kleine telefoons en met grote systeemtekst testen;
  de browserkaart wordt op 320px/200% en in vijf talen gecontroleerd.
- Bevestigen dat realtime zichtbaar geblokkeerd blijft. Geen complete
  Socket.IO- of Mobile 1.0-acceptatie afgeven op basis van HTTP-succes.

De strenge backendcheck blijft onveranderd. Zonder native secure-store-toegang kan
de bestaande CLI niet door Service Auth authenticeren; zet daarvoor geen secret
in zijn omgeving of headers. `account-deletion-v1` blijft daarnaast ontbreken tot
de bestaande WP4-PR's afzonderlijk zijn geïntegreerd. Geen beperkte capabilitylijst
gebruiken om een releasecheck groen te maken; `store-test` blijft ongewijzigd.

Bronnen: [Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[Access en CORS](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/),
[M0](MOBILE-1-0-INTEGRATIE.md), [Development-pipeline](DEVELOPMENT-PIPELINE.md).
