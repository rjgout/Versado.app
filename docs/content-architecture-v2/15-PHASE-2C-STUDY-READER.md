# Fase 2C — StudyReader en persistente leespositie

## Voorbereiding en toestemming

Werkbranch: `codex/content-architecture-v2-2c-study-reader`, gestart vanaf
`origin/main` **1a34c020a93bfc898a9ae1bde6f2cccbcb2c64be**. Fase 2B / PR #96
is gemerged. De afzonderlijke concept-PR #97 wordt niet meegenomen.

**Status: definitief schemavoorstel voor afzonderlijke goedkeuring.** Er is
nog geen fase-2C-migratie of Prisma-schemawijziging uitgevoerd. De eerdere
toestemming voor 2B wordt niet als toestemming voor 2C gebruikt.

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
- Een geopende, eerder aantoonbaar gepubliceerde revisie kan nog een positie
  krijgen na een publicatiewissel, mits de collectie en les nog normaal
  toegankelijk zijn. Bewijs komt uit de bestaande publicatiehistorie, inclusief
  `previousRevisionId` voor een vervangen 2A-publicatie; niet uit een clientclaim.
  Conceptrevisies zijn nooit een geldige normale position-target.
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
zijn leestekst, geen oefeningen. Media gebruiken de bestaande gewone media-API,
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

Nog geen fase-2C-testresultaten geclaimd. Na schema-akkoord:

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

Alleen na afzonderlijke schema-goedkeuring wordt de additieve migratie gebouwd.
Geen oude tabellen, rijen of kolommen veranderen; geen FSY-backfill. Afgebroken
DDL/objectconflict en herhaalde migrate deploy worden op de eigen database getest.

Review/merge/deployment hebben afzonderlijke gates. Synology voert Prisma-migraties
uit bij containerstart; deze ontwerpgoedkeuring geeft daar geen toestemming voor.
Bij approllback: vorige image, nieuwe positietabel/data behouden, geen destructieve
down-migratie. Officiële import/publicatiegate uit 2B blijft gesloten.

De eigenaar beheert Hyper Backup; geen onafhankelijke restoretest uitgevoerd,
conform het eerder geaccepteerde risico. Geen productiequery, NAS-aanpassing,
backup-, herstel-, import- of deploymentactie in deze voorbereiding.
