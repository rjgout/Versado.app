# Implementatieplan: NAS-teststack voor native testbuilds

Status: **plan**, geen uitrol. Besluit van de eigenaar: een afzonderlijke HTTPS-testbackend op de NAS, gescheiden van productie.
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
| Netwerk | Aparte container(s) en netwerk; niet bereikbaar vanuit productiecontainers. |

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
3. Maak de teststack (compose-bestand met aparte namen/volumes), start database, Redis en app; draai `prisma migrate deploy` op de **lege** testdatabase.
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
