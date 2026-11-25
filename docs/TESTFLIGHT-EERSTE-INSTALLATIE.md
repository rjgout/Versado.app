# Kortste veilige route naar de eerste iPhone-installatie

Alles hieronder betreft dezelfde bestaande development-stack; geen derde
stack/database/webapp. `dev.versado.app` blijft de besloten website, productie
blijft `versado.app`. Geen merge, deployment, DNS/Cloudflare/NAS-wijziging,
Apple-signing of upload is door deze voorbereiding toegestaan of uitgevoerd.

## Eerst de drie codevoorwaarden beoordelen

1. [#267: begrensde API-proxy](https://github.com/rjgout/Versado.app/pull/267):
   opt-in configuratie voor dezelfde dev-proxy; extra listener 8081 voor de
   **voorgestelde**, nog niet uitgerolde `api-test.versado.app`. Geen website-,
   beheer- of diagnostiekroutes. Cookie-/CF-headers worden verwijderd, Bearer,
   Range en WebSocket-upgrade doorgegeven. Website/LAN blijven behouden.
2. [#268: native direct transport](https://github.com/rjgout/Versado.app/pull/268):
   dezelfde native JSON-, sessie- en audiotransportlaag, met vaste testorigin en
   zonder Service Auth. Bestaande sockettickets/reconnect en veilige OS-opslag.
   Interne Access-enrollment blijft apart en werkt ongewijzigd.
3. Deze WP4-develop-integratie: bestaande code uit #202/#205 voor veilige
   accountverwijdering, native scherm en `account-deletion-v1`. Originele PR's
   staan nog open tegen main; niet dubbel mergen of automatisch retargeten.
   Beoordeel het hergebruik en de tests in deze develop-PR afzonderlijk.

Na onafhankelijke review en expliciete mergegoedkeuring gaan deze voorwaarden
naar develop. Conflicten en gegenereerde pariteitsinventaris moeten bij iedere
bewuste integratie opnieuw worden gecontroleerd. #266 blijft tot die tijd
ongemerged; er is geen reden de signingketen opnieuw te bouwen.

## Daarna uitsluitend de eigenaar

4. Accepteer de voorgestelde hostname/configuratie apart. Volg de precieze
   tunnel-, dev-proxy-, DNS-, cache-/WAF- en rollbackinstructies in
   `docs/NATIVE-TEST-API.md` uit #267. Alleen cloudflared mag de API-listener
   bereiken. Websitepoort 80 behoudt Access; geen servicecredentials in de app.
   Geen productievolumes, accounts, databases of Redis gebruiken.
5. Rol de beoordeelde develop-versie bewust uit op de bestaande dev-stack.
   Controleer eigen dev-secrets/data, volledige native capabilities, native
   CORS, bronrechten, Range/audio en echte WebSocket-upgrade. Test negatieve
   web-/adminroutes via de API-host en website-Access/LAN apart. Voer de volledige
   `native:check-test-backend` uit, zonder beperkte capabilitylijst.
6. Lever dit bewijs en het aparte vrijgavebesluit aan. Pas daarna volgt een
   kleine reviewbare wijziging met de exacte API-origin in `store-test` van
   `scripts/native/distribution-origins.json`. De lijst is nu bewust nog leeg.
7. Beoordeel [#266](https://github.com/rjgout/Versado.app/pull/266) en geef apart
   merge- en signingtoestemming. GitHub Environment **testflight** bestaat al en
   is beperkt tot **develop**. Controleer reviewers en de secrets **ASC_KEY_ID**,
   **ASC_ISSUER_ID**, **ASC_API_KEY_P8_BASE64**, **IOS_TEAM_ID**; zet variabele
   **NATIVE_STORE_TEST_API_ORIGIN** op de geaccepteerde API-origin. Geen secrets
   in chat; metadata kon met deze integratie niet worden gelezen (HTTP 403).
8. GitHub → Actions → iOS TestFlight → Run workflow → **develop** → app_version
   invullen → **upload uit**. Eerste echte signing pas na aparte toestemming.
   Controleer volledige SHA, versie/build, backend, signing, IPA-validatie en
   SHA-256. De oude default-branch kan nog de archiefnaam tonen; kies develop.
9. Na geslaagde controle en aparte uploadtoestemming: start een **nieuwe run**
   met **upload aan**. Geen rerun van een reeds geaccepteerd buildnummer.
10. App Store Connect → Versado → TestFlight: wacht op verwerking, beantwoord
    de eigen export-/testvragen, voeg je eigen Apple-ID bewust als interne tester
    toe en installeer via Apples TestFlight-app op je iPhone. De workflow nodigt
    niemand uit en publiceert niets in de App Store. Geen lokale Xcode nodig.

## Fysieke acceptatie blijft noodzakelijk

Op wifi én mobiel internet: startup/backend/commit controleren, synthetisch
account met 2FA, herstart/refresh, logout, accountwisseling, sessie-intrekking,
hoofdstukken/bronrechten, audio/seek/Range/netwerkherstel en socketreconnect met
eenmalige tickets. Controleer daarna accountverwijdering met herauthenticatie en
intrekking. Geen Cloudflare-login of enrollment; geen productieaccount/-data.

De eerste volledige toestelacceptatie kan pas na de bewust toegestane upload en
installatie gebeuren. Lokale tests en ongetekende CI-compilaties vervangen die
acceptatie niet. Readiness- en capabilityguards blijven actief. Privacylabels,
Apple-overeenkomsten, export compliance en eventuele eigenaarsteksten blijven
eigenaartaken. Publieke App Store-release en main blijven een apart traject.
