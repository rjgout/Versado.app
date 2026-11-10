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

## Reviewbare proxyconfiguratie, nog niet activeren

`scripts/native/render-test-api-proxy.mjs` genereert een opt-in **development**-
nginxconfiguratie. De bestaande websiteconfiguratie blijft behouden op poort 80;
een afzonderlijke listener **8081** bedient alleen de voorgestelde API-host.
Geen nieuwe container/stack/database. De productieproxy en Dockerfiles veranderen
niet. Genereer lokaal of vanuit de beoordeelde checkout:

```sh
node scripts/native/render-test-api-proxy.mjs > /tmp/versado-dev-api-nginx.conf
```

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

1. Beoordeel hostname, gegenereerde configuratie en de bijbehorende draft-PR's.
   Maak eerst een back-up van de huidige **dev**-proxyconfiguratie en noteer
   dev-image-digests en tunnelregels. Geen productiepad of productienetwerk kiezen.
2. Laat de bestaande dev-proxy de gegenereerde nginxconfiguratie read-only laden
   op `/etc/nginx/nginx.conf`. Bijvoorbeeld een bind mount van het door jou
   gekozen NAS-configuratiepad; neem geen verzonnen `/volume1`-pad over.
   Controleer met `nginx -t` in die dev-container vóór een bewuste reload.
   Upstream `jehova-app:3000` moet uitsluitend de bestaande dev-app zijn via de
   bestaande netwerkalias, nooit een productiecontainer. Geen nieuwe app maken.
3. Hergebruik de bestaande Cloudflare Tunnel: voeg na toestemming één exact
   public-hostname-item `api-test.versado.app` toe, met service
   `http://<bestaande-dev-proxy>:8081` en expliciete HTTP Host-header
   `api-test.versado.app`. Behoud `dev.versado.app` → bestaande websitepoort 80,
   de Access-app en alle bestaande LAN-routes. Behoud een gesloten tunnelcatchall.
   Wijzig geen bestaande website-ingress naar de API-listener.
4. Laat DNS via de bestaande tunnel/public-hostname-inrichting verwijzen; geen
   NAS-IP of app-poort publiceren. **8081 uitsluitend bereikbaar vanuit de
   vertrouwde cloudflared-verbinding**, bij voorkeur op het bestaande Docker-
   netwerk zonder hostpoort. Als cloudflared buiten Docker draait: bepaal eerst
   een door de firewall tot die connector beperkt pad. Publiceer geen algemene
   NAS-hostpoort; anders zijn client-IP-/CF-headers niet betrouwbaar.
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

## Open afhankelijkheden en reviewvolgorde

PR #266 blijft ongemerged en wordt niet opnieuw gebouwd: bestaande Apple-signing,
vier secretnamen, `testflight`, develop-branchpoort en IPA-validatie blijven het
uitgangspunt. Alle zes uitgevoerde checks op `b7d24dcf` waren succesvol; publicatie
werd terecht overgeslagen. Dit bewijst geen echte Apple-signing of upload.

`account-deletion-v1` ontbreekt nog op actuele develop. #202 (herauthenticatie bij
verwijdering) en #205 (voorbereiding verwijderpagina/native scherm/inventaris)
staan open, hebben **main** als doel en bevatten conflicten. Die PR's mogen niet
blind worden gemerged, geretarget of dubbel toegepast. Laat de bestaande WP4-
implementatie eerst gecontroleerd naar actuele develop brengen: herauthenticatie,
verwijderingssemantiek/sessie-intrekking, native scherm, inventaris en tests samen
beoordelen. De proxy laat `DELETE /api/v1/native/account` door, maar maakt geen
ontbrekende backendfunctionaliteit en publiceert geen capability namens WP4.
De volledige backend-/readinesspoort blijft daarom afkeuren tot dit is opgelost.

Kortste veilige volgorde: review proxyvoorbereiding → review native direct-
transport/audio → WP4 integreren via normale review → eigenaar accepteert dev-
configuratie en infrastructuur → echte API-/infrastructuuracceptatie → afzonderlijke
allowlistvrijgave → review #266 → apart toestemming voor signing → build zonder
upload → aparte toestemming voor upload → TestFlight-installatie → fysieke
iPhone-acceptatie. De eerste volledige toestelproef volgt na installatie.
Geen van deze merges, deployments, signing of uploads wordt zelfstandig gestart.

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
