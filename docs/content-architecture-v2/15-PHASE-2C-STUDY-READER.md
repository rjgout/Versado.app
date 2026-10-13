# Fase 2C — StudyReader en persistente leespositie

## Voorbereiding en toestemming

Werkbranch: `codex/content-architecture-v2-2c-study-reader`, gestart vanaf
`origin/main` **1a34c020a93bfc898a9ae1bde6f2cccbcb2c64be**. Fase 2B / PR #96
is gemerged. De afzonderlijke concept-PR #97 wordt niet meegenomen.

**Status: schema afzonderlijk goedgekeurd op 13 oktober 2026.** De eigenaar
antwoordde expliciet “Akkoord met dit schema”. Implementatie en geïsoleerde
validatie vinden plaats op deze branch; productie-uitrol blijft buiten scope.
De eerdere toestemming voor 2B is niet als toestemming voor 2C gebruikt.

De opdracht vereist: “Leg het definitieve ReadingPosition-schema eerst ter
goedkeuring voor voordat je de Prisma-migratie implementeert.” Het hieronder
beschreven ontwerp is het concrete object van die goedkeuring. Toestemming
betreft uitsluitend code, tests en een concept-PR, geen productie-uitrol.

## Vastgestelde beginsituatie

- `StudyLessonEdition` identificeert exact les + collectie; `StudyRevision`
  heeft reeds de unieke combinatie `(id, lessonEditionId)` voor een samengestelde
  FK. Inhoudsrevisies zijn immutable.
- `getPublishedStudyLesson()` valideert normale bronrechten, bronsoort,
  retired-status, actuele publicatie, schema en hash. De DTO is readonly.
- `StudyRevisionContent` biedt de negen semantische bloktypen als beheerpreview;
  deze preview is geen gewone reader en mag geen posities schrijven.
- `NavigationScroll` beheert documentscroll en geschiedenis. Een tweede
  onafhankelijke herstel-loop zou met deze component conflicteren.
- `LiveDataProvider` verzorgt al focus/online/native-resume; geen extra globale
  listener of polling nodig. Query-identiteiten moeten de werkelijk geopende
  leseditie/revisie gebruiken, niet de inmiddels gewijzigde actieve collectie.
- `LessonFlow` en `ReadingLessonFlow` combineren bestaande hoofdstukken met
  audio/oefeningen/afronding. Ze blijven ongewijzigd; de nieuwe reader mag deze
  transacties niet overnemen.
- De reviewcorrecties op main beperken normale media tot de **actuele**
  publicatie en valideren gepinde rechtenmetadata. Historische publicatie-audit
  geeft geen mediarechten. Een frozen reader maakt oude afbeeldingen niet
  opnieuw toegankelijk.

## Definitief voorgesteld ReadingPosition-schema

```prisma
model ReadingPosition {
  userId          String
  lessonEditionId String
  revisionId      String
  sectionAnchor   String @db.VarChar(128)
  blockAnchor     String @db.VarChar(128)
  sectionFraction Float
  quoteContext    String? @db.VarChar(240)
  version         Int @default(1)
  lastActionId    String @db.Uuid
  lastActionHash  String @db.Char(64)
  updatedAt       DateTime @updatedAt

  user     User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Restrict)
  edition  StudyLessonEdition @relation("StudyEditionReadingPositions", fields: [lessonEditionId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  revision StudyRevision @relation("StudyRevisionReadingPositions", fields: [revisionId, lessonEditionId], references: [id, lessonEditionId], onDelete: Restrict, onUpdate: Restrict)

  @@id([userId, lessonEditionId])
  @@index([lessonEditionId])
  @@index([revisionId, lessonEditionId])
}
```

Prisma krijgt uitsluitend de drie benodigde inverse relaties. Geen scalar op
User, wijziging van bestaande identiteiten of tweede revisie-/lesmodel.

Aanvullende SQL-constraints:

- `sectionFraction` is eindig en ligt inclusief tussen 0 en 1; geen NaN/infinity.
- `version >= 1`; writes blokkeren vóór een Int-overflow.
- Sectie-/blokankers voldoen aan hetzelfde begrensde ankerformaat als schema v1.
- `lastActionHash` is een lowercase SHA-256 van de gevalideerde actie.
- Een beperkte INSERT/UPDATE-trigger verifieert dat de sectie en het bijbehorende
  top-level blok werkelijk in de immutable bedoelde revisie voorkomen. De
  samengestelde FK verbiedt cross-edition-revisies. De service valideert dezelfde
  voorwaarden met het bestaande rich-content-schema.

`quoteContext` is optioneel, maximaal 240 tekens en uitsluitend server-afgeleide
gepubliceerde tekst uit het gekozen blok; geen vrij gebruikersveld of notitie.
Het ondersteunt alleen uniek, exact aantoonbaar tekstherstel binnen dezelfde
editie. Ambigue, ontbrekende of te korte tekst levert geen automatische mapping.
Geen vertaalprojectie of gegokt anker.

Een eigen technische `id` is niet nodig: gebruiker + editie is al de eenduidige
identiteit. Een ontbrekende rij betekent versie 0 en veroorzaakt geen GET-write.
Alleen een echte lees-/start-over-actie maakt of wijzigt een positie.

Hoofdstukposities worden nu niet toegevoegd. Er is geen goedgekeurde rewrite
van de hoofdstukkenlezer of bewezen FSY-positiemapping. Verplichte editie/revisie
maakt dit werkpakket kleiner en de constraints duidelijker. Een latere concrete
hoofdstukfase kan additief chapterId en een exclusieve targetconstraint toevoegen;
deze fase bouwt geen ongebruikte nullable targets.

## Opslag- en concurrencycontract

- GET en writes gebruiken uitsluitend het server-userId en normale leesrechten,
  ook voor admins. Geen andere userId in de payload.
- Strict Zod-write: exacte editie/revisie, sectionAnchor, blockAnchor,
  sectionFraction, expectedVersion en UUID actionId. Geen READ-, XP- of contextveld.
- Eén transactie met vastgelegde editie/publicatie- en gebruiker/editie-lockvolgorde,
  begrensde locks/statements. Eerste creatie is door de primaire sleutel beschermd.
- Dezelfde laatste actionId met dezelfde actiehash is een retry zonder extra
  write; anders conflict. Een oude retry na een nieuwere actie krijgt 409 en kan
  de oude positie nooit herstellen. Timestamps van toestellen hebben geen gezag.
- Nieuwe positie verhoogt de versie precies eenmaal. Een save van dezelfde
  positie zonder nieuwe semantische actie schrijft niets.
- Een geopende, eerder aantoonbaar gepubliceerde revisie kan na een
  publicatiewissel alleen nog positie bewaren met **twee onafhankelijke bewijzen**:
  (1) bestaande publicatiehistorie (ook `previousRevisionId`), en (2) een
  serverondertekend leesbezoekbewijs dat eerder bij het openen van de toen
  actuele gepubliceerde revisie is uitgegeven. Het bewijs is maximaal zes uur
  geldig en gebonden aan gebruiker, sessie, leseditie en exacte revisie.
  De server verifieert HMAC in constante tijd en controleert het bewijs
  **vóór** het ophalen van historische bloktekst of de server-afgeleide
  `quoteContext`. Ontbrekend, ongeldig, verlopen of niet-passend bewijs:
  `UNAVAILABLE`, geen historische tekst in de response. De actuele
  publicatie blijft via de gewone leesrechten beschikbaar; een bewijs geeft
  nooit toegang tot concepten, andere gebruikers of ingetrokken collecties.
  Het bewijs is geen productievrijgave, geen nieuw sessietoken en wordt niet
  in URLs, sociale data of logs opgenomen. Een lang geopend leesbezoek dat
  na zes uur verlopen is, moet bewust de huidige publicatie heropenen.
- Een 409 bevat alleen de eigen, toegestane serverpositie en versie. Bij
  ingetrokken brontoegang blijft de rij bewaard, zonder verborgen tekst/quote
  terug te geven. Geen persoonlijke gegevens in logs of sociale scopes.

## Reader, route en navigatieontwerp

Voorgestelde route: `/study-lesson/[lessonId]/[collectionId]`. Beide identiteiten
staan expliciet in de interne route; geen actieve-bronfallback. Serverauthenticatie
en `getPublishedStudyLesson()` blijven autoritatief. Geen nieuwe kaart/menulink
zolang er geen werkelijk beschikbare les is. Registratie in de bestaande focus-
en terugbalkcontracten; geen nieuwe header, scrollcontainer of shell-offset.

De reader bevriest de ontvangen revisie en toont heading/paragraph/list/quote/
question/assignment/figure/reference/divider doorlopend. Questions/assignments
zijn leestekst, geen oefeningen. Inline-links die al door het rich-content-schema
zijn gecontroleerd als veilige absolute HTTPS-URL worden als echte focusbare
`<a>`-links gerenderd (nieuw tabblad, `noopener noreferrer`). Onbewezen
Schriftuurverwijzingen blijven tekst tot fase 2D. De bestaande 2B-importgate
voor onbewezen ongeankerde links wordt hierbij niet versoepeld.
Media gebruiken de bestaande gewone media-API,
met gereserveerde beeldverhouding, alt en caption. Afgewezen oude/ontbrekende media
krijgen een toegankelijke melding; geen adminmedia-fallback.

De gedeelde navigatiecoördinatie bepaalt de prioriteit:

1. Bewuste gebruikersinteractie stopt elk automatisch herstel.
2. Browser terug/vooruit volgt het bestaande geschiedenisitem.
3. Expliciete sectienavigatie.
4. Opgeslagen ReadingPosition.
5. Zonder positie: begin van de les.

`NavigationScroll` blijft eigenaar van de globale historie. De reader meldt een
begrensd ankerherstel bij dezelfde coördinatie aan; geen concurrerende permanente
RAF-loop. Layoutmeting volgt ShellMetrics, ResizeObserver en gereserveerde media.

## Autosave, herstart en revisie-update

Debounce alleen gewijzigde ankerposities na leespauze; geen scrollpixelrequests,
polling of tweede globale focuslistener. Een gebonden savequeue houdt immutable
actie-identiteiten vast voor netwerkretry en voorkomt toepassing van een oude
les-/editie-/revisierespons op nieuwe inhoud. Laatste save bij vertrek/pagehide/
app-pauze is best effort; succes wordt alleen na serverbevestiging gemeld.

“Opnieuw bovenaan beginnen” is een expliciete, versiegecontroleerde position-write
en maakt oudere lokale autosaves ongeldig. Een onbekende serveruitkomst moet eerst
worden hersteld; geen automatische overschrijving van een ander toestel.

Een nieuwe publicatie vervangt de geopende body niet vanzelf. Bestaande live-data
kan een lichte actuele-publicatiestatus verversen; de gebruiker kiest bewust voor
heropenen. Bij heropenen: hetzelfde blok → dezelfde sectie → uniek bewezen quote
→ herstelbare melding/bovenaan. Geen onbetrouwbare automatische vervanging.

## Gescheiden voortgang en privacy

`readingPosition != readStatus != courseProgress`. Een voortgangsbalk is alleen
een positie-inschatting. Scrollen, 100%, openen of herstart leveren nooit READ,
XP, reeks, oefencredits, cursusafronding of ActivityFeed op. Geen UserStudyContext,
activeContentCollectionId, podcasts of bestaande annotaties wijzigen. Expliciet
markeren als gelezen blijft fase 2E; interne referencepreview blijft fase 2D.

## Geplande validatie en migratiebewijs

Voorbereiding op 13 oktober 2026: 134 bestaande unit-/contracttests geslaagd,
0 fouten, 0 skips (`study-content`, `study-publication`, focus/shell en de drie
live-data-suites). Dit is een controle van actuele main, geen fase-2C-integratie-
of browserbewijs. `git diff --check` is eveneens geslaagd. Geen database aangeraakt.

De volgende controles zijn uitgevoerd; de verdere CI-resultaten worden op de exacte commit in de concept-PR geregistreerd:

- Eigen PostgreSQL met alle bestaande migraties, dynamische schemaobjecttelling
  en vergelijking van alle oude rijgegevens; geen backfill of productiegegevens.
- FK/anker/fraction/version-controles, isolatie van gebruikers, gelijktijdige
  writes, eerste creatie, retries, rollback bij fout en behoud van oude data.
- Browserproductiebuild: 320/390/desktop, licht/donker, 200% tekst, landscape,
  late/ingetrokken media, back/forward, gebruikersscroll tijdens herstel,
  tweede toestel/sessie, netwerkfout, revisiewissel en start-over.
- Bestaande 1A–2B-, navigatie-, studiecontext-, leer-, economie- en spelregressies.
- Prisma validate/generate, TypeScript per coherent codeblok, lint, i18n,
  schone build en Actions op de exacte laatste commit; screenshots als artifact.

## Uitrol en rollback

De afzonderlijk goedgekeurde additieve migratie is `20261031120000_reading_position`.
Geen oude tabellen, rijen of kolommen veranderen; geen FSY-backfill. Afgebroken
DDL/objectconflict en herhaalde migrate deploy worden op de eigen database getest.

Review/merge/deployment hebben afzonderlijke gates. Synology voert Prisma-migraties
uit bij containerstart; deze ontwerpgoedkeuring geeft daar geen toestemming voor.
Bij approllback: vorige image, nieuwe positietabel/data behouden, geen destructieve
down-migratie. Officiële import/publicatiegate uit 2B blijft gesloten.

De eigenaar beheert Hyper Backup; geen onafhankelijke restoretest uitgevoerd,
conform het eerder geaccepteerde risico. Geen productiequery, NAS-aanpassing,
backup-, herstel-, import- of deploymentactie in deze voorbereiding.

## Actuele implementatie en integratievoorwaarden

De HTTP-write controleert naast bestaande Origin/auth de opaque
`navigationSessionKey()` van de ingelogde sessie via `X-Reading-Session`.
Die bestaande hash is geen authenticatiemiddel: de cookie blijft autoritatief.
Een late save kan daardoor niet bij een later ingelogde gebruiker of een nieuwe
login worden toegepast. Tabcache bevat alleen begrensde actie/coördinaten, geen
quote, credentials of gebruikersprofiel; key bevat sessie, editie en revisie.

De globale live-data-listeners bieden `subscribeDataPause` aan voor pagehide,
verborgen tab en de bestaande native bridge. De controller registreert geen
eigen focus-, visibility-, online- of pollinglistener. Mutation en realtime-event
blijven gericht op `readingPosition`.

De centrale scrollcoördinatie kan een vroeg ankerverzoek vasthouden totdat
NavigationScroll gereed is. Geschiedenis en gebruikersinput houden voorrang.
Een readerreload vraagt de serverpositie; bestaande generieke pagina's behouden
hun eerdere lokale reloadherstel. Een bewust resetpunt is de echte paginabovenkant,
ook na herladen, niet alleen de eerste tekstsectie onder de bediening.
Sectieherstel bij een verdwenen blok begint veilig aan die sectie; alleen een
uniek exact quote-fragment kan een verdwenen sectie vervangen.

Kompas is beoordeeld: er is nog geen officiële studielescatalogus, dus geen nieuwe
lege leskaart, menulink of bronbelofte toegevoegd. De reader legt lokaal het
verschil tussen leespositie en gelezenstatus uit in alle vijf UI-talen. Een
bron-/lesgebonden Kompas-ingang kan bij daadwerkelijke contentbeschikbaarheid
op de bestaande infrastructuur aansluiten. Geen tweede tutorial.

## Werkelijke validatieresultaten

| Controle | Resultaat |
| --- | --- |
| Prisma validate/generate en TypeScript | Geslaagd; TypeScript per coherent codeblok. |
| Schone Next.js-productiebuild | Geslaagd. Browser gebruikt deze productiebuild, niet dev. |
| Nieuwe positie-/queue-unitchecks + bestaand 2A-schema | 56 geslaagd: 28 nieuwe checks en 28 bestaande schema/revisiechecks; geen skips. |
| Contentwisseling, focus/shell en live-data-regressies | 122 geslaagd op de definitieve code, inclusief late-response/epochchecks en hervatten tijdens een lopende fetch; geen skips. |
| Kompas, studyscoring, centrale reeks en leerregels | 77 geslaagd; geen skips. |
| Volledige geïsoleerde reader-run | 296 Node-tests geslaagd: 281 bestaande toegang/context/cursus/leer/tijdcontroles en 15 nieuwe DB/API-tests; geen skips. |
| Migratiebehoud | 144 bestaande tabellen, 1220 kolommen, 377 constraints, 381 indexen, 7 triggers, 5 functies en 60 enums behouden; bestaande sequencetelling 0. Oude rijhashes gelijk; geen backfill. Werkelijke dynamische telling, geen hardcoded migratievoorwaarde. |
| Migratiefouten | Mid-DDL-error, tabel-/indexnaamconflict en locktimeout rollen de nieuwe objecten terug. Herhaald migrate deploy is veilig; handmatig SQL-herhalen stopt voor review. |
| Readerbrowser | 20 flows geslaagd: mobiele/desktop/landscape hervatting, 200% tekst, alle vijf UI-talen, netwerkretry, conflicten, late oude responses, app-pauze, nieuwe login, revisie-update en verdwenen anker. Geen browser-pageerrors. |
| Bestaande 2B-publicatie en media | Afzonderlijk 307 Node-tests en 19 browserflows geslaagd; persistent mediavolume ook na container-/imagevervanging gecontroleerd. |
| Snelle Zendeling / Genees | 173 speltests, 58 economytests, 18 bron/isolationtests en 2 echte multi-instance/browsertests geslaagd; eigen PostgreSQL/Redis. |
| Lint/i18n | Geen lintfouten; 134 vooraf bestaande waarschuwingen. Nieuwe gebruikerslabels vertaald in alle vijf UI-talen; bestaande 418 ontbrekende vertalingen buiten dit werkpakket blijven staan. |
| Availability-querybudgetten | Bestaande limieten, actuele rechten/settings/scopes en economie behouden. Eigen database, geen productiemeting. |

Browsermatrix: 320×844, 390×844, 1280×900 en 844×390 landscape, licht/donker.
Daarnaast 320px met **200% tekst die ook na reload actief blijft**, in alle vijf
UI-talen, met 20px boven-/34px onder-safearea-emulatie. De controle meet werkelijk
32px rootfont, overflow, terugbalk/inhoud, bron/editie/revisie en opgeslagen ankers.
Screenshots en `results.json` worden als `study-reader-browser` CI-artifact bewaard;
geen grote gegenereerde bestanden in Git.

Geen fysieke iOS-/Android-toestellen, Safari/WebKit of echte Capacitor-app getest.
App-pauze/resume is met de bestaande bridge-gebeurtenissen in Chromium getest.
Pagehide/OS-afsluiten blijft best effort: alleen een serverbevestiging betekent
opgeslagen. De gebonden tabcache ondersteunt een herstelbare onbekende uitkomst;
een harde OS-stop vóór enige lokale/serveropslag kan niet worden gegarandeerd.

De eerste aanloop vond echte fouten in vroege scrollregistratie en het exacte
resetdoel; beide zijn centraal gecorrigeerd en opnieuw in de browser gecontroleerd.
De savequeue heeft aanvullend monotone positie-/publicatieversies en een bezoekepoch:
een late eigen response of een response na bewuste conflictherstelkeuze kan geen
nieuwere toestand vervangen. Oude tab-/les-/loginresponses zijn gebonden aan hun
originele queue, sessie en editie/revisie.

Testomgevingsafwijkingen zijn afzonderlijk behandeld: timezonefixtures zijn op
UTC afgestemd op de browser; gedeelde PNG-bytes kunnen terecht via een andere
actuele publicatie beschikbaar zijn. Die testkopieën worden bij de intrekkingsproef
geïsoleerd. Een gecombineerde reader-/publicatiesuite bleek ongeschikt omdat de
STAGED-compensatietest een eigen lege mediapool vereist; de runner weigert die
combinatie nu vóór database-start. De bestaande suites draaien elk op hun eigen
wegwerpdatabase. Een gelijktijdige extra database kon lokaal niet starten bij
beperkte capaciteit; Snelle Zendeling is daarna afzonderlijk volledig geslaagd.
Dit waren geen productieacties.

Bewuste foutinjecties geven Prisma-testlogs; de API toont alleen vertaalde,
begrensde foutmeldingen. Daarnaast meldt de PostgreSQL-driver zijn bestaande
concurrent-query-deprecatie en Next.js kan bij bewuste navigatieafbraak melden
“destination stream closed early”. Deze worden niet als geslaagde herstelproef of
als genegeerde browser-pageerrors gepresenteerd.

## Gerichte reviewcorrecties vóór merge

- De eerder gebleken mogelijkheid om via een willekeurig historisch revisie-ID
  een herstelquote op te vragen is beperkt: zonder een geldige, bij het
  oorspronkelijke gepubliceerde leesbezoek uitgegeven en sessiegebonden HMAC
  vindt geen historische revisieopslag of quote-afleiding plaats.
- De client houdt het bewijs bij dezelfde serialiseerbare saveactie, zodat
  keepalive, netwerkretry met dezelfde actionId en start-over dezelfde
  toegangsgrenzen respecteren. Hij schrijft het bewijs niet in de URL.
- Unit-/API-regressies dekken geldige frozen visits, ontbrekend, vervalst,
  verlopen en verkeerd gebonden bewijs, onbereikbare concepten en
  gewone bestaande position writes.
- De rich-contentreader toont gecontroleerde HTTPS-links als echte links.
  Semantische Schriftuurverwijzingen krijgen nog geen onbewezen bestemming.

Deze wijzigingen geven géén toestemming voor merge of productie-uitrol.

## Gewijzigde onderdelen en grenzen

- Eén ReadingPosition-model, drie inverse relaties en één nieuwe additieve SQL-migratie.
- Gedeeld leespositiecontract, server-service, private GET/PUT-API en readonly reader-DTO.
- `/study-lesson/[lessonId]/[collectionId]`, StudyReader, RichContentBlocks en position-controller.
- Centrale scrollcoördinatie in de bestaande NavigationScroll, bestaande native/live-data-pauze,
  navigatie-/focus-/contentroutecontracten en één eigen positie-event/scope.
- Vijf UI-vertalingen, bestaande isolated runner, nieuwe unit/DB/migratie/browsertests,
  packagecommando's, bestaande Actions-workflow, dit document en DATA-REFRESH.

De bestaande adminpreview blijft een zelfstandige readonly beheercontext. Hij
maakt geen ReadingPosition. De nieuwe semantische renderer is gedeeld door alle
normale studielessen; er is geen bronafhankelijke FSY-/CFM-reader gebouwd.
Geen nieuwe permanente toolbar, hoofdstukkenrewrite, officiële content, FSY-
conversie, annotatiemodel, ReferencePreview of READ-transactie.

Publicatiemonitoring gebruikt de bestaande gerichte scope en focus/online/app-resume-
hercontrole. Er is geen permanente polling of nieuwe globale broadcast toegevoegd.
De eerste reader-CI-run vond een race bij het updatebericht: een geforceerde
hercontrole tijdens een lopende GET kon verloren gaan. De bestaande centrale
LiveDataStore bewaart dit signaal nu met zijn generatiecontract en haalt na het
oude antwoord eenmaal opnieuw op. Meerdere hervatsignalen worden samengevoegd;
er komen geen parallelle fetches of permanente herhaallus bij. Een deterministische
unitcheck en een browsercheck met bewust vertraagd oud publicatieantwoord dekken
dit af. De afzonderlijke live-data-suite telt nu 52 geslaagde tests.
De geopende tekst blijft altijd frozen; heropenen is bewust. Fase 2D neemt veilige
referencepreviews/equivalentie over; 2E neemt uitsluitend expliciete READ-afhandeling
met bestaande centrale activiteitregels over. De drie voortgangstoestanden blijven
onafhankelijk.

Uitrol vereist review van de exacte concept-PR/DDL/CI en afzonderlijke merge-/
deploymenttoestemming. Synology-startup migreert automatisch. Vooraf bestaande
backupdekking en container-/DB-gezondheid controleren; geen nieuwe restoreclaim.
Na gecontroleerde migratie eerst legacycontent/games/bronkeuze controleren en de
nieuwe route alleen bij echt beschikbare publicatie gebruiken. Approllback behoudt
nieuwe schema/data; nooit een destructieve down-migratie of algemene seed uitvoeren.
