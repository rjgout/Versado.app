# Native CFM — B3a-2: weekpad en archief

Basis: `develop` na #249, `896c2a4d8288e1c050eaac3a1dadab18a3bcd99c`.
Roadmap: #238. Dit is ontwikkelimplementatie, geen onafhankelijke acceptatie of
releasevrijgave. Geen migratie, seed of import nodig voor deze wijziging.

## Eén presentatie, bestaande domeinregels

Web en de lokale Capacitor-bundel gebruiken dezelfde `CfmCourseView`,
`CfmWeekPath`, `CfmArchiveView`, `WeekStepCards` en `MyStepNav`.
`WebCfmCourseView` en `WebWeekSteps` behouden de bestaande lazy webquery,
leesmodusvoorkeur en contextmutatie. `NativeCfmCourseView` levert alleen data
via de bestaande navigatie-, afbeelding- en LiveDataStore-poorten.
De zuivere stapconstanten staan los van de serverplanner: geen `node:crypto`,
Next-compatibiliteitsshim of servercode in de lokale bundel.

De bestaande services `getStudyCatalogue`, `getStudyCourseSummary` (via het
cursusoverzicht), `resolveWeekSelection`, `groupArchiveByYear` en
`modeOfStudyCourse` blijven leidend. Kalenderweek gaat vóór een expliciet
gekozen week, daarna werkelijk bestudeerde week, anders een neutraal overzicht.
Uitklappen is in native lokaal; het schrijft geen studiecontext of activiteit.
Een geselecteerde week wordt niet als bestudeerd gemarkeerd. Tijdzone en daggrens
komen uit de bestaande gebruikershelpers. Archiveren blijft een projectie vanaf
één kalendermaand na het einde van de les, met de bestaande maandafkapping.
De begrenzing van 600 cataloguslessen blijft behouden en wordt expliciet gemeld.

## Kleine read-only contracten

Capability `study-course-overview-v1`, DTO-versie 1:

| Methode/pad onder `/api/v1/native` | Gegevens |
| --- | --- |
| `GET courses/<courseId>/weeks` | Cursusmodus, huidige weken, echte hervatreden, tijdzone/dag, archiefteller |
| `GET courses/<courseId>/archive` | Bestaande gepubliceerde weken per officiële jaargang/werk |
| `GET courses/<courseId>/weeks/<editionId>/steps` | Exact zes bestaande stappen, fingerprints en huidige status bij de publicatierevisie |

TypeScript, Swift en Java staan uitsluitend deze GET-patronen met gevalideerde
ID's toe; geen querystrings, schrijfroute of algemene proxy. Alle bestaande
Bearer-/Service Auth-, Access-, 2FA- en sessiecontroles blijven gelden.
De server controleert cursusmethode, gekozen bron, programmaverband,
collectietoegang, publicatie en retired-status vóór aggregatie. Na aggregatie
worden cursusrechten, alle geretourneerde publicatierevisies en sessie/context
opnieuw gecontroleerd. Een veranderde context/revisie wordt geweigerd.
De DTO bevat geen lesbody, e-mail of authenticatiegegevens.

De B3a-1-contracten blijven intact. Een backend zonder de nieuwe capability
biedt geen native CFM-pad; directe routes krijgen de bestaande veilige melding.
Er is geen stilzwijgende terugval naar een eerste schriftelijk hoofdstuk.

## Legacyvoortgang zonder writes

`getStepProgressForEdition` en `getStepProgress` hebben een expliciete
`readOnly`-optie. `coverLegacyProgress` berekent dezelfde bestaande dekking
voor de oude zevenstappenindeling en eerdere 2027-indeling. Alleen de bestaande
standaardroute materialiseert deze met `createMany(skipDuplicates: true)`.
In read-only modus worden virtuele rijen samengevoegd met bestaande rijen;
bestaande fingerprints winnen, ook bij een reeds opgeslagen IN_PROGRESS-status.
Tijdstempels, fingerprints, status- en dekkingregels zijn dezelfde.

De native catalogus gebruikt dezelfde projectie voor weektellers als er oudere
staprijen bestaan; alleen die edities vragen extra planberekening. Er is geen
nieuwe voortgangstabel of statusalgoritme. Web houdt standaard zijn bestaande
materialisatiegedrag. Native GET schrijft geen stapstatus, context, cursuspositie,
READ, XP, reeks, beloning of leespositie.

Het integratiebewijs voert de kernprojectie werkelijk uit in een PostgreSQL-
transactie met `SET TRANSACTION READ ONLY`, vergelijkt de uitkomst met de
bestaande materialisatie en vergelijkt database-snapshots rond herhaalde native
GET-verzoeken. Alle fixtures zijn synthetisch in een eigen wegwerpdatabase.

## Cache, media, fouten en navigatie

Alle data gebruikt de bestaande LiveDataStore en sessie-epoch. Identiteiten
bevatten account, taal, bron/selectieversie, cursus, current/archive; stapplannen
ook editie en publicatierevisie. Late antwoorden na account-/bronwisseling en
plannen met een afwijkende revisie worden verworpen. Geen tweede cache of
schrijfqueue. Hervatten/onlineherstel gebruikt bestaande invalidatie; actieve
queries verversen begrensd per minuut en op de lokale daggrens, geen extra socket.

Tijdelijke fouten behouden bevestigde kaarten, open weekgroepen en focus.
Initieel mislukte cursusmetadata en stapplannen hebben een handmatige retry.
Autorisatie-/contextfouten worden niet als oude bruikbare data gepresenteerd.
Afbeeldingen gebruiken de bestaande beveiligde media-ID-/WebP-bridge en
account-/brongebonden caching; publieke assets blijven lokaal.
`/courses/<id>/pad` en `/courses/<id>/archief` werken lokaal, inclusief terug-
navigatie en focus-/scrollregels. De gedeelde container past binnen 320px en
vergrootte tekst; interactieve focus en selecteerbare tekst blijven behouden.

## Grenzen

De zes stappen en vrije-studiekaarten zijn zichtbaar; openen van een echte
studieles toont de bestaande veilige melding. StudyReader, annotaties,
leesposities, vragen, afronding en beloningen volgen in B3b–B3d.
Geen CFM-inhoud, imports, publicaties of bestaande gebruikersgegevens gewijzigd.
Geen NAS-/Portainer-/Cloudflare-handeling of deployment uitgevoerd.

## Verificatie

De nieuwe unitproeven controleren DTO's, exacte drie-platform-allowlists en
late antwoorden bij account-/bron-/revisiewijziging. De SQL-proeven controleren
legacyprojectie, bestaande-rijvoorrang, kalender/gekozen/bestudeerde week,
tijdzones, archief, zes stappen, herhaalde GET-snapshots en werkelijke lockraces
met logout, verloop, bronwijziging, cursusintrekking en publicatiewijziging.
De browserproef gebruikt echte Next-SSR en dezelfde lokale React-componenten:
vijf talen, 320px/200%, licht/donker, tabletoriëntaties, uitklappen, archief,
vrije studie, ontbrekende capability, tijdelijke fouten/focus en accountwisseling.
Screenshots komen als Actions-artifact onder `study-courses`.
De uiteindelijke PR beschrijft de werkelijk uitgevoerde controles en CI-status;
compileer-/browserbewijs is geen fysieke toestelacceptatie.

### Uitgevoerde lokale controles

- TypeScript schoon; lint: nul fouten, 171 bestaande waarschuwingen. Bij de
  lokale brede lint zijn uitsluitend twee oude gegenereerde B3a-1-bundelmappen
  extra uitgesloten; CI lint de schone checkout zonder deze lokale artifacts.
- Schone Next-productiebuild, lokale native bundel, Capacitor-sync voor beide
  platformen en verpakte distributiecontrole voor iOS én Android geslaagd.
- 107 native unit-/contracttests, 80 gedeelde datalaagtests, 101 CFM-tests en
  vier bestaande beveiligingstests geslaagd, zonder skips.
- 74 SQL-integratietests plus 64 twee-proces-/Redis-/sessie-/beloningsproeven
  geslaagd (138 totaal), inclusief de vijf nieuwe CFM-tests, zonder skips.
  De definitieve SQL-herhaling gebruikt de bestaande `--no-browser`-optie;
  de elf browsersuites waren al afzonderlijk groen op dezelfde implementatie.
- Alle elf bestaande/nieuwe browsersuites uitgevoerd: authenticatie/Access,
  datalaag, shell, contentkiezer, Apple-UI, Vandaag, acties, media, schriftelijke
  cursusmethoden en CFM. Nieuwe CFM-proef: 44 vergelijkingsbeelden.
- Routefocus: 27 combinaties/fallbacks/flows plus mobiele CSS-controle groen.
  Bestaande CFM-overlayproef groen (geometrie, keyboard, afbeeldingfouten en
  ongewijzigde Vrije studie; lokaal bronles-43-beeld uit bestaande cache,
  geen importer-/pincontrole of wijziging aan #237).
- Native broninventaris, actionlint en diffcontrole geslaagd.

De eerste gecombineerde run onthulde fixturelekkage naar latere media- en
bronselectieproeven. De nieuwe fixture sluit haar eigen broncollectie af,
retireert uitsluitend haar synthetische lessen en herstelt eerdere
cursusbeschikbaarheid. Bestaande assertions en autorisatie blijven intact.
Een parallelle lokale SQL-herhaling is wegens schijfruimte afgebroken; de
hercontrole draait sequentieel. Deze pogingen tellen niet als geslaagde tests.
De twee-procesresultaten en de definitieve iOS-/Android-CI staan bij de PR.
Geen lokale Xcode-/Android-SDK-compilatie of fysieke acceptatie geclaimd.

## PENDING PHYSICAL ACCEPTANCE — iPhone én Android

Na onafhankelijke review en afzonderlijke mergegoedkeuring: bestaande
`develop → Mac → Capacitor-sync → Xcode → iPhone`-route gebruiken. De backend
moet dezelfde capability ondersteunen; geen automatische uitrol toegestaan.
De eigenaar bevestigde alleen de eerdere B3a-1-schriftpaden op iPhone.

| Handeling | Verwacht | Foutverschijnsel |
| --- | --- | --- |
| Inloggen/2FA, sluiten en heropenen | Zelfde eigen account, CFM-kaarten in Leren | Verkeerd account, verloren sessie |
| Beide CFM-cursussen openen | Webgelijke weken, juiste modus en kalenderweek | Verkeerde week, andere bron, lege route |
| Andere week uit-/inklappen | Zes stappen in Stap voor stap, juiste beelden | Afgesneden kaarten, onjuiste status |
| Archief openen en teruggaan | Juiste jaargang/volgorde, logische terugroute | Ontbrekende toegestane lessen, scrollsprong |
| Tijdelijk offline, dan opnieuw proberen | Geladen groepen blijven; herstel zonder voortgangswrites | Verlies van inhoud, dubbel verzoek, vast scherm |
| Bron/account wisselen tijdens laden | Alleen nieuwe eigen bron/accountgegevens | Oude titels/beelden blijven zichtbaar |
| Stap of vrije-studieles aantikken | Veilige melding dat de lezer nog niet beschikbaar is | Lege lezer, onbedoelde afronding/XP |
| Grote tekst, donker, VoiceOver/TalkBack en systeemterug | Leesbaar, bruikbare focus/safe areas, correcte terugroute | Horizontale overflow, onbereikbare knoppen |

Noteer per test PASS/FAIL/NOT TESTED/BLOCKED met buildcommit, backend,
reproductiestappen en eventueel screenshot. iPhone-acceptatie accepteert Android
niet automatisch. Onafhankelijke review en fysieke CFM-acceptatie blijven open.

Vier vaste vergelijkingsbeelden (synthetische lesinhoud en afbeelding; echte
web-/native componenten, geen fysieke toestellen):
[weekpad web](native-cfm-evidence/weekpad-web.png),
[weekpad native](native-cfm-evidence/weekpad-native.png),
[archief web](native-cfm-evidence/archief-web.png),
[archief native](native-cfm-evidence/archief-native.png).
