# Deployen op je Synology NAS via Portainer

Je hebt al Cloudflare (Tunnel + domein) en Portainer draaien op je NAS. Deze
app sluit daar gewoon op aan — je hoeft niks in de Cloudflare Tunnel-container
of z'n Docker-netwerk te wijzigen. Alles hieronder gebeurt in Portainer.

## Migreren van een bestaande "bom-game"-installatie

Draait er al een installatie onder de oude naamgeving (`bom-game`/`bom-db`/
`bom-redis`)? Doe dit **vóórdat** je de rest van dit document volgt:

1. Portainer → **Stacks** → `bom-game` → **Stop**.
2. Verplaats op de NAS (File Station of SSH) de map `/volume1/docker/bom-game`
   naar `/volume1/docker/jehova-app` — dus inclusief de `postgres`-submap
   met al je bestaande data.
3. Maak het GitHub-package `jehova-app` publiek (zie **Stap 1** hieronder —
   dat is een eenmalige, nieuwe stap, ook al deed je dat destijds al voor
   `bom-game`).
4. Vervang de inhoud van de bestaande stack door de bijgewerkte
   `deploy/docker-compose.yml` (zie **Stap 2**) en **Update the stack**.
   De Postgres-gebruiker/database blijven bewust "bom" heten — dat is voor
   niemand zichtbaar en hoeft dus niet mee te veranderen.
5. Controleer (**Stap 5**) dat inloggen en je bestaande voortgang nog werken
   vóórdat je de oude, nu ongebruikte map `/volume1/docker/bom-game`
   definitief verwijdert.

## Hoe het in elkaar zit

1. Je pusht naar `main` op GitHub.
2. De workflow `.github/workflows/docker-publish.yml` bouwt **drie**
   Docker-images en publiceert ze naar GitHub Container Registry (ghcr.io):
   `jehova-app` (de applicatie zelf), `jehova-proxy` (een altijd-actieve
   nginx die voor de app staat en tijdens een update een onderhoudspagina
   toont) en `jehova-deploy-agent` (voert de update namens je adminbackend
   veilig uit — zie **Deployen & onderhoudsmodus** hieronder).
3. Op de NAS draaien daardoor vijf containers: `jehova-proxy`, `jehova-app`,
   `jehova-deploy`, `jehova-db` (PostgreSQL, met alle persistente data) en
   `jehova-redis` (Socket.io-adapter voor de live multiplayer-quiz).
4. **Alleen `jehova-proxy`** publiceert een poort op je NAS — `jehova-app`
   zelf is voortaan alleen intern bereikbaar. Jij wijst je eigen, al
   bestaande Cloudflare Tunnel naar `<NAS-IP>:<gekozen poort>` — dat regel
   je zelf in het Cloudflare Zero Trust-dashboard, niet in Docker; die
   verwijzing hoeft bij het invoeren van deze opzet niet te wijzigen, alleen
   `jehova-proxy` publiceert voortaan diezelfde poort in plaats van
   `jehova-app` zelf.

Alle persistente data (gebruikers, wachtwoorden, leesvoortgang, XP, streaks,
freezes, vrienden, competitie, quizresultaten, content, instellingen) staat
in PostgreSQL, in een map op je NAS die losstaat van de containers. Je kan elk
van de containers probleemloos verwijderen en opnieuw starten zonder
dataverlies.

## Stap 1 — Eenmalig: packages publiek maken op GitHub

Zodra de workflow voor het eerst gedraaid heeft na een push naar `main`
(check: tabblad *Actions* in de repo), voor **alle drie** de packages:

1. Ga naar je GitHub-profiel → **Packages** → `jehova-app` (en herhaal voor
   `jehova-proxy` en `jehova-deploy-agent`).
2. **Package settings** → **Change visibility** → **Public**.

Dit is nodig zodat de NAS de images kan ophalen zonder in te loggen bij ghcr.io.

## Stap 2 — Stack toevoegen in Portainer

1. Open Portainer → **Stacks** → **Add stack**.
2. Naam: `jehova-app`.
3. Build method: **Web editor**.
4. Open [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) uit deze
   repo, kopieer de inhoud en plak 'm in het Web editor-veld.
5. Vervang de placeholders (zoek ze op met Ctrl+F — sommige komen op 2-3
   plekken voor en moeten daar overal hetzelfde blijven):
   - `CHANGE_THIS_DB_PASSWORD` → een zelfverzonnen wachtwoord voor de database
   - `CHANGE_THIS_REDIS_PASSWORD` → een zelfverzonnen wachtwoord voor Redis
   - `CHANGE_THIS_TO_A_LONG_RANDOM_STRING` → een lange, geheime willekeurige
     string voor sessies (bv. gegenereerd met `openssl rand -hex 32` op je laptop)
   - `CHANGE_THIS_TO_A_DIFFERENT_LONG_RANDOM_STRING` → **een andere**, eigen
     lange willekeurige string (dus niet dezelfde als hierboven) — dit is het
     gedeelde geheim tussen `jehova-app` en `jehova-deploy`, komt op **twee**
     plekken in het bestand voor en moet daar identiek zijn
   - de `2402` bij `jehova-proxy`'s `ports:` → de poort die je Cloudflare
     Tunnel (of andere reverse proxy) al gebruikt om je NAS te bereiken
6. Klik **Deploy the stack**.

Na een wijziging aan `deploy/docker-compose.yml` moet je de stack één keer
via **Update the stack** bijwerken voordat je vanuit `/adminbackend` een app-
deploy uitvoert. Daarmee krijgt `jehova-deploy` ook de branding-volume mee;
een oude deploy-agent kan die nieuwe configuratie niet zelf achteraf raden.

Portainer trekt nu de vijf images en start alles. `jehova-app` wacht via de
`depends_on`/`service_healthy`-configuratie tot `jehova-db` en `jehova-redis`
daadwerkelijk gezond zijn, draait daarna automatisch de database-migraties
(met een korte automatische retry) en start pas dan de server. `jehova-deploy`
heeft toegang tot de Docker-daemon nodig (de gemounte
`/var/run/docker.sock`) om jou vanuit de adminbackend te kunnen laten
deployen — zie de toelichting in
[`deploy/agent/server.js`](../deploy/agent/server.js) voor waarom dat nodig
is en hoe de scope daarvan beperkt is.

Je kan de voortgang volgen bij **Stacks → jehova-app → Containers**, of per
container op **Logs** klikken.

## Stap 3 — Content laden (eenmalig, en na elke content-update)

Ga naar **Containers → jehova-app → Console**, kies `/bin/sh`, **Connect**, en
draai daarin:

```bash
npm run db:seed
```

Dit laadt alle content (zie de auteursrechtnotitie in de hoofd-README).
Hetzelfde kan zonder console via **Inhoud opnieuw laden** in `/adminbackend`.

Als laatste stap haalt dit ook de voorgelezen hoofdstukken op van de kerk
naar `/volume1/docker/jehova-app/audio` (zie `volumes:` bij `jehova-app` in
`deploy/docker-compose.yml`), zodat de app ze vanaf de NAS afspeelt. De
eerste keer is dat ruim een gigabyte per taal en duurt het even; daarna
worden alleen nieuwe bestanden opgehaald. Zolang een bestand nog niet lokaal
staat, speelt de app het gewoon van de kerk af. Los opnieuw proberen kan met
`npm run audio:mirror` in dezelfde console.
Wil je een andere (toegestane) bron gebruiken, kopieer die dan eerst naar de
container (**Containers → jehova-app → Volumes**, of `docker cp` via SSH) en
draai vervolgens `npm run db:import -- /pad/naar/bestand.json`.

## Stap 4 — Cloudflare: domein naar de NAS wijzen

Dit doe je volledig in je eigen, al bestaande Cloudflare-omgeving — niks in
Docker hoeft hiervoor aangepast te worden:

1. Maak (of gebruik) je domein/subdomein bij Cloudflare.
2. Wijs 'm naar je NAS op de poort die je bij `jehova-proxy` hebt ingesteld
   (via je bestaande Tunnel, of hoe je dat verder al geregeld hebt). Draaide
   je hiervoor al rechtstreeks naar `jehova-app` op diezelfde poort, dan
   hoeft deze verwijzing dus niet te wijzigen — alleen wie er op die poort
   luistert is veranderd.

WebSockets (voor de live multiplayer-quiz) werken hierbij standaard, zonder
extra configuratie (`jehova-proxy` geeft die correct door).

## Stap 5 — Testen

Open je domein in een browser. Werkt registreren/inloggen en de lesflow, dan
staat alles goed. In Portainer moeten alle vijf containers een groene/gezonde
status tonen.

## Daarna: updaten — Deployen & onderhoudsmodus

Elke push naar `main` zet nieuwe images klaar op ghcr.io. Voortaan update je
via het paneel **"Deployen & onderhoudsmodus"** onderaan `/adminbackend` in
de app zelf (dus niet meer via Portainer) — dat volgt precies dit stappenplan:

1. **Onderhoudsmodus aan** — bezoekers zien meteen de nette "Even
   geduld..."-pagina in plaats van straks een Cloudflare-foutmelding.
2. **Nieuwe versie pullen** — de nieuwste `jehova-app`-image wordt van
   ghcr.io gehaald.
3. **Nieuwe container starten** — de oude `jehova-app`-container wordt
   vervangen door een nieuwe met dezelfde omgeving, mounts en netwerken, maar
   de nieuwe image.
4. **Healthcheck** — er wordt gewacht tot Docker's eigen gezondheidscontrole
   van `jehova-app` (die o.a. de databaseverbinding checkt, zie
   `/api/health`) "gezond" meldt.
5. **Werkt de nieuwe versie?**
   - **Ja** → onderhoudsmodus gaat automatisch weer uit, site is live op de
     nieuwe versie.
   - **Nee** → de vorige versie wordt automatisch teruggezet (dezelfde
     image die al draaide vóór deze deploy) en opnieuw gezondheidsgecontroleerd;
     wordt ook dát niet gezond, dan blijft onderhoudsmodus expres aan staan
     totdat je handmatig ingrijpt (zie **Als er iets misgaat** hieronder),
     zodat er nooit een kapotte versie live komt te staan.

Klik gewoon op **"Nu deployen"** en volg de live status/logregels in
hetzelfde paneel. De losse knoppen **"Onderhoudsmodus aan/uit"** en
**"Rollback naar vorige versie"** zijn er voor als je dat ooit los van een
deploy wil doen (bv. eigen onderhoud, of een eerdere mislukte deploy
alsnog handmatig terugdraaien).

**Als er iets misgaat** (bv. de adminbackend zelf is door iets anders niet
bereikbaar): Portainer's eigen **Stacks → jehova-app → Pull and redeploy**
op de `jehova-app`-service blijft ook gewoon werken als noodgreep — dan mis
je alleen de onderhoudspagina en de automatische rollback voor die ene keer.

**Let op bij schemawijzigingen**: nieuwe Prisma-migraties in
`prisma/migrations/` worden automatisch toegepast bij het opstarten
(`prisma migrate deploy`) — daar hoef je zelf niets voor te doen op de NAS.
De healthcheck in stap 4 hierboven faalt als een migratie faalt, dus een
mislukte migratie leidt vanzelf tot de automatische rollback hierboven in
plaats van een half-bijgewerkte database.

## Back-ups

De database staat op je NAS onder `/volume1/docker/jehova-app/postgres` (zie
het `volumes:`-pad in `deploy/docker-compose.yml`) — neem die map mee in je
bestaande Synology-back-upplan (Hyper Backup e.d.). De map `audio` ernaast
hoeft niet in de back-up: die wordt bij de volgende contentlading vanzelf
opnieuw gevuld.

Wil je liever een los, herstelbaar databasedump-bestand, gebruik dan de
meegeleverde scripts (`scripts/backup.sh` / `scripts/restore.sh`) — die
werken op elke Docker-host, ook je NAS via SSH.
