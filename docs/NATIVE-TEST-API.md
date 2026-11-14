# Eerste TestFlight-installatie — bestaande developmentbackend

## Besluit en grenzen

Hergebruik de bestaande development-stack, PostgreSQL, Redis en opslag. De
voorgestelde API-host is **api-test.versado.app**; deze naam is nog niet uitgerold
of als operationele configuratie goedgekeurd. De besloten website blijft
**dev.versado.app**, met de bestaande Cloudflare Access-policy en interne
thuisnetwerktoegang. Productie en APP_URL blijven ongewijzigd.

De app gebruikt bestaande native Bearer-sessies en eenmalige Socket.IO-tickets;
geen Cloudflare-login, servicecredential of webcookie in de TestFlight-route.
Dit is een afzonderlijk begrensde publieke API, geen vrijgave van de website.
CORS/Origin zijn geen authenticatie: de backend blijft tokens, 2FA, sessies,
bronrechten, mutaties en Redis-rate limits afdwingen.

## Automatische DEV-image, nog niet zelfstandig uitrollen

`scripts/native/render-test-api-proxy.mjs` blijft de enige generator. Het
`development`-target van `deploy/nginx/Dockerfile` voert hem tijdens de imagebuild
uit met Node 24 en neemt alleen de gegenereerde configuratie mee. De bestaande
website blijft op 80; de native test-API luistert daarnaast op 8081. De
Development-workflow selecteert dit target voor de PR-proxybuild én publicatie
van `ghcr.io/rjgout/jehova-proxy:dev` / `dev-sha-<SHA>`.

Het laatste/standaardtarget `production` bevat uitsluitend de oorspronkelijke
nginxconfiguratie. De main-workflow verandert niet. Node wordt niet aan de
proxy-runtime toegevoegd. Geen nieuwe runtimecontainer/stack/database of
handmatig gemounte nginxconfiguratie. De generator kan lokaal nog voor review
worden uitgevoerd; zijn uitvoer hoeft niet naar de NAS te worden gekopieerd.

De listener staat standaard gesloten voor alle overige routes/methoden/hosts en
niet-native Origins. Hij biedt uitsluitend de bestaande native JSON-routes,
brongebonden audio-Range-routes en websocket-only Socket.IO aan. Geen `/api/audio`
met webcookies, `/api/auth`, webpagina's, admin, health, onderhoudsprobe, diagnostiek
of generieke `/api`-proxy. Encoded/traversal/ongekende queryroutes worden geweigerd.
Webcookies en CF-serviceheaders worden upstream verwijderd, evenals Set-Cookie
op responses. Versado Authorization, Range en WebSocket-upgrade blijven behouden.
Alle responses krijgen `X-Robots-Tag: noindex, nofollow, noarchive`. Noindex is
geen toegangsbeveiliging.

## Eigenaar: afzonderlijk goedkeuren en uitsluitend op development uitvoeren

1. Beoordeel deze DEV-imagewijziging; merge en uitrol vereisen apart akkoord.
   Wacht na merge op de volledig groene develop-publicatie. Bewaar het huidige
   dev-imagepaar/digests en de stack-/tunnelinstellingen voor rollback.
2. Ververs uitsluitend het app/proxy-paar van dezelfde goedgekeurde commit in de
   bestaande DEV-stack. De proxy blijft `ghcr.io/rjgout/jehova-proxy:dev` (of zijn
   vaste dev-commit-tag/digest). Geen productie/latest-image gebruiken, geen
   nginx-configbindmount toevoegen. Behoud brandingvolume, depends_on,
   healthchecks en de bestaande netwerken. Upstream `jehova-app:3000` moet via de
   bestaande dev-netwerkalias naar de DEV-app wijzen, nooit naar productie.
3. De bestaande websitekoppeling `18081:80` blijft behouden. De Tunnel draait
   volgens de eigenaar in host-network op dezelfde NAS. Advies voor de extra
   proxykoppeling in Portainer:

   ```yaml
   ports:
     - "18081:80"
     - "127.0.0.1:18082:8081"
   ```

   Cloudflare Tunnel: hostname `api-test.versado.app`, service
   `http://127.0.0.1:18082`, HTTP Host Header `api-test.versado.app`, Path leeg.
   De opgegeven `http://192.168.2.254:18082` werkt niet met uitsluitend een
   loopbackbinding: pas dus ook deze service-URL bewust aan. Behoud
   `dev.versado.app` via 18081, diens Access-app en alle bestaande LAN-routes.
4. **`18082:8081` zonder bindadres is geen tunnelisolatie.** Docker kan de poort
   rechtstreeks op het NAS-netwerk publiceren. Daarmee worden Cloudflare
   Access/WAF/rate limits omzeild en kunnen CF-IP-headers worden vervalst.
   Bearer-/sessie-/bronrechten blijven vereist, maar een Cloudflare-header is
   geen bewijs van tunnelherkomst. Gebruik de loopbackbinding hierboven;
   controleer op de daadwerkelijke NAS/Docker-versie dat 18082 vanaf LAN niet
   bereikbaar is en via de lokale Tunnel wel. Oudere Docker-versies kunnen
   aanvullende beperkingen voor localhost-publicatie vereisen. Bij behoud van
   het LAN-IP-pad is eerst een aantoonbare netwerk/firewallbeperking nodig;
   vertrouw niet uitsluitend op een NAS-firewallregel zonder Docker-padtest.
   Geen router/NAT-portforward voor 18082; geen publieke NAS-IP-DNS-records.
   Geen van deze instellingen wordt door een agent gewijzigd.
5. Behoud Access voor de website. Maak voor de nieuwe, uitsluitend native API-
   hostname een aparte beleidsgrens zonder interactief Access-scherm; wijzig of
   bypass de websitepolicy niet. Controleer eventuele wildcard Access-apps.
   Behoud TLS, WAF, DDoS-bescherming, passende rate limits; geen JavaScript-
   challenge op native JSON/audio/Socket.IO. Schakel cache/HTML-injectie en
   transformaties voor deze API uit (ook Range); behoud WebSocket-ondersteuning.
   Dit zijn eigenaarshandelingen, niet door Codex uitgevoerd.
6. Behoud dev-APP_URL=`https://dev.versado.app`, eigen SESSION_SECRET,
   NATIVE_SESSION_SECRET, PostgreSQL/Redis/opslag en synthetische dev-accounts.
   `NATIVE_API_ENABLED=1` en eigen Redis zijn nodig voor sockettickets. Geen
   productiegegevens kopiëren. Controleer ook herstel-/bevestigingsmails en
   native verwerking van links: de besloten website wordt niet opengesteld om
   dergelijke links te laten werken.
7. Controleer website-Access vanaf buiten en bestaande LAN-toegang. Via de API-
   hostname moeten `/`, admin, `/api/auth`, health en andere webpaden ook met
   vervalste Origin/Host/forwardingheaders geen website of websessie opleveren.
   Host-headeromschakeling mag nooit op listener 80 uitkomen.
8. Test de volledige bestaande backendcheck met de nieuwe origin; gebruik geen
   beperktere capabilitylijst. De `store-test`-allowlist blijft tot bewijs en
   een aparte reviewbare vrijgave **leeg**.

## Reeds geïntegreerd en resterende vrijgave

#267, #268, #269 en #266 zijn in develop opgenomen (basis `749649b4`). WP4 uit
#202/#205 is via #269 geïntegreerd; de oorspronkelijke PR's niet dubbel toepassen.
De bestaande native authenticatie/audio/realtime en TestFlight-signing-/IPA-guards
blijven intact. Geen Apple-signing of upload is hiermee uitgevoerd of toegestaan.

Kortste volgorde: onafhankelijke review en mergegoedkeuring van deze imagefix →
groene DEV-publicatie → eigenaar ververst DEV en configureert poort/tunnel →
werkelijke API-/netwerkacceptatie → afzonderlijke reviewbare store-test-
allowlistvrijgave → aparte toestemming voor signing zonder upload → aparte
uploadtoestemming → TestFlight-installatie en fysieke iPhone-acceptatie.
De allowlist blijft tot acceptatie leeg. Productie/main blijven ongewijzigd.

## Acceptatiebewijs dat de eigenaar nog moet leveren

Op fysieke iPhone, zowel wifi als mobiel internet, zonder Cloudflare-enrollment:

- Controleer de development-origin/commit, aanmelden met synthetisch account,
  vereiste 2FA, herstart/refresh, logout, accountwisseling en ingetrokken sessies.
- Haal hoofdstukken op en lees ze; controleer bronrechten en weigering van een
  niet-toegestane bron. Geen productieaccount/-data zichtbaar.
- Speel hoofdstukaudio af, seek/Range, hervat na netwerkverlies; controleer
  sessieverloop, bron-/accountwissel, logout en background/foreground. Geen
  audiobytes via de JS-JSON-brug en geen verzoek naar dev-website of productie.
- Controleer echte WebSocket-upgrade, eenmalige ticketclaim, reconnect met nieuw
  ticket, verlopen sessie, logout/accountwisseling en afwezigheid van querytokens.
- Test accountverwijdering na geïntegreerd WP4, inclusief herauthenticatie en
  intrekking. Behoud alle capability-/releaseguards.

Een lokale nginxproef met synthetische upstream bewijst alleen de proxygrens,
methoden en headerdoorvoer, niet de echte Cloudflare/NAS-keten, TLS, iPhone-codec,
backendautorisatie of WebSocket-upgrade. **Nog NO-GO voor echte TestFlight-signing
of upload** totdat bovenstaande afhankelijkheden/bewijzen zijn beoordeeld.


## Uitgevoerd proxybewijs

De lokale nginx-proef controleert negatieve routes, raw URI/encoding, host/methode,
CORS-origin en het verwijderen van webcookies en CF-serviceheaders. Daarnaast
is een **echte Socket.IO-client via nginx naar een synthetische Socket.IO-server**
getest: echte WebSocket-upgrade, het auth-pakket buiten de querystring,
replayweigering, een vers bewijs, headerverwijdering en verkeerde origin.
Deze twee proeven draaien ook in de bestaande Linux Development-controles;
er is geen extra CI-matrix of distributieworkflow toegevoegd. Dit bewijst de
proxydoorvoer, niet de echte Cloudflare/TLS/NAS-keten of backend-sessieautoriteit.
De bestaande backend-socketintegraties blijven daarvoor afzonderlijk vereist.
