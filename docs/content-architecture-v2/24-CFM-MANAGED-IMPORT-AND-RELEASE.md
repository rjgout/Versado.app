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

1. Laat #123 en deze concept-PR beoordelen en bepaal expliciet merge/uitrolvolgorde.
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
