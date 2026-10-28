# Implementatieplan: NAS-teststack voor native testbuilds

**Actuele aanvulling:** de eigenaar heeft de afzonderlijke omgeving op
`https://dev.versado.app` handmatig getest. De internal-allowlist en de afzonderlijke
develop-imagepipeline worden beschreven in [Development-pipeline](DEVELOPMENT-PIPELINE.md).
`store-test` blijft leeg; Access-compatibiliteit en `account-deletion-v1` zijn nog
open acceptatiepunten. De onderstaande generieke inrichtingsstappen blijven een
referentie; voer ze niet opnieuw uit op de al bestaande stack. Geen NAS-controle
of deployment door Codex.

Status: **plan met technisch voorbeeld**, geen uitrol. Besluit van de eigenaar: een afzonderlijke HTTPS-testbackend op de NAS, gescheiden van productie.
Dit document verzint geen domein of URL en gebruikt geen productiegegevens of productievolumes. De eigenaar voert de inrichting
uit en levert pas daarna de origin voor `scripts/native/distribution-origins.json`.

## 1. Doel
Een bereikbare, veilige testomgeving waarmee interne (`local-internal`) en store-testbuilds (`local-store-test`) kunnen inloggen,
lezen en oefenen, zonder risico voor productie. Zonder deze stack blijft de allowlist leeg en bouwt alleen de CI compileproeven.

## 2. Scheiding van productie (harde eisen)
| Onderdeel | Eis |
|---|---|
| Data | Eigen PostgreSQL-instantie en volume; nooit een kopie of dump van productie. Alleen synthetische testaccounts. |
| Redis | Eigen instantie; geen gedeelde sleutelruimte met productie. |
| Geheimen | Eigen `SESSION_SECRET`, `NATIVE_SESSION_SECRET` (≥ 32 tekens, willekeurig, anders dan productie), SMTP uit of naar een sink. |
| Content | Alleen de content die nodig is voor de te testen functies (eigen import via "Content opnieuw laden"; geen productie-import, geen publicatie vanzelf). Content blijft standaard verborgen tenzij een beheerder het openzet (CLAUDE.md contentregels). |
| E-mail | Uit, of een testinbox; geen echte gebruikers aanschrijven. |
| Netwerk | Eigen Docker-netwerken; geen koppeling aan productienetwerken. Database/Redis uitsluitend intern, alleen proxy heeft een hostpoort. De app heeft uitgaand netwerk voor officiële bronnen en Apple-verificatie; NAS-firewallbeleid blijft een eigenaarstaak. |

## 3. Architectuur (zelfde 3 containers als productie, eigen namen)
Appcontainer + PostgreSQL + Redis, met de bestaande images uit `ghcr.io` (zelfde build als productie, andere configuratie).
Reverse proxy met TLS voor een **aparte hostnaam**; de proxyheaders blijven die van `deploy/nginx/nginx.conf` (inclusief
`Permissions-Policy` met `microphone=(self)`). Documenteer het in `docs/DEPLOY-SYNOLOGY.md`-stijl als een apart voorbeeld.

## 4. Vereiste configuratie (zonder waarden)
`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `APP_URL` (canonieke testorigin), `NATIVE_API_ENABLED=1`, `NATIVE_SESSION_SECRET`,
bij Sign in with Apple: `APPLE_SIGN_IN_ENABLED=1`, `APPLE_TEAM_ID`, `APPLE_IOS_CLIENT_ID=app.versado.app`. Native toegestane origins
zijn vast (`capacitor://localhost`, `https://localhost`); er komt **geen** wildcard.

## 5. Stappen voor de eigenaar
1. Kies de testhostnaam en stel DNS in (alleen de eigenaar bepaalt het domein).
2. Verkrijg een geldig TLS-certificaat (publiek vertrouwd; geen zelfondertekend certificaat, want de apps valideren HTTPS).
3. Maak de teststack (compose-bestand met aparte namen/volumes), start database, Redis en app. **Wijzigende handeling:** de bestaande image-entrypoint voert bij starten `prisma migrate deploy` en initialisatie uit, uitsluitend op de eigen lege testdatabase. Dit is geen alleen-lezen controle; voer niet daarnaast blind dezelfde opdrachten op een andere database uit.
4. Maak een testbeheerder en synthetische testaccounts (inclusief een reviewer-account voor de stores).
5. Laad de benodigde content via "Content opnieuw laden" op de testomgeving en geef gewenste content bewust vrij.
6. Controleer met de bestaande native integratietests (`npm run test:native:integration`-scenario) en handmatig: registratie, inloggen, lezen, oefenen, uitloggen.
7. Voeg de origin toe via een reviewbare PR aan `distribution-origins.json` (`internal` en/of `store-test`); zet `NATIVE_STORE_TEST_API_ORIGIN` in de
   omgevingen `android-play-test` en `ios-testflight`.

## 6. Wat Claude/Codex kan voorbereiden zonder NAS-toegang
- Een voorbeeld-compose en een `.env.native-test.example` met alleen plaatsaanduidingen (geen geheimen, geen echte hostnaam).
- Een controlescript dat een opgegeven origin controleert (HTTPS, certificaat, headers, native health), draaibaar door de eigenaar.
- Documentatie van back-up en opruimen van de testdata. Geen NAS-toegang, geen uitrol, geen productiegegevens.

## 7. Risico's
Testdata die per ongeluk echte persoonsgegevens bevat (alleen synthetisch), gedeelde geheimen met productie (verboden), TLS dat niet
vertrouwd wordt door de toestellen, en content die onbedoeld zichtbaar wordt. De allowlist-PR en de readiness-gate
(`distribution-origins-configured`) blijven de laatste controle vóór een echte testbuild.

## 8. Technisch voorbeeld (toegevoegd)

| Bestand | Doel |
|---|---|
| `deploy/test-stack/docker-compose.yml` | Portainer-stack (web editor) met `versado-test-proxy`, `-app`, `-db`, `-redis`; eigen netwerken (`versado-test-edge`, en `versado-test-internal` met `internal: true`), eigen benoemde volumes, vaste imagetag |
| `deploy/test-stack/.env.native-test.example` | Alleen lege plaatsaanduidingen voor de Portainer-stackvariabelen; geen domein, geen waarden |
| `scripts/native/check-test-backend.mjs` | Alleen-lezen controle van een door jou opgegeven origin (`npm run native:check-test-backend -- <origin> --profile store-test`) |
| `tests/nas-test-stack.test.mjs` | Bewaakt de scheidingsregels hieronder en de beoordeling van het controlescript (`npm run test:nas-stack`) |

**Scheiding van productie, afgedwongen door een test:** alleen `versado-test-*` containernamen; geen `docker.sock`, geen deploy-agent, geen `/volume1`-paden;
database, Redis en app publiceren geen poort (alleen de proxy, op een poort die de eigenaar kiest); elk geheim en elke omgevingswaarde is een verplichte
stackvariabele (`:?`) zonder standaardwaarde of placeholder; geen domein of URL in het bestand; geen `latest`-tag; geen SMTP of feedbackontvanger;
`ALLOW_INSECURE_COOKIES=false`; `NATIVE_API_ENABLED=1`. De productie-proxy-image verwijst vast naar de hostnaam `jehova-app`; de teststack geeft de testapp die
alias **alleen** op het eigen interne netwerk, zodat nooit een productiecontainer wordt bereikt.

**Controlescript (`check-test-backend.mjs`):** valideert de origin exact als HTTPS (zelfde regels als de distributieprofielen), doet drie GET-verzoeken
(`/api/v1/native/capabilities` met en zonder native origin, en `/`), volgt geen redirects en gebruikt geen onveilige TLS-opties. Het controleert: status 200, `apiVersion` 1,
de verwachte capabilities, CORS alleen voor `capacitor://localhost` (een vreemde origin krijgt niets), `Permissions-Policy` met `microphone=(self)`, en optioneel dat de
origin in de allowlist van het gekozen profiel staat. Met `VERSADO_PRODUCTION_ORIGIN` (optioneel, door de eigenaar gezet) weigert het de productie-origin als testbackend. Het maakt geen accounts en schrijft niets.

**Wat nog bij de eigenaar ligt:** hostnaam en DNS, TLS-certificaat, kiezen van de poort en de imagetag, geheimen genereren, de stack in Portainer uitrollen, synthetische accounts
en content aanmaken, en de allowlist-PR. Claude/Codex rolt niets uit en heeft geen NAS-toegang.

**Eerste controle na uitrol:** `npm run native:check-test-backend -- <jouw-testorigin> --profile store-test`; daarna `npm run test:native:integration`-scenario's of handmatig inloggen met een synthetisch account.


## Consolidatie en M0

Zie [MOBILE-1-0-INTEGRATIE.md](MOBILE-1-0-INTEGRATIE.md) voor de actuele mergevolgorde, ontwikkelbuilds en het fysieke M0-protocol.
#206 richt op main zodat de controles werkelijk worden uitgevoerd; #199 blijft de voorafgaande documentatieafhankelijkheid.
Het controlescript verlangt nu ook `account-deletion-v1`; dit bewijst alleen het backendcontract, niet het native scherm of Apple-only-verwijdering.
De app is aangesloten op het **eigen** uitgaande edge-netwerk, anders zouden officiële bronverificatie en Apple-JWKS nooit bereikbaar zijn.
Er zijn geen verbindingen met productienetwerken, database of volumes toegevoegd. De twee datacontainers blijven uitsluitend intern.
Een image-start initialiseert de testdatabase; synthetische accounts aanmaken en content importeren zijn afzonderlijke bewuste testhandelingen.
Geen NAS-validatie, DNS-inrichting of deployment uitgevoerd door Codex.
