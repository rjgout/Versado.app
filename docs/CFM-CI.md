# CFM-CI: root cause en vaste brondata

## Root cause, 30 oktober 2026

De gewone CFM-tests waren afhankelijk van live bytes van de officiële,
**niet op een inhoudsversie vastgezette afbeeldingsrendities** (`/default`).
De applicatiepinnen verwachtten terecht exacte SHA-256's, maar zeven huidige
JPEG-antwoorden verschillen van die eerder vastgelegde bytes. De integratietests
bereikten daardoor hun import-/publicatiecode niet. Vijf jobs voerden bovendien
ieder dezelfde voorbereiding en een eigen productiebuild uit.

Het is geen aangetoonde database-, import-, rechten- of publicatiefout:

- Runs [40940175218](https://github.com/rjgout/Versado.app/actions/runs/40940175218),
  [41017359611](https://github.com/rjgout/Versado.app/actions/runs/41017359611) en
  [41028648301](https://github.com/rjgout/Versado.app/actions/runs/41028648301)
  falen alle bij de voorbereidingsstap, vóór de echte tests. Hun 2026-media-lock
  is byte-identiek (SHA-256
  `6d5e0d769e479a8341f1f1060171717b7cf0f92416e5777abd2dbe5764306a27`).
  De oude foutmelding bevat geen bestandsidentiteit of responstype: welk bestand
  in elke historische run als eerste faalde kan achteraf niet worden bewezen.
- Eerder slaagde [run 40725492266](https://github.com/rjgout/Versado.app/actions/runs/40725492266)
  op 28 oktober, inclusief alle vijf CFM-jobs en strikte bronhashcontrole. De
  werkelijk uitgecheckte PR-mergecommit was
  `59aa0988358dac005a1b5b1df8fca742b2d736fa` (niet de feature-head in de runmetadata).
  Zijn media-lock heeft dezelfde Git-blob
  `e1845f6261ee90335347829daf632ab1cb3d9574` als de drie latere runs. Het log meldt
  723 gepinde mediaregels en 929 OTB-hoofdstukken; de preparer weigert afwijkende
  hashes. Daarmee is historische overeenstemming met de oude pins aangetoond.
- De huidige volledige meting geeft 705 overeenkomende en 7 afwijkende unieke
  afbeeldingen. Alle 929 oorspronkelijke OTB-bestanden voldoen aan hun gepinde
  Git-blobhash. De 723 mediaregels bevatten 11 identieke kruisjaargang-dubbelen:
  totaal **712 unieke media + 929 OTB = 1.641 bestanden**.
- Alle zeven afwijkingen: HTTP 200, `image/jpeg`, volledig decodeerbaar, dezelfde
  breedte/hoogte als de oude lock, afwijkende bytes/hash. Geen HTML-foutpagina of
  JPEG/WebP-formaatwissel. Voor de eerste afwijking zijn daarnaast JPEG-Accept,
  Node-/standaardheaders, expliciete JPEG-extensies, equivalente resizepaden en
  een queryvariant gecontroleerd: dezelfde nieuwe JPEG-hash. Dat verklaart de
  fout niet als eenvoudige content-negotiatie-/URL-encodingkwestie.

**Bewezen:** upstream-bytewijziging ten opzichte van eerder werkende pins en
verkeerde koppeling van gewone tests aan veranderlijke live bronbytes.
**Niet bewezen:** welk intern CDN-/resize-/JPEG-proces de wijziging veroorzaakte,
of pixelgelijkheid met de oude JPEG's. Die oude bestanden zijn niet beschikbaar;
geen re-encode-, metadata-only- of inhoudsgelijkheidsclaim.

## Synchronisatie met develop na #239

Opnieuw gecontroleerd tegen `develop` `0c56b029ab246da5645f20a3fd3dcdcc0e7831c1`.
Run [41058704756](https://github.com/rjgout/Versado.app/actions/runs/41058704756)
faalt in dezelfde voorbereidingsstap bij alle vijf CFM-consumers, vóór de echte
integratietests. Zijn 2026-media-lock heeft nog steeds de oorspronkelijke Git-blob
`e1845f6261ee90335347829daf632ab1cb3d9574`; #237 was daar nog niet opgenomen.
Deze fout bewijst geen regressie van de gedeelde shell.

De bestaande #237-branch is met deze develop-commit samengevoegd. Er waren geen
mergeconflicten; de automatische samenvoeging van de pariteitsinventaris voldoet
opnieuw aan de generatorcontrole. Native/web-shell, authenticatie, de Apple-UI-
correctie en native regressietests zijn exact gelijk aan develop. Geen handmatige
terugplaatsing van oude native code of tests. De zeven goedgekeurde repins, het
archief, alle bronlocks en beide CFM-workflows zijn ongewijzigd ten opzichte van
`04479318f4767ec0e421c6e3c7143d9f9300270c`.

De lokale verificatie hergebruikt één nieuwe productiebuild voor de importproef
en vier programmasuites, elk op een eigen wegwerpdatabase. Offline voorbereiding
valideert alle 1.641 bestanden zonder bronverzoeken; de zeven goedgekeurde nieuwe
JPEG-hashes/groottes zijn bovendien opnieuw via zeven verse officiële downloads
bevestigd. De afzonderlijke CI-broncontrole blijft alle 1.641 live bronnen zonder
cache controleren. Resultaten op de nieuwe definitieve PR-head staan bij #237;
geen eerdere groene head wordt als nieuw testbewijs gebruikt.

## Expliciet goedgekeurde, begrensde pinwijziging

De eigenaar heeft in deze opdracht expliciet goedgekeurd uitsluitend de zeven
beoordeelde SHA-256-pins en bestandsgroottes bij te werken. De officiële
bron-ID's, URL's, leskoppelingen en afmetingen zijn gecontroleerd; de huidige
beelden zijn afzonderlijk visueel vergeleken met hun bestaande beschrijvingen.
Alle zeven zijn vervolgens opnieuw via de officiële bron op dezelfde nieuwe
hashes gecontroleerd.

| Bestands-ID (begin) | Les | Afmetingen | Oude → nieuwe bytes |
| --- | --- | --- | --- |
| `930d33407d99` | 39 | 500 × 281 | 17694 → 17696 |
| `ebaf72897426` | 43 | 500 × 281 | 28267 → 28254 |
| `17321b600c83` | 34 | 320 × 427 | 24633 → 24654 |
| `5dc933a6b340` | 07 | 500 × 281 | 20190 → 20191 |
| `6b4f476973c1` | 42 | 500 × 281 | 17209 → 17189 |
| `d33c6782e013` | 07 | 320 × 240 | 28640 → 28948 |
| `fa1ee428b903` | 14 | 500 × 281 | 23960 → 23959 |

Volledige oude/nieuwe hashes en bronidentiteiten:
[APPROVED-MEDIA-REPINS-2026-10-30.json](cfm-ci/APPROVED-MEDIA-REPINS-2026-10-30.json).
[Contactblad van de beoordeelde representaties](cfm-ci/VERIFIED-REPRESENTATIONS.png).
Dit is een eenmalige, expliciete verificatie en eigenaarbeslissing, geen
acceptatielogica in een script. Toekomstige afwijkingen blijven fouten.

Geen wijziging in officiële les-JSON, source-locks, OTB-index, 2027-media-lock,
lesmanifesten, databasecode of bestaande publicaties/gebruikersvoortgang.
De 2026-media-lock verandert de bestaande `cfmApprovedSnapshot` vanzelf: de
backend blijft een oude goedkeuringsidentiteit afwijzen. Deze CI-PR keurt geen
productie-import goed en voert niets op productie uit. Bestaande gepubliceerde
revisies/media worden niet gemuteerd of verwijderd.

## Vaste dataset en rechten

`tests/fixtures/cfm/pinned-assets.json.gz` bevat de werkelijke officiële bytes;
geen synthetische vervanging in de bestaande integratie-/browsertests. Het
archief is 23.041.096 bytes (21,97 MiB), 1.641 leden, SHA-256
`81c5df9982d986895ab6994007ce4fdfdb96fdbc0fe0bf44e37227e84cd553d5`.
De bijbehorende lock, ledenlijst en individuele bronhashes/groottes worden
allemaal gecontroleerd. Een beschadigde dataset of ontbrekend lid faalt vóór
de eerste extractiewrite; er is nooit een automatische terugval op internet.
De echte importer behoudt aanvullende decodering, afmetingen, rechten, opslag,
transacties en publicatievalidatie. Alleen eigen `/tmp`-testmappen zijn toegestaan.

Licentie-/opslagcontrole: OTB op exact de gepinde commit is CC BY-SA 4.0;
licentietekst en toeschrijving zijn meegeleverd. Voor CFM-media geldt de bestaande
eigenaarverklaring van volledige gebruiksrechten (`CFM-DOORLOPEND.md` §8), niet
een afgeleide open licentie. De onderliggende schriftelijke toestemming wordt
buiten de repository bewaard en is niet zelfstandig juridisch gecontroleerd.
De repository en fixture zijn publiek; het archief bevat geen productie-export
of geheimen. Zie [NOTICE](../tests/fixtures/cfm/NOTICE.md). Het archief blijft ruim
onder GitHubs limiet van 100 MiB per Git-bestand, gebruikt geen LFS of externe
mirror en is via `.dockerignore` uitgesloten van de Docker-buildcontext.

## Oude en nieuwe workflow

| Onderdeel | Voorheen | Nu |
| --- | --- | --- |
| Reguliere bronvoorbereiding | Live downloads in vijf jobs | Vast, lokaal archief; nul officiële bronverzoeken |
| CFM-productiebuilds | Vijf builds | Eén build in `cfm-test-setup`, vijf consumers |
| Isolatie | Eigen verse database per suite | Ongewijzigd eigen verse database per suite |
| Matrix | Vier programmajobs | Dezelfde vier jobs/namen, `fail-fast: false` |
| Mislukte voorbereiding | Generieke hashfout in vijf jobs | Gestructureerde diagnose; consumers falen expliciet, geen groene afhankelijke skips |
| Externe broncontrole | Impliciet bij elke test | Aparte `CFM externe bronintegriteit`-workflow |

`content-access.yml` controleert nu ook relevante PR's naar develop. Geen
branchregels, productie-imageworkflow of mergebeveiliging aangepast. De gedeelde
build is gebonden aan `${{ github.sha }}` en dezelfde workflowrun; tijdelijke
artefactretentie één dag. Bij een verlopen artefact moet de volledige workflow
opnieuw draaien; nooit terugvallen op een andere commit of live brondata. Alleen `.next` wordt gedeeld, zonder buildcache of
standalone-node_modules; elke consumer installeert dezelfde lockfiledependencies
en genereert zijn eigen Prisma-client. Unit-/type-/broncontroles blijven behouden.

De aparte bronworkflow gebruikt **geen cache**, controleert alle 1.641 unieke
bestanden en faalt hard bij elke afwijking. Diagnose per bestand: identiteit,
verwachte/ontvangen hash, status, responstype en grootte; geen volledige URL,
responsebody, credentials of ruwe netwerkfout. Rapport als tijdelijk artefact.
Triggers: expliciete dispatch, wijzigingen aan broncontrole/pins en wekelijkse
controle. Gewone app-PR's downloaden deze bronnen niet. GitHub-schedules draaien
op de standaardbranch: zolang dit alleen op develop staat, zijn PR- en handmatige
runs actief; de schedule wordt pas actief na een later afzonderlijk goedgekeurde
release naar de standaardbranch. Dit deployt of importeert niets.

### Besparing (onderscheid tussen gemeten en verwacht)

- Bij een **volledig geslaagde oude** voorbereiding: circa 1.641 unieke externe
  downloads per job, 8.205 voor vijf jobs; 8.260 lockregels vóór interne
  cache-deduplicatie. Nu nul in de gewone CFM-CI, ook bij cachemiss/herstart.
  De drie gemelde mislukte runs stopten vroeg: daarvoor claimen we geen gemeten
  8.205 downloads. De exacte historische downloadaantallen zijn niet gelogd.
- Externe controle: één aparte set van 1.641 bestanden op de beperkte triggers,
  niet vijf sets. Een eerste Git-checkout bevat wel het extra 21,97 MiB archief;
  dat GitHub-verkeer is niet hetzelfde als 1.641 veranderlijke bronverzoeken.
- Gemeten in run 41028648301: één matrix-productiebuild 73 seconden; de importjob
  besteedde 124 seconden aan schema/types/bronchecks/build samen. Vier builds
  minder scheelt bij die matrixduur bruto 292 seconden Linux-runnerwerk.
  Extra setup-installatie en artefactoverdracht gaan daarvan af: **verwacht circa
  3–5 Linux Actions-minuten minder per volledige CFM-run**, geen gemeten garantie.
  De echte database-/browserproeven zijn niet verwijderd of ingekort. Overige
  niet-CFM-jobs worden in deze PR niet herbouwd of weggelaten.

## Herhalen

```sh
# Geen netwerk, database of productieactie:
node --test tests/cfm-test-assets.test.mjs tests/cfm-ci-workflow.test.mjs
CFM_TEST_ASSETS=/tmp/versado-cfm-local \
  node scripts/study-content/prepare-cfm-test-assets.mjs --offline

# Uitsluitend publieke bronverzoeken + eigen tijdelijke bestanden; nooit repinnen:
CFM_TEST_ASSETS=/tmp/versado-cfm-upstream \
CFM_ASSET_REPORT=/tmp/versado-cfm-upstream-report.json \
  node scripts/study-content/prepare-cfm-test-assets.mjs --verify-upstream
```

Voor de echte bestaande integratietests: eerst dependencies/Prisma en productiebuild
maken, dan met `CFM_TEST_ASSETS` naar de gevalideerde tmp-dataset de bestaande
`test:cfm-2026:integration` of vier `--cfm-suite=...`-harnessopdrachten uitvoeren.
Die harnesses maken en verwijderen uitsluitend hun eigen PostgreSQL-containers
via de lokale Docker-socket. Nooit productie-DATABASE_URL gebruiken.

Bevriezen: alleen de expliciete maintaineropdracht in de fixture-NOTICE, na
bron- en rechtenverificatie en gewone PR-review. Geen automatisch pin-updatepad.
Voor de werkelijk uitgevoerde tests en actuele CI: zie de PR-head en PR-rapportage;
geen oudere groene run wordt als bewijs voor de nieuwe head gebruikt.
