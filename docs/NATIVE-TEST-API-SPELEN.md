# Spelen op de store-test-API (api-test.versado.app)

Dit document hoort bij `docs/NATIVE-TEST-API.md` en beschrijft de herstelde spelroutes op de
test-API-rand, wat daarvan in de broncode is bewezen, en het uitrol- en rollbackplan voor de eigenaar.
Er is niets uitgerold of geüpload door de wijziging zelf.

## Oorzaak (bevestigd in de broncode en met een echte nginx)

De TestFlight-build (`store-test`) praat via `https://api-test.versado.app` met de dev-backend. Die
host is een bewust smalle nginx-listener (`scripts/native/render-test-api-proxy.mjs`, poort 8081) met een
allowlist van routes. Er stond geen enkele `games/*`-route in: de Spelen-integratie (#283) kwam later dan
de proxylijst. `GET /api/v1/native/games/page?route=%2Flive` kreeg daardoor een kale 404 van nginx
(geen JSON, geen CORS-header). Daarbovenop weigerde de URI-guard elke `%`, terwijl de client de route
(`encodeURIComponent`) als `%2F` verstuurt.

Waarom de gebruiker "De toesteltoegang kon niet worden gebruikt." zag: Swift classificeert een antwoord
zonder JSON/CORS-header met status 404 als `access_invalid_response`; `NativeFoundation.report` geeft
alleen `access_missing`, `access_disabled` en `access_denied` een eigen tekst, elke andere `access_*`-code
de generieke toesteltoegangstekst. Vandaag en Leren werken omdat hun routes wel in de lijst stonden; de
backend meldt `games-v1` en `realtime-ticket-v1` via `capabilities` (wel toegestaan), waardoor de Spelen-tab
verschijnt. De bestaande backendcheck testte alleen `capabilities` en kon dit dus niet zien.

## Wat de rand nu doorlaat

Alle routes komen uit dezelfde expliciete tabellen als de native client (`src/lib/native/gamesRoutes.ts`,
`gamesPagesRoutes.ts`); Node 24 leest ze rechtstreeks (typen worden verwijderd), er is geen tweede lijst.

| Onderdeel | Doorgelaten |
| --- | --- |
| `games/page` | alleen `GET`, precies één query `route=`, en alleen een route uit `GAME_PAGE_ROUTES` (per rij: eigen paden en alleen de sleutels van die rij, elke sleutel hoogstens eenmaal) |
| spel-API's | alleen de paden en methoden uit `GAME_API_ROUTES`, met alleen hun eigen queryparameters (elk hoogstens eenmaal) |
| annotaties | `GET`/`POST games/reading/<id>/annotations`, `GET .../annotations/<id>` |
| audio | `GET games/<bron>/…/audio/playback`; `GET`/`HEAD …/audio/<64 hex>/stream` (niet voor `ak-*`), zoals de native Range-poort |

Toegestane procentcoderingen (de rest van `%`, ook `%25`, `%2E`, `%00`, `%5C` en kleine hex, blijft 404):

- `%2F %3F %3D %26` alleen binnen de waarde van `games/page?route=`, waarbij elke `%2F` door een letter, cijfer,
  `_` of `-` wordt gevolgd (dus geen `%2F..`, `%2F%2F` of `%2F.`);
- `%20 %2C` en niet-ASCII-bytes (`%80`–`%FF`, UTF-8) alleen in spel-queryparameters, en niet-ASCII-bytes in het
  woord van `dictionary/[word]`.

Onveranderd: methoden, `Origin` (alleen `capacitor://localhost` en `https://localhost`), `Host`, het verwijderen van
webcookies en CF-serviceheaders, `Authorization` en `Range` doorgeven, Socket.IO alleen via websocket, en de
authenticatie, sessies en bronrechten in de backend. De proxy geeft geen rechten; hij laat alleen het smalle
verzoekoppervlak van de native client door.
De URI-guard blokkeerde door nginx-quoting geen backslash en geen `//` (de regex las `\|//`); dat is hersteld
(`\\\\`), zonder gevolgen voor geldige routes.

Bekende grens van deze testrand: een zoekterm voor een vriend met andere leestekens dan spatie, komma of
niet-ASCII (bijvoorbeeld `/` of `&`) wordt door de test-API geweigerd; de website en productie zijn niet geraakt.

## Bewijs

In de broncode bewezen (zonder NAS):

- `tests/native-test-api-games.test.ts`: de oorspronkelijke lijst weigerde alle ≥ 240 spelverzoeken van de client
  (regressie van de oorzaak); met het herstel komt elk clientverzoek door en blijven 54 foute/verdachte verzoeken
  (verkeerde methoden, extra/dubbele parameters, `%25`, traversal, onbekende routes, enz.) geweigerd; bestaande
  routes (Vandaag, Leren, `capabilities`, auth, `realtime/session`) beslissen ongewijzigd.
- `tests/native-test-api-games.local-nginx.mjs`: dezelfde gevallen tegen een echte nginx-binary (`nginx -t` en
  HTTP): de oude configuratie gaf 404 op `games/page?route=%2Flive`, de nieuwe laat alle 246 clientverzoeken door
  en weigert alle 54 foute.
- `tests/native-test-api-proxy.integration.mjs` (Docker, in Development-controles): dezelfde gevallen tegen de
  gebouwde `development`-proxy-image, naast de bestaande productie-/onderhoudscontroles.
- `scripts/native/check-test-backend.mjs`: nieuwe, alleen lezende controle `GET games/page?route=%2Flive` zonder
  sessie; verwacht `401` met een JSON-foutcode en de native CORS-header. Een kale 404 keurt de testbackend af.

Pas na uitrol op de NAS te bevestigen: dat de uitgerolde proxy-image deze configuratie draait, de keten
Cloudflare Tunnel → `127.0.0.1:18082` → proxy → app, dat Cloudflare (WAF/managed rules) `%2F` in de querystring
doorlaat, de echte backend-antwoorden voor Spelen met een synthetisch account, de WebSocket voor Samen spelen,
en alles op de fysieke iPhone.

## Uitrolplan (eigenaar, alleen na expliciete goedkeuring)

De wijziging raakt uitsluitend de proxy-image (`deploy/nginx` + generator). De app, database en migraties
veranderen niet; de iPhone-app hoeft niet opnieuw te worden gebouwd of geüpload.

1. **Alleen lezen – GitHub:** wacht op de groene develop-publicatie na de merge en noteer SHA en het
   digest van `ghcr.io/rjgout/jehova-proxy` (`dev-sha-<SHA>`).
2. **Alleen lezen – NAS/Portainer:** noteer het huidige proxy-image (tag én digest) van de dev-stack en de
   huidige app-image. Controleer dat de app een build is met `games-v1` (Spelen-tab zichtbaar). Maak geen
   databaseback-up nodig: er is geen schema- of dataverandering.
3. **Voor de wijziging:** voer de huidige controle uit en bewaar de uitvoer (verwacht: afgekeurd door de nieuwe
   games-controle, of 404 op de curl hieronder):
   `curl -i -H 'Origin: capacitor://localhost' -H 'X-Versado-Client: native-v1' 'https://api-test.versado.app/api/v1/native/games/page?route=%2Flive'`
4. **Wijzigend – Portainer → development-stack → Editor:** zet alleen de proxy-imagereferentie op
   `ghcr.io/rjgout/jehova-proxy@sha256:<digest>` van stap 1; app, volumes, netwerken, poorten (`18081:80`,
   `127.0.0.1:18082:8081`) en geheimen blijven ongewijzigd. Redeploy met opnieuw pullen. Alleen de proxy-container
   herstart; `dev.versado.app` is enkele seconden onbereikbaar. Doe dit buiten een actieve test.
5. **Alleen lezen – controle:**
   - `nginx -t` in de proxy-container (`docker exec <proxy> nginx -t`) of een gezonde container in Portainer.
   - Dezelfde curl: verwacht `401` met `{"error":"session_expired"}` en `Access-Control-Allow-Origin:
     capacitor://localhost` (voorheen 404 zonder JSON).
   - Negatief: `…/games/page?route=%252Flive`, `…/games/admin`, `…/games/page?route=%2Flive&route=%2Fshop`, en
     `https://api-test.versado.app/api/auth/login` geven alle 404.
   - `node scripts/native/check-test-backend.mjs https://api-test.versado.app --profile store-test` slaagt.
   - Vandaag en Leren werken nog (website `dev.versado.app` en de bestaande iPhone-app).
6. **iPhone:** open de bestaande TestFlight-app, ga naar Spelen (met synthetisch account), kies enkele spellen
   en Samen spelen. Geen nieuwe build nodig.

### Rollback

Zet in dezelfde dev-stack de proxy-imagereferentie terug op het in stap 2 genoteerde digest en redeploy. Er is
geen database- of opslagherstel nodig omdat deze wijziging geen data raakt. Ruim niets op in de app. Na een
rollback werkt Spelen op de store-test-build weer niet (de oorspronkelijke fout), en blijven Vandaag en Leren
werken. Voer geen `migrate reset`, seed of productiehandeling uit.

### Als de controle in stap 5 mislukt

- `401` blijft uit en er komt nog steeds een kale 404: de oude proxy-image draait nog (digest, pull-beleid).
- `403`: controleer `Origin`/`Host` van het verzoek en de Cloudflare-regel voor de API-host.
- Een Cloudflare-pagina of HTML: de WAF of managed rules blokkeren `%2F` in de querystring; stel een
  uitzondering in voor uitsluitend `/api/v1/native/games/page` van de API-host (eigenaar, apart besluit).
- `5xx`: de app is niet bereikbaar of niet gezond; dit staat los van deze wijziging.
