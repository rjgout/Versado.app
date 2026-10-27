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

Persistente databasegegevens (gebruikers, wachtwoorden, leesvoortgang, XP, reeksen,
reeksbevriezingen, vrienden, competitie, quizresultaten, content, instellingen) staat
in PostgreSQL, in een map op je NAS die losstaat van de containers. Studielesmedia
en branding staan daarnaast in eigen persistente volumes. Containervervanging
behoudt deze gegevens alleen wanneer de bestaande mounts en configuratie intact
blijven; verwijder de bijbehorende volumes of hostmappen niet.

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

## Stap 3 — Contentbeheer staat los van deployment

Contentbeheer V2 uit #187 is gemerged op main (`419ba1e5`), naast Audio V2 uit #194. Dat bevestigt niet welke image of migratie
op jouw NAS staat. Voor een **bestaande installatie en Audio V2-acceptatie** volg je de acht fasen in
[PRODUCTIE-ACCEPTATIE.md](audio-v2/PRODUCTIE-ACCEPTATIE.md): alleen lezen → opslag/mounts → afgestemde back-up/herstelproef →
expliciete deployment → nacontroles → Ether 1-pilot → beoordeling/publicatie → bulk. Alle NAS-/Portainerhandelingen doe je zelf.
Daar staat per stap Waar/Wat/Waarom/Verwachte uitkomst/Bij fouten en of iets leest, rapporteert of wijzigt.

- **Nieuwe content ophalen** in Adminbackend → Systeem verwerkt aanvullende content, met de bestaande CFM-snapshot-/vrijgaveregels.
  Het vervangt geen Schriftteksten/-oefeningen/-cursussen, spiegelt geen audio en is geen deploymentstap.
- **Schriftbronnen bijwerken** is apart: Controleren → Voorbereiden → Publiceren met planHash. Controleren schrijft wel een logrij;
  Voorbereiden kan OTB downloaden. Publiceren wijzigt tekst/oefeningen per hoofdstuk en markeert legacy-audio waar nodig via
  ChapterAudioCheck. RETIRED bewaart gebruikte oefeningen/historie. Na een deelfout opnieuw voorbereiden, geen oude planHash forceren.
- **Audiobibliotheek** onder Content → Audio registreert/previewt opnamen; publicatie volgt uitsluitend na afzonderlijk akkoord.
  Registratie, tekstvrijgave en audiopublicatie zijn verschillende handelingen. Een tekst-/legacy-controle bevestigen publiceert geen V2-opname.

De legacy-MP3's worden dus niet meer als laatste stap van een gewone aanvullende contentupdate opgehaald. De aparte knop
**Audiobestanden spiegelen** blijft een bewuste download, en hoort niet bij de Audio V2-acceptatie. Gebruik daarvoor geen
`db:seed`, `db:import` of `audio:mirror`. Een nieuwe, lege installatie vraagt een afzonderlijk beoordeeld initialisatie-/bronplan;
start geen volledige seed omdat een bestaande installatie na deployment een fout toont.

ContentUpdateRun bewaart het beheerlogboek, ook bij fouten/herstarts. Openen van de Schriftkaart kan achtergelaten RUNNING-rijen
als onderbroken markeren; het is daarom geen puur alleen-lezen databaseonderzoek. Gebruik de READ ONLY-queries uit het runbook
voor de inventarisatie. Tijdens de audiopilot geen Schriftupdate of andere tekstschrijver starten.

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

Een geslaagde image-workflow voor `main` publiceert images op ghcr.io; controleer de werkelijke build/digest. Normaal update je
via het paneel **"Deployen & onderhoudsmodus"** onderaan `/adminbackend` in
de app zelf — dat volgt het algemene stappenplan hieronder. **Voor de eerste gecombineerde Audio V2-/Contentbeheer-acceptatie**
geldt de gecontroleerde route uit het runbook: afgestemde back-up, oude schrijvers stil, uitsluitend de goedgekeurde app-digest
via Portainer, geen algemene re-pull of configuratievervanging. De repo-voorbeeldstack is geen weergave van jouw NAS.
Een klik op deploy/start is een wijziging, nooit inspectie: hij kan automatisch migreren en de scanner/scheduler starten.
Een complete onbekende incoming/READY-backlog moet daarom vóór deployment zijn verklaard.

Het algemene deployagentpad:

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
hetzelfde paneel. Leg vóór elke update ook het huidige immutable image-ID/digest
en de build-SHA vast en bewaar die image. De huidige deployagent slaat na een
geslaagde healthcheck de **nieuwe** image als `last-good` op. De knop
**"Rollback naar vorige versie"** garandeert daarom na een geslaagde update niet
dat de eerdere image wordt gekozen. Voor een latere bewuste applicatierollback:
zet onderhoudsmodus aan en kies in Portainer expliciet de vooraf vastgelegde
oude image, met behoud van alle mounts, environment en netwerken. Gebruik geen
onbepaald `latest` als rollbackdoel. De automatische rollback tijdens een
mislukte deploy gebruikt wel het daadwerkelijk vooraf vastgelegde image-ID.

**Als er iets misgaat** (bv. de adminbackend zelf is door iets anders niet
bereikbaar): Portainer's eigen **bestaande stack → Update** of de betreffende service-redeploy is alleen na bewuste controle van image, mounts en migraties
bruikbaar. Dit is geen alleen-lezen noodcontrole. Houd onderhoud aan, leg de vorige immutable digest vast en behoud de afgestemde
back-up; gebruik geen blinde re-pull van alle services. Voor Audio V2 is de beperkte Portainerprocedure in het runbook leidend.

**Let op bij schemawijzigingen**: nieuwe Prisma-migraties in
`prisma/migrations/` worden automatisch toegepast bij het opstarten
(`prisma migrate deploy`) — daar hoef je zelf niets voor te doen op de NAS.
De healthcheck faalt als de server door een migratiefout niet opstart. De
automatische applicatierollback draait reeds uitgevoerde SQL echter **niet**
terug. Afgeronde migraties blijven toegepast; een mislukte migratieregistratie
kan ook het starten van een oudere image blokkeren. Houd bij zo'n fout de site
in onderhoud en laat de migratiestatus en database afzonderlijk beoordelen.
Voer niet blind `migrate resolve`, een downmigratie of herstel uit. Een groene
`/api/health` bewijst alleen basisgezondheid, niet dat alle lessen en media
functioneren; voer ook de functionele controles uit het vrijgavedraaiboek uit.

## Back-ups

Het repo-voorbeeld gebruikt `/volume1/docker/jehova-app/postgres` en de blijvende audiobindmount
`/volume1/docker/jehova-app/audio:/data/audio`. Controleer jouw werkelijke Portainer-mounts, volume/quota, vrije ruimte en rechten;
deze handleiding bevestigt geen NAS-configuratie. Neem de vastgestelde blijvende gegevens mee in je eigen back-upplan (Hyper Backup e.d.). Zorg voor een recente,
PostgreSQL-consistente backup (een gevalideerde logische dump of passende
consistente snapshot; alleen een willekeurige kopie van een draaiende datamap
bewijst dat niet). Bescherm ook de permanente `study-media`-map inclusief
`.versado-study-volume.json`, het brandingvolume en de stackconfiguratie met
geheimen in besloten opslag. Neem ook de volledige permanente map `audio` mee:
Audio V2 bewaart onveranderlijke objecten en publicatieverwijzingen in combinatie
met PostgreSQL. Een gewone contentlading reconstrueert die combinatie niet.
Maak een consistente database-/audioback-up met gepauzeerde schrijvers, bewaar
die buiten het betrokken volume en test herstel in een geïsoleerde omgeving.
Zie [Audio V2: productieacceptatie](audio-v2/PRODUCTIE-ACCEPTATIE.md) voor de
controlevolgorde, opslagberekening en afzonderlijke goedkeuringsmomenten.

Wil je liever een los, herstelbaar databasedump-bestand, gebruik dan de
meegeleverde scripts (`scripts/backup.sh` / `scripts/restore.sh`) — die
moet de eigenaar eerst tegen zijn eigen container-/rolinstellingen controleren. `backup.sh` maakt alleen de DB-dump, geen audiokopie;
`restore.sh` gebruikt `pg_restore --clean --if-exists` en overschrijft de gekozen DB. Voer dat nooit uit als controle.
Het Audio V2-runbook geeft de afgestemde DB/audio-back-up, hashes en een echte restore naar uitsluitend nieuwe afgeschermde testdoelen.
Een latere productie-restore vraagt een apart concreet herstelbesluit en kan nieuwere gebruikersvoortgang terugdraaien.

## Fase 2B: studielesmedia — eenmalige voorbereiding na afzonderlijk uitrolakkoord

Dit zijn voorbereidingsinstructies; de fase-2B-PR voert ze niet op de NAS uit.
Een nieuwe appimage alleen voegt **geen** mount toe. De bestaande deployagent
neemt de mounts en environment van de vorige appcontainer over.

1. Controleer de daadwerkelijke stackconfiguratie en de opslag-/backupdekking.
   Het voorstel sluit aan bij de bestaande `/volume1/docker/jehova-app/audio`:
   `/volume1/docker/jehova-app/study-media:/data/study-media`. De werkelijke NAS-map
   is niet vanuit de ontwikkelomgeving geïnspecteerd of aangemaakt.
2. Maak als eigenaar de definitief gekozen NAS-map aan met beperkte rechten;
   koppel hem in de **appservice**, met `STUDY_MEDIA_DIR=/data/study-media`.
   Gebruik uitsluitend een eigen permanente bind mount/volume, geen containerlaag
   of tijdelijke directory. Neem de map op in het gewenste Hyper Backup-bereik.
3. Werk na afzonderlijke review de bestaande Portainer-stack één keer bij. Houd
   alle bestaande database-, Redis-, branding- en audiomounts intact. Deze handeling
   vervangt de container en kan de automatische `prisma migrate deploy` starten:
   dit is dus een productie-uitrol, geen vrijblijvende configuratiecontrole.
4. Initialiseer op de gemounte map expliciet de volumemarker met
   `node scripts/study-content/prepare-storage.mjs` in de appcontainer. Doe dit met
   dezelfde OS-identiteit als de app. De huidige Dockerfile gebruikt root; een
   latere niet-root-configuratie moet de eigenaar van deze map daarop aanpassen.
   De helper controleert de echte mount, maakt geen map aan, verwijdert geen media
   en publiceert niets. Hij bewaart een bestaande geldige volumemarker.
5. Controleer in Adminbackend → Content → Studielespublicaties de opslagstatus.
   Zonder mount, marker of schrijfbevoegdheid blokkeren import en publicatie.
   Controleer na een bewuste containervervanging dezelfde marker en bestanden.

Na afzonderlijke uitroltoestemming ondersteunt de beheerde CFM-workflow een
verborgen conceptimport via **Content opnieuw laden**, met expliciete
snapshotgoedkeuring. De operator-CLI blijft een hulpmiddel, geen noodzakelijke
beheerhandeling. Import publiceert niets: revisiebeoordeling, lespublicatie,
collectievrijgave en publieke zichtbaarheid blijven afzonderlijke acties. Zie
het [actuele vrijgavedraaiboek](content-architecture-v2/24-CFM-MANAGED-IMPORT-AND-RELEASE.md);
het eerdere fase-3B.2-draaiboek beschrijft de historische CLI-voorbereiding.
Geen import of publicatie bij containerstart of CLI-seed. Het
profiel `synthetic-test` werkt alleen tegen de eigen lokale wegwerpdatabase
`versado_content_access_test`; dit is geen productievrijgavevlag. Zet dat profiel
niet op de NAS. Er worden geen synthetische lessen voor productiegebruikers gemaakt.

Bij terugkeer naar de vorige appimage blijven de additieve tabellen en de
mediamount bestaan. Draai geen down-migratie en verwijder geen map of marker.
De oudere image kent de nieuwe beheerpagina niet; gebruikersvoortgang blijft
hetzelfde. Publicatie-rollback wisselt uitsluitend een gevalideerde revisiepointer.

De eigenaar beheert dagelijkse Synology Hyper Backup. Er is geen onafhankelijke
herstelproef uitgevoerd; dat is het eerder expliciet geaccepteerde restrisico.

## Afzonderlijke Audio Worker voorbereiden

De optionele, standaard uitgeschakelde stack `versado-audio-worker` staat in
[de eigen Portainer-handleiding](../deploy/audio-worker/README.md). Zij deelt geen appdata,
productiecredentials of database en publiceert geen poorten. Deze voorbereidende image genereert
geen audio; de Nederlandse legacy-conversie blijft de bestaande appworker gebruiken.
Controleer DSM-quota en niet-root maprechten zelf. Een stack aanmaken, image bouwen of statuscontainer
op de NAS starten is een afzonderlijke wijzigingshandeling en vereist voorafgaande toestemming;
deze handleiding start niets automatisch.
