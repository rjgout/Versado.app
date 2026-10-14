# 04 — Gefaseerde implementatieroadmap

Alle werkpakketten hieronder zijn **toekomstig werk na goedkeuring**.
Fase 0 levert uitsluitend documentatie. Geen fase wordt automatisch gestart.
Volgorde: toegang/context → lezen/publicatie → echte programma's → annotaties
→ lesgebonden spellen. Migraties: [03](03-MIGRATION-STRATEGY.md).

## Algemene werkwijze per PR

- Start vanaf actuele main; scope en auditbevindingen herbevestigen.
- Bescherm ongerelateerde wijzigingen; één concrete verantwoordelijkheid per PR.
- Lever migratie/backfill, veilige rollback, tests, vertalingen nl/en/de/fr/es
  en relevante Kompas-uitleg samen met gebruikerszichtbare functionaliteit.
- TypeScript na samenhangende codewijziging, lint, i18n, Prisma-validatie,
  schone productiebuild; exact gepushte commit moet groene Actions hebben.
- Database-integratie in een wegwerpdatabase met benodigde migraties/fixtures;
  geen gedeelde testdatabase of productie als gemakspad.
- Shell/FocusLayout/live-data/eager-importregels behouden. Nieuwe broncontext
  nooit alleen aan een CSS-state of lokale cache ontlenen.
- Browserbewijs van werkelijk gerenderde UI, inclusief 320 px, 200% tekst,
  lange vertaling, light/dark, touch/keyboard en native-limieten.
- Een fase is pas klaar na functionele scenario's en eigenaarbeoordeling,
  niet uitsluitend een groene build. Geen automatische merge.

## Fase 1 — Contentfundament en fullscreen kiezer

### Doel en concrete scope

Vaststellen wat een bron is, wie deze mag gebruiken en hoe één samenhangende
context in de app wordt gekozen. De dropdown vervangen door een echte route
met één tik, geïntegreerde taal en de bestaande terugbalk. Studiecontext
persistent klaarzetten zonder een CFM-import of nieuwe lezer te bouwen.

### Kleine PR's

| PR | Werkpakket | Reviewbaar resultaat |
|---|---|---|
| 1A | ContentWork, legacypublicatiebeleid en centrale toegang | Collecties/edities expliciet; servergate voor aanbod, deeplinks en relevante API's |
| 1B | Contextcontract, UserStudyContext, version/actions, centrale routewissel | Oude gebruikers blijven werken; keuze per programma kan veilig blijven staan |
| 1C | Fullscreen `/content`, headeringang, taalkeuze, passende bestemming | Directe wissel zonder bevestiging, correct bij ontbrekend route-equivalent |
| 1D | Regressiebewijs en minimale spelavailability-check | Geen spelstart die buiten ondersteunde bron/pool valt; geen nieuwe speladapter |

### Bestaande bestanden

`prisma/schema.prisma`, `contentCollections.ts`, `contentEdition.ts`,
`contentRouting.ts`, `contentSwitch.ts`, `contentMetadata.ts`,
`ContentSwitcher.tsx`, `/api/content-context`, `/api/admin/content-switcher`,
`app/layout.tsx`, `LiveDataProvider.tsx`, `data/hooks.ts`, `data/scopes.ts`,
`navigation.ts`, `focusMode.ts`, `SubpageBackBar.tsx`, `today.ts`,
`gameCatalog.ts`, `/api/admin/game-scopes`, relevante content-/spel-API-guards.

Nieuwe onderdelen: kleine availability-/contextservice en FullscreenContentPicker.
Hergebruik ContentIcon, PageIntro, button/surface-tokens en ShellMetrics.
Geen nieuwe shellcomponent. Metadataregister blijft plek voor iconen.

### Data, migraties en afhankelijkheden

M1 uit document 03. ContentWork/publicatiecompatibiliteit en UserStudyContext
met nullable legacy-leskey; FK naar de echte les pas in fase 2. Geen andere
tabellen aanpassen alleen om toekomstige features klaar te leggen.
Vooraf: fase-0-goedkeuring en alleen-lezen inventaris. Voor de hervatting van
1A vervangt de expliciete risicoacceptatie D5 de aanvullende herstelproef;
geïsoleerde migratie-/databehoudtests en afzonderlijke uitroltoestemming blijven vereist. De vier
aanvullende productbesluiten D1–D4 in document 06 zijn vastgesteld en geen
open afhankelijkheid. Betrouwbare verwijzingsedities/mappings worden bij
fase 2D en latere lespublicatie gevalideerd; ze blokkeren fase 1A niet.

### Acceptatiecriteria

- Alleen beschikbare/toegankelijke/gepubliceerde bronnen voor gewone users;
  adminconcept via expliciete preview. Hidden/disabled ook via API/deeplink afwijzen.
- Twee groepen, actieve bron herkenbaar, één tik wisselt direct; taal blijft
  afzonderlijk van uiLanguage. Geen stilzwijgende wissel van editie-familie.
- Podcasts staan herkenbaar als aparte rij onder de visuele groep
  Studieprogramma’s; technisch OTHER, zonder wekelijkse leslogica en met
  behoud van bestaande podcastfunctionaliteit en voortgang.
- De voorafgaande route wordt equivalent geremapt; ontbrekend equivalent
  opent een bruikbaar onderdeel van de gekozen bron, zonder lege cursuskaart.
- Terug vanuit kiezer zonder selectie wijzigt niets. Reopen/focus/ander apparaat
  halen servercontext op; trage requests of dubbele tikken vervuilen die niet.
- Bestaande users zonder lescontext blijven probleemloos lezen/spelen.
  Lescontext van programma A wordt niet door B of weekwissel gewijzigd.
- Headerlagen, scrollrestore, safe areas, bottomnav en focusflows blijven intact.
- Adminscope en direct-start-API zijn coherent; geen 'scope aan = pool bestaat'.

### Regressietests en risico's

Breid content-switch/edition tests en geïsoleerde integratietests uit met
verborgen/null/lege catalogus, verschillende families in dezelfde taal,
stale context, key resets en directe route/API-toegang. Browser: kiezer vanaf
Vandaag, Leren en Spelen; terug/vooruit en 200% tekst.

Grootste risico's: bronfallback, collecties onbedoeld verbergen, losse
contextversies en oude clients. Publicatiecompatibiliteit voorkomt dat alle
oude bronnen automatisch concept worden. Buiten scope: volledige CFM/FSY-
contentimport, nieuwe reader, annotaties, nieuwe spellen.

## Fase 2 — Gedeelde studie- en leesengine

### Doel en concrete scope

Eén semantische doorlopende reader met revisies, secties, media, verwijzingen,
automatische positie en afzonderlijk expliciet gelezen. Bouw import-/review-
publicatiebasis met beperkte, gecontroleerde fixtures; nog geen volledige
CFM-kalender-import. Bestaande Schrifturen-reader blijft staan.

### Kleine PR's

| PR | Werkpakket | Reviewbaar resultaat |
|---|---|---|
| 2A | StudyPeriod/Lesson/Edition/Revision + rich schema | Stabiele identiteit, Zod-validator, readonly published DTO en immutable revisie |
| 2B | ContentImportRun, media en concept/adminpreview | Hervatbare import naar concept, secure media, diff en atomische publish/rollback |
| 2C | StudyReader, secties en ReadingPosition | Doorlopend lezen, stabiele ankers, bewaren/hervatten/naar boven zonder afronding |
| 2D | Reference resolver, gevalideerde verwijzingsedities en veilige preview/Meer lezen | Intern alleen bij bewezen canonieke én editie-equivalentie; anders officiële externe bron of melding; bewuste bronwissel en gebonden Terug naar les |
| 2E | ContentProgress-studieadapter en expliciete afronding | READ + eenmalige centrale activity in één transactie, geen XP |

Werkpakket 2D is gemerged via PR #102; bronbewijs, grenzen, tests en het apart goedgekeurde bronselectiecounter-schema staan in [16-PHASE-2D-REFERENCE-PREVIEW.md](16-PHASE-2D-REFERENCE-PREVIEW.md). Werkpakket 2E is geïmplementeerd op zijn afzonderlijke werkbranch; het READ-contract, testbewijs en uitrolgrenzen staan in [17-PHASE-2E-EXPLICIT-READ.md](17-PHASE-2E-EXPLICIT-READ.md). Review en productie-uitrol blijven afzonderlijk. Officiële contentvrijgave is niet afgerond.


### Bestaande bestanden en componenten

`LessonFlow.tsx`/ReaderView en `ReadingLessonFlow.tsx` als gedragsreferentie;
`learning/contentIdentity.ts`, `contentProgress.ts`, `progressState.ts`,
`streak.ts`, `learning/streakRules.ts`, `ChapterPopup.tsx`,
`PuzzleHintPanel.tsx`/`WordGameHintPanel.tsx` als modalpatroon,
`navigationHistory.ts`, `backTarget.ts`, `NavigationScroll.tsx`,
`audioMirror.ts`, `artwork.ts`/MediaArtwork, adminGuard/adminstyles,
`reseedJob.ts`/importPhase als beperkte taakrunnerpatronen, OTB-validatie.

Nieuw: StudyReader, RichContentBlocks, PositionController, ReferencePreview,
rich-schema/source-adapters, revisie-/media-/importservices. Alleen benodigde
bloktypen uit echte fixtures. Gedeelde snippets krijgen vs-tokens; geen
nieuwe permanente toolbar of bronfooter zonder concrete voorwaarde.

### Data, migraties en afhankelijkheden

M2: lesfamilie, position, references/media/importlogs en nullable progressvelden.
UserStudyContext-FK wordt gekoppeld zodra een gemigreerde les bestaat.
Alleen publicatiepointer/teller zijn wijzigbaar; inhoudsrevisies zijn onveranderlijk.
Afhankelijk: fase 1, echte bron-/licentie-/kalendermonsters voor adapters,
media-volume/backup en goedgekeurde blokkenschema's. Geen productie-seed
om fixtures te verkrijgen; in testomgeving fixtures laden.

Specifiek vóór fase 2D: kies en valideer de concrete betrouwbare
verwijzingsedities/mappings met bronbewijs en fixtures voor canon, nummering
en teksteditie. Zonder bewezen equivalentie werkt uitsluitend een bekende
officiële externe fallback of nette melding. Dezelfde referentievalidatie
is verplicht vóór latere lespublicatie; dit is geen gate voor fase 1A.
Bewaarbeleid D4 geldt vanaf de importbasis: geen automatische garbage
collection of destructieve contractmigratie zonder afzonderlijk goedgekeurd beleid.

### Acceptatiecriteria

- Heading/alinea/list/quote/question/assignment/figure/reference behouden de
  volledige semantiek; onbekende betekenisvolle broninhoud faalt de import.
- Concepten niet publiek; eerdere publicatie blijft staan bij importfout/
  nieuwe draft; rollback kiest exact oude body/media/references.
- Geen deelpublicatie van een onvolledige les. Media mist niet door appdeploy.
- Hervatten werkt na reload, scherm-/tekstwijziging, app-resume en veilige
  update. Restart naar boven reset geen gelezenstatus of beloningshistorie.
- 100% scroll wordt nooit automatisch READ. Expliciet lezen telt eenmalig,
  geen XP; concurrente retries en nieuwe revisies geven geen dubbele activiteit.
- Preview wijzigt geen selectie/positie/reeks. Meer lezen en Terug naar les
  herstellen de oorspronkelijke context; zelfstandig verder lezen wisselt
  de bron niet automatisch terug.
- Interne previews hebben bewezen canonieke én editie-equivalentie; bij
  ontbrekende mapping een bekende officiële externe bron of nette melding.
  Geen stilzwijgende substitutie van vertalingen. Voor publicatie zijn alle
  verwijzingsuitkomsten gevalideerd en ontbrekende doelen inzichtelijk.
- Nieuwe providerkeys bevatten echte les/editie/revisie; autosave remount niet.

### Regressietests en risico's

Unit rich-schema/ankers/resolver + DB-publicatietransacties met foutinjectie +
browser lange les met late images, 320px/200%, soft keyboard, dialogfocus,
back/forward en concurrent positieopslag. Bestaande learning/streak/XP-tests.

Risico's: ankerverlies, scopelek in preview, gedeeltelijke bestanden/DB-commit,
scrollmanager-conflict en complexe reader. Buiten scope: alle Schrifturen
herschrijven, volledige CFM-/FSY-import, passageannotatie-UI, nieuwe cursussen/
spellen, video-ecosysteem zonder concrete bron.

## Fase 3 — Kom dan en volg Mij 2026 en FSY

### Doel en concrete scope

De volledige, gecontroleerde **Nederlandse CFM 2026-content — Oude Testament**
en FSY op dezelfde engine publiceren. CFM heeft
officiële leskalender en eerdere/toekomstige lessen; FSY behoudt echte maand,
categorie en meerdere lessen. Volledige tekst en betekenisvolle media, geen
metadata-only of automatisch gegenereerde quiz.
Het model blijft meertalig en de vijf bestaande UI-talen blijven behouden;
andere contenttalen verschijnen pas bij daadwerkelijk beschikbare en
gepubliceerde inhoud. De eerste CFM-contenttaal is geen open productkeuze.

### Kleine PR's

| PR | Werkpakket | Reviewbaar resultaat |
|---|---|---|
| 3A | Bronvoorbereiding en volledig Nederlands CFM 2026-manifest | Echte ids/kalender/rechten/verwijzingen en volledigheidscontroles gecontroleerd |
| 3B | CFM 2026-adapter, volledige Nederlandse conceptimport en leskeuze | Alle manifestlessen traceerbaar; gecontroleerde teksten/media doorlopend leesbaar |
| 3C | FSY-conversie en nieuwe adapter, writerhandover | Oude publicaties/drafts/ids/cursuslinks behouden; één schrijver |
| 3D | Programma-aanbod in Vandaag/Leren/Spelen en admin | Gedeelde actieve les, expliciete huidige-weekactie, correct beschikbare kaarten |

Status 3A: bronmanifest en structurele validatie zijn voorbereid, maar de
officiële gebruiksvoorwaarden vereisen nog een expliciete schriftelijke
rechtenbeslissing voor opslag/herpublicatie. Fase 3A is dus niet automatisch
afgerond en geeft geen toestemming voor import of publicatie.

### Bestaande bestanden en componenten

`fsyContent.ts`, FsyContentBlocks/CourseView/LessonView, AdminFsyClient,
`src/app/fsy/[lessonId]/page.tsx`, `/api/admin/fsy`, scheduler, seed,
courses/courseSummaries/courseResume, today/today-components,
contentSwitch/contentRouting, Kompasregister en relevante i18n-bestanden.

Nieuwe CFM-/FSY-bronadapters, ProgramLessonPicker en CalendarView met bestaande
tokens. CFM-kalendercomponent blijft programspecifiek; reader en context niet.
Oude FSY-UI later vervangen met de gedeelde componenten, geen parallelle reader.
Er komt geen lege Cursussenkaart wanneer alleen officiële leestekst bestaat.

### Data, migraties en afhankelijkheden

M3: werk/period/lessen/revisies/media op basis van echte bronmanifesten;
mapping via FsyLesson.studyLessonEditionId en retained snapshots. Geen
voortgangsbackfill op basis van cursusstart. Nieuwe CFM-perioden zijn eigen
identiteiten, geen overschrijving van 2026 bij 2027.
Afhankelijk: alle fase-2-gates; FSY-counts en gecontroleerde bestaande
publicatie-/draft hashes; bevestigde bronvoorwaarden. Uitrol alleen na
previewreview per bron/taal en volledigheidsrapport.
De concrete verwijzingsedities/mappings en fallbackuitkomsten moeten conform
fase 2D vóór publicatie gevalideerd zijn. Bestaande publicaties, relevante
revisies, snapshots, gerefereerde media en persoonlijke annotaties blijven
behouden; geslaagde migratie is geen toestemming voor destructieve contractstappen.

### Acceptatiecriteria

- CFM 2026 is selecteerbaar zodra toegankelijk en daadwerkelijk gepubliceerd;
  kalender toont de officiële perioden, inclusief afwijkende intervallen.
- De eerste uitrol bevat de volledige gecontroleerde Nederlandse CFM
  2026-content volgens het officiële manifest. De vijf bestaande UI-talen
  blijven werken; andere contenttalen zijn alleen zichtbaar bij werkelijk
  beschikbare en gepubliceerde inhoud.
- Les van drie weken geleden blijft actief in Vandaag/Leren/Spelen na nieuwe
  kalenderweek, logout/login en andere bron. Huidige-weekactie is expliciet.
- FSY-maand heeft zoveel lessen/categorieën als de echte bron; geen weekmodel.
- Onbeschikbare taal/les geeft uitleg, geen mix met andere jaar/bron/taal.
- Originele opdrachten/vragen en media zijn volledig; geen stille truncatie.
- Legacy-FSY-draft met oude publicatie behoudt beide versies; oude routes en
  abonnementen werken. Geen nieuwe READ/XP/reeks tijdens migratie.
- Spelen biedt slechts bestaande geschikte adapters; geen nieuwe spellen
  zichtbaar maken alleen omdat het programma content heeft.

### Regressietests en risico's

Manifest/payloadfixtures, volledige manifest-to-import-to-publication readback,
FSY-legacypariteit; **geen vast week-/lesaantal aannemen**: verwachte
aantallen komen uit het gecontroleerde manifest. Browserkeuze/hervatflow,
language-/yearchange, references naar beschikbare/onbeschikbare Schrifturen.
DB-test van schedulerlease/writerhandover, rollback en geen beloningbackfill.

Risico's: echte upstreamstructuur, ontbrekende beelden/links, kalendergrenzen,
oude FSY-autoPublish en verlies van gepubliceerde snapshots. Buiten scope:
nieuwe lesquizzen, volledige 2027-import zonder aparte goedkeuring, annotatie-
redesign, spelimplementaties en eigen kalendergokwerk.

## Fase 4 — Persoonlijke studie en Mijn studiemap

### Doel en concrete scope

Vers- en passageannotaties via één contextuele bediening; notities/markeringen/
bladwijzers in één doorzoekbare, accountbrede map onder Leren. Alle oude
gegevens blijven in dezelfde tabellen en op dezelfde ids.

### Kleine PR's

| PR | Werkpakket | Reviewbaar resultaat |
|---|---|---|
| 4A | Additieve annotatietargets en gedeelde service/API | Eigenaarschap, targetvalidatie, versie/idempotentie en compatibele legacyfilters |
| 4B | Contextmenu/sheet voor vers en passage | Geen drie permanente knoppen; touch/keyboard en betrouwbare selectors |
| 4C | Mijn studiemap, zoeken/filter/paginering/deeplinks | Alle bronnen, duidelijke labels, edit/delete, exacte teruglink |
| 4D | Update-/taal-/orphanherstel en legacyroutehandover | Geen automatische foute verplaatsing; volledige private pariteit |

### Bestaande bestanden en componenten

`LessonFlow.tsx`/ReaderView/NoteEditor, study reader, Bookmark/Highlight/Note,
verse bookmark/highlight/note API's, `/api/bookmarks`, BookmarksClient,
`/bookmarks`, routes/navigation/backTarget, data/scopes/mutation, i18n/Kompas.
Nieuwe AnnotationActions, veilige selectorhelper, StudyFolderClient en één
queryservice. Gebruik bestaande dialog/sheet- en button/surfacepatronen.

### Data, migraties en afhankelijkheden

M4: nullable verse/lestargets, CHECK/FK/indexen, mutationVersion en selector.
Geen vierde Annotation-tabel, geen bulkcopy of timestampreset. Een veilige
compatibele rollbackversie vóór de eerste lestarget-write is verplicht.
Afhankelijk: stabiele fase-2-ankers, fase-3-revisies met updatefixtures en
privacy-/backupbeleid. Een annotatie kan op ongepubliceerd materiaal alleen
in een expliciet privéadmin/testscenario, geen reguliere gebruikersfeature.

### Acceptatiecriteria

- Oude annotatiecount/id/user/verse/text/color/timestamps blijven gelijk.
- Nieuwe passageannotaties wijzen naar exact geselecteerde tekst; cross-user
  read/write, verborgen-contentreload en ongeldige selectors worden afgewezen.
- Notities privé; geen XP/reeks, geen realtime-payload met tekst.
- De map toont standaard alle bronnen; zoeken en filters veranderen geen
  actieve bron. Pagination heeft geen dubbel/ontbrekend item bij stabiele set.
- Edit/delete werkt idempotent, zonder stille optimistische fout of toggle-retry.
- Bronupdate bewaart oorspronkelijke quote en notitie; ambiguous mapping wordt
  zichtbaar, nooit naar een andere passage/taal geschoven.
- De passage kan via deeplink geopend worden, met logische terugkeer naar de map.
- Voor bestaande hoofdstukken blijven audio, lezen, oefeningen en beloningen werken.

### Regressietests en risico's

DB-controles op backward compatibility en null-verse rows, selector roundtrip,
private API's, multiuser/cross-device conflicts, exact/removed/ambiguous anchor,
taalwissel, lijstfilter/paginering; browser native selectie/longpress/contextmenu,
keyboardfocus, sheet safe areas en terugnavigatie.

Risico's: oude joins bij nullable verseId, tekstankerprivacy, highlightoverlap,
toestelverschillen in selectie en cascade-delete. Buiten scope: gedeelde
notities, sociale feed, XP, collaboratieve editors en automatisch vertalen.

## Fase 5 — Spelintegratie en Het Verborgen Woord

### Doel en concrete scope

Uniforme beschikbaarheid en werkelijke bron-/lesinhoud voor spellen. Daarna
Het Verborgen Woord ontwikkelen als afzonderlijke, goedgekeurde gameplayflow.
Geen aanpassing van huidige Woord van de Dag of puzzelregels als bijvangst.

### Kleine PR's

| PR | Werkpakket | Reviewbaar resultaat |
|---|---|---|
| 5A | Concrete GameContentResolver-adapters voor bestaande spellen | Catalogus/admin/UI/start/resume wijzen aantoonbaar naar dezelfde pool |
| 5B | Lesgebonden woordpool en frozen spelcontext | Taalspecifieke woordselectie uit echte gepubliceerde les, voldoende inhoud |
| 5C | Het Verborgen Woord: apart goedgekeurde regels + Solo | Server-authoritative letter/whole-word/foutenbudget en resultaatcontract |
| 5D | Accountsamen, klassikale host en presentatiescherm | Beurten en rolrechten, geen netwerk-gasten, public view zonder antwoord |

### Bestaande bestanden en componenten

gameCatalog/GameSettings/GameContentScope/admin game-scopes,
wordSearch/content/game, wordGame en hintregels, scrabble/dictionary,
chapterGuess, familyGame, alleskenner/pool, jigsaw/puzzle/solo,
`src/server/gameServer.ts`, `src/server/study.ts`, auth/realtime/live-data.
Nieuwe adapters en latere regels voor Het Verborgen Woord/view gebruiken dezelfde
contentcontext en transport; geen tweede centrale woordenboekinfrastructuur.

### Data, migraties en afhankelijkheden

M5 voor concrete bestaande adapters; alleen een eigen spelrecordfamilie voor
het daadwerkelijk goedgekeurde nieuwe spel. Frozen collection/edition/language/
lesson/revision/poolhash/rulesVersion; actionId/version en deelnemers met echte
userId. Klassikaal hostaccount bestuurt fysieke klasinput, geen guestaccounts.
Afhankelijk: fase 1-availability, fase 2-publicatie/resolvers, fase 3-lescontext,
voldoende geteste taalspecifieke pools en afzonderlijke spelregels. Fase4 is
voor annotaties gereed, maar de resolver mag privénotities nooit als spelpool
gebruiken. Geen functionele afhankelijkheid van studiemap op het spelpad.

### Acceptatiecriteria

- Geen spel zonder juiste bronsoort, taal, publicatie, scope en voldoende inhoud.
- Geen fallback naar BOM bij lege/onbekende studieles. Session-resume houdt
  originele frozen pool, ongeacht nieuwe actieve les/publicatie.
- Bestaande dagspel met zes pogingen, 18:00-grens, XP, ranking en betaalde hints onveranderd;
  puzzelgeometrie/rules/hints/snapping/vraag/reeks ongewijzigd.
- Solo, accountsamen en klas gebruiken correcte bron-/lesgebonden woorden.
- Netwerkdeelnemers ingelogd; elke actie van geautoriseerde huidige beurt;
  gezamenlijk foutenbudget en pogingen met het hele woord servergecontroleerd.
- Retry/parallel/device/resume veroorzaakt geen dubbele zet of beloning.
- Presentatieclient krijgt nooit het geheime woord vóór toegestane reveal.

### Regressietests en risico's

Adapterfixtures voor elke bron/taal, DB-sessiestarts/resumes op frozenversies,
hidden/directAPI-tests, queryfilter-emptytests en netwerkrole/versiontests.
Volledige regressie van de bestaande spel-/XP-/streak-/hintsuites plus
browserflows voor Solo/accounts/host/presentatiescherm. Nieuwe scoring/rewards pas
testen tegen de later goedgekeurde regels, niet nu bedenken.

Risico's: schijnbare scope-support, antwoordlek, turnraces, guests uit
Gezinsavond kopiëren en wijziging van lopende sessies. Buiten scope:
vriendenranglijsten, gastnetwerkaccounts, bestaande spellen redesignen,
multiplayer-legpuzzel en algemene nieuwe gameengine.

## Waarom beperkte voorbereiding eerder nodig is

Toegang en spelcapabilities moeten in fase 1 klaar zijn: anders kan een
nieuwe studiecollectie bestaande spellen met de verkeerde bron openen.
Dit is alleen herkennen/blokkeren en contract, geen nieuwe lesadapter.

De actieve-lesopslag hoort bij context in fase 1; de StudyLesson-FK hoort bij
de rich-contentfamilie in fase 2. De tijdelijke legacy-key is gecontroleerd en
vervalt als schrijfformaat na mapping. Zo vereist fase 1 geen volledige
CFM-/FSY-engine. Privéselectoren worden pas in fase 4 geschreven, maar
stabiele blok-id's moeten in fase 2 aanwezig zijn om latere bulkherankering
te voorkomen. Het nieuwe spel heeft alleen die publieke fundamenten nodig.

## Fase-0-gate

Goedkeuring van dit ontwerp autoriseert nog geen codewerk. Eerst de concrete
fase-1-scope afzonderlijk autoriseren; daarna pas 1A starten. De vier
aanvullende productbesluiten zijn genomen. Technische inventaris, bronvalidatie,
herstelproeven en fasegebonden tests blijven noodzakelijke uitrolvoorwaarden.
Alle latere fasen hebben een eigen beoordeling en merge-/uitrolbesluit.

### Actuele 1A-uitwerking

PR #85 is gesynchroniseerd met PR #86/main. De aangeleverde productie-inventaris
van 2026-10-11T18:51:50.752Z is beschikbaar; een NAS-koppeling is geen gate meer.
1A bevat alleen ContentWork.key/kind, FK via bestaand work, LEGACY/DRAFT/PUBLISHED,
DRAFT/onzichtbare insertdefaults en gedeelde normale/expliciete-previewguards.
Geen UserStudyContext, nieuwe kiezer, CFM-content of volledige spelresolver.
Het automatische prisma migrate deploy bij appstart vereist afzonderlijk
goedgekeurde uitrol ondanks groene tests; zie [uitrolplan](07-PHASE-1A-STATUS.md).
