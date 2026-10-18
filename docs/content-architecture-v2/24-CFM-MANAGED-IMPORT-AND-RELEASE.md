# CFM 2026 — beheerbare import, inhoudelijke vrijgave en normale toegang

## Beginsituatie en grenzen

Gestart op main `fe7bb37c` plus PR #123 (`7511df94`). Tijdens het werk is
#123 door de eigenaar gemerged; deze branch is daarna fast-forward gesynchroniseerd
met main `6dc89860`. Er is door deze opdracht geen andere PR gemerged. De eigenaar heeft een
succesvolle productie-import van 52 lessen gemeld; tijdens deze opdracht worden
geen productiequeries, imports, publicaties, deployments of NAS-acties uitgevoerd.
Een geïsoleerde testdatabase is alleen ontwikkel-/testinfrastructuur, geen nieuwe
stagingserver of noodzakelijke beheerworkflow.

Een aanvullende concrete bronisolatiefout is gericht hersteld: de eerste BOM-
seedfase koos de eerste enabled collectie. Deze fase gebruikt nu expliciet
content_bom. Een nieuwe of anders gesorteerde CFM-collectie kan dus niet het
doel van de Schriftuurimport worden.

De aangetroffen oorzaken waren: runSeed kende CFM niet; snapshotgoedkeuring
bestond alleen in de CLI; officiële publicatie was uitsluitend in een synthetisch
testprofiel toegestaan; de collectie bleef DRAFT; normale adminrechten eisten
visibleToUsers; de kiezer had geen normale bestemming voor StudyLesson-edities.

## Eén beheerworkflow

De bestaande keten blijft `ReseedClient → /api/admin/reseed → reseedJob → runSeed`.
De bestaande knop krijgt een CFM-keuze, standaard aangevinkt, en een afzonderlijke
bevestiging van de servergeleverde SHA-256-snapshotidentiteit. Dezelfde functie
`sourceApproval.ts` wordt gebruikt door de CLI-controle met
`CFM_DRAFT_IMPORT_APPROVED_SNAPSHOT`. De backend gebruikt de expliciet bevestigde
snapshot in de geauthenticeerde POST; er hoeft geen environmentvariabele of
terminalcommando op productie te worden ingesteld. Een andere snapshot wordt
geweigerd. Oude clients met een lege POST behouden uitsluitend hun oude seedflow.

De optionele studie-importfase in runSeed is alleen aanwezig na die bewuste
beheeractie. Een CLI-seed, appstart, migration of deploy importeert geen CFM.
Er is geen tweede importer: importCfm2026Drafts gebruikt dezelfde parser,
ContentImportRun/Item, leases, fencing, revisies en opslag als voorheen.
Importruns bewaren bronidentiteiten en uitvoerende beheerder. De reloadvoortgang
gebruikt de bestaande job/pollinginterface. Een netwerkfout wordt via de status
hersteld; de client verhindert dubbele starts. De algemene seedfasen blijven
bestaan en ongewijzigd beschikbaar.

Vooraf worden mount, marker/volume-identiteit, schrijfbaarheid, vrije ruimte
(gepinde media plus 32 MiB reserve) en alle 52 bronbestanden gecontroleerd.
READY-media worden opnieuw geverifieerd en hergebruikt. Een ontbrekend bestand
kan opnieuw uit de gepinde bron worden geïnstalleerd; een corrupt bestaand bestand
wordt niet overschreven. Een verkeerd volume of ontbrekende opslag stopt veilig.
Geen fallback naar tijdelijke containeropslag. De bestaande Docker-volumeconfiguratie
blijft behouden.

Een onderbreking laat alleen reeds vastgelegde concepten achter. Dezelfde goedgekeurde
reload hervat via de duurzame per-lesruns; een actieve lease moet zo nodig eerst
verlopen. Scope-locks en fencing blijven leidend, ook tegenover de operator-CLI.
De bestaande in-memory reloadstatus is procesgebonden; na containervervanging
wordt de status via een nieuwe bewuste reload opgebouwd uit de importaudit.
Publicaties, zichtbaarheid en gebruikersgegevens worden nooit door CFM-herimport
gewijzigd, ook niet als de collectie inmiddels vrijgegeven of zichtbaar is.

## Publiceren zonder de zichtbaarheidsschakelaar te misbruiken

Bestaande beheerroute: `/adminbackend/content/study-publications`.
Een import blijft DRAFT. Elke les wordt bekeken met de bestaande preview,
mediacontrole, referentiediagnostiek en diff. Publiceren blijft een expliciete,
geversioneerde en idempotente transactie met dezelfde immutable revisies en
publicatiepointers. De enige officiële adapter die wordt toegelaten is de gepinde
Nederlandse CFM-2026-adapter; synthetische productiepublicatie blijft gesloten.

De bronversie, lesidentiteit, titel, lichaam, herkomst en rechten worden opnieuw
tegen de gepinde bron gecontroleerd. Media, hashes, bindings, editie-identiteit,
volledigheid en versievoorwaarden blijven verplicht. Een ontbrekende afbeelding,
lege alttekst of onbekende/onveilige verwijzing blijft een fout.

### De 553 geblokkeerde verwijzingen

De bestaande heraudit wijzigt alleen diagnose en bewijs; oorspronkelijke targets
en normalisaties blijven historisch. Publicatie valideert de bestemming opnieuw
via de centrale resolver. Hierdoor vereisen gewijzigde toegangsrechten geen
herimport of herschrijving van de oorspronkelijke les.

De bestaande referentiereview bevat exact 553 gevallen zonder betrouwbare
interne/externe bestemming. Alleen een exacte combinatie van les, anker, label
en target in deze review komt in aanmerking voor **niet-klikbare weergave**.
Er wordt geen URL of editie-equivalentie goedgekeurd. Een beheerder moet per
revisie de expliciete beoordelingscheckbox aanvinken en daarna publiceren
bevestigen. Zonder die beoordeling blijven deze verwijzingen blokkerend.

De auditactie heet `PUBLISH_DISPLAY_ONLY`. De oorspronkelijke labels, doelen en
UNRESOLVED-diagnoses blijven behouden. De gewone reader toont zulke verwijzingen
als tekst met een uitleg; de resolver weigert ze ook bij een gemanipuleerd
rechtstreeks verzoek. Een latere uitbreiding van de resolver activeert ze dus
niet automatisch. Onbekende nieuwe problemen buiten de vastgelegde review blijven
publicatie blokkeren. Historische, eerder goedgekeurde inactieve verwijzingen
blijven bij een expliciete rollback herleidbaar via de immutable publicatieaudit.

### Collectie vrijgeven

Nadat alle 52 echte lesidentiteiten een gecontroleerde publicatie hebben, verschijnt
**Collectie inhoudelijk vrijgeven**. De beheerder bevestigt deze handeling apart.
De collectie moet technisch ingeschakeld en nog verborgen zijn. De server toetst
alle lesidentiteiten, de complete set, media en het actuele releasetoken opnieuw.
Hij vergrendelt collectie en edities, controleert eerdere publicatie-audits en
registreert `RELEASE_COLLECTION` bij dezelfde bestaande auditstructuur. Elke
betrokken editie krijgt precies één volgende publicatieversie. De collectie
wordt PUBLISHED; visibleToUsers blijft false. Gelijktijdige of herhaalde acties
kunnen geen tweede vrijgave of stilzwijgende pointerwissel veroorzaken.

Er is één noodzakelijke SQL-migratie: de bestaande checkconstraint op
StudyPublicationAction accepteert naast PUBLISH/ROLLBACK de twee expliciete
auditacties. De versie-, hash-, FK- en immutable-eisen blijven bestaan. Geen nieuwe
tabel, kolom, backfill, verwijdering, publicatie of zichtbaarheidsschakeling.

## Normaal lezen en zichtbaarheid

| Toestand | Beheerder | Gewone gebruiker |
| --- | --- | --- |
| LEGACY/PUBLISHED, enabled, verborgen | Normale kiezer, pagina en API | Geen toegang |
| LEGACY/PUBLISHED, enabled, zichtbaar | Normale toegang | Normale toegang |
| DRAFT of disabled | Alleen expliciete beheerpreview | Geen toegang |
| Niet ingelogd | Geen beschermde toegang | Geen beschermde toegang |

De wijziging staat centraal in contentAccess.ts, zowel in queryfilters als in de
pure controle. Er ontstaat geen impliciet DRAFT-previewrecht. De bestaande
contentkiezer laat beheerders nu verborgen vrijgegeven edities selecteren.
Leren (`/courses`) toont voor de actieve studiecollectie de gepubliceerde lessen,
in echte lesvolgorde, met links naar de bestaande StudyReader. Er worden geen
Course-, Exercise- of fictieve CFM-records aangemaakt. Bronwisseling en normale
navigatie wissen geen keuzes, leesposities, annotaties of UserStudyContext.

Interne verwijzingen blijven daarnaast de rechten op hun eigen doelcollectie
controleren. CFM zichtbaar maken maakt een verborgen Bijbeluitgave niet openbaar.
De gewone gebruiker krijgt daar een veilige onbeschikbaarheidsmelding; een
beheerder kan vrijgegeven, enabled doelen wel normaal bekijken. De eigenaar
kiest de zichtbaarheid van die Bijbelcollectie afzonderlijk.

Lofzangen uit #123 blijft een activiteit met dezelfde eigen beheerschakelaar en
noodstop, zonder ContentCollection of wijziging van actieve bron/taal.

## Bestaande productie-import beschikbaar maken — later door de eigenaar

1. #123 is inmiddels in main aanwezig. Laat deze concept-PR afzonderlijk beoordelen.
   De Synology-container voert bij een toegestane nieuwe image automatisch
   migrate deploy uit. Deze opdracht voert dat niet op productie uit.
2. Controleer bestaande Hyper Backup, juiste image en de reeds gemounte
   studiemediaopslag. De eerder geaccepteerde ontbrekende onafhankelijke
   restoreproef blijft een restrisico; er wordt geen herstelclaim gedaan.
3. **Importeer de bestaande 52 lessen niet opnieuw om ze te kunnen lezen.**
   Open Studielespublicaties en controleer de 52 edities, hun concepten, media,
   altteksten, referenties en bron-/rechtenmetadata.
4. Beoordeel en publiceer iedere revisie; bevestig waar van toepassing de exact
   aangegeven niet-klikbare verwijzingen. Los overige fouten eerst op.
5. Houd de CFM-zichtbaarheidsschakelaar uit. Geef daarna de complete collectie
   afzonderlijk inhoudelijk vrij. De bestaande collectie-ID
   `content_cfm_ot_2026_nl`, lessen, revisies en media blijven dezelfde.
6. Kies CFM in de gewone contentkiezer en open Leren. Controleer de 52 lessen in
   de normale reader, inclusief afbeeldingen, tabellen, posters en verwijzingen.
7. Schakel pas daarna CFM onder **Adminbackend → Content → Content** in voor
   gebruikers. Uitgeschakeld houden of opnieuw uitschakelen wijzigt geen
   publicatie, voortgang of leespositie.
8. Gebruik bij latere contentupdates **Content opnieuw laden**, met de expliciete
   snapshotbevestiging. Bekijk daarna nieuwe concepten/diffs en publiceer bewust.

## Testbewijs, beperkingen en rollback

De bestaande spelstart- en hervatservices zijn niet aangepast. Hun afzonderlijke
technische availability-/runbronvoorwaarden blijven gelden; normale leestoegang
voegt geen nieuwe speladapter of spelondersteuning toe. De oorspronkelijke
Mysterie- en Genees-regressieasserties blijven daarom intact.

Werkelijke eindresultaten en CI-artifacts worden bij de PR vastgelegd. De suite
controleert alle 52 bronlessen, 3200 blokken, 356 media, 3609 verwijzingen,
1960 interne en 1096 externe diagnoses en 553 inactieve verwijzingen. Ze test
onderbreking/herimport, opslagfouten, expliciete goedkeuring, echte publicatie,
concurrente collectievrijgave, normale adminreader met schakelaar uit en de
gebruikersschakelaar. Browsermatrix: 320px/200%, 390px donker, 1280px desktop,
plus bestaande verwijzings-, navigatie- en readerregressies.
De echte reload-POST voert de volledige CFM-fase uit; een uitsluitend in de
wegwerpdatabase geïnstalleerde foutinjectie stopt de legacyfase vóór de eerste
Book-write. Dit bewijst ook dat CFM als eerste gesorteerde collectie geen BOM-
import kan overnemen. De volledige legacytaak met externe feeds en grote
audiomirrors wordt niet als internettaak in deze suite uitgevoerd. De browser
controleert daarnaast bevestigen/annuleren/Escape en de exacte snapshotpayload.
De bestaande native bevestigingsdialoog heeft een begrensd scrollbaar tekstdeel
en afzonderlijke bereikbare acties, ook bij 320px en 200% tekst. De tabeltest
wacht op gehydrateerde readerbediening en geladen fonts en behoudt de strikte
hit-test onder de terugbalk, na een echte gebruikersscroll.

Reeds uitgevoerde lokale controles:

| Controle | Werkelijke uitkomst |
| --- | --- |
| Content-/studiecontext-, selectie-, beschikbaarheids- en cursusintegraties | 281 geslaagd, 0 overgeslagen |
| ReferenceResolver/Meer lezen/Terug naar les integraties | 15 geslaagd, 0 overgeslagen |
| ReferenceResolver-unit- en querybudgettests | 18 geslaagd; één hoofdstukquery per 100 verwijzingen voor beide toegangsrollen |
| CFM-integratie en productiebuild-browserflows | 52 echte lespublicaties en collectievrijgave; 21 browsergevallen geslaagd |
| CFM bron-, review- en goedkeuringstests | 11 geslaagd, 0 overgeslagen |
| Publicatie-/mediabeveiligingsintegraties | 26 geslaagd; historische media blijven uitsluitend via expliciete beheerpreview bereikbaar |
| Live-data / Focus-shell / studiecontent | 52 / 27 / 28 geslaagd |
| Aanvullende Kompascontrole zonder DB-binding | 60 geslaagd, 9 DB-tests overgeslagen; geïsoleerde regressie/CI voert de DB-gebonden checks apart uit |
| TypeScript, Prisma validate/generate, i18n en schone productiebuild | Geslaagd |
| ESLint | 0 fouten, 155 bestaande waarschuwingen; geen nieuwe waarschuwingen |

De migratieketen is geïsoleerd getest met 146 bestaande tabellen en behoud van
bestaande rijen; herhaalde migrate deploy had geen resterende migraties. De
CFM-integratie vergelijkt daarnaast 21 persoonlijke voortgangs-/economietabellen
vóór en na import/publicatie/vrijgave. Een bewuste foutinjectie vóór de eerste
legacy-boekwrite verschijnt als SYNTHETIC_LEGACY_BOUNDARY in het testlog; dit is
een verwacht testresultaat. De bestaande pg-client-deprecatiewaarschuwing en de
buildfallback voor branding zonder live DB zijn apart herkenbaar; beide stoppen
de checks niet. De definitieve CI-status en browser-artifacts horen bij de
exacte PR-head en worden in de PR gerapporteerd.

Rollback naar een vorige appimage laat alle data, revisies, auditacties en media
bestaan. Oude code kan verborgen content weer minder ruim tonen en ondersteunt
de nieuwe beheerhandelingen niet. Geen downmigratie uitvoeren: nieuwe auditacties
blijven bestaan. Een eerdere lespublicatie terugzetten gebruikt de bestaande
expliciete rollbackservice, niet het verwijderen van de nieuwe revisie. Niets
verandert automatisch aan XP, hints, reeksen, cursusabonnementen of spelstatus.

Niet getest op fysieke iOS-/Android-toestellen. Er is geen productie-inventarisatie
of volledige inhoudelijke beoordeling door de producteigenaar tijdens deze
ontwikkelopdracht uitgevoerd. De beheerbeoordeling en productie-uitrol blijven
bewuste, afzonderlijke handelingen.

## Definitieve pre-mergecontrole van PR #125

De controle begon op `9b16a04e3148a6321fd7893f87e73ea9d52b6bc2`: de PR was
open, concept en zonder mergeconflicten, met 16 geslaagde checks. Main was daarna
doorgegaan naar `ee43dc1b` met #124 (zelfstandige muziekrubriek en de zondagse
Lofzangenkaart). Die wijzigingen zijn zonder conflicten geïntegreerd in
mergecommit `a7483733`; #123 (`7511df94`) is een bewezen voorouder van main.
De nieuwe controles en CI horen bij de uiteindelijke PR-head, niet alleen bij
de eerder groene commit. De PR vermeldt de exacte eind-SHA en artifactlinks.

### Aangetroffen en herstelde race

Een echte geïsoleerde foutinjectie trok één les in tussen de volledigheidscheck
en de vrijgavetransactie. De oorspronkelijke service accepteerde dat ten
onrechte. Dezelfde cataloguscontrole wordt nu binnen de transactie herhaald;
het vrijgavetoken omvat ook werk-/editie-identiteit, bronvolgorde en ingetrokken
lesstatus. De regressie controleert weigering zonder collectievrijgave of
nieuwe auditrijen. De bestaande vergrendelingsvolgorde (collectie, daarna
edities op ID) blijft behouden. Een latere bewuste intrekking blijft daarnaast
de normale reader blokkeren; vrijgave verleent geen blijvend onbeperkt recht.

### Exacte migratie en gegevensimpact

Alleen `20261103120000_study_publication_audit_actions/migration.sql` wordt
toegevoegd. Eén atomische `ALTER TABLE` vervangt uitsluitend
`StudyPublicationAction_version_check`: naast PUBLISH/ROLLBACK worden
PUBLISH_DISPLAY_ONLY en RELEASE_COLLECTION toegestaan. De bestaande eisen aan
versiestap en SHA-256 blijven staan. Geen Prisma-modelwijziging, nieuwe tabel,
kolom, index, DML, backfill, pointerwissel, zichtbaarheidsreset of automatische
publicatie. Bestaande geldige auditrijen blijven geldig.

De geïsoleerde test controleert alle constraints vóór/na de wijziging, herhaalt
de SQL en veroorzaakt bewust een naamconflict ná de DROP: ook dan blijft de
oorspronkelijke constraint behouden. De bestaande migratierunner controleert
de keten op een oudere fixture en herhaalt `migrate deploy`. In productie
wordt de migratie uitsluitend door de later goedgekeurde containerstart
uitgevoerd; niet tijdens deze controle.

### Wat niet op productie is vastgesteld

Deze werkruimte heeft geen geautoriseerde read-only productieverbinding. De
52 geïmporteerde DRAFT-lessen en `publicationChanged=false` zijn door de eigenaar
gemelde feiten, geen nieuwe live meting. Ook backupdatum, vrije NAS-opslag,
live mountidentiteit, fysieke mediachecksums en actuele migratieregistraties
zijn hier niet gemeten. De geïsoleerde fixtures vervangen dat bewijs niet.

Het diagnostische `/tmp/versado-cfm-2026-drafts-1792095443834.json` is geen
afhankelijkheid: alleen de operator-CLI schrijft zo'n resultaatbestand. De
beheerpagina leest bestaande collecties, lesedities, revisies, importaudits en
media uit PostgreSQL en de permanente opslag. De bestaande 52 lessen kunnen
zonder herimport worden beoordeeld en gepubliceerd.

## Productie-uitrol: handelingen na afzonderlijke toestemming

1. **Voor merge:** controleer groene checks op de definitieve PR-head en de
   mergebaarheid tegen de actuele main. Niet automatisch mergen. Leg na een
   toegestaan mergebesluit ook de merge-SHA en geslaagde main-imagebuild vast;
   de release-image hoort bij die SHA en kan afwijken van de PR-head.
2. **Backup en vertrekpunt:** laat de eigenaar een recente, geslaagde,
   PostgreSQL-consistente backup en dekking vastleggen. Bescherm database,
   `study-media` inclusief `.versado-study-volume.json`, branding en besloten
   stack-/environmentconfiguratie. Noteer tijdstip, PostgreSQL-versie (de
   repository gebruikt 16), migratienamen/checksums en het huidige appimage-ID,
   digest en build-SHA. Bewaar die oude image; ruim niets op. Dagelijkse Hyper
   Backup is eigenaarbevestigd; onafhankelijk terugzetten blijft ongetest en
   als restrisico geaccepteerd.
3. **Live voorwaarden:** controleer zonder mutaties de bestaande collectie-ID,
   52 lesedities, DRAFT/publicatiepointers en verborgen vlag. Controleer de
   relevante importaudits en huidige bronsnapshot; exporteer geen gebruikers-
   of notitieteksten. Controleer dat alle 356 unieke mediabestanden READY,
   leesbaar en checksumcorrect zijn en dat `/data/study-media` werkelijk
   permanent gemount is. De voorgestelde Synology-hostmap blijft
   `/volume1/docker/jehova-app/study-media`; de bestaande live mount moet door
   de eigenaar worden bevestigd. De beheerpagina moet opslag gereed melden.
   Controleer schrijfrechten en voldoende vrije ruimte voor eventuele latere
   imports. Bij afwijkingen: stoppen, geen herimport als vermeende reparatie.
4. **Uitrol:** uitsluitend na aparte toestemming via het bestaande deploypaneel.
   De agent behoudt huidige mounts/environment/netwerken; een image voegt geen
   ontbrekende mount toe. De nieuwe container voert vóór de serverstart
   automatisch `prisma migrate deploy` uit. Geen seed, reload of CFM-import
   starten. Houd alle bestaande volumes en geheimen intact.
5. **Direct na start:** controleer health, build-SHA en succesvolle registratie
   van exact de nieuwe migratie, zonder mislukte open migratie. Health test
   alleen basisgezondheid. Controleer daarom ook inloggen, bestaande BOM/OTB/
   DC/PGP-readers, Lofzangen-instelling/noodstop, contentkeuze en voortgang.
   Controleer dezelfde opslagmarker/media en de bestaande 52 conceptlessen in
   Studielespublicaties. Aantallen, identiteiten, publicatiepointers en alle
   zichtbaarheidsschakelaars moeten vóór bewuste beheerhandelingen gelijk zijn
   aan het vertrekpunt. Gewone reader blijft dicht voor deze DRAFT-collectie,
   ook voor admins; geautoriseerde beheerpreview werkt wel.
6. **Bewuste inhoudelijke handelingen:** beoordeel per les tekst, afbeeldingen,
   tabellen, video’s, bronmetadata en diagnoses. Alleen de exact gepinde
   display-only-verwijzingen kunnen per revisie expliciet als niet-klikbare
   tekst worden aanvaard; dat wordt als PUBLISH_DISPLAY_ONLY geaudit. Andere
   blokkades eerst oplossen. Publiceer alle 52 revisies via de bestaande
   knoppen. Controleer dat de collectie nog DRAFT/verborgen blijft. Geef daarna
   de complete collectie afzonderlijk inhoudelijk vrij; dit registreert
   RELEASE_COLLECTION maar zet de publieke schakelaar niet aan.
7. **Normaal testen en publiek besluit:** kies CFM in de gewone contentkiezer,
   open Leren en de 52 lessen als beheerder met publieke zichtbaarheid uit.
   Controleer beelden, tabellen, videoacties, actieve en inactieve verwijzingen
   en terugkeer naar de les. Een gewone gebruiker blijft geweigerd. Alleen na
   apart inhoudelijk besluit zet de eigenaar de bestaande schakelaar aan en
   controleert gewone reader/API/kiezer. Uitzetten moet nieuwe verzoeken direct
   weigeren. Reeds door een gebruiker ontvangen tekst kan niet worden
   teruggehaald; servercache mag geen nieuwe onbevoegde respons leveren.

### Rollback: applicatie is niet de database

Bij een functionele fout: onderhoudsmodus aan, foutstatus vastleggen zonder
geheimen en de vooraf vastgelegde oude image via Portainer terugzetten, met
dezelfde mounts/configuratie. Geen `latest` of blind vertrouwen op de losse
rollbackknop: de huidige agent bewaart na een geslaagde healthcheck juist de
nieuwe image als last-good. Automatische rollback tijdens een mislukte deploy
gebruikt wel het voorafgaande image-ID. Dit bestaande agentgedrag is niet in
deze content-PR aangepast.

De additief verruimde constraint kan bij applicatierollback blijven staan;
bestaande code en oude auditrijen blijven geldig. Nieuwe auditacties mogen
niet met een vernauwende downmigratie worden verwijderd of ongeldig gemaakt.
De oude app mist de nieuwe beheerhandelingen en kan verborgen bronnen weer
beperkter tonen. Reeds gemaakte publicatiepointers en zichtbaarheidskeuzes
blijven databasegegevens; een imagewissel draait die niet terug.

Faalt de migratie, dan is dit ene ALTER-statement atomisch, maar een mislukte
Prisma-registratie kan verdere starts blokkeren. De bestaande automatische
herstelhelper staat deze nieuwe migratie niet op zijn whitelist toe. Stop en
laat de registratie/constraint afzonderlijk beoordelen; voer niet blind
`migrate resolve` uit. De site blijft zo nodig in onderhoud.

Databaseherstel is een afzonderlijke, expliciet goed te keuren noodhandeling
met een gecontroleerd backupmoment en afgestemde mediaversie. Het kan nieuwere
gebruikersmutaties verliezen en is geen normale applicatierollback. Geen
databasevolume vervangen of wissen, geen seed/herimport, geen historische
revisies, media of auditrijen verwijderen.

### Aanvullend lokaal bewijs op de geïntegreerde branch

- Schone productiebuild, TypeScript, Prisma validate/generate en i18n: geslaagd.
- CFM bron/review/goedkeuring: 11 geslaagd; contenttoegang/inventarisatie: 40;
  kiezer/contentwissel/Focus-shell: 45. Geen skips in deze drie suites.
- Lofzangen inclusief de nieuwe zondagkaart uit #124: 171 geslaagd, geen fouten;
  twee optionele echte-audiotests overgeslagen omdat de lokale opname van
  lofzang 82 niet beschikbaar is. De overige herkenningsregressies zijn wel
  uitgevoerd.
- ESLint: 0 fouten, 157 waarschuwingen in de gecombineerde codebasis; de vorige
  head had 155. De aanvullende bestaande waarschuwingen komen uit de met main
  geïntegreerde Lofzangen-browsercontroles. De vijf gewijzigde auditbestanden
  introduceren geen nieuwe lintwaarschuwingen.
- De nieuwe constraint- en intrekkingsraceproeven slagen samen met de volledige
  CFM-importintegratie: 52 echte lespublicaties, dubbele vrijgave precies één
  wijziging, 21 persoonlijke/economietabellen behouden en DRAFT-reader geweigerd.
  De bewust uitgelokte `42710` en `SYNTHETIC_LEGACY_BOUNDARY` zijn verwachte
  foutinjecties; de pg-client-deprecatiewaarschuwing is geen testfout.

Alle 22 browsergevallen zijn lokaal geslaagd tegen de nieuwe schone
productiebuild: 320px/200% licht, 390px donker en 1280px desktop, inclusief
publiek aan/uit, beelden, tabellen, resolver en Meer lezen/Terug naar les.
De browserproef publiceert daarnaast alle 52 bestaande concepten via echte
beheerknoppen en geeft daarna via de UI de collectie vrij. De test begrenst de
assertie tot de 52 CFM-identiteiten: andere synthetische studiecollecties mogen
naast CFM blijven bestaan. De bestaande limiet van 30 beheeracties per minuut
blijft actief. Eindresultaten, screenshots en alle definitieve CI-checks worden
bij de exacte gepushte PR-head vastgelegd. Er is niet op fysieke iOS-/Android-
toestellen getest. De private branch-protectionconfiguratie is met deze GitHub-
integratie niet uitleesbaar (403); de volledige zichtbare PR-checklijst wordt
wel gecontroleerd.

## Studielespublicaties: één programmakaart en gezamenlijke publicatie

`/adminbackend/content/study-publications` is herbouwd voor een niet-technische
beheerder. Er is geen nieuw publicatiemodel, geen tabel en geen migratie: de pagina
is een leesbare laag over dezelfde import-, revisie- en auditgegevens, en lespublicatie
blijft uitsluitend `publishStudyRevision`.

### Wat de beheerder ziet

Per studieprogramma één kaart (naam, bron/uitgave, taal; verwachte, geïmporteerde en
gepubliceerde lessen; klaar-om-te-publiceren; afbeeldingen en verwijzingen; aantal
echte blokkerende fouten; aantal bekende, gecontroleerde niet-klikbare verwijzingen;
één volgende stap in gewone taal). De vier stappen zijn bewust gescheiden:
1. **Controleren** (`Programma controleren`, op verzoek; geen polling);
2. **Lessen publiceren** (alleen na het controleverslag en een uitdrukkelijke bevestiging);
3. **Vrijgeven** (de bestaande `release-collection`, ongewijzigd);
4. **Zichtbaarheid voor gebruikers** (blijft de bestaande schakelaar onder Beheer → Content;
   deze pagina zet haar nooit aan of uit).

De lessenlijst is compact, met zoekveld en statusfilter (klaar, geblokkeerd,
gepubliceerd, ontbreekt). De volledige lespreview opent op verzoek. Importgeschiedenis,
revisiegeschiedenis en de synthetische testimport staan onder **Technische details**
(ingeklapt); op het hoofdscherm staan geen hashes, ruwe tijdstempels of diagnostiek.
De synthetische fixtures zijn uitsluitend zichtbaar in een testprofiel
(`studyReleaseAllowed("synthetic-v1")`); in productie verdwijnt de bediening, de
testmogelijkheid zelf blijft bestaan.

### Controleverslag

`GET /api/admin/study-publications?collectionId=…&review=1` geeft de voorcontrole
(`studyProgramReview`, `src/lib/studyContent/programReview.ts`); het verslag is te
downloaden als Markdown of JSON (`/api/admin/study-publications/report`, alleen
beheerders, `no-store`, `Content-Disposition: attachment`). Het bevat alle lessen met
identiteit en titel, bronversie en volledigheid, media- en alttekstcontrole,
verwijzingsstatussen, alle uitzonderingen en blokkerende fouten, en de concrete bron-,
import- en revisie-identiteiten. Het bevat geen gebruikersgegevens, tokens of geheimen,
en is expliciet gemarkeerd als `NOT_REVIEWED`: een controle is geen beoordeling, er is
niets door een mens of AI goedgekeurd totdat de beheerder dat bevestigt.
Verslag, kaart en publicatie-preflight gebruiken dezelfde functie, zodat ze niet uiteen
kunnen lopen.

### Gezamenlijke, hervatbare publicatie (`publish-program`)

`publishStudyProgram` (`src/lib/studyContent/programPublication.ts`) publiceert de
beoordeelde set. Aanvraag: `collectionId`, `reviewToken`, `batchId`, `confirmReviewed: true`.

- **Eén poort per les.** Elke les gaat door `publishStudyRevision` met volledige bron-,
  media-, rechten- en referentievalidatie, versiecontrole en audit. De 553 bekende
  weergave-only verwijzingen worden alleen geaccepteerd als ze exact overeenkomen met de
  vastgelegde lijst (`cfmDisplayOnlyKeys`); nieuwe, onbekende of gewijzigde onveilige
  verwijzingen blokkeren de hele set vóór de eerste publicatie.
- **De server herberekent de beoordeelde set.** `reviewToken` is de identiteit van alle
  edities, revisies, inhoudshashes en importruns plus de hash van de controlelijsten
  (zonder status, dus stabiel tijdens een hervatting). Een afwijkend token geeft `CONFLICT`;
  een gewone gebruiker `FORBIDDEN`.
- **Idempotent en hervatbaar zonder batchtabel.** De `actionId` per les is afgeleid van
  batch + leseditie + revisie; een reeds gepubliceerde les wordt overgeslagen. Hervatten is
  dezelfde aanvraag opnieuw. Eén verzoek werkt binnen een tijdsbudget (12 s na de
  voorcontrole); de pagina herhaalt dezelfde aanvraag tot `done` of een fout.
- **Gelijktijdigheid.** Een advisory lock per programma: een tweede batch krijgt `BUSY`.
  Daarnaast gelden per les de bestaande locks (importscope → run → edition) en
  `expectedVersion`.
- **Gedeeltelijk mislukken.** Een les die faalt (bijvoorbeeld een gelijktijdig gewijzigd
  concept) komt met titel en reden in `failed`; de overige lessen worden wel gepubliceerd.
  Zolang niet alle edities gepubliceerd zijn, weigert `releaseStudyCollection` met
  `INCOMPLETE`: een onvolledige subset wordt nooit vrijgegeven of zichtbaar.
- **Behoud.** Geen tweede import, geen duplicaten, bestaande publicaties, revisies,
  auditregels en gebruikersvoortgang blijven bytegelijk; publiceren raakt `visibleToUsers`
  en `publicationState` niet.

### Testbewijs

`tests/cfm-2026-import.integration.test.mjs` (`bulkPublicationScenarios`, isolated
PostgreSQL, volledige 52-lessenset): voorcontrole (52/52/0/52, 553 bekende verwijzingen,
0 blokkerend), verslag met alle 52 titels zonder geheimen of beoordelingsclaim, HTTP-rechten
(anoniem 401, gebruiker 403), verborgen fixtures in een productieprofiel, onveilige
aanvragen zonder effect, een gewijzigd verwijzingsdoel dat de hele set blokkeert, een
tijdsbudgetstap, een onderbreking midden in de batch (51 gepubliceerd, 1 mislukt, vrijgave
geweigerd, niets zichtbaar), hervatten, twee gelijktijdige hervattingen (één voert uit,
de ander `BUSY`), identieke herhaling als no-op, exact één auditregel per les, de
beoordeelde revisies als gepubliceerde revisies, ongewijzigde persoonlijke tabellen.
`tests/cfm-2026-import.browser.mjs` en `tests/study-publication.browser.mjs` dekken de
pagina op 320 px/200 % tekst, 390 px donker en 1280 px (toetsenbord, toegankelijke
namen, bevestigingsdialoog, geen overflow, geen hash op het hoofdscherm).

Screenshots van de nieuwe pagina (isolated test, 52 CFM-lessen, geen productiegegevens)
staan in `docs/evidence/study-program-publication/`: programmakaart na controle
(1280 px, 390 px donker, 320 px met 200 % tekst), de bevestiging van de gezamenlijke
publicatie, het eindresultaat met de aparte vrijgavestap, en de overzichten in
Nederlands en Duits bij 200 % tekst.

Beperkingen: er is niet op fysieke iOS-/Android-toestellen getest, en niet op productie
(geen productie-import, -publicatie, zichtbaarheidsschakeling of NAS-handeling). De
voorcontrole van 52 lessen duurt in de isolated testomgeving circa 10 seconden.
