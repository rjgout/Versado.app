# Versado Audio Worker — inactieve Portainer-voorbereiding

Bestemd voor een gecontroleerde **Docker Standalone/Compose**-omgeving in Portainer, niet voor Swarm.
Controleer dit zelf vóór installatie; Swarm mag de netwerk-/profielgrenzen niet stilzwijgend negeren.

Dit is **infrastructuur**, geen werkende spraakgenerator of tweede audio-importer.
De image kan alleen een status of de bestaande Audio V2-contractbron tonen en stopt daarna.
`generate` en andere opdrachten worden geweigerd. Er is geen daemon, taakscanner, download,
netwerkpoort, databaseverbinding of audio-uitvoer. De stack staat standaard op nul replica's,
achter profiel `manual`, met `restart: no`. Ook expliciet starten genereert niets.

Deze PR verandert de appstack, bestaande audiomount, database en publicaties niet.
De Nederlandse legacy-conversie gebruikt de bestaande appworker en is niet van deze stack afhankelijk.
Geen NAS-/Portainerconfiguratie of capaciteit is door Codex gecontroleerd.

## Architectuur en mappen

Voorgestelde nieuwe **afzonderlijke DSM-gedeelde map** (niet zomaar een onbeperkte submap van `docker`):

```text
/volume1/versado-audio-worker/     DSM-quota: 20 GiB voor deze gehele gedeelde map
  jobs/                          invoer/tekst-snapshots, alleen-lezen in worker
  work/                          blijvende werkbestanden, schrijven door worker-UID
  outbox/                        toekomstige complete pakketten, schrijven door worker-UID
```

Alleen deze drie submappen worden in de worker gemount, respectievelijk op `/jobs`, `/work`, `/outbox`.
Geen toegang tot `/volume1/docker/jehova-app`, `/data/audio`, PostgreSQL, Redis of `docker.sock`.
De app krijgt in deze PR **geen nieuwe mount**. `outbox` wordt niet als `incoming` gemount:
anders zou een pakket met `READY` een database-import kunnen starten zonder apart overdrachtsbesluit.
Een dossier in outbox is geen registratie en geen publicatie.

CPU is begrensd op 1 kern, geheugen op 512 MiB, processen op 64. De tijdelijke RAM-map is maximaal
64 MiB. Het hoofd-bestandssysteem is alleen-lezen; capabilities zijn verwijderd, privilegeverhoging
is verboden en netwerkmodus is `none`. Logrotatie begrenst Docker-logs op maximaal 3 × 10 MB.
De container draait met een gecontroleerde, niet-root DSM-UID/GID; de voorbeeldimage zelf gebruikt 10001.

**Een bindmount heeft geen portable Docker-opslagquota.** De 20 GiB omgevingswaarde is uitsluitend
informatief. De echte opslaggrens moet de eigenaar met een DSM/Btrfs-quota afdwingen. Ontbreekt die
mogelijkheid, dan is opslagbegrenzing nog niet aangetoond en mag een latere generator niet worden
geactiveerd. Vergroot quota of geheugen later alleen na een apart besluit voor het gekozen model.
De huidige statuscontainer schrijft niets en downloadt geen model.

## Voorbereiden zonder iets op de NAS te wijzigen

**Alleen lezen:** beoordeel deze Compose-configuratie, Dockerfile en contractreferentie in GitHub.
Controleer zelf in DSM welk volumetype wordt gebruikt en of quota voor een gedeelde map beschikbaar zijn.
Controleer in Portainer de versie en ondersteuning voor Compose-profielen, `replicas: 0`, resources en
`bind.create_host_path: false`. Maak of start nog geen stack om die controle te doen.

Een lokale configuratiecontrole in een ontwikkelcheckout leest alleen YAML en maakt geen containers:

```sh
AUDIO_WORKER_UID=10001 AUDIO_WORKER_GID=10001 \
  docker compose -f deploy/audio-worker/compose.yml --profile manual config
```

10001 is hier uitsluitend een ontwikkelvoorbeeld. Deze opdracht bevestigt geen NAS-rechten of quota.

## Installatie door de eigenaar, pas na afzonderlijke toestemming

Alle volgende stappen **wijzigen de NAS of Portainer**. Codex voert ze niet uit.

1. **DSM → Configuratiescherm → Gebruiker en groep.** Maak een afzonderlijk serviceaccount zonder
   beheerdersrechten. Geef geen toegang tot de appdata of andere gedeelde mappen. Maak een nieuwe
   gedeelde map `versado-audio-worker`, stel een harde quota van 20 GiB in en controleer die instelling.
   Geef alleen het serviceaccount en de bevoegde beheerder toegang. Schakel gasttoegang uit.
   Een mislukte quota- of rechtencontrole betekent stoppen; gebruik geen `chmod 777` als oplossing.
2. **DSM → File Station.** Maak binnen die map `jobs`, `work`, `outbox`. Geef het serviceaccount lezen
   op jobs en schrijven op work/outbox. De jobs-bindmount is aanvullend door Docker alleen-lezen.
   Wijzig geen rechten op de bestaande Versado-audiomap.
3. **UID/GID vaststellen, alleen lezen.** Laat via een reeds toegestane DSM-taak of eigen beheerterminal
   `id versado-audio-worker` uitvoeren (gebruik de werkelijk gekozen accountnaam). Noteer de numerieke
   uid/gid; ga niet uit van het voorbeeld 10001 en kies nooit UID 0. Hiervoor hoeft geen SSH-poort
   voor de webapp te worden geopend. De worker krijgt geen DSM-login of wachtwoord als environment.
4. **Image beschikbaar maken.** Deze PR publiceert geen image of release. Gebruik pas na review en
   aparte toestemming een image gebouwd vanaf de beoordeelde commit. De Dockerfile bouwt vanuit de
   repository-root met uitsluitend het script en de huidige contractbron in de runtime-image.
   Een Portainer Git-stack kan de `build`-sectie gebruiken als de geïnstalleerde versie dit ondersteunt.
   Zonder die ondersteuning moet eerst een apart goedgekeurde image beschikbaar komen; verwijder
   geen beveiliging om een build/pull te laten slagen. Pin een gepubliceerde image bij voorkeur op digest.
5. **Portainer → Stacks → Add stack → Repository.** Naam: `versado-audio-worker`. Repository:
   `https://github.com/rjgout/Versado.app`. Reference: de goedgekeurde commit/branch, niet automatisch
   een volgende main. Compose path: `deploy/audio-worker/compose.yml`. Voeg onderstaande niet-geheime
   variabelen toe. Portainer-repositorycredentials blijven bij Portainer, niet in de worker.

   | Variabele | Waarde |
   | --- | --- |
   | `AUDIO_WORKER_UID` | Werkelijk gecontroleerde niet-root DSM-UID |
   | `AUDIO_WORKER_GID` | Werkelijk gecontroleerde DSM-GID |
   | `AUDIO_WORKER_ROOT` | Werkelijke afzonderlijke gedeelde map, bv. `/volume1/versado-audio-worker` |
   | `AUDIO_WORKER_IMAGE` | Afzonderlijke goedgekeurde workerimage/tag of digest |

   Voeg **geen** DATABASE_URL, REDIS_URL, SESSION_SECRET, app-env-file, hostnetwerk, poorten,
   privileged-modus of Docker-socket toe. Laat beide resourceblokken dezelfde waarden houden.
6. **Deploy stack is een afzonderlijke wijzigingshandeling.** Doe dit uitsluitend na toestemming.
   Verwacht standaard **nul draaiende workercontainers** en geen audio-uitvoer. Een Portainerversie
   kan een volledig uitgeschakeld profiel als lege stack weigeren. Stop dan en controleer de versie;
   verwijder niet op eigen initiatief het profiel of de nul-replica-instelling.

### Optionele statusproef na toestemming

Een statuscontainer is nog steeds een **containerstart op de NAS** en vereist eigen toestemming.
Bij een vooraf gecontroleerde checkout kan de eigenaar die eenmalig uitvoeren:

```sh
docker compose -f deploy/audio-worker/compose.yml --profile manual \
  run --rm --no-deps audio-worker status
```

Dit start uitsluitend status en stopt. Verwacht `generationEnabled: false`,
`packageDeliveryEnabled: false`, een niet-root UID en de juiste mapaanwezigheid/rechten.
`contract` toont alleen de exacte contractbron. Er worden geen opdrachten verwerkt en geen bestanden
verplaatst. De lokale ontwikkelcontainerproef vervangt deze NAS-controle niet.

## Contract en veilige latere activering

De enige contractautoriteit blijft [src/lib/audio/contract.ts](../../src/lib/audio/contract.ts).
Een toekomstig pakket bevat één MP3, `manifest.json`, `segments.json`, eventueel een
`quality-report.json`, plus een als laatste geplaatst `READY`. Het bestaande contract bindt onder meer
collectie, werk, exacte uitgave, taal, target, sourceHash, MP3-hash/bytes/duur en segmenthashes.
De bestaande app-importer valideert opnieuw tegen de werkelijke database/contentrevisie,
bronrechten, opslag, importreceipt en actuele beheerbesluiten. De worker kan die niet vervangen.
`READY` betekent geen publicatie. Een kwaliteitslabel mag geen beoordeling forceren.

Voor latere generators zijn jobs voorzien als **onveranderlijke tekst-/identiteitssnapshots**:

- Bijbel: specifieke collectie, tekstuitgave, taal, canoniek hoofdstuk en alle vershashes.
- CFM: exacte bestaande lesrevisie en blokidentiteiten, niet alleen een weeknummer of huidige titel.
- FSY: bestaande contentblokken/revisie met de bijbehorende hashes, geen nieuwe cursus of oefening.

Dit zijn nog geen ingeschakelde functies. De huidige importer staat `STUDY_REVISION` of Bijbel-targets
niet operationeel toe (`PHASE_NOT_ENABLED` voor niet-ingeschakelde werken/targets). Voor die uitbreiding
zijn een eigen review, gerichte contract-/appvalidaties en expliciete toestemming nodig. Deze PR wijzigt
ze niet en genereert geen Bijbel-, CFM-, FSY- of TTS-audio.

Latere activering vergt dus eerst een afzonderlijk goedgekeurde generatorimplementatie/image,
model-/opslagbegroting, jobautorisatie, begrensde verwerking en een proefpakket. Pas daarna kan de eigenaar
het specifieke jobcommando expliciet starten met hetzelfde netwerk-/mount-/resourcebeleid. De huidige
image weigert `generate` met exitcode 2. Stel geen onbeheerde `restart: always` of directoryscanner in.

Een toekomstig getest pakket blijft eerst in outbox. Overdracht naar de bestaande app-`incoming`
vereist apart registratieakkoord en een gecontroleerde kopie naar een nieuwe pakketmap; zet `READY`
pas na volledige overdracht neer. **Dat kan de bestaande scanner een database-import laten uitvoeren.**
Die handeling is daarom geen alleen-lezen controle en wordt niet in deze PR uitgevoerd.
Publicatie blijft ook daarna een afzonderlijk bevestigd besluit in Versado.

## Fouten, opslag en herstel

- Ontbrekende mappen worden niet automatisch door Compose gemaakt: `create_host_path: false`.
  Maak ze alleen na expliciete toestemming met gecontroleerde DSM-rechten.
- Bij UID-/rechtenfouten, een volle quota of onbekende image: stop de worker, verander geen appdata.
  Een statusproef meldt uitsluitend metadata, geen wachtwoorden of volledige omgevingsvariabelen.
- De worker deelt geen appobjecten of database. Een workerback-up is dus een aparte back-up van jobs,
  work en outbox, niet een vervanging voor de gezamenlijke PostgreSQL/audioback-up van Versado.
- Herstel workerdata alleen terwijl geen job actief is. Hergebruik geen pakket-ID voor gewijzigde bytes;
  hervatten en overdracht moeten later aan dezelfde manifeste hashes worden gebonden.
- Verwijder geen appaudio om ruimte voor modellen te maken. Controleer quota én vrije fysieke ruimte;
  de eerder door de eigenaar gemelde NAS-capaciteit is geen hier uitgevoerde meting.

## Ontwikkelcontrole

`python3 -m unittest discover -s tests/audio-worker -v` valideert de werkelijke Compose-configuratie,
bouwt de image en start uitsluitend eigen tijdelijke containers zonder netwerk of schrijfbare root.
De proef bewaakt ongewijzigde hostmappen, niet-root uitvoering, weigering van generatie en de exacte
bestaande contractbron. GitHub Actions publiceert geen image in deze workflow.
Dit zijn ontwikkelproeven, geen NAS-installatie of geslaagde deployment.
