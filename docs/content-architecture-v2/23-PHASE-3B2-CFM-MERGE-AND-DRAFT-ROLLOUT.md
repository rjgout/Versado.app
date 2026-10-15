# Fase 3B.2 — mergevoorbereiding en verborgen CFM-conceptimport

## Beslissing en grenzen

Dit rapport betreft PR #120, branch `codex/content-architecture-v2-3b-cfm-2026-import`.
Er is één productieomgeving; de lokale PostgreSQL-/browseromgeving is een
wegwerptestomgeving, geen stagingserver. Geen productiequery, NAS-actie, import,
merge of deployment is tijdens dit werkpakket toegestaan of uitgevoerd.

Drie afzonderlijke besluiten:

| Status | Beoordeling |
| --- | --- |
| Technisch mergeklaar | Pas JA na groene controles op de geïntegreerde head, review en eventuele GitHub-beveiligingsvoorwaarden. Definitieve uitslagen hieronder en in PR #120. |
| Verborgen conceptimport op productie nu vrijgegeven | NEE. De procedure is voorbereid; actuele image, collectieflags, opslagruimte, mount/rechten en backupdekking moeten door de eigenaar worden gecontroleerd. Daarna is afzonderlijke importtoestemming nodig. |
| Publieke publicatie | NEE. De officiële gate blijft gesloten; 553 verwijzingen blijven geblokkeerd. Ook een geslaagde conceptimport verleent geen publicatietoestemming. |

## Mergeoorzaak en integratie

GitHub rapporteerde bij head `23294047` `mergeable=false`,
`mergeable_state=dirty`, zonder merge-resultaatcommit. Het was een werkelijk
inhoudelijk conflict, niet alleen een ontbrekende check: `package.json` en de
rootdependencies van `package-lock.json` bevatten op dezelfde positie respectievelijk
`parse5` (CFM) en `opensheetmusicdisplay` (bladmuziek op main).

Actuele main `08d1795e` bevat ook PR #117/#118 (Legpuzzel), #119 (bladmuziek)
en #121 (microfoon en Permissions-Policy). Main is via een gewone merge
geïntegreerd in `19e0953f`, zonder rebase of force-push. Beide dependencies en
alle wijzigingen van main blijven behouden. De vijf vertaalbestanden en de
CI-proxyregressie zijn automatisch samengevoegd. Geen bronbestand, bronidentiteit,
Prisma-migratie of publicatieregel is verwijderd of vervangen.

De branch-API meldt `protected=false` en de toegepaste branchregels geven een
lege lijst. De gedetailleerde klassieke protectionconfiguratie gaf wel HTTP 403
voor deze integratie. Er is daarmee geen aangetoonde protectionblokkade; de
eigenaar controleert vóór een later besluit opnieuw het actuele mergepaneel.
Een draft is bovendien bewust nog niet voor merge vrijgegeven.
De actuele GitHub-mergeability en head/merge-tree worden na push opnieuw gecontroleerd.

## Gerichte aanvullende beveiliging en beheercontrole

De importer accepteert een bestaande CFM-collectie nu uitsluitend als deze
`DRAFT` en `visibleToUsers=false` is. Afwijkingen geven `CONFLICT` vóór een
nieuwe importregistratie. Er worden geen flags stilzwijgend gerepareerd.
`enabled` blijft ongewijzigd. Bestaande publicatiepointers blijven bij herimport
behouden, ook als een verborgen editie historisch al een pointer heeft.

De gewone reader gebruikt nog steeds normale leesrechten voor gebruikers én
admins: DRAFT/verborgen bronnen geven 404. De aparte beheer-API vereist een
beheerder en geeft read-only toegang tot concepten. Geen nieuwe reader of CMS.

De bestaande ingang is **Adminbackend → Content → Studielespublicaties**
(`/adminbackend/content/study-publications`). De bestaande lijst kan de 52 edities
bevatten (begrensd op 100); de importrunlijst toont de laatste 50 runs, dus niet
noodzakelijk alle 52 lesruns tegelijk. De edities zijn afzonderlijk te openen en
historische revisies hebben bestaande paginering. Voor toekomstige catalogi boven
100 edities is aanvullende editie-paginering nodig; dat is geen aanname dat alle
historische runs zichtbaar zijn.

De bestaande preview toont tekst, tabellen, opdrachten, afbeeldingen en videoposters.
De bestaande referentiereview toont diagnoses en canonieke doelen. Aanvullend:

- Het oorspronkelijke doel wordt ook bij geblokkeerde verwijzingen getoond.
- Alleen een `EXTERNAL_VERIFIED` URL die de bestaande exacte officiële
  URL-validatie doorstaat, krijgt een klikbare bronactie met `noopener noreferrer`.
- Onopgeloste links blijven tekst; geen automatische vrijgave of redirect.
- Een beheerder kan video’s/PDF’s via die gecontroleerde externe bron bekijken;
  er is geen ingebedde videospeler of PDF-reader.
- De bestaande **Verwijzingen testen**-actie vernieuwt uitsluitend diagnoses;
  dat is een bewuste beheermutatie, geen publicatie of voortgangsactie.

Fouten zijn te identificeren aan les-/revisie-ID, bronanker, oorspronkelijke URL,
diagnose, ontbrekende media en verschillenweergave. Correcties verlopen via een
reviewbare adapterwijziging en nieuwe conceptrevisie, niet via een nieuwe editor.
De 52 lessen zijn bereikbaar zonder publieke collectieactivatie. Tijdens de tests
worden verborgen concepten eerst werkelijk in beheer bekeken; pas daarna zetten
fixtures uitsluitend in de testdatabase publicatieflags voor readerregressies.

## Omvang, bron en opslag

De gepinde inhoud blijft: 52 lessen, 3.200 blokken, 3.609 verwijzingen,
1.960 intern gecontroleerd en 1.096 officieel extern. De 553 blokkades blijven:
209 NT, 270 onvoldoende bron-/taal-/ankerbewijs, 73 nummeringsconflicten en één
niet-goedgekeurde PDF-host. Alle 95 videolinks en 52 banner-altteksten behouden
hun fase-3B.1-beoordeling. Engelstalige oorspronkelijke video’s blijven herkenbaar.

De 356 unieke afbeeldingen/posters omvatten exact **10.473.831 bytes**, exclusief
filesystemruimte en quarantaine. Elk bestand heeft een eigen SHA-256. Import
controleert bytes, MIME/signatuur, decodeerbaarheid, afmetingen en checksum.
Installatie gebeurt exclusief en atomair; READY-bestanden worden bij lezen opnieuw
gecontroleerd. Geen automatische verwijdering van historische of ongerefereerde media.

De repository configureert `/data/study-media` via `STUDY_MEDIA_DIR` en een
persistente bind mount; het Synology-voorbeeld gebruikt
`/volume1/docker/jehova-app/study-media`. `studyStorage()` weigert een ontbrekende,
onveilige, onbeschrijfbare of niet daadwerkelijk gemounte directory en eist de
bestaande `.versado-study-volume.json`. Geen containerlaag-/tmp-fallback.

De deployagent neemt bestaande mounts en environment over bij containervervanging.
Een nieuwe image creëert dus geen ontbrekende mount. De huidige live mount,
vrije ruimte, rechten, marker en Hyper Backup-dekking zijn **niet geïnspecteerd**.
Dit is een productie-importvoorwaarde. De eerder door de eigenaar bevestigde
dagelijkse Hyper Backup blijft uitgangspunt; een onafhankelijke restoretest is
niet uitgevoerd en het daarvoor geaccepteerde risico blijft bestaan. Back-up en
restorebekwaamheid worden niet als bewezen geclaimd.

## Operator-draaiboek — uitsluitend na afzonderlijke toestemming

De volgende opdrachten zijn instructies voor een latere bevoegde operator,
**geen in deze opdracht uitgevoerde productiecommando’s**. Gebruik de bestaande
Container Manager-/Portainer-terminal van `jehova-app`; geen externe DB-verbinding,
nieuw importmechanisme of credentials in rapporten. Werk vanuit `/app`.

### 1. Review, backup en versie

1. Controleer PR #120, de definitieve SHA, alle relevante checks en de drie
   afzonderlijke statussen. Alleen na expliciet mergebesluit mag naar main worden
   gemerged. Deployment vereist daarna afzonderlijke toestemming.
2. Leg de vorige gezonde image-digest en de nieuw goedgekeurde merge-SHA vast.
   Controleer na een toegestane deployment de getoonde build-SHA en image-digest,
   niet uitsluitend een veranderlijke `latest`-tag. `/api/health` moet 200 geven,
   maar bewijst op zichzelf geen buildidentiteit of mediageschiktheid.
3. Controleer de recente geslaagde Hyper Backup-taak via metadata, inclusief
   database en de definitieve studiemediamap. Noteer herstelprocedure, bereik,
   tijdstip en verantwoordelijke. Start geen nieuwe backup of herstelactie
   vanuit de importer. De eerder bewust overgeslagen onafhankelijke restoreproef
   blijft een geaccepteerd restrisico; ontbrekende backupdekking blokkeert import.
4. Vergelijk de actuele migratiestatus met de goedgekeurde repository via de
   bestaande beveiligde admininventarisatie. Deze PR voegt geen migratie toe.
   Containerstart voert wel automatisch `prisma migrate deploy` uit: deployment
   blijft een afzonderlijke productiehandeling, niet onderdeel van preflight.
5. Controleer de bestaande CFM-collectie in beheer: afwezig of exact
   werk `cfm-old-testament-2026`, editie `church-cfm-ot-2026`, taal `nl`, DRAFT
   en verborgen. Een aanwezige afwijking vereist beoordeling; de CLI verandert
   geen bestaande zichtbaarheid of publicatiestatus.
6. Bewaar vóór import een beveiligd technisch overzicht van relevante collectieflags,
   bestaande les-/revisie-ID’s en publicatiepointers. Leg de aantallen van bestaande
   voortgang en economie vast via de bestaande beheerinventarisatie. Geen notitieteksten,
   sessietokens of persoonsgegevens exporteren.

### 2. Opslag controleren, zonder deze automatisch aan te passen

Controleer in de echte stack de mountbron, bestemming `/data/study-media`, rw,
het beperkte directoryrecht (geen group/world-write), appidentiteit en marker.
Ontbreekt de mount of marker: **stop**. Een stackwijziging of markerinitialisatie
volgt alleen afzonderlijk goedgekeurd de bestaande instructies in
`docs/DEPLOY-SYNOLOGY.md`; niet als verborgen bijeffect van import.

Bestaande opslagservice aanroepen en vrije ruimte opvragen (read-only):

```sh
cd /app
node --import tsx --input-type=module <<'NODE'
import fs from 'node:fs/promises';
import { studyStorage } from './src/lib/studyContent/storage.ts';
const store = await studyStorage();
const disk = await fs.statfs(store.root);
const freeBytes = disk.bavail * disk.bsize;
if (freeBytes < 100 * 1024 * 1024) throw Error('ONVOLDOENDE_IMPORTMARGE');
console.log(JSON.stringify({ storageChecked: true, freeBytes, volumeId: store.volumeId }));
NODE
```

De 100 MiB is een conservatieve operationele ondergrens voor deze 10,5 MB-set en
quarantaine, geen ingebouwde quota of garantie tegen gelijktijdig vollopen.
Controleer ook ruimte/inodes op de host en voorkom gelijktijdige imports.

### 3. Snapshot controleren en bevestigen

De CLI berekent zijn goedkeuringshash over de **exacte bytes** van
`source-lock.json`, `media-lock.json`, `otb-index.json`,
`reference-source-checks.json` en `reference-review.json` (bestandsnaam + nulbyte
+ inhoud per bestand). Voor deze snapshot is de verwachte waarde:

`68569806ec10533e7f0d1591e164758ab9f7c14ccebe9d81c9cab69193fdba15`

Zonder bevestiging weigert de bestaande CLI met exitcode 2 vóór databasegebruik:

```sh
npx tsx scripts/study-content/import-cfm-2026.ts
```

Controleer dat de gemelde hash exact overeenkomt. Een andere hash vereist nieuwe
review, geen blind overnemen. Valideer alle bronnen zonder import:

```sh
node --import tsx --input-type=module <<'NODE'
import { cfmOldTestament2026NlManifest as manifest } from './src/lib/studyContent/cfm2026Manifest.ts';
import { loadCfmLesson } from './src/lib/studyContent/cfm2026Import.ts';
for (const lesson of manifest.lessons) await loadCfmLesson(lesson.sourceKey);
console.log(JSON.stringify({ checkedLessons: manifest.lessons.length }));
NODE
```

Deze controle toetst de 52 bronhashes, taal, structuur, identiteit en gepinde
mediareferenties. Ze downloadt niets en wijzigt geen database. Actuele interne
OTB-beschikbaarheid blijft een aparte runtimecontrole; geen automatische import
van aanvullende Schrifturen uitvoeren.

### 4. Expliciete verborgen conceptimport

Alleen na akkoord voor **deze image en snapshot**, met het ID van een bestaande
bevoegde beheerder (niet een e-mailadres of token):

```sh
CFM_DRAFT_IMPORT_APPROVED_SNAPSHOT=68569806ec10533e7f0d1591e164758ab9f7c14ccebe9d81c9cab69193fdba15 \
  npx tsx scripts/study-content/import-cfm-2026.ts \
  --confirm-drafts-only --admin-user-id <bestaande-beheerder-ID>
```

Vervang de placeholder vóór uitvoeren. Start maar één operatorproces. Laat de
huidige publicatiegate dicht en zet nooit `STUDY_PUBLICATION_PROFILE=synthetic-test`
op productie. Gebruik geen seed, reload, fixture-import of publieke publishactie.

Verwacht bij een eerste lege catalogus: exact 52 lessen, 52 edities, 52
conceptrevisies en 52 les-importruns, allemaal via de bestaande audit-/leaseketen.
Bij een gedeeltelijk bestaande catalogus zijn de **eindaantallen** leidend; geen
claim dat iedere uitvoering 52 nieuwe records toevoegt. Er komen geen cursussen,
activeCourse-/UserStudyContext-wijzigingen of economieacties bij.

De volledige CLI-uitkomst staat alleen na succes in
`/tmp/versado-cfm-2026-drafts-<tijdstip>.json` (0600). Bewaar die vóór een
containervervanging in een private, beheerde locatie. Niet in Git, `/public`, een
publiek NAS-volume of algemene logs. De terminal toont slechts de veilige
52-concepten-samenvatting. Bij fout: exitcode 1 en de bestaande beheer-importruns.

### 5. Controle na import, vóór verdere besluiten

- Alle 52 edities in Studielespublicaties terugvinden; revisie-ID’s en bronidentiteiten
  vergelijken met CLI-uitkomst en gepinde manifestvolgorde. De laatste-50-runlijst
  is niet de volledigheidscontrole.
- CFM blijft DRAFT en verborgen; enabled en alle bestaande flags/pointers blijven
  gelijk. Geen automatische publicatiepointer, cursus of normale actieve keuze.
- Alle 356 unieke mediachecksums moeten aanwezig, READY, decodeerbaar en aan
  hetzelfde volume gekoppeld zijn. Bestaande deduplicatie kan fysieke/DB-totalen
  beïnvloeden; vergelijk de gepinde set, niet alleen het totale aantal media.
  De beheerpreview herleest bytes/checksum en meldt ontbrekende bestanden.
- Controleer als beheerder de 52 teksten, 10 tabellen, afbeeldingen/posters,
  95 externe videoverwijzingen, feitelijke banner-alttekst, brondoelen en diagnoses.
  Leg afwijkingen vast met les, revisie en anker. Geen publicatie via workaround.
- Test dezelfde verborgen lesroute zonder sessie, als gewone gebruiker en als
  admin via de **publieke** reader: geen inhoud. Anoniem volgt de bestaande
  inlogflow; aangemelde gebruiker en admin krijgen 404. Alleen de bestaande
  geautoriseerde beheerpreview geeft conceptinhoud; de beheer-API geeft 401/403
  voor onbevoegden. Geen synthetische fixture of previewparameter als bevoegdheid.
- Vergelijk publicatiepointers en het technische voortgangsoverzicht vóór/na.
  In de live app kunnen andere gebruikers ondertussen geldige activiteiten doen:
  legitieme wijzigingen zijn geen bewijs van importbijwerkingen. De geïsoleerde
  regressies bewijzen het ontbreken van importmutaties.
- Verwacht de 553 categorieën; actuele bronrechten kunnen méér blokkades geven.
  Minder blokkades vereisen nieuw bewijs/review, geen stilzwijgende vrijgave.

### 6. Gedeeltelijk falen en opnieuw uitvoeren

De 52-lessenbatch is bewust geen globale alles-of-niets-transactie: eerder
voltooide verborgen concepten en media blijven bestaan. Een fout wijzigt geen
publicatiepointer. Verander geen bronlocks, lesidentiteiten of bestaande flags.
Inspecteer de mislukte/onderbroken run in beheer en los uitsluitend de gemelde
bron-, opslag- of netwerkfout op. De bestaande leases/fencing sluiten oude workers
uit. Wacht bij een levende lease; start geen concurrerende worker.

Herhaal daarna **dezelfde operator-CLI met dezelfde goedgekeurde snapshot**.
De gedeelde importer hergebruikt stabiele identiteiten en inhoudshashes; dezelfde
versie maakt geen dubbele runs, revisies of media. Een leaseherstel mag opnieuw
verwerking uitvoeren, maar nooit een ongeldige oude worker laten committen.
Gebruik voor CFM niet de uitsluitend synthetisch vrijgegeven beheer-fixtureknop.
Een gewijzigde bron/adapter kan een nieuwe conceptrevisie betekenen en vereist
opnieuw kwaliteitsreview; historische revisies blijven intact.

### 7. Rollback en herstel

Stop een foutieve import beheerst en behoud de audit/laatste fout. Verwijder geen
revisies, media, marker of importrecords. De oorspronkelijke publieke inhoud is
niet veranderd en hoeft dus niet te worden teruggezet. Een eventuele appimage-
rollback volgt de bestaande deploymentprocedure, met behoud van DB en mounts.
Een oudere reader ondersteunt mogelijk passagebundels/tabellen nog niet: houd
CFM verborgen. Geen downmigratie, reseed of automatische garbage collection.

Controleer na een later toegestane containervervanging dezelfde volumeId en
mediachecksums. Bij dataverlies: stop, behoud logs/metadata en laat de eigenaar het
bestaande Hyper Backup-herstelplan beoordelen. Voer geen ongecontroleerde restore
over een levende productie-DB uit. Dit draaiboek claimt geen uitgevoerde herstelproef.

## Validatie en resterende voorwaarden

Werkelijk opnieuw uitgevoerd op de met `08d1795e` geïntegreerde implementatie:

- `npm ci`, Prisma generate/validate, TypeScript, i18n en schone productiebuild: geslaagd.
- CFM 8/8, ReferenceResolver 18/18, StudyReader/posities 57/57,
  publicatie/content 33/33, focus/shell 27/27 en live data 52/52: geslaagd, geen skips.
- De recente main-functionaliteit: Lofzangen/proxy 161 geslaagd, 0 fouten;
  twee tests met echte audiobestanden expliciet overgeslagen. Geen fysieke
  iOS-/Androidtest en geen onafhankelijke productiebackup-herstelproef.
- Geïsoleerde PostgreSQL: alle 144 migraties, herhaalde deployment,
  fout-/conflictrollback en databehoud doorlopen. 52 lessen tweemaal verwerkt,
  dezelfde revisies/runs/media hergebruikt, twintig gegevensmodellen ongewijzigd.
  De echte resolver bevestigt 1.960 intern / 1.096 extern / 553 geblokkeerd.
- Nieuwe integratieasserties: 52 edities vindbaar in beheer; adminpreview/media
  toegankelijk; anoniem 401 en gewone gebruiker 403 op beheer; publieke reader
  weigert DRAFT voor gebruiker én admin. Een zichtbare of niet-DRAFT bestaande
  CFM-collectie wordt zonder nieuwe import/revisies of flagwijzigingen geweigerd.
- Vijftien productiebuild-browsercases geslaagd: de bestaande twaalf reader-/
  verwijzingscases plus drie echte verborgen-beheerflows. Die controleren alle
  52 kaarten, tabellen, daadwerkelijk geladen afbeeldingen, referentiediagnoses,
  gecontroleerde bronacties en normale readerweigering op 320px/200% licht,
  390px donker en 1280px licht. Geen overflow of navigatiebeloning.
- Persistente opslag: synthetisch controlebestand blijft checksumgelijk in twee
  afzonderlijke containers met verschillende images; echte mount bewezen;
  alleen-lezen/ontbrekende mount blokkeert. Dit is geen live NAS-proef en geen
  claim dat alle 356 productiebeelden al op de NAS staan.
- ESLint: 0 fouten, 151 waarschuwingen in de geïntegreerde repository.
  Gerichte lint op alle vijf gewijzigde code-/testbestanden: 0 meldingen.
  De bestaande i18n-achterstand is 418 sleutels per niet-Nederlandse UI-taal;
  geen nieuwe gebruikersgerichte tekstsleutels nodig.
- De exacte bronpreflight uit dit draaiboek is zonder bereikbare database
  beproefd: 52 bronnen geldig. De CLI weigert zonder bevestiging met exit 2
  vóór databasegebruik en meldt de hierboven vastgelegde hash.

Een eerste poging strandde vóór tests op een volle ontwikkelschijf. Een volgende
ronde voltooide de import, maar het nieuwe browsergeval wachtte op een nog niet
in beeld gescrolde lazy-loaded afbeelding; daarnaast trad opnieuw ENOSPC op.
Alleen herbouwbare pakket-/compiler-cache en de eigen diagnosecontainer zijn
opgeruimd, geen bestaande Docker-databasevolumes of bronbestanden. De browser
scrolt nu eerst naar de afbeelding en controleert daarna echte geladen pixels.
De volledige eindronde is opnieuw doorlopen en geslaagd; mislukte pogingen zijn
niet als succes geteld. De bestaande pg-driverdeprecation over overlappende
`client.query()`-aanroepen is als waarschuwing zichtbaar gebleven.

De definitieve CI-uitslagen gelden uitsluitend voor de nieuwe gepushte head;
ze worden met runlinks en controle van GitHubs merge-resultaattree in PR #120
vastgelegd. De oude groene checks op `23294047` tellen daarvoor niet mee.
Screenshots en JSON-bewijs staan in het bestaande `cfm-2026-import-browser`
CI-artifact, niet als grote bestanden in Git.

De noodzakelijke resterende handelingen zijn een review/mergebesluit, afzonderlijk
deployakkoord, aantoonbare live opslag-/backup-/versiecontrole en daarna expliciete
verborgen-importtoestemming. Publieke vrijgave blijft een later afzonderlijk besluit.
