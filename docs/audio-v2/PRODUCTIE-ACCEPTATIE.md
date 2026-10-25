# Audiobibliotheek V2 — acceptatie en uitrol door de eigenaar

Repositorycontrole: **25 oktober 2026**, main **`e7264f05eeda725b2540198d5592908ebb6de09d`**.
Dit is een uitvoerbaar voorbereidingsdocument, geen uitvoeringsverslag of toestemming.
Codex heeft geen NAS, Portainer of productieomgeving benaderd. Werkelijke containers, mounts, vrije ruimte,
images, bestanden, migratiehistorie en registraties zijn **onbekend totdat de eigenaar ze zelf vastlegt**.

## Wat de repository bevestigt

| Onderdeel | Bevestigd in de broncode | Niet hiermee bewezen |
|---|---|---|
| Contentbeheer V2 | #187 is gemerged in `419ba1e5`; aparte beheerkaarten, planHash, ChapterAudioCheck, ContentUpdateRun, RETIRED en transactionele legacy-audio | Of deze image en migratie op de NAS staan |
| Audio V2 | #194 is opgenomen; AudioPackage → AudioRecording → afzonderlijke AudioPublication | Aanwezige NAS-bestanden, registraties of publicaties |
| Bestaande Nederlandse audio | `prisma/bomAudio.json` bevat 205 hoofdstukken; NL Ether 1 staat daar niet in | Of de NAS exact deze 205 heeft en alle MP3's aanwezig zijn |
| Zes tekstuitgaven | DC/PGP in de/fr/es worden indien afwezig verborgen toegevoegd; bestaande teksten worden overgeslagen; cursussynchronisatie sluit ze uit | Of ze op de NAS bestaan en hun huidige instellingen |
| Officiële bronset | 1.965 doelen, 1.974 varianten, 1.973 unieke audiohashes; vijf Ether 1-kandidaten VALIDATED | Of een nieuwe download nog identieke bytes/tekst levert |
| Review | 12 onzekere uitlijningen + 7 zonder veilige grenzen = 19 uitgesloten publicatiekandidaten | Een inhoudelijke vrijgave van die gevallen |

Bronnen: [Contentbeheer](../CONTENTBEHEER.md), [integratierapport #187](../CONTENTBEHEER-INTEGRATIE-187.md),
[importer](../../scripts/audio/import-official.ts), [ontvanger/publicatie](../../src/lib/audio/library.ts),
[verborgen uitgaven](../../src/lib/audio/hiddenEditions.ts), [Docker-start](../../Dockerfile),
[composevoorbeeld](../../deploy/docker-compose.yml), [broninventaris](../../data/audio/official-inventory.json).
Nieuwe main-wijzigingen blijven behouden; deze PR wijzigt uitsluitend documentatie, geen software, audio of migratie.

## Leeswijzer en beslismomenten

Voer de fasen op volgorde uit. Elke handeling heeft **Waar, Wat, Waarom, Verwachte uitkomst en Bij fouten**.
De technische bijlagen bevatten de precieze commando's; uitvoeren is altijd werk van de eigenaar.

| Label | Werkelijke werking |
|---|---|
| **LEZEN** | Geen beoogde wijziging van database, audio of containerstatus; alleen inspectie/SELECT |
| **RAPPORT** | Leest bronnen, maar maakt nieuwe besloten rapportbestanden; geen DB-/audiowijziging |
| **WIJZIGT** | Download, back-upbestand, onderhoud, stop/start, migratie, import of publicatie; eerst het genoemde akkoord |

Een page-GET is niet altijd alleen lezen: openen van de Schriftbeheerkaart kan achtergelaten ContentUpdateRun-rijen
als FAILED/INTERRUPTED markeren. **Controleren** schrijft een logrij; **Voorbereiden** schrijft bovendien een plan en kan
de OTB-bron downloaden. **Publiceren** daar is een tekst-/oefenupdate, géén audiopublicatie. Gebruik deze knoppen niet
als NAS-inventarisatie. `db:seed`, `db:import` en `audio:mirror` horen niet bij deze audioacceptatie.

Een complete `incoming/<pakket>/READY` kan na appstart door de scanner automatisch worden **geregistreerd**.
Appstart kan dus, naast migraties en andere bestaande achtergrondtaken, ook importwerk veroorzaken. Vooraf onbekende
complete pakketten of lopende imports verklaren; zonder registratieakkoord niet deployen of hervatten. Er is geen hier
veronderstelde scanner-uitknop. De scanner publiceert nooit automatisch.

Afzonderlijke beslissingen van de eigenaar: rapportopslag → onderhoud/back-up/herstelproef → image/deployment → pilotdownload
→ pilotregistratie (inclusief eventuele zes tekstuitgaven) → vijf expliciete pilotpublicaties → bulkdownload/-registratie
→ iedere vervolgpublicatie. Een akkoord op deze document-PR is geen akkoord op die uitvoeringen.

## Toegang en huidige toestemming

Bij deze repositorybeoordeling is geen NAS-/Portainer-/productietoegang beschikbaar: geen geconfigureerde VPN,
NAS-identiteit of productiecredentials. Er is geen verbinding geprobeerd en geen inventarisatie op productie uitgevoerd.
Onderstaande toegang betreft wat de **eigenaar** nodig heeft; er wordt geen NAS-toegang voor Codex aangevraagd.
Geselecteerde, van geheimen ontdane rapporten kunnen later als beoordelingsmateriaal dienen.

| Stap | Benodigde toegang door eigenaar | Toestemming / veilige grens |
|---|---|---|
| Container-/mount-/ruimte-/migratie-inventaris | DSM/Portainer-weergave; voor commando’s SSH met leesrechten op de vastgestelde audiomap en beheerder die geselecteerde Docker-inspect/exec-opdrachten uitvoert; DB-SELECT-toegang | Alleen-lezen inventarisatie is toegestaan; geen containerstart, schema-/datamutatie of importer. Een Docker-socket/groepslidmaatschap geeft brede beheermacht en is geen alleen-lezen rol. |
| Hashes/rapporten/dump-TOC van een bestaande back-up lezen | Leesrechten op een gekozen bestaande back-up; besloten nieuwe rapportmap en eventueel bestaande PostgreSQL-container voor pg_restore --list | Bronnen uitsluitend lezen; rapporten niet overschrijven. Een leesbare TOC bewijst geen herstelbaarheid. Geen wachtwoorden, volledige databasekopie of stacksecrets delen. |
| Nieuwe afgestemde back-upset maken | Eigenaar kan alle schrijvers stoppen; dumprechten in DB; leesrechten op alle blijvende bestanden; schrijf/toegangsrechten op externe versleutelde back-upbestemming | **Nog afzonderlijk akkoord nodig:** onderhoud/stoppen én nieuwe DB-/audio-/configuratieback-up met concrete bestemming en ruimte. Productie blijft ongewijzigd totdat dat besluit is genomen. |
| Echte geïsoleerde herstelproef | Geverifieerde back-upset, lokale Docker-beheerrechten, passende PostgreSQL-image, vrije testcapaciteit en nieuwe besloten testmap | **Nog afzonderlijk akkoord nodig:** expliciet nieuwe testcontainer/volume/map, geen productie-DB, app, netwerkpoort of import. De proef wijzigt testdoelen; dit is geen alleen-lezen inventarisatie. |
| Nieuwe app starten/deployen | Eigenaar beheert bestaande Portainer-stack en image-digests | **Nog afzonderlijk deploymentakkoord nodig**; start kan migraties en scannerregistraties uitvoeren. |
| Ether 1-bronnen ophalen | Goedgekeurde downloadhost met vijf taalbronnen, gereedschappen en nieuwe werkmap | **Nog afzonderlijk downloadakkoord nodig**; in deze opdracht alleen voorbereid, niet gedownload. |
| Vijf Ether 1-kandidaten registreren | Gecontroleerde app, audiomount en DB; vooraf inventaris/back-up/herstelbewijs | **Nog afzonderlijk import-/DB-akkoord nodig**, inclusief eventuele aanmaak van zes ontbrekende verborgen tekstuitgaven; geen publicatie. |
| Ether 1 publiceren | Bevoegde beheerder, vijf beoordeelde opname-ID’s/hashes en actuele pointerversies | **Nog afzonderlijk publicatieakkoord nodig**; registratie of merge geeft dit akkoord niet. |

## Fase 1 — Alleen-lezen inventarisatie

### 1.1 Bestaande omgeving identificeren — LEZEN

- **Waar:** Portainer (Stacks/Containers/Volumes) en DSM (Storage Manager/File Station), alleen bekijken.
- **Wat:** noteer werkelijke app-/DB-/Redis-/proxy-/deployagentnamen, stacknaam, images, bindmounts/volumes, overige appinstanties,
  externe importers, cronjobs en eventuele automatische updaters. Noteer alleen geselecteerde instellingen; deel geen volledige env/inspect
  of stackexport met geheimen. Gebruik voorlopig geen Deploy, Update, Pull-and-redeploy, Restart, console-seed of herstelknop.
- **Waarom:** de repo bevat een voorbeeldstack, niet jouw werkelijke configuratie. Onderhoud van de proxy stopt geen andere schrijvers.
- **Verwachte uitkomst:** een namen-/mount-/schrijverslijst die je later aan concrete containers en paden kunt koppelen.
- **Bij fouten:** niets aanmaken, verplaatsen of corrigeren. Ontbrekende informatie eerst verklaren; Codex krijgt geen toegang.

### 1.2 Exacte image en instellingen lezen — LEZEN

- **Waar:** SSH op de NAS, **Bash**; voer [bijlage A](#bijlage-a--sessie-en-containerinspectie) uit.
- **Wat:** vul de werkelijke namen/paden in, lees image-ID/digests, build-SHA, AUDIO_DIR, rechten, DB-image en aanwezige CLI.
- **Waarom:** een tag zoals `latest` zegt niet welke code draait; `docker exec … printenv` start of migreert de app niet.
- **Verwachte uitkomst:** opgeslagen technische waarden zonder credentials; een ontbrekende nieuwe CLI op een oude image wordt gemeld.
- **Bij fouten:** container/pad niet gokken en geen container starten als controle. Een ontbrekende CLI is vóór deployment informatie,
  na deployment van de gekozen nieuwe image een stopcriterium.

### 1.3 Besloten database-/bestandsbaseline — RAPPORT

- **Waar:** SSH en de bestaande PostgreSQL-container; [bijlagen B–E](#bijlage-b--alleen-lezen-database-inventaris).
- **Wat:** kies een nieuwe rapportmap buiten audio; maak de SELECT-inventaris, beschermingssnapshot, tekstexport indien de huidige CLI
  aanwezig is, en bestandsinventaris. De DB-query gebruikt een READ ONLY-transactie; de rapporten zijn nieuwe bestanden.
  Bijlage B legt ook zonder export-CLI de bestaande verborgen teksten met vers-ID’s en teksthashes vast.
  Ontbreekt de export-CLI, noteer dat en maak de aanvullende export na deployment, vóór iedere audio-import. Gebruik geen importer als alternatief.
- **Waarom:** vóór/na-vergelijkingen bewaken registraties/publicatiepointers, 205 NL-hoofdstukken, controlemarkeringen en zes uitgaven.
- **Verwachte uitkomst:** 205 NL_LEGACY-rijen of een vooraf verklaard verschil; bestaande zes uitgaven hebben false/false/DRAFT,
  nul Course/Exercise en onveranderde tekst-/vers-ID's. Ontbrekende uitgaven blijven als ontbrekend genoteerd.
  Elke READY-map is aan een bekende, beoordeelde receipt gekoppeld; geen onbekende PROCESSING-/FAILED-backlog of actieve import.
- **Bij fouten:** een afwijkende telling, checksum, uitgave of symlink is een stopcriterium. Niets wissen, reseeden, publiceren of in SQL
  aanpassen. Rapporteer ontbrekende MP3's als ontbrekend. De eerste inventaris bij een nog draaiende app is een momentopname;
  herhaal de DB-/bestandssnapshot nadat alle schrijvers in fase 3 zijn gestopt voor de consistente back-upbaseline.

## Fase 2 — Opslagcapaciteit en mounts

### 2.1 Mount en vrije ruimte toetsen — LEZEN

- **Waar:** DSM Storage Manager voor volume/pool/quota/snapshots; Portainer voor effectieve mounts; SSH voor `df`/`du`.
- **Wat:** vergelijk met het repo-voorbeeld `/volume1/docker/jehova-app/audio:/data/audio`, zonder dit als NAS-feit aan te nemen.
  Gebruik de in fase 1 vastgestelde AUDIO-map, controleer dat ze geen symlink is en voer uit:

```bash
test -d "$AUDIO" && test ! -L "$AUDIO"
df -Pk "$AUDIO"
df -Pi "$AUDIO"
du -sk "$AUDIO"
available_kib=$(df -Pk "$AUDIO" | awk 'NR==2 {print $4}')
case "$available_kib" in ''|*[!0-9]*) echo 'STOP: vrije ruimte niet betrouwbaar gelezen'; exit 1;; esac
required_kib=$((30 * 1024 * 1024))
printf 'Beschikbaar: %s KiB; richtwaarde extra vrij: %s KiB
' "$available_kib" "$required_kib"
test "$available_kib" -ge "$required_kib" || { echo 'STOP: minder dan 30 GiB vrij'; exit 1; }
```

- **Waarom:** de onderzochte set vraagt onderstaande extra opslag; DB, bestaande audio en back-ups komen daar afzonderlijk bij.
- **Verwachte uitkomst:** dezelfde blijvende audiomount, passende app-UID/rechten, voldoende bytes én bruikbare inode-/quotacapaciteit.
  Controleer in DSM ook snapshotreserve en de normale vrije-volumemarge. Een niet-ondersteunde inodeweergave is geen positieve meting.
- **Bij fouten:** stop de bulkvoorbereiding. Geen `chown -R`, `chmod -R`, volumeprune, bestandverplaatsing of cacheverwijdering als snelle fix.

Berekening uit de gepinde repositorymetadata, **geen NAS-meting**:

| Opslagdeel | Bytes | GiB |
|---|---:|---:|
| Broncache: 1.974 URL-/stemvarianten (D) | 7.168.283.880 | 6,676 |
| Objecten: 1.973 unieke inhoudshashes (S) | 7.159.935.725 | 6,668 |
| Grootste tijdelijk bestand (M) | 25.009.564 | 0,0233 |
| D + S + M | 14.353.229.169 | **13,367 ≈ 13,4** |

De Franse Alma 30-varianten delen bytes, niet hun bronidentiteit. Op hetzelfde filesystem gebruikt staging/incoming hardlinks;
objects krijgt een eigen kopie. Bij EXDEV kan nog circa 6,676 GiB extra kopie ontstaan. Metadata, bestaande legacy-audio,
filesystem-/snapshot-overhead en groei zijn extra. **30 GiB extra vrij bij de bulkstart** is een conservatieve richtwaarde,
geen garantie voor iedere NAS. Meet opnieuw vóór iedere grote stap. De back-upbestemming moet apart ruimte bieden voor de
volledige huidige audiomap, DB-dump, overige volumes/configuratie en versiebehoud; een back-up op dezelfde pool is geen externe kopie.

## Fase 3 — Database en audio samen back-uppen en herstel toetsen

### 3.1 Onderhoud en schrijvers stilzetten — WIJZIGT beschikbaarheid

- **Waar:** Versado-adminbackend → Deployen & onderhoudsmodus, vervolgens Portainer/SSH.
- **Wat:** na onderhoudsakkoord onderhoud inschakelen; wacht op afronding van imports/leases. Stop alle vastgelegde appinstanties en
  externe content-/audio-/DB-schrijvers, pauzeer eventuele automatische herstarts/updaters. Stop **niet** PostgreSQL, en laat de
  onderhoudsproxy staan. Voor de gecontroleerde appcontainer is het exacte stopcommando:

```bash
docker stop "$APP"
docker inspect --format '{{.State.Status}}' "$APP"
```

  Stop overige vastgelegde schrijvers elk bewust via hun eigen beheer; gebruik geen generieke stop-all-loop. Start nu niets opnieuw.
- **Waarom:** onderhoud alleen blokkeert geen bestaande sockets, scheduler of externe importers; een afgestemde DB/audio-kopie vraagt stilstand.
- **Verwachte uitkomst:** alle beoogde schrijvers aantoonbaar stil, DB actief, geen lopende import. Herhaal B, C en E met nieuwe namen
  (`inventaris-stil.jsonl`, `beschermd-stil.jsonl`, `bestanden-stil.json`); export D moest vóór stop gemaakt zijn, zonder tekstschrijvers.
- **Bij fouten:** geen gedeeltelijk voltooide import als geslaagde baseline voorstellen. Wacht of beoordeel de fout; forceer geen leases/statussen.

### 3.2 Consistente externe back-up maken — WIJZIGT back-upbestanden

- **Waar:** DSM/Hyper Backup voor beschermde externe bestemming/configuratie; SSH voor [bijlage F](#bijlage-f--back-up-en-geïsoleerde-herstelproef).
- **Wat:** maak één nieuwe set met PostgreSQL custom dump en de volledige audiomap, inclusief objects/incoming/staging en broncache.
  Bewaar ook de huidige stack/secrets, image-ID/digest, branding en andere blijvende volumes, waaronder study-media met zijn marker.
  Deze bestanden vallen buiten de scope van de audio-tar en moeten in hetzelfde onderhoudsvenster in de bestaande back-up worden meegenomen.
- **Waarom:** de database bevat verwijzingen naar de bestanden; alleen een audiokopie, een live PG-datamapkopie of een gewone seed reconstrueert dit niet.
- **Verwachte uitkomst:** niet-lege dump/tar, hashes kloppen, dump-TOC leesbaar, archief leesbaar, externe en versleutelde opslag met herstelbare sleutels.
  Een custom dump is op zichzelf niet versleuteld; een DSM-snapshot op dezelfde NAS is niet de externe herstelkopie.
- **Bij fouten:** stop vóór deployment/import. Bewaar oude sets; label de nieuwe onvolledige set als onbruikbaar en overschrijf niets.

### 3.3 Herstelproef en terugvalbesluit — WIJZIGT uitsluitend nieuwe testdoelen

- **Waar:** eigen geïsoleerde herstelomgeving, eventueel door de eigenaar op de NAS; bijlage F bevat afgeschermde testdoelen.
- **Wat:** herstel de dump in een nieuwe lege test-DB en audio in een nieuwe map; controleer hashes, baselinerijen en referenties samen.
  Start geen herstelde productieapp met echte accounts, SMTP of externe koppelingen. Noteer benodigde hersteltijd en bewaartermijn.
- **Waarom:** `pg_restore --list` bewijst alleen leesbaarheid, niet succesvol herstel of bijpassende objecten.
- **Verwachte uitkomst:** echte restore zonder fout naar uitsluitend testdoelen, dezelfde beschermde rijenset en beschikbare objecten;
  koppelingen met SHA/byteSize zijn gecontroleerd. De eigenaar tekent het herstelbewijs af vóór de volgende fase.
- **Bij fouten:** stop; geen restore naar de echte DB en geen oude set wissen. Bijlage F geeft geen toestemming voor productieherstel.

## Fase 4 — Nieuwe image veilig deployen

### 4.1 Image downloaden en aan broncommit koppelen — WIJZIGT lokale imagecache

- **Waar:** GitHub Actions/Packages voor de gekozen main-build, SSH voor pull/inspect.
- **Wat:** kies een beoordeelde image die #187 bevat. Leg de werkelijke package-digest en bijbehorende broncommit vast; geen verondersteld
  `latest` of verzonnen digest. De workflow bouwt `ghcr.io/rjgout/jehova-app` en gebruikt onder meer een korte `sha-…`-tag.
  Voer uitsluitend na download-/uitrolakkoord uit:

```bash
NEW_IMAGE='ghcr.io/rjgout/jehova-app@sha256:VUL_GECONTROLEERDE_DIGEST_IN'
SOURCE_SHA='VUL_VOLLEDIGE_GOEDGEKEURDE_BRONCOMMIT_IN'
case "$NEW_IMAGE" in *VUL*) echo 'STOP: digest invullen'; exit 1;; esac
case "$SOURCE_SHA" in *VUL*) echo 'STOP: broncommit invullen'; exit 1;; esac
docker pull "$NEW_IMAGE"
actual_revision=$(docker image inspect "$NEW_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
test "$actual_revision" = "$SOURCE_SHA" || { echo 'STOP: image en broncommit verschillen'; exit 1; }
docker image inspect "$NEW_IMAGE" --format '{{.Id}} {{json .RepoDigests}}'
```

- **Waarom:** pull haalt bytes op maar start geen container. Een nieuwe app **starten** voert daarentegen automatisch
  `recoverFailedMigrations.ts`, `prisma migrate deploy` en daarna server/scheduler uit.
- **Verwachte uitkomst:** immutable digest en broncommit passen bij de goedgekeurde build; oude image-ID/digest blijft bewaard en lokaal beschikbaar.
- **Bij fouten:** geen `docker run IMAGE` als inspectie gebruiken: de standaard-entrypoint zou migreren/starten. Geen pull-/TLS-/checksumfout negeren.

### 4.2 Alleen de app vervangen — WIJZIGT container, DB-schema en achtergrondwerk

- **Waar:** Portainer → bestaande stack → Editor, onder het afgesproken onderhoud.
- **Wat:** bewaar de bestaande stackexport/secrets besloten. Wijzig alleen de app-image naar de vastgelegde `NEW_IMAGE`-digest.
  Behoud alle bestaande mounts, environment, netwerken, container- en servicenames; plak niet de hele repo-voorbeeldstack over productie.
  Gebruik **Update the stack** uitsluitend na controle van de verschillen. Zet een algemene re-pull/force-recreate van andere diensten niet aan;
  de app-image is al gepulld. Als jouw Portainer-versie geen beperkte wijziging toelaat: stop en laat het uitvoeringsplan beoordelen.
  DB, Redis, proxy en deployagent krijgen in deze ronde geen andere image of configuratie. Oude appschrijvers blijven uit.
- **Waarom:** dit is het expliciete start-/migratiemoment. Een nieuwe image wijzigt niet vanzelf de audiomount.
- **Verwachte uitkomst:** alleen de bedoelde nieuwe app draait, op de vorige mounts en dezelfde DB; proxy blijft onder onderhoud.
- **Bij fouten:** houd onderhoud aan en lees private app-/migratielogs. Geen blind Restart, redeploy-loop, seed, migrate reset/resolve of downmigratie.
  De automatische recovery kent slechts specifiek gepinde oude mislukte migraties; hij is geen generieke reparatie voor Audio/Contentbeheer.

De normale keten bevat `20261020120000_content_work_publication`, `20261029120000_study_identity`,
`20261030120000_study_import_publication`, vervolgens `20261127120000_content_beheer_v2` en
`20261204120000_audio_library_v2` en `20261205120000_daily_text_source` (#215), naast de overige bestaande migraties.
De laatste voegt alleen `User.dailyTextSource` met standaardwaarde toe; hij wijzigt geen audio of bestaande kanaal-/tijdinstellingen. Op een verse DB loopt november vóór december;
op een DB met Audio V2 kan de ontbrekende novembermigratie later volgen. Dat is geïsoleerd getest in #187, inclusief alle 205 NL-hoofdstukken.
De latere main-merge #214 (`e7264f05`) behoudt deze migraties en de Audio-/Contentbeheer-kern; hij wijzigt CFM-plaatsing en verwijzingen, geen audioarchitectuur.
Nooit alleen geselecteerde SQL-bestanden handmatig toepassen, namen hernoemen of toegepaste SQL/checksums veranderen.

| Migratiebestand | Ongewijzigde SHA-256 |
|---|---|
| `20261127120000_content_beheer_v2/migration.sql` | `09ff08e06449733ba78ae35319faf5355839921c496fb44dbaed512e26484d66` |
| `20261204120000_audio_library_v2/migration.sql` | `0f53acb44a291c68369d7b68a0482bb23b919c1b98c5c5712685c8e3c640fa9b` |

## Fase 5 — Controles na deployment

### 5.1 Technische gezondheid en databehoud — LEZEN/RAPPORT

- **Waar:** Portainer voor status/private logs; SSH voor inspectie, health-GET en herhaalde B/C/E-rapporten.
- **Wat:** lees status en broncommit, maak nieuwe snapshots met suffix `na-deploy`. Geen check-/prepare-/publishknoppen gebruiken.

```bash
docker inspect --format '{{.State.Status}} {{.State.Health.Status}} {{.Config.Image}}' "$APP"
docker exec "$APP" printenv NEXT_PUBLIC_BUILD_SHA
docker exec "$APP" node -e 'fetch("http://localhost:"+(process.env.PORT||3000)+"/api/health").then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
```

- **Waarom:** groen health bewijst basisgezondheid, niet mediakwaliteit. De migratie mag uitsluitend nieuwe controle-/logtabellen vullen,
  geen bestaande teksten, hintsaldi, voortgang, legacy-URL's, tijdcodes of publicatiepointers vervangen.
- **Verwachte uitkomst:** juiste digest/broncommit, gezonde app, migraties finished zonder onverklaarde checksum-/foutregistraties;
  dezelfde 205 NL_LEGACY-rijen, dezelfde publicatiepointers en dezelfde bestaande tekst-/vers-ID's. Nieuwe ChapterAudioCheck-rijen
  zijn de verwachte backfill; reeds bestaande controles blijven intact. Maak **nu** een na-migratie/before-import baseline voor controles.
  De zes uitgaven blijven verborgen; ontbreken mag vóór de expliciete registratie nog steeds.
- **Bij fouten:** houd onderhoud aan. Een nieuwe backfill is geen reden om alle oude controles op CURRENT te zetten.
  Geen volledige `cmp` tussen pre-migratie en post-migratie controles eisen als de tabel eerst ontbrak; vergelijk bestaande rijen apart.
  Bij onverwachte tekst-/audio-/pointerwijziging stoppen en beoordelen, niet herstellen met een reload.

### 5.2 Beheerflow herkennen en onderhoud afronden — WIJZIGT mogelijk beheerlog/gebruikersstatus

- **Waar:** Versado-adminbackend → Systeem; Audiobibliotheek onder Content → Audio (`/adminbackend/content/audio`).
- **Wat:** herken de twee beheerkaarten en hun logboek. Openen van de Schriftkaart kan uitsluitend onbeheerde oude RUNNING-rijen
  als FAILED/INTERRUPTED markeren; actieve eigenaars op andere processen worden door hun PG-lock beschermd. Voer geen update uit.
  De eigenaar kan onderhoud pas na bovenstaande controles bewust opheffen; importschrijvers blijven voor de pilot exclusief geblokkeerd.
- **Waarom:** onderscheid de volgende bestaande handelingen; geen ervan is impliciet nodig om reeds aanwezige audio terug te krijgen.
- **Verwachte uitkomst:** beheerrechten werken, twee kaarten aanwezig, fouten/runs zichtbaar en geen onbedoelde contentactie.
- **Bij fouten:** geen mislukte run verwijderen of status in SQL aanpassen. Leg run-ID/fase/fout vast; lees de onderstaande retryregels.

| Handeling | Definitieve werking sinds #187 |
|---|---|
| Nieuwe content ophalen | `runSeed(..., {scriptures:false})`; geen Schriftteksten/-oefeningen/-cursussen of audiomirror. Bestaande CFM-snapshot/vrijgaveregels blijven leidend; deze audioacceptatie start dit niet. |
| Controleren | Contentdroogloop, wel ContentUpdateRun; geen download van OTB. |
| Voorbereiden | Contentdroogloop, wel log/plan/planHash en eventueel gepinde OTB-download; geen audioacceptatiestap. |
| Schrift-Publiceren | Herberekent plan onder importlock; verouderde planHash wordt geweigerd. Per hoofdstuk transacties; veranderde gebruikte oefeningen RETIRED, historie/open sets behouden. |
| Tekstwijziging met legacy-audio | ChapterAudioCheck NEEDS_REVIEW; audio/tijdcodes blijven. Ongewijzigde audio heft de controle niet op. Nieuwe geldige audio, tijden en controle delen één commit; een fout rolt die drie terug. |
| Audio ter controle bevestigen | Alleen expliciete legacy-controle; geen V2-registratie/publicatie en geen bronhashbypass. |
| Audiobestanden spiegelen | Aparte bewuste download, geen gewone contentupdate. Niet uitvoeren in deze ronde. |
| Audio V2 registreren | Receipts/objects/Recording en eventueel zes verborgen uitgaven; **geen AudioPublication**. |
| Audio V2 publiceren | Alleen expliciete beheerbevestiging op opname en huidige pointerversie, met bron-/object-/sessiecontrole in de transactie; tekstzichtbaarheid blijft apart. |

Een Schriftupdate is geen globale transactie: eerdere hoofdstukken kunnen na een fout gecommit blijven. Controleer het logboek,
vergelijk de stand en **bereid opnieuw voor**; forceer geen oude planHash. Een crash wordt via de vrijgevallen eigenaarslock herkenbaar.
Een startlogfout blokkeert de import; eindlogfouten worden als fout getoond. Geen automatische correctie van gebruikersvoortgang.
Bij app-rollback blijven migraties bestaan. RETIRED-compatibiliteit van een oudere image moet vooraf bewezen zijn. De deployagent
schrijft na gezonde deploy de **nieuwe** image als last-good; zijn handmatige rollbackknop is geen bewijs dat de vorige image terugkomt.
Bewaar daarom de vorige digest zelf. Een DB-restore verliest nieuwere voortgang en is geen oplossing voor één afspeelfout.

## Fase 6 — Ether 1-pilot in vijf talen

### 6.1 Broncheckout en gereedschap voorbereiden — WIJZIGT bronbestanden, geen DB

- **Waar:** SSH op de vooraf goedgekeurde downloadhost (NAS uitsluitend door de eigenaar), of een aparte ontwikkelhost.
- **Wat:** Python 3.11+, curl, ffmpeg en ffprobe controleren; geen Vosk nodig voor exact gepinde uitlijningen.
  Gebruik een checkout van exact `SOURCE_SHA`; als die nog ontbreekt, uitsluitend na bron-downloadakkoord in een **nieuwe** map:

```bash
SOURCE=/VUL_BESLOTEN_NIEUWE_BRONMAP_IN
case "$SOURCE" in *VUL*) echo 'STOP: bronmap kiezen'; exit 1;; esac
test ! -e "$SOURCE"
git clone --no-checkout https://github.com/rjgout/Versado.app.git "$SOURCE"
git -C "$SOURCE" checkout --detach "$SOURCE_SHA"
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$SOURCE_SHA"
```

- **Waarom:** downloader en metadata moeten bij de image passen; de runtime-image heeft geen Python en bevat geen bron-MP3's.
- **Verwachte uitkomst:** gecontroleerde checkout/gereedschappen; bij een bestaande checkout eerst commit en schone status controleren, geen blind pull.
- **Bij fouten:** stop. Geen gereedschappen ongemerkt op de NAS installeren, geen heruitlijning/modeldownload en geen seed starten.
  Bij externe download: transporteer uitsluitend de nieuwe werkmap na aparte goedkeuring en verifieer dezelfde hashes op de NAS;
  gebruik geen synchronisatie met delete. Een ontbrekende dependency is geen reden om de importer te vervangen.

### 6.2 Vijf gecontroleerde opnamen downloaden — WIJZIGT nieuwe broncache

- **Waar:** SSH, goedgekeurde checkout en [bijlage G](#bijlage-g--pilotdownload-via-bestaande-validator).
- **Wat:** download Ether 1 voor onderstaande uitgaven, buiten incoming/objects en buiten de legacy-hoofdmap.
  De inspectie ziet twee Engelse stemmen en downloadt daardoor zes bestanden; selecteer precies vijf registratiekandidaten.
- **Waarom:** één canonieke passage vergelijkt vijf talen, vers-navigatie en taalvoorkeur zonder de bestaande 205 NL-hoofdstukken te vervangen.
- **Verwachte uitkomst:** exacte tekst-/audiohashes, vijf VALIDATED kandidaten, juiste uitgaven; NL Ether 1 is ook volgens jouw DB-baseline geen beschermd oud audiohoofdstuk.
- **Bij fouten:** stop bij gewijzigde bron/bytes/uitgave of bestaand beschermd NL-doel. Geen hashes aanpassen, tijden gokken of tekst zichtbaar maken.
  Geen registratie voordat de selectie en de DB-baseline beoordeeld zijn.

| Taal | Bestaande BOM-collectie | Familie | Stem | Onderzochte bytes |
|---|---|---|---|---:|
| nl | content_bom | bofm | audio | 3.086.844 |
| en | content_bom_en | bofm | male | 2.981.144 |
| de | content_bom_de | bofm | audio | 2.592.605 |
| fr | content_bom_fr | bofm | audio | 3.322.613 |
| es | content_bom_es | bofm | audio | 3.192.255 |

### 6.3 Alleen registreren en vergelijken — WIJZIGT bestanden/DB, geen publicatie

- **Waar:** SSH; de bestaande app-importer, [bijlage H](#bijlage-h--pilotregistratie-en-nacontrole).
- **Wat:** eerst nieuwe B/C/D/E-baselines na de migratie en een exclusief importvenster zonder andere aanleveraars/backlog.
  Bij één al exact geregistreerde pilot de vijf-kandidaten-CLI niet uitvoeren; beoordeel bestaande IDs en laat een ontbrekende selectie apart vastleggen.
  Na registratieakkoord de CLI uitvoeren en voor/na vergelijken.
- **Waarom:** de CLI kan ook zes ontbrekende DC/PGP-tekstuitgaven aanmaken: content_dc_de/fr/es en content_pgp_de/fr/es.
  Per uitgave atomair, false/false/DRAFT, geen cursussen/oefeningen; bestaande uitgaven worden niet herschreven.
- **Verwachte uitkomst:** bij vijf nieuwe kandidaten imported:5, missingAlignment:0, mismatched:0, failed:0, published:0; vijf technische registraties,
  geen nieuwe AudioPublication, alle vooraf bestaande 205 hoofdstukken/MP3-hashes/controles onveranderd, zes uitgaven verborgen zonder Course/Exercise-toename.
- **Bij fouten:** lees receipt/foutcode; geen DB-status/lease forceren. Bij gedeeltelijk resultaat eerst opnieuw inventariseren.
  Exact dezelfde batch is herhaalveilig; vers controlemoment kan een andere pakketidentiteit geven. Details staan bij fase 8 en herstel.

## Fase 7 — Beoordelen vóór audiopublicatie

### 7.1 Beheerpreview en schriftelijk besluit — APP-GEBRUIK, geen publicatie

- **Waar:** Versado-adminbackend → Content → Audio.
- **Wat:** beluister alle vijf via de aparte beheerpreview. Leg recording-ID, taal/stem, targetKey, bronhash, SHA-256, kwaliteit,
  huidige publicatie-ID/pointerversie en bevindingen vast. Controleer bestaande leesrechten; maak geen verborgen tekstuitgave zichtbaar om te testen.
- **Waarom:** technisch VALIDATED is geen luisterkundige goedkeuring. Een kandidaatpreview bewijst nog niet de normale vers-/minispelerflow.
- **Verwachte uitkomst:** eigenaar heeft vijf concrete kandidaten beoordeeld; geen publicatiepointer verandert.
- **Bij fouten:** kandidaat buiten publicatie laten; bij bron-/segmentfout een nieuw beoordeeld pakket, geen SQL-promotie of aanpassing van een immutable opname.

### 7.2 Alleen goedgekeurde pilots publiceren en speler testen — WIJZIGT AudioPublication

- **Waar:** dezelfde adminbackend, daarna de gewone lezer op de echte doelbrowsers/toestellen.
- **Wat:** pas na expliciet akkoord op de vijf IDs/hashes/versies ieder afzonderlijk bevestigen; geen API-loop of bulkknop.
  Gebruik de testmatrix hieronder. Zonder productiepublicatieakkoord kan volledige speleracceptatie alleen in een apart goedgekeurde geïsoleerde omgeving.
- **Waarom:** publicatie is de bewuste pointerwissel, los van registratie en tekstzichtbaarheid.
- **Verwachte uitkomst:** uitsluitend de vijf goedgekeurde pointers wijzigen; de 205 beschermde NL-hoofdstukken en 19 reviewgevallen blijven buiten publicatie.
- **Bij fouten:** CAS-conflict → opnieuw lezen en beslissen, niet blind met een hogere versie opnieuw verzenden. Slechte opname niet verder publiceren;
  herstel zo nodig bewust naar een eerder geregistreerde broncompatibele VALIDATED kandidaat. Geen algemene unpublish-/legacy-CLI of pointerdelete verzinnen.

| Proef na pilotpublicatie (of in goedgekeurde acceptatieomgeving) | Acceptatiecriterium |
|---|---|
| Eigen tekst-/audiotaal voor alle vijf pilots | Juiste uitgave en stem; geen stilzwijgende andere tekst/taal |
| Vers 1, midden, laatste vers; snel vooruit/achteruit zoeken | Begin/eindgrens klopt hoorbaar, geen verkeerde versselectie |
| NL Ether 1 lezen, audio naar en/de/fr/es en terug | Dezelfde canonieke passage en uitgavefamilie, voorkeur blijft correct |
| Minispeler: pauze/hervat, navigatie naar andere pagina, stop | Eén speler, correcte tekst/tijd, geen dubbele geluidsbron |
| iPhone/Safari en Android/Chrome; desktop; 320px/200% tekst | Bediening bereikbaar, geen overflow, herstel na netwerkonderbreking |
| Range/HEAD/seeken; logout en gewone gebruiker versus adminpreview | 206/HEAD correct; afgeschermde of ingetrokken audio niet leesbaar |
| NL Ether 2, mits vooraf geen legacy-audio/pointer is vastgesteld, of een ander al leesbaar hoofdstuk zonder audio | Apparaat-TTS volgens bestaande terugval, passende beschikbare stem; afwezigheid eerlijk melden |
| Bron-/objectfouten en tekstwijziging | Eerst geïsoleerd: TTS bij ongeldige actieve V2-opname, geen ongewenste oude V2-opname |
| Zes verborgen tekstuitgaven en 19 reviewopnamen | Zes uitgaven niet zichtbaar voor gewone gebruikers; geen V2-publicatie van de 19 reviewopnamen. Bestaande leesrechten en legacy-audio blijven behouden. |

Geen productieobject verwijderen/corrumperen, sessies van anderen intrekken of brontekst wijzigen als foutinjectietest.
Voor een hoofdstuk zonder V2-pointer blijft bestaande legacy-audio de eerste terugval; pas als die ontbreekt volgt TTS.
Lokale Capacitor-audiopariteit ontbreekt nog op de gecontroleerde basis: web/PWA-bewijs is geen bewijs van native audio,
achtergrondaudio, lockscreen-/headsetbediening of lifecycle-herstel. Registreer die apparaattests afzonderlijk als nog open.
Publicatie verandert nooit tekstzichtbaarheid: verborgen DC/PGP blijft verborgen, ook met een audiopointer.

## Fase 8 — Volledige officiële bibliotheek, na pilotacceptatie

### 8.1 Volledige set downloaden en bekende registraties uitsluiten — WIJZIGT broncache/selectie

- **Waar:** goedgekeurde downloadhost/SSH; [bijlage I](#bijlage-i--volledige-download-bronvergelijking-en-selectie).
- **Wat:** na apart bulkdownloadakkoord een andere nieuwe werkmap gebruiken, met één worker beginnen en exact tegen de gepinde bronset vergelijken.
  In een exclusief importvenster de actuele DB-inventaris nemen en bekende bronidentiteiten uit de selectie halen.
- **Waarom:** checkedAt zit in het manifest en daarmee in pakket-ID. Dezelfde MP3-bytes met een nieuwe controledatum zijn niet vanzelf dezelfde Recording.
  Deduplicatie gebruikt werk/familie/taal/boek/hoofdstuk/stem/bron-URL/audiohash/teksthash; Franse Alma 30-URL's blijven afzonderlijke varianten.
- **Verwachte uitkomst:** 1.965 identiteiten/1.974 identieke varianten; verified-inventaris bewaard. Met vijf bestaande pilots en verder lege bibliotheek:
  1.969 nieuwe kandidaten; bij meer bestaande data minder. Dit is een verwachting voor die beginsituatie, geen NAS-feit.
- **Bij fouten:** bronverschil → stoppen en herbeoordelen. Nul kandidaten → geen nieuwe import. Een hervatte downloader kan inventory.json vervangen;
  dan eerst opnieuw vergelijken en selecteren met verse DB-inventaris, niet blind registreren.

### 8.2 Batch registreren, controleren en publicatie apart besluiten — WIJZIGT bestanden/DB

- **Waar:** SSH voor importer en rapporten; adminbackend voor beoordeling; bijlage I.
- **Wat:** pas na registratieakkoord de bestaande CLI op de gecontroleerde selectie uitvoeren. Herhaal B/C/D/E en vergelijk beschermde data,
  pointers en bestaande tekst-ID's. Reviewgevallen mogen herkenbaar NEEDS_REVIEW geregistreerd zijn maar blijven buiten publicatie.
- **Waarom:** registratie van de bibliotheek is geen toestemming voor brede beschikbaarstelling of vervanging van legacy-audio.
- **Verwachte uitkomst:** alleen ontbrekende kandidaten toegevoegd, geen dubbele pilotregistratie, nul automatische publicaties;
  zes uitgaven verborgen, nul cursussen/oefeningen daarvoor, oorspronkelijke 19 identiteiten en 205 NL-hoofdstukken niet overgepubliceerd.
- **Bij fouten:** gedeeltelijke import eerst inventariseren; receipts/bestanden bewaren. Geen bulkpublish, kwaliteitsveldpromotie, seed of datareset.
  Vervolgpublicatie alleen per beoordeelde batch met apart akkoord op IDs/versies. Eén pointer per hoofdstuk; stemmen zijn alternatieven.

| Taal | Werk / hoofdstuk | Stemmen | Aantal |
|---|---|---|---:|
| nl | bofm / 1-ne 1 | audio | 1 |
| de | bofm / morm 1; pgp / js-h 1 | audio | 2 |
| en | dc-testament / dc 44; dc 84; pgp / js-h 1 | 44 male; 84 female+male; js-h female+male | 5 |
| es | dc-testament / dc 84; pgp / js-h 1 | audio | 2 |
| fr | bofm / 1-ne 18; dc-testament / dc 2,12,14,17,32; pgp / js-h 1, moses 3, moses 4 | audio | 9 |

Samen 12 onzekere alignments en 7 zonder veilige volledige grenzen. De exacte hashes en uitkomsten staan in
`data/audio/official-alignments.json` en `docs/audio-v2/RESULTATEN.md`. Een nieuwe opname voor zo'n doel blijft buiten
deze publicatieronde totdat afzonderlijke review én expliciet publicatieakkoord bestaan. Geen kwaliteitsveld in SQL promoveren.
De overige 1.955 technisch VALIDATED registraties zijn **niet automatisch luisterkundig goedgekeurd**.
Er is maar één actieve publicatiepointer per hoofdstuk: verschillende stemmen zijn alternatieven, geen gelijktijdige publicaties.
Publiceer de 205 beschermde bestaande NL-hoofdstukken in deze acceptatieronde evenmin over met V2-opnamen.

## Storingen, prestaties en herstelbesluit

### Storing behandelen — eerst LEZEN, herstel uitsluitend na afzonderlijk WIJZIGINGS-akkoord

- **Waar:** private app-/importlogs, SELECT-rapporten en adminbackend; ernstig herstel alleen door de eigenaar in onderhoud.
- **Wat:** stop nieuwe aanlevering; lees receipt, run-ID/fase, bronhash, objecthash en actuele pointer. Gebruik onderstaande foutafhandeling.
  Een afspeelfout vraagt geen volledige database-restore. Bij ernstig dataverlies pas na apart herstelbesluit alle schrijvers stoppen,
  de geteste bijpassende DB-/audiokopie en compatibele image gezamenlijk terugzetten en de fase-5-controles herhalen.
- **Waarom:** eerdere hoofdstukcommits, durable objecten en databaseverwijzingen moeten samen beoordeeld worden.
- **Verwachte uitkomst:** een verklaarde fout en een gerichte herhaal-/herstelbeslissing; originele bestanden, receipts, historie en back-up blijven bewaard.
- **Bij fouten:** geen ad-hoc productie-restore, brede delete, schema-/enum-drop, reset of volumeprune. Herstel eerst opnieuw op lege testdoelen toetsen.

De volledige set bevat circa 238,4 uur speelduur. Ideale netwerktijd voor 7,168 GB: circa 96 minuten bij 10 Mbit/s,
19 minuten bij 50 Mbit/s of 10 minuten bij 100 Mbit/s; exclusief TLS, bronlimieten, pagina's en volledige decodering.
Dit zijn berekeningen, **geen NAS-benchmarks**. De importer verifieert/hasht/decodeert opnieuw; meet de vijf pilots met
`time`, `docker stats`, `df`, fouttellingen en normale appresponstijden. Plan bulk buiten piekgebruik en pauzeer bij
ruimte onder de afgesproken grens, aanhoudende hoge IO/CPU, oplopende HTTP-fouten of merkbare verslechtering van de app.
Spreek vooraf concrete grenzen af; voorstel: minimaal 30 GiB vrij bij de start, nul nieuwe HTTP-5xx, en pauzeren als
de gemeten p95-responstijd vijf minuten boven tweemaal de vóór-baseline blijft. Meet daarvoor dezelfde lees-/seekacties
minstens tienmaal per pilottaal. Dit zijn voorgestelde acceptatiegrenzen, geen gemeten NAS-resultaten.
De downloader begrenst netwerkverzoeken en decodeertijd; trage bestanden mogen falen, niet met onvolledige bytes doorgaan.

- HTTP-/decode-/checksumfout: geen registratie van dat bestand; oorzaak vastleggen en gecontroleerd hervatten.
- SOURCE_MISMATCH: stoppen voor dat doel; echte productie-editie/tekst vergelijken. Nooit hashes, Verse-ID's of tekst passend maken.
- PROCESSING-lease maximaal vijf minuten; FAILED krijgt backoff tot maximaal één uur. Dezelfde ongewijzigde batch kan daarna opnieuw; scanner maximaal twintig kandidaten per minuut.
  Na een onderbreking kunnen complete pakketten later nog worden **geregistreerd**, nooit vanzelf gepubliceerd.
- PROCESSING door een andere worker: CLI kan een niet-READY resultaat melden terwijl de scanner afrondt. Wachten, uitsluitend
  lezend de receipt controleren en dezelfde batch herhalen; geen lease, manifestHash of status met SQL wijzigen.
- Gewijzigde manifestinhoud: nieuw pakket-ID; PACKAGE_ID_REUSED of LEASE_LOST niet met SQL omzeilen.
- DB-/procesfout: registratie en READY delen één transactie; een al duurzaam object kan achterblijven. Bewaren, niet automatisch wissen;
  idempotente retry kan dat object hergebruiken. CLI kan gedeeltelijk geslaagd zijn: inventariseren vóór herhalen.
- Zes-uitgaven-aanmaak faalt: per-uitgave rollback, andere al aangemaakte uitgaven blijven verborgen; geen automatische correctie
  van bestaande collecties. Nul nieuwe cursussen/oefeningen blijft een harde eis.
- Mislukte publicatie: pointertransactie rolt terug. Vorige publicatie blijft actief; geen geforceerde hogere CAS-versie proberen.

Herstelvolgorde na akkoord: stop nieuwe aanlevering/importers; behoud alle bestanden/receipts; vergelijk snapshots en foutcodes.
Bij een fout beluisterde publicatie: laat de eigenaar een eerder geregistreerde, nog broncompatibele VALIDATED opname bewust
terug publiceren met de actuele pointerversie. Er is **geen algemene unpublish-/terug-naar-legacy-CLI**; geen pointerrij wissen
om dat te simuleren. Bij ontbrekend/corrupt actief V2-object volgt TTS, niet gegarandeerd de oude legacy-opname.
Bij ernstig dataverlies: schrijvers pauzeren, afgestemde DB/audio-back-up en passende image onder apart herstelakkoord terugzetten,
eerst geïsoleerd verifiëren. Een DB-restore kan nieuwere gebruikersvoortgang terugdraaien: daarom niet gebruiken voor een enkele
afspeelfout. Geen schema-/enum-drop, reset, brede verwijderquery, `rsync --delete` of volumeprune als rollback.
Een oude appimage is na RETIRED-gebruik niet zonder compatibiliteitscontrole een veilige #187-rollback.

## Aftekenlijst voor de eigenaar

- [ ] Werkelijke namen, images/digests, mounts, databaseversie, schrijvers en migratiehistorie vastgelegd; onbekenden verklaard.
- [ ] 205 NL-hoofdstukken, bestaande MP3-hashes/mtime, controles, tekst-ID's en publicatiepointers hebben een bruikbare baseline.
- [ ] Zes uitgaven ontbreken bewust of blijven false/false/DRAFT met nul Course/Exercise; 19 reviewidentiteiten vastgelegd.
- [ ] Minimaal afgesproken extra ruimte, inodes/quota/snapshotreserve én aparte back-upcapaciteit gecontroleerd door de eigenaar.
- [ ] Alle schrijvers stil, consistente externe DB/audio-set plus overige volumes/configuratie; echte geïsoleerde herstelproef afgetekend.
- [ ] Deployment apart goedgekeurd op immutable digest/broncommit; geen onbekende incoming-READY-backlog.
- [ ] Na deployment: migraties/gezondheid/data vergeleken; nieuwe controlebackfill apart van bestaande controles behandeld.
- [ ] Vijf Ether 1-kandidaten exact in de juiste uitgaven; download en registratie afzonderlijk goedgekeurd; nul publicatie bij registratie.
- [ ] Vijf concrete pilotpublicaties vooraf expliciet goedgekeurd, of speler uitsluitend in geïsoleerde acceptatie getest.
- [ ] Vers-navigatie, minispeler, vijf talen, TTS en rechten op doelbrowsers/toestellen door de eigenaar afgetekend.
- [ ] Prestaties, foutcodes, retries en herstelduur vastgelegd; native/apparaatachterstand afzonderlijk genoteerd.
- [ ] Bulkselectie tegen actuele registraties gecontroleerd; 19 reviewgevallen en 205 beschermde NL-publicaties uitgesloten.
- [ ] Iedere vervolgpublicatie apart beoordeeld en goedgekeurd. Geen contentactie of audiopublicatie als verborgen deploymentstap.

Alle NAS-specifieke vakken blijven open totdat de eigenaar de handeling werkelijk heeft uitgevoerd en bewijs heeft vastgelegd.

## Technische bijlagen — alleen uitvoeren bij de genoemde fase

Dezelfde Bash-sessie bewaart variabelen. Leg APP, DB, AUDIO, RUN, REPORT, BACKUP, SOURCE_SHA, SOURCE en gebruikte WORK/FULL-paden
besloten vast. Na een verbroken sessie eerst die gecontroleerde waarden herstellen, met `set -euo pipefail`, noclobber en umask 077;
geen volgende fase uitvoeren met ontbrekende variabelen. Bestaande baselines en een ongewijzigde importbatch blijven behouden:
maak hun map niet opnieuw en download die batch niet opnieuw als registratie-retry. Nieuwe rapporten/exports krijgen een nieuwe suffix;
een werkelijk nieuwe downloadcontrole krijgt een nieuwe RUN/werkmap en opnieuw vergelijking/deduplicatie. Nooit vóórbestanden overschrijven.
Een codeblok is geen toestemming. **Kopieer geen complete pagina naar een terminal.**

### Bijlage A — sessie en containerinspectie

- **Waar:** SSH/Bash; LEZEN.
- **Wat:** Vul eerst gecontroleerde namen in. Bij een gestopte app werken exec-opdrachten niet; start haar niet om te inspecteren.

```bash
set -euo pipefail
set -o noclobber
umask 077
APP=VUL_APP_CONTAINER_IN
DB=VUL_DB_CONTAINER_IN
AUDIO=/VUL_WERKELIJKE_AUDIOBINDMOUNT_IN
case "$APP:$DB:$AUDIO" in *VUL*) echo 'STOP: eerst namen/pad in Portainer controleren en invullen'; exit 1;; esac
RUN=$(date -u +%Y%m%dT%H%M%SZ)
test -d "$AUDIO" && test ! -L "$AUDIO"
docker inspect --format '{{.Config.Image}} {{.Image}}' "$APP"
docker image inspect "$(docker inspect --format '{{.Image}}' "$APP")" --format '{{json .RepoDigests}}'
docker inspect --format '{{range .Mounts}}{{println .Source "->" .Destination "rw=" .RW}}{{end}}' "$APP"
docker inspect --format '{{.Config.Image}} {{.Image}}' "$DB"
docker exec "$APP" printenv AUDIO_DIR
docker exec "$APP" printenv NEXT_PUBLIC_BUILD_SHA
docker exec "$APP" id
docker exec "$APP" stat -c '%d %u:%g %a %n' /data/audio
if docker exec "$APP" test -f /app/scripts/audio/import-official.ts; then echo 'Import-CLI aanwezig'; else echo 'Import-CLI ontbreekt in huidige image'; fi
if docker exec "$APP" test -f /app/data/audio/official-alignments.json; then echo 'Metadata aanwezig'; else echo 'Metadata ontbreekt in huidige image'; fi
docker stats --no-stream "$APP" "$DB"
```

- **Waarom:** Namen/UID/build/mount komen uit de werkelijke omgeving; de voorbeelden gelden niet vanzelf.
- **Verwachte uitkomst:** Geregistreerde oude digest/broncommit, DB-image en effectieve audiomount.
- **Bij fouten:** Stop bij onbekend pad, symlink of verkeerde container; geen wijziging van rechten of mounts als inspectie.

### Bijlage B — alleen-lezen database-inventaris

- **Waar:** SSH; RAPPORT: nieuwe map/SQL/JSONL, DB uitsluitend READ ONLY.
- **Wat:** Eenmalig nieuwe rapportmap en inventaris.sql maken. Hergebruik later alleen de psql-regel met een nieuw uitvoerbestand.

```bash
umask 077
REPORT_PARENT=/VUL_BESTAANDE_BESLOTEN_RAPPORTMAP_IN
case "$REPORT_PARENT" in *VUL*) echo 'STOP: rapportparent kiezen'; exit 1;; esac
test -d "$REPORT_PARENT"
REPORT="$REPORT_PARENT/audio-acceptatie-$RUN"
test ! -e "$REPORT" || { echo 'Kies een nieuwe rapportmap; bestaande baseline niet overschrijven.'; exit 1; }
mkdir "$REPORT"
cat > "$REPORT/inventaris.sql" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object('type','MIGRATION','name',migration_name,'checksum',checksum,'finished',finished_at,'rolledBack',rolled_back_at)
FROM "_prisma_migrations" ORDER BY started_at,migration_name;
SELECT jsonb_build_object('type','TABLE','name',name,'present',to_regclass(format('%I',name)) IS NOT NULL)
FROM (VALUES ('AudioPackage'),('AudioRecording'),('AudioPublication'),('ChapterAudioCheck'),('ContentUpdateRun')) t(name);
SELECT 'SELECT jsonb_build_object(''type'',''RECORDINGS'',''work'',work,''language'',language,''quality'',quality->>''status'',''count'',count(*),''bytes'',sum("byteSize")) FROM "AudioRecording" GROUP BY work,language,quality->>''status'' ORDER BY work,language,quality->>''status'';'
WHERE to_regclass('"AudioRecording"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''RECORDING'',''row'',(to_jsonb(r)-''segments''-''sourceMetadata''-''quality'') || jsonb_build_object(''qualityStatus'',r.quality->>''status'',''sourceUrl'',r."sourceMetadata"->>''url'',''bookKey'',b.key,''chapterNumber'',c.number,''packageStatus'',k.status)) FROM "AudioRecording" r LEFT JOIN "Chapter" c ON c.id=r."chapterId" LEFT JOIN "Book" b ON b.id=c."bookId" LEFT JOIN "AudioPackage" k ON k.id=r."packageId" ORDER BY r.id;'
WHERE to_regclass('"AudioRecording"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''PACKAGE'',''id'',id,''status'',status,''attempts'',attempts,''leaseUntil'',"leaseUntil",''errorCode'',"errorCode") FROM "AudioPackage" ORDER BY id;'
WHERE to_regclass('"AudioPackage"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''PUBLICATION'',''row'',to_jsonb(p)-''publishedBy'',''rowMD5'',md5(to_jsonb(p)::text)) FROM "AudioPublication" p ORDER BY "targetKey";'
WHERE to_regclass('"AudioPublication"') IS NOT NULL \gexec
SELECT jsonb_build_object('type','PILOT_EDITION','id',id,'language',language,'enabled',enabled,'visible',"visibleToUsers",'state',"publicationState")
FROM "ContentCollection" WHERE work='bofm' AND "editionKey"='bofm' AND language IN ('nl','en','de','fr','es') ORDER BY language;
SELECT jsonb_build_object('type','EDITION','id',i.id,'missing',c.id IS NULL,'work',c.work,'family',c."editionKey",'enabled',c.enabled,'visible',c."visibleToUsers",'state',c."publicationState",
 'courses',(SELECT count(*) FROM "Course" k WHERE k."contentCollectionId"=c.id),
 'exercises',(SELECT count(*) FROM "Exercise" e JOIN "Chapter" h ON h.id=e."chapterId" JOIN "Book" b ON b.id=h."bookId" WHERE b."contentCollectionId"=c.id))
FROM (VALUES ('content_dc_de'),('content_dc_fr'),('content_dc_es'),('content_pgp_de'),('content_pgp_fr'),('content_pgp_es')) i(id)
LEFT JOIN "ContentCollection" c ON c.id=i.id ORDER BY i.id;
SELECT jsonb_build_object('type','TEXT_EDITION','id',id,'work',work,'family',"editionKey",'language',language,'enabled',enabled,'visible',"visibleToUsers",'state',"publicationState")
FROM "ContentCollection" WHERE work IN ('dc-testament','pgp') AND "editionKey"=work AND language IN ('de','fr','es') ORDER BY id;
SELECT jsonb_build_object('type','HIDDEN_TEXT','collectionId',b."contentCollectionId",'bookId',b.id,'key',b.key,'slug',b.slug,'nameMD5',md5(b.name),'chapterId',c.id,'number',c.number,'headingMD5',md5(coalesce(c.heading,'')),
 'verses',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'textMD5',md5(v.text)) ORDER BY v.number) FROM "Verse" v WHERE v."chapterId"=c.id))
FROM "Chapter" c JOIN "Book" b ON b.id=c."bookId" JOIN "ContentCollection" k ON k.id=b."contentCollectionId"
WHERE k.work IN ('dc-testament','pgp') AND k."editionKey"=k.work AND k.language IN ('de','fr','es') ORDER BY b."contentCollectionId",b.key,c.number;
SELECT jsonb_build_object('type','DB_SIZE','bytes',pg_database_size(current_database()));
SELECT 'SELECT jsonb_build_object(''type'',''UPDATE_RUN'',''id'',id,''kind'',kind,''status'',status,''startedAt'',"startedAt",''finishedAt'',"finishedAt",''error'',error) FROM "ContentUpdateRun" ORDER BY "startedAt" DESC LIMIT 20;'
WHERE to_regclass('"ContentUpdateRun"') IS NOT NULL \gexec
COMMIT;
SQL
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/inventaris.sql" > "$REPORT/inventaris-voor.jsonl"
```

- **Waarom:** Inspecteert migraties, tabelaanwezigheid, receipts, registraties, pointers, uitgaven, runs en databaseomvang.
  De rapporttransacties normaliseren tijdstempels naar UTC, ook bij een andere tijdzone van de herstelserver.
  TEXT_EDITION/HIDDEN_TEXT bewaren de werkelijke uitgave-/tekst-/versidentiteit en teksthashes ook zonder export-CLI;
  vergelijk die bestaande rijen vóór/na deployment. Een onverwachte alternatieve uitgave-ID eerst verklaren.
- **Verwachte uitkomst:** Geen onverklaarde migratiefout/checksum; query werkt ook als nieuwe audio-/controletabellen nog ontbreken.
- **Bij fouten:** Niet bestaande rapporten overschrijven. Een onvoltooide migratie of onbekende import is een stopcriterium, geen SQL-reparatieopdracht.

### Bijlage C — beschermde legacy- en controlebaseline

- **Waar:** SSH; RAPPORT.
- **Wat:** Bewaar SQL en eerste baseline; herhaal de laatste psql-regel met een nieuwe suffix bij stilstand, na migratie en vóór/na import.

```bash
cat > "$REPORT/beschermd.sql" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object('type','NL_LEGACY','id',c.id,'book',b.key,'number',c.number,'url',c."audioUrl",'headingStart',c."audioHeadingStart",'headingEnd',c."audioHeadingEnd",
 'verses',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'start',v."audioStart",'textMD5',md5(v.text)) ORDER BY v.number) FROM "Verse" v WHERE v."chapterId"=c.id))
FROM "Chapter" c JOIN "Book" b ON b.id=c."bookId"
WHERE b."contentCollectionId"='content_bom' AND c."audioUrl" IS NOT NULL ORDER BY b.key,c.number;
SELECT 'SELECT jsonb_build_object(''type'',''AUDIO_CHECK'',''row'',to_jsonb(a)-''reviewedById'',''rowMD5'',md5(to_jsonb(a)::text)) FROM "ChapterAudioCheck" a ORDER BY "chapterId";'
WHERE to_regclass('"ChapterAudioCheck"') IS NOT NULL \gexec
COMMIT;
SQL
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/beschermd.sql" > "$REPORT/beschermd-voor.jsonl"
```

- **Waarom:** Bewaking van URLs, kop-/vers-tijden, teksthashes en controlemarkeringen, zonder accounts te exporteren.
- **Verwachte uitkomst:** 205 NL_LEGACY-rijen volgens de onderzochte set; afwijking eerst verklaren. Nieuwe migratiebackfill is apart van importbaseline.
- **Bij fouten:** Bestaande controles nooit resetten. Vergelijk NL_LEGACY vóór/na deployment; bestaande AUDIO_CHECK-rijen blijven gelijk, alleen nieuwe backfill mag erbij.

### Bijlage D — tekstexport met bestaande CLI

- **Waar:** SSH bij draaiende, gecontroleerde app; RAPPORT.
- **Wat:** Exporteer alleen bij aanwezige CLI; de opdracht leest de DB, maar maakt een nieuw 0600-bestand in de container en een besloten kopie. Voor een na-export zowel EXPORT als TARGET_EXPORT een nieuwe suffix geven; beide vóórbestanden bewaren.

```bash
EXPORT="/tmp/audio-targets-$RUN-voor.json"
TARGET_EXPORT="$REPORT/targets-voor.json"
test ! -e "$TARGET_EXPORT"
docker exec -w /app "$APP" npx tsx scripts/audio/export-targets.ts "$EXPORT"
docker cp "$APP:$EXPORT" "$TARGET_EXPORT"
```

- **Waarom:** Legt bestaande hoofdstuk-/vers-ID’s, tekst en bronhash vast; geen credentials of accounts.
- **Verwachte uitkomst:** Alle vooraf bestaande IDs/hash/segmenten blijven bij latere export gelijk; uitsluitend ontbrekende zes uitgaven mogen erbij.
- **Bij fouten:** Bestaat het exportbestand al, dan weigert de CLI. Kies een nieuwe naam; geen importer of seed als export gebruiken.

### Bijlage E — bestanden en READY-backlog

- **Waar:** SSH met Python 3.11+; RAPPORT, audio uitsluitend gelezen.
- **Wat:** Hash de bestaande hoofdmap-MP3’s; geneste bestanden krijgen eerst een stat. Herhaal met nieuwe rapportnaam.

```bash
python3 -I - "$AUDIO" > "$REPORT/bestanden-voor.json" <<'PY'
import hashlib,json,os,pathlib,stat,sys
root=pathlib.Path(sys.argv[1]); rows=[]
assert root.is_dir() and not root.is_symlink(), 'STOP: ongeldige inventarisroot'
def fail(error): raise error
for base,dirs,files in os.walk(root,followlinks=False,onerror=fail):
    for name in dirs+files:
        p=pathlib.Path(base)/name; s=p.lstat()
        if stat.S_ISLNK(s.st_mode): raise SystemExit('STOP: symlink '+str(p))
        if stat.S_ISDIR(s.st_mode): continue
        if not stat.S_ISREG(s.st_mode): raise SystemExit('STOP: afwijkend bestandstype '+str(p))
        row={'path':str(p.relative_to(root)),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns}
        if p.parent==root and p.suffix.lower()=='.mp3':
            with p.open('rb') as f: row['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
        rows.append(row)
print(json.dumps(sorted(rows,key=lambda r:r['path']),indent=2))
PY
```

- **Waarom:** Bewaking van naam/bytes/mtime/SHA; geen scan met symlinkvolging.
- **Verwachte uitkomst:** Elke beschermde legacy-MP3 behoudt alle waarden. Controleer aanwezige objecthashes tegen registraties en verklaar iedere incoming/*/READY.
- **Bij fouten:** Een ontbrekend bestand blijft een ontbrekend bestand; niet downloaden/vervangen. Geneste stat alleen bewijst geen objectchecksum: controleer geselecteerde objecten aanvullend vóór publicatie.

### Bijlage F — back-up en geïsoleerde herstelproef

- **Waar:** SSH/DSM na fase-3-akkoord; WIJZIGT back-upbestanden en uitsluitend nieuwe testdoelen.
- **Wat:** Eerst dump/tar/hashcontrole; daarna echte restoreproef zonder app of netwerkpoort.

```bash
BACKUP_ROOT=/VUL_BESTAANDE_EXTERNE_BESCHERMDE_BACKUPMAP_IN
case "$BACKUP_ROOT" in *VUL*) echo 'STOP: externe bestemming kiezen'; exit 1;; esac
test -d "$BACKUP_ROOT"
df -Pk "$BACKUP_ROOT"
BACKUP="$BACKUP_ROOT/audio-v2-$RUN"
test ! -e "$BACKUP"
mkdir -m 700 "$BACKUP"
docker exec "$DB" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP/database.dump"
tar -cpf "$BACKUP/audio.tar" -C "$AUDIO" .
test -s "$BACKUP/database.dump" && test -s "$BACKUP/audio.tar"
(cd "$BACKUP" && sha256sum database.dump audio.tar > SHA256SUMS)
(cd "$BACKUP" && sha256sum -c SHA256SUMS)
docker exec -i "$DB" pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/dump-inhoud.txt"
tar -tf "$BACKUP/audio.tar" > "$BACKUP/audio-inhoud.txt"
```

**Uitsluitend nieuwe testdoelen; geen productieherstel.** Deze volgende groep maakt een lege, niet-gepubliceerde testcontainer,
een nieuw volume en een nieuwe herstelmap. Vereist een geverifieerde PostgreSQL-image met dezelfde majorversie en officiële
POSTGRES_PASSWORD_FILE-ondersteuning; gebruik de bestaande DB-image-ID pas na die controle. `openssl` en Python 3.11+ moeten aanwezig zijn.
Er wordt geen app gestart, geen dump over de bestaande DB gezet en geen audiomap vervangen.

```bash
command -v openssl
PG_IMAGE=$(docker inspect --format '{{.Image}}' "$DB")
docker exec "$DB" postgres --version
TEST_DB="versado-audio-restore-$RUN"
TEST_VOL="${TEST_DB}-pg"
RESTORE_PARENT=/VUL_BESTAANDE_BESLOTEN_TESTMAP_IN
case "$RESTORE_PARENT" in *VUL*) echo 'STOP: testparent kiezen'; exit 1;; esac
test -d "$RESTORE_PARENT"
RESTORE_AUDIO="$RESTORE_PARENT/audio-$RUN"
test ! -e "$RESTORE_AUDIO"
mkdir -m 700 "$RESTORE_AUDIO"
case "$TEST_DB" in versado-audio-restore-*) ;; *) exit 1;; esac
test "$TEST_DB" != "$DB"
if docker container inspect "$TEST_DB" >/dev/null 2>&1; then echo 'STOP: testcontainer bestaat al'; exit 1; fi
if docker volume inspect "$TEST_VOL" >/dev/null 2>&1; then echo 'STOP: testvolume bestaat al'; exit 1; fi
TEST_SECRET="$REPORT/restore-password-$RUN"
test ! -e "$TEST_SECRET"
openssl rand -hex 32 > "$TEST_SECRET"
docker volume create "$TEST_VOL"
docker run -d --name "$TEST_DB" --network none   --mount "type=volume,source=$TEST_VOL,target=/var/lib/postgresql/data"   --mount "type=bind,source=$TEST_SECRET,target=/run/secrets/pg-password,readonly"   -e POSTGRES_USER=restore_test -e POSTGRES_DB=restore_test   -e POSTGRES_PASSWORD_FILE=/run/secrets/pg-password "$PG_IMAGE"
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$TEST_DB" pg_isready -U restore_test -d restore_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" -eq 1 || { echo 'STOP: testdatabase niet gereed'; exit 1; }
docker exec -i "$TEST_DB" pg_restore --exit-on-error --no-owner --no-privileges -U restore_test -d restore_test < "$BACKUP/database.dump"
python3 -I - "$BACKUP/audio.tar" <<'RESTORE_PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        p=pathlib.PurePosixPath(member.name)
        assert not p.is_absolute() and '..' not in p.parts, member.name
        assert member.isfile() or member.isdir() or member.islnk(), member.name
        if member.islnk():
            target=pathlib.PurePosixPath(member.linkname)
            assert not target.is_absolute() and '..' not in target.parts, member.linkname
print('Relatieve bestanden/mappen/hardlinks, geen symlinks of afwijkende archiefpaden.')
RESTORE_PY
tar -xpf "$BACKUP/audio.tar" -C "$RESTORE_AUDIO"
docker exec -i "$TEST_DB" psql -X -q -A -t -v ON_ERROR_STOP=1 -U restore_test -d restore_test < "$REPORT/beschermd.sql" > "$REPORT/hersteltest-beschermd.jsonl"
cmp "$REPORT/beschermd-stil.jsonl" "$REPORT/hersteltest-beschermd.jsonl"
docker exec -i "$TEST_DB" psql -X -q -A -t -v ON_ERROR_STOP=1 -U restore_test -d restore_test < "$REPORT/inventaris.sql" > "$REPORT/hersteltest-inventaris.jsonl"
python3 -I - "$RESTORE_AUDIO" "$REPORT/inventaris-stil.jsonl" "$REPORT/hersteltest-inventaris.jsonl" <<'OBJECT_PY'
import hashlib,json,pathlib,re,sys
root=pathlib.Path(sys.argv[1]); assert root.is_dir() and not root.is_symlink()
def rows(filename): return [json.loads(line) for line in pathlib.Path(filename).read_text().splitlines() if line.strip()]
before,after=rows(sys.argv[2]),rows(sys.argv[3])
for kind in ['MIGRATION','RECORDING','PUBLICATION','EDITION','PILOT_EDITION','TEXT_EDITION','HIDDEN_TEXT','PACKAGE']:
    assert [r for r in before if r.get('type')==kind]==[r for r in after if r.get('type')==kind], kind
seen={}
for row in after:
    if row.get('type')!='RECORDING': continue
    r=row['row']; sha=r['sha256']; size=int(r['byteSize'])
    assert re.fullmatch('[a-f0-9]{64}',sha), 'Ongeldige objecthash'
    if sha in seen: assert seen[sha]==size; continue
    f=root/'objects'/(sha+'.mp3'); assert f.is_file() and not f.is_symlink() and f.stat().st_size==size, str(f)
    with f.open('rb') as handle: assert hashlib.file_digest(handle,'sha256').hexdigest()==sha, str(f)
    seen[sha]=size
print({'hersteldeUniekeV2Objecten':len(seen),'registratiesEnPointersGelijk':True})
OBJECT_PY
```

De eigenaar herhaalt ook de bestandsinventaris E met `RESTORE_AUDIO` als leespad en een nieuwe rapportnaam.
Vergelijk pad/bytes/SHA van alle beschermde MP3's; tar kan mtime afronden, dus een mtime-diff bij restore apart verklaren.
Het bovenstaande objectprogramma controleert alle herstelde AudioRecording-verwijzingen op bestand, byteSize en SHA-256 en
vergelijkt migraties, registraties/pointers/uitgaven/receipts en verborgen tekst-/versidentiteit met teksthashes. Zijn er nul AudioRecording-rijen, dan zijn er nog geen V2-objecten in deze set; de legacy-hashcontrole blijft verplicht. Vergelijk de migratiehistorie apart op namen/checksums/status; DB_SIZE hoeft na
restore niet fysiek gelijk te zijn. Maak geen nieuwe registraties/publicaties. Geen app met productieaccounts/secrets/mail starten.

De proef gebruikt `--no-owner --no-privileges` uitsluitend voor de geïsoleerde testrol; dit bewijst niet de productierollen/ACL's.
Een werkelijk herstelbesluit vraagt de vastgelegde echte rollen, credentials, image, overige volumes en mountrechten.
Testcontainers/-volumes en het testwachtwoord pas na aftekening bewust via hun exacte nieuwe namen opruimen; geen prune.
Productieherstel: onderhoud en alle schrijvers stil → huidige stand extra bewaren → geteste bijpassende DB/audio-set naar
beoordeelde lege doelen herstellen → rollen/rechten/overige volumes/configuratie herstellen → consistente koppelingen en migratiehistorie
controleren → alleen na akkoord compatibele app aansluiten/starten → fase 5/pilot herhalen → onderhoud bewust opheffen.
Er staat geen generiek destructief productie-restorecommando in dit document: de werkelijke doelen en credentials zijn nog onbekend.
Het bestaande `scripts/restore.sh` gebruikt `pg_restore --clean --if-exists` tegen de gekozen DB en is geen alleen-lezen controle.

- **Waarom:** Consistente DB/audio-kopie én daadwerkelijke herstelbaarheid; niet alleen een dump-TOC.
- **Verwachte uitkomst:** Alle opdrachten eindigen met 0; stille baseline, registraties, pointers en bestandshashes komen overeen. Overige volumes/configuratie zijn apart gedekt.
- **Bij fouten:** Niet doorgaan na fout. Geen productiepad/DB invullen als TEST_DB of RESTORE_AUDIO; oude back-ups en bronbestanden blijven staan. Een volledige DB-restore draait nieuwere gebruikersvoortgang terug.

### Bijlage G — pilotdownload via bestaande validator

- **Waar:** SSH op goedgekeurde downloadhost; WIJZIGT een nieuwe werkmap.
- **Wat:** Onderstaande paden zijn de NAS-uitvoering door de eigenaar; bij externe download eerst een apart overdrachtsplan. Exacte checkout vereist.

```bash
cd "$SOURCE"
for tool in python3 curl ffmpeg ffprobe; do command -v "$tool" || exit 1; done
WORK="$AUDIO/_official-pilot-$RUN"
test ! -e "$WORK"
test ! -L "$WORK" || exit 1
python3 -I - "$WORK" <<'PY'
import argparse,importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('official','scripts/audio/official_inventory.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True); (root/'pages').mkdir(exist_ok=True)
pinned=json.loads(pathlib.Path('data/audio/official-inventory.json').read_text())
align=json.loads(pathlib.Path('data/audio/official-alignments.json').read_text())['recordings']
rows=[]
for task in m.tasks(['nl','en','de','fr','es']):
    if (task['bookKey'],task['chapterNumber'])!=('bofm/ether',1): continue
    old=next(c for c in pinned['chapters'] if (c['language'],c['bookKey'],c['chapterNumber'])==(task['language'],'bofm/ether',1))
    row=m.inspect(task,argparse.Namespace(root=root,download=True))
    assert row['textStatus']=='EXACT_TEXT_MATCH' and row['sourcePageHash']==old['sourceHash']
    voice='male' if task['language']=='en' else 'audio'
    selected=[r for r in row['recordings'] if r['voice']==voice]
    assert len(selected)==1
    r=selected[0]; original=next(x for x in old['recordings'] if x['voice']==voice)
    assert r['status']=='DOWNLOADED_VALIDATED' and (r['sha256'],r['bytes'])==(original['sha256'],original['bytes'])
    assert align[r['sha256']+'-'+row['sourceHash']]['quality']=='VALIDATED'
    row['recordings']=selected; rows.append(row)
assert len(rows)==5
(root/'inventory.json').write_text(json.dumps({'schemaVersion':1,'chapters':rows},ensure_ascii=False,indent=2))
print('Vijf gecontroleerde kandidaten; geen DB of publicatie gewijzigd.')
PY
```

- **Waarom:** Gebruikt de bestaande tasks/inspect-downloader, geen tweede importer; controleert bronhash, bytes, checksum en gepinde kwaliteit.
- **Verwachte uitkomst:** Vijf geselecteerde kandidaten in inventory.json; zes bronbestanden kunnen gedownload zijn. Geen DB of publicatie gewijzigd.
- **Bij fouten:** Iedere assertie-/HTTP-/decodefout stopt de selectie. Geen hashes/tijden passend maken; niet in incoming downloaden. Een nieuwe map voorkomt verouderde receipts als nieuwe netwerkcontrole te presenteren. Na een mislukte pilotdownload eerst oorzaak/ruimte beoordelen en voor een nieuwe controle een nieuwe RUN/werkmap kiezen; geen bulkdownloader op de pilotmap loslaten. Een registratie-retry gebruikt juist dezelfde ongewijzigde batch, zonder herdownload.

### Bijlage H — pilotregistratie en nacontrole

- **Waar:** SSH bij gecontroleerde draaiende nieuwe app; WIJZIGT DB en audiomount.
- **Wat:** Alleen na registratieakkoord, lege/onverklaarde backlog uitgesloten en passende mount op /data/audio.

```bash
WORK_NAME=${WORK##*/}
case "$WORK" in "$AUDIO"/_official-pilot-*) ;; *) echo 'STOP: werkmap niet onder gecontroleerde audiomount'; exit 1;; esac
time docker exec -w /app "$APP" npx tsx scripts/audio/import-official.ts "/data/audio/$WORK_NAME"
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/beschermd.sql" > "$REPORT/beschermd-na-pilot.jsonl"
cmp "$REPORT/beschermd-importbaseline.jsonl" "$REPORT/beschermd-na-pilot.jsonl"
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/inventaris.sql" > "$REPORT/inventaris-na-pilot.jsonl"
```

Maak `beschermd-importbaseline.jsonl` met C **na migratie en vóór registratie**; gebruik niet de pre-migratiecontrole als importbaseline.
Vergelijk in de twee inventarisbestanden alle PUBLICATION-rijen exact en de reeds bestaande RECORDING-rijen op identiteit/hash;
vergelijk ook D en E met nieuwe bestandsnamen. Nieuwe opnamen mogen alleen bij de vijf goedgekeurde targets horen.
De CLI heeft **geen dry-run- of publish-vlag** en maakt de zes ontbrekende tekstuitgaven vóór het lezen van inventory.json.
Een lege/foute inventaris is dus geen veilige proef. De scanner kan complete incoming-pakketten gelijktijdig claimen;
PROCESSING is geen bewijs van een definitieve fout. Wacht en lees de receipts vóór een identieke retry.

- **Waarom:** Registratie blijft gescheiden van publicatie; data/pointers/controles moeten aantoonbaar gelijk blijven.
- **Verwachte uitkomst:** Bij vijf nieuwe pilots imported:5, missingAlignment:0, failed:0, mismatched:0, published:0; controlematige cmp eindigt met 0.
- **Bij fouten:** Niet cmp omzeilen of baseline overschrijven. Eerst receipt/status/foutcode en gedeeltelijke resultaten inventariseren; geen lease-/status-SQL.

### Bijlage I — volledige download, bronvergelijking en selectie

- **Waar:** SSH op goedgekeurde downloadhost, daarna gecontroleerde app; WIJZIGT eerst cache/selectie, pas laatste blok DB.
- **Wat:** Download na apart akkoord met één worker; vergelijk offline; maak de verse DB-inventaris en filter bekende identiteiten; laatste blok uitsluitend na registratieakkoord.

```bash
FULL="$AUDIO/_official-volledig-$RUN"
test ! -e "$FULL"
cd "$SOURCE"
python3 -I scripts/audio/official_inventory.py --root "$FULL" --languages nl en de fr es --download --workers 1
```
```bash
python3 -I - "$FULL" > "$REPORT/bronvergelijking.txt" <<'PY'
import json,pathlib,sys
old=json.loads(pathlib.Path('data/audio/official-inventory.json').read_text())
new=json.loads((pathlib.Path(sys.argv[1])/'inventory.json').read_text())
def index(doc):
    rows=doc['chapters']; keys=lambda c:(c['work'],c['editionKey'],c['language'],c['bookKey'],c['chapterNumber'])
    result={keys(c):c for c in rows}
    assert len(result)==len(rows)==1965
    return result
a,b=index(old),index(new); assert a.keys()==b.keys(); count=0
for key,c in b.items():
    p=a[key]
    assert c['textStatus']=='EXACT_TEXT_MATCH' and c['sourcePageHash']==c['sourceHash']==p['sourceHash'],key
    records=lambda row: sorted((r['voice'],r['url'],r['sha256'],r['bytes']) for r in row['recordings'])
    assert all(r['status']=='DOWNLOADED_VALIDATED' for r in c['recordings']),key
    assert records(c)==records(p),key
    count+=len(c['recordings'])
assert count==1974
print('1965 identiteiten, 1974 identieke gecontroleerde opnamen, geen bron-/bytediff.')
PY
```
```bash
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/inventaris.sql" > "$REPORT/inventaris-voor-bulk.jsonl"
python3 -I - "$FULL" "$REPORT/inventaris-voor-bulk.jsonl" <<'PY'
import copy,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); original=root/'inventory.verified.json'
assert not original.exists(), 'Bewaar eerdere bewijsbestanden; kies een nieuwe gecontroleerde batch.'
data=json.loads((root/'inventory.json').read_text()); original.write_text(json.dumps(data,ensure_ascii=False,indent=2))
def key(c,r):
    return (c['work'],c['editionKey'],c['language'],c['bookKey'],c['chapterNumber'],r['voice'],r['url'],r['sha256'],c['sourceHash'])
known=set()
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
    row=json.loads(line)
    if row.get('type')!='RECORDING': continue
    r=row['row']
    if r['packageStatus']=='READY' and r.get('bookKey'):
        known.add((r['work'],r['editionKey'],r['language'],r['bookKey'],r['chapterNumber'],r['voice']['name'],r['sourceUrl'],r['sha256'],r['sourceHash']))
selected=copy.deepcopy(data); skipped=0; count=0
for c in selected['chapters']:
    remaining=[]
    for r in c['recordings']:
        if key(c,r) in known: skipped+=1
        else: remaining.append(r); count+=1
    c['recordings']=remaining
assert count+skipped==1974
(root/'inventory.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2))
print({'nieuweKandidaten':count,'alGeregistreerd':skipped,'published':0})
PY
```

Alleen na akkoord op de geselecteerde nieuwe kandidaten; dezelfde gevalideerde batch niet opnieuw downloaden:

```bash
FULL_NAME=${FULL##*/}
case "$FULL" in "$AUDIO"/_official-volledig-*) ;; *) echo 'STOP: bulkmap niet op gecontroleerde audiomount'; exit 1;; esac
time docker exec -w /app "$APP" npx tsx scripts/audio/import-official.ts "/data/audio/$FULL_NAME"
```

- **Waarom:** Behoudt pilot-ID’s, bewaart inventory.verified.json en gebruikt dezelfde ontvangende importer.
- **Verwachte uitkomst:** 1.965 doelen/1.974 identieke varianten; aantal nieuwe kandidaten + bekende = 1.974; nul publicaties door importer.
- **Bij fouten:** Geen bronverschil negeren, verified-inventaris overschrijven of tweede import van verse checkedAt-data zonder deduplicatie starten. Bij nul nieuwe kandidaten laatste blok niet uitvoeren.
