# Fase 4C — Mijn studiemap

Status: geïmplementeerd in een draft-PR. Geen migratie, geen nieuwe tabel, geen wijziging aan de
4A-service, geen XP/reeks. Fase 4D (herplaatsing van annotaties bij een gewijzigde revisie) is niet gestart.

## 1. Plaatsing (definitief besluit van de eigenaar)

* Mijn studiemap staat **onderaan de fullscreen contentkiezer, direct boven de taalkeuze**
  (`FullscreenContentPicker.tsx`, `data-study-folder-entry`, volgorde: Schrifturen, Muziek, Studieprogramma's,
  Mijn studiemap, Taalkeuze, beheerlink).
* De kaart is een gewone `next/link` naar `/study-folder`. Mijn studiemap is geen contentcollectie: de kaart roept
  `choose()`/`select()` niet aan en wijzigt actieve collectie, contenttaal, studieles of cursus nooit. Ze blijft
  zichtbaar bij elke actieve bron en bij een lege catalogus.
* Niet op Leren (`CoursesClient`, `/courses`) en niet bij Hulpmiddelen: de tegel Bladwijzers is uit `/tools` verwijderd en
  er is geen vervangende tegel. Er is geen nieuwe primaire tab. `/study-folder` hoort functioneel bij Leren (`navigation.ts`)
  maar is een focusroute met terugbalk (`focusMode.ts`, geen activiteitsroute) en blijft contentneutraal in `contentRouting.ts`.
* Oude links: `/bookmarks` stuurt door naar `/study-folder?type=bookmark`. `/api/bookmarks` en alle opgeslagen
  bladwijzers (id, `createdAt`) blijven ongewijzigd.

## 2. Gezamenlijke queryservice

`src/lib/annotations/studyFolder.ts` + `GET /api/study-folder` (alleen GET, strikte zod-query, `private, no-store`,
alleen de ingelogde gebruiker; er bestaat geen client-userId).

* Eén geparameteriseerde PostgreSQL-query: `UNION ALL` over `Bookmark`, `Highlight`, `Note` met gedeelde projectie,
  filtering en sortering; nooit drie volledige downloads. Alleen `deletedAt IS NULL` en `userId = actor.id` in alle drie de takken.
* Sortering `createdAt DESC, kind ASC, id ASC` (originele timestamps). Keysetpaginering met opaque base64url-cursor
  `{t, k, i, h}`; `h` bindt de cursor aan gebruiker + `q`/`type`/`source`. Strikt gevalideerd, maximaal 400 tekens. 25 items per pagina
  (maximaal 50); `nextCursor` alleen als er meer is; er wordt nooit geteld.
* Zoeken (`q`, NFC, maximaal 100 tekens, `ILIKE` met geëscapete `%`/`_`, beide kanten NFC-genormaliseerd): eigen notitietekst,
  eigen opgeslagen quote, en alleen voor nu leesbare bronnen verstekst en bronlabels. De client debounced op 350 ms.
* Bronfilter `source=<collectieId>`; de bronlijst (`?view=sources`) bevat alleen nu leesbare collecties.
* `?item=<kind>:<id>` levert één eigen, actief item; een ander gebruiker, tombstone, verkeerd type en onbekend id geven allemaal 404.

## 3. Privacy en niet-beschikbare bronnen

Leesbaarheid van een bron volgt exact `readingAccessWhere` (ingeschakeld, LEGACY/PUBLISHED, zichtbaar voor gebruikers of beheerder),
voor studielessen aangevuld met een gepubliceerde, niet-ingetrokken les. De SQL geeft bronmetadata (collectienaam, boek/hoofdstuk/vers,
verstekst, lestitel) alleen terug als de bron leesbaar is (`CASE WHEN open`); zoeken en filteren werken op die afgeschermde kolommen.
Daardoor lekken filters en zoekresultaten geen verborgen of ingetrokken broninhoud.

Bij een niet-beschikbare bron blijven wel zichtbaar: type, datum, kleur, eigen notitietekst en eigen oorspronkelijke quote, plus
"Bron niet beschikbaar". Er is dan geen "Open passage". Bewerken en verwijderen lopen via de 4A-writer en geven geen extra
rechten: een bestaande actieve notitie blijft bewerkbaar, verwijderen blijft mogelijk, nieuwe annotaties en kleurwijzigingen op een
ingetrokken bron geven 404.

## 4. Bewerken en verwijderen

`AnnotationActions` (4B) wordt hergebruikt: expliciete PUT/DELETE, `expectedVersion`, stabiele `actionId`, 409-herstel en
bescherming van onopgeslagen tekst. Na een mutatie ververst `annotationsChanged` de accountbrede `useLiveQuery`
(`scopes: ["annotations"]`, geen `contentScoped`). Extra pagina's horen bij de eerste pagina en vervallen als die verandert;
een tijdelijk tab-geheugen herstelt ze na terugkeer uit een leespassage. Notitietekst of selectors gaan nooit in realtime-events.

## 5. Deeplinks en terugnavigatie

* Vers: `/lesson/<chapterId>?vers=<n>&returnTo=<studiemap-url>`; de bestaande `focusVerse` scrolt naar het vers (gecentreerd, onder
  de vaste header) en laat het even oplichten; er opent geen sheet.
* Studiepassage: `/study-lesson/<lessonId>/<collectionId>?annotation=<kind>:<id>&returnTo=…`. De server (`studyFocus.ts`) controleert
  eigenaarschap, actief item, leseditie, gepinde revisie en de exacte selector (`validatePassageSelector`). Alleen bij een exacte match scrolt de
  reader (`useAnnotationFocus`, via het bestaande `requestScrollRestore`-punt) en markeert de passage kort (`data-annotation-focus`).
  Bij een andere revisie of ontbrekend anker verschijnt een melding met de eigen quote: **geen** fuzzy matching of automatische remapping.
* Terug: alleen `returnTo` dat met `/study-folder` begint wordt gehonoreerd (`studyFolderReturn`). `ReaderBackTarget` kent een `soft`-modus:
  terug is gewoon browser-terug (filters en scrollpositie blijven), `returnTo` geldt alleen zonder in-app geschiedenis. De bestaande
  Mysterie-terugweg blijft ongewijzigd. Contentkiezer → map → terug brengt naar `/content`.

## 6. Tests

* Eenheid/contract: `tests/study-folder.test.ts` (cursor, zoekterm, routes, kaartvolgorde, geen studiemapingang op Leren/Hulpmiddelen), in `npm run test:annotations`.
* Integratie (eigen PostgreSQL): `tests/study-folder.integration.test.mjs` — legacy bladwijzers, alle typen en targets, meerdere collecties/talen,
  1.050 records met gelijke timestamps en begrensde queryresultaten, gelijktijdige wijzigingen tijdens paginering, Unicode/`%`/`_`, ongeldige cursors/filters,
  bronintrekking (3 varianten), 409/retry/gelijktijdige clients, geen cross-user-toegang, geen XP/hint/reeks-wijziging, revisie vervangen.
* Browser: `tests/study-folder.browser.mjs` — kiezerkaart (volgorde, geen contextwissel), geen ingang op Leren/Hulpmiddelen, `/bookmarks`-redirect, zoeken/filters/URL/meer laden,
  vers- en passage-deeplinks, terugnavigatie met filters, bewerken/verwijderen, revisiemelding, 5 talen × 320/390/820/1280 px × licht/donker × 100/200%.
* De runner `npm run test:annotations:integration -- --browser` (CI-job `content-access`) voert alles uit; bewijs staat in het artifact `annotation-actions-browser`.

## 7. Bekende beperkingen en grens naar 4D

* Geen herplaatsing van annotaties op een nieuwe revisie, geen taalremapping, geen sociale of gedeelde notities (fase 4D / buiten scope).
* Zoeken is hoofdletterongevoelig en NFC-bestendig, maar niet accent-ongevoelig (geen `unaccent`-extensie, geen migratie).
* Bij veel gelijktijdige wijzigingen kan de lijst na een mutatie weer bij de eerste pagina beginnen; de al geladen pagina's worden alleen hersteld als de eerste pagina ongewijzigd is.
* Niet getest op fysieke iOS-/Android-toestellen (Chromium-emulatie met aanraking).
