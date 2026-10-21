# Cursusidentiteit van de leescursussen

Dit document legt vast hoe de drie schriftuurlijke leescursussen (Stap voor stap `READING_LESSONS`, Hoofdstuk voor hoofdstuk `FRONT_TO_BACK`, Vrije keuze `FREE_CHOICE`) hun identiteit krijgen, waarom het Boek van Mormon er een tijd dubbel kon staan en hoe bestaande duplicaten veilig worden hersteld.

## Invariant

Per schriftcollectie bestaat er **maximaal één** cursus per type `READING_LESSONS`, `FRONT_TO_BACK` en `FREE_CHOICE`. Andere soorten (podcast, kinderen, introductie, FSY, CFM) vallen er bewust buiten: een collectie mag meerdere podcastcursussen hebben.

Canonieke slugs (`canonicalReadingSlug`, `src/lib/courseIntegrity.ts`):

| Collectie | `FREE_CHOICE` | `FRONT_TO_BACK` | `READING_LESSONS` |
|---|---|---|---|
| Boek van Mormon (`content_bom`) | `vrije-keuze` | `voor-naar-achter` | `lezen-van-voor-naar-achter` |
| elke andere schriftcollectie | `vrije-keuze-<collectieslug>` | `voor-naar-achter-<collectieslug>` | `lezen-van-voor-naar-achter-<collectieslug>` |

## Oorzaak van de duplicaten (bewezen in de code)

`syncCourses()` (`src/lib/courses.ts`) koos de "standaardcollectie", de collectie die de historische slugs krijgt, met `findFirst({ enabled: true }, orderBy order asc)`. `ContentCollection.order` heeft `@default(0)` en het Boek van Mormon heeft zelf `order 0`. Een collectie die met de standaardwaarde wordt aangemaakt (zoals de CFM-collectie in `cfm2026Import.ts`) deelt die waarde, en bij een gelijke `order` is de keuze van PostgreSQL niet vastgelegd. Hetzelfde geldt zodra het Boek van Mormon wordt uitgeschakeld of een nieuwe collectie lager wordt gezet. Gevolg bij een wissel van de standaard:

1. de historische slugs verhuizen (`update: { contentCollectionId }`) naar de andere collectie, en `setChapters`/`syncReadingLessons` bouwen ze daar opnieuw op (een collectie zonder boeken gaf zelfs een leeg lessenplan);
2. het Boek van Mormon geldt dan als "andere collectie" en krijgt een tweede set onder `…-boek-van-mormon`;
3. wisselt de standaard terug, dan keren de historische slugs terug naar het Boek van Mormon, maar de tweede set blijft staan: **twee sets in `content_bom`**.

De volgende dingen verklaren waarom Kinderverhalen en Ontdek het Boek van Mormon niet dubbel staan (vaste singleton-slug, geen collectieslug) en waarom andere collecties het probleem niet hebben (altijd een collectieslug). Een vertaalkwestie is uitgesloten: `tests/reading-courses.test.ts` controleert dat de drie leeswijzen in alle vijf talen drie verschillende namen hebben.

Verwachte dubbele slugs in een aangetaste database: `vrije-keuze-boek-van-mormon`, `voor-naar-achter-boek-van-mormon`, `lezen-van-voor-naar-achter-boek-van-mormon` (en spiegelbeeld: cursussen van een andere collectie onder de historische slug). **Dit is niet aan de productiedatabase geverifieerd** (geen toegang); gebruik de diagnose hieronder.

## Structurele correctie (code, veilig)

- `syncCourses` gebruikt vast `BOM_COLLECTION_ID` (`src/lib/contentCollectionIds.ts`, opnieuw geëxporteerd door `contentCollections.ts`), nooit volgorde of `enabled`. Ontbreekt de collectie, dan volgt een duidelijke fout.
- Een collectie zonder hoofdstukken wordt overgeslagen (geen leeg lessenplan dat lessen wist).
- Een andere collectie hergebruikt een bestaand record van hetzelfde type als haar canonieke slug (nog) niet bestaat (bijvoorbeeld na het hernoemen van een collectieslug), in plaats van een tweede aan te maken.
- `importBooks` valt zonder expliciete doelcollectie terug op het Boek van Mormon, niet op "de eerste collectie".
- Na een sync waarschuwt `warnOnDuplicateReadingCourses` in het log; de import breekt niet af (herstel is een aparte, goed te keuren stap).
- Een synchronisatie raakt geen duplicaten aan en voegt er geen toe; herhaald draaien is idempotent.

## Databaseconstraint: bewust nog niet

Een partiële unieke index op `("contentCollectionId", "type") WHERE type IN ('READING_LESSONS','FRONT_TO_BACK','FREE_CHOICE')` zou de invariant in de database afdwingen en is compatibel met podcasts en andere soorten. Hij **faalt echter zolang er in productie duplicaten staan** en zou de uitrol blokkeren. Daarom: eerst herstel (hieronder) en verificatie, daarna een aparte migratie (`CREATE UNIQUE INDEX CONCURRENTLY … WHERE …`, zonder backfill). Tot dan dwingt de synchronisatielaag de invariant af en meldt `findDuplicateReadingCourses` overtredingen.

## Productiegegevenscorrectie (aparte goedkeuring nodig)

Niets hiervan draait vanzelf: niet bij een build, uitrol, migratie of normale import.

1. **Back-up** (`scripts/backup.sh`) en uitrol van de code met de structurele correctie. De eerstvolgende import/sync zet een verhuisde historische cursus terug naar het Boek van Mormon (alleen de collectiekoppeling; er wordt niets verwijderd).
2. **Diagnose (alleen lezen):** `npm run courses:audit` (of `npx tsx scripts/courses/audit-duplicates.ts`). Toont collecties, alle leescursussen met afhankelijkheden (hoofdstukken, lessen, abonnementen, gebruikers met voortgang, actieve cursus, lesvoortgang, oefensessies, Samen studeren, persoonlijke volgorde, feedback) en per groep het oordeel `merge` of `blocked`. Exitcode 1 bij duplicaten.
3. **Dry-run:** `npm run courses:repair` toont hetzelfde plan en schrijft niets.
4. **Uitvoeren na goedkeuring:** `npm run courses:repair -- --apply --backup-gemaakt`.
5. **Controle:** `npm run courses:audit` moet exitcode 0 geven; kijk in `/courses` of elke leeswijze één keer staat en of abonnementen en de actieve cursus kloppen.
6. Daarna pas de partiële unieke index (vorige sectie) als migratie voorstellen.

Wat het herstel doet (`src/lib/courseRepair.ts`), per dubbele cursus in een eigen transactie met hervalidatie en een eindcontrole:

- **Canoniek** is de cursus met de canonieke slug; elke andere cursus in dezelfde (collectie, type)-groep is een duplicaat. Ontbreekt of is er meer dan één canonieke cursus, dan is de groep `blocked`.
- **Lesvoortgang** (Stap voor stap): lessen worden gekoppeld op (hoofdstuk, beginvers). Voortgang verhuist; bij een botsing geldt: voltooid = of, beste score en XP = maximum, vroegste voltooiing. Een les van het duplicaat met gebruikersgegevens zonder gelijkwaardige canonieke les blokkeert de groep (handmatige beoordeling), er wordt niets overschreven.
- **Cursusvoortgang** per gebruiker: abonnement blijft zodra één van beide actief is; plek (hoofdstuk/les) en combo volgen de recentste activiteit; gebruikers met alleen de dubbele cursus verhuizen mee.
- Verhuizen mee: actieve cursus, oefensessies, Samen studeren-sessies, feedbackverwijzingen en de persoonlijke cursusvolgorde (`UserListOrder`, verborgen alleen als beide verborgen waren).
- Pas als er niets meer naar het duplicaat wijst, wordt het verwijderd; anders wordt de transactie teruggedraaid. Geen `deleteMany` op gebruikersgegevens, geen reset, geen herbouw.
- Idempotent: een tweede run vindt niets te doen.

Een groep die `blocked` is wordt nooit aangeraakt; beoordeel haar met de notities uit het plan.

## Tests

`npm run test:course-identity` (unit + integratie, vereist `LEARNING_TEST_DATABASE_URL`, een wegwerpdatabase) en `tests/course-sync.integration.test.ts` (lessenplan). In CI draait `tests/course-identity.integration.test.ts` in de job `content-access`.
