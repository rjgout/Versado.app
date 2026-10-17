# Fase 4D — veilig annotatieherstel en legacycompatibiliteit

Bouwt op 4A (fundament), 4B (acties), 4C (Mijn studiemap), PR #137 en #138. Geen vierde annotatietabel, geen fuzzy matching,
geen AI, geen wijziging van de publicatiearchitectuur, geen XP/reeks, geen productiehandeling.

## 1. Eén centrale resolver

`src/lib/annotations/revisionResolution.ts` (`placeAnnotation`) is puur: geen database, geen netwerk, geen verborgen mutatie. Invoer is de
huidig gepubliceerde revisie van **exact dezelfde leseditie** en de eigen annotatievelden; uitvoer is een expliciete status:

| Status | Betekenis | Wat Versado doet |
|---|---|---|
| `EXACT` (`via`: `original` / `resolved` / `carried`) | Bewezen plaats in de huidige revisie | scrollen, markeren, bewerken via dezelfde annotatie-id |
| `NEEDS_REVIEW` (met `proposal`) | Eén unieke kandidaat in een bewezen equivalente sectie | alleen een voorstel; nooit zichtbaar als bestaande markering |
| `ORPHANED` (`reason`) | Geen veilige plaats (`edition`, `invalid`, `section`, `text`, `ambiguous`) | oorspronkelijke quote/notitie blijven; gebruiker kan zelf een passage kiezen |

Regels (alle server-side, dezelfde `validatePassageSelector`):

1. Andere leseditie (andere taal, collectie, uitgave of les) ⇒ `ORPHANED(edition)`; er wordt nooit tussen edities gematcht.
2. Dezelfde revisie ⇒ de oorspronkelijke selector geldt (ook na een rollback).
3. Een bevestigde koppeling die precies bij de huidige revisie hoort en hier nog valideert ⇒ `EXACT(resolved)`.
4. Sectie-equivalentie is uitsluitend bewezen door hetzelfde **stabiele sectie-ID** in dezelfde leseditie. Een gelijknamige sectie met een ander ID bewijst niets.
5. `EXACT(carried)`: de oorspronkelijke selector valideert ongewijzigd, óf elk gekozen stuk komt **precies één keer** voor in het blok met hetzelfde blok-ID (verschoven offsets), in dezelfde volgorde. Een gedeeltelijke match van meerdere ranges is nooit exact.
6. `NEEDS_REVIEW`: blok-ID verdwenen of tekst niet meer in dat blok, maar elk stuk komt binnen dezelfde sectie precies één keer voor.
7. Meerdere kandidaten, ontbrekende stukken, een andere sectie of een andere volgorde ⇒ `ORPHANED`; nooit "de eerste".
8. Een eerder bevestigde locatie is het vertrekpunt bij een volgende revisie; een oude bevestigde selector wordt nooit blind op een niet-overeenkomende revisie toegepast.

De oorspronkelijke velden (`revisionId`, `selector`, `targetKey`, tekst, kleur, ids, tijdstempels) worden door lezen of resolutie nooit overschreven.

## 2. Opslag en migratie

Additieve migratie `20261117120000_annotation_resolution` op `Bookmark`, `Highlight` en `Note`: `resolvedRevisionId`, `resolvedSelector` (JSONB), `resolvedAt`,
alles nullable, geen backfill, geen UPDATE/DELETE/DROP.

* CHECK `*_resolution_check`: alles-of-niets; alleen voor lestargets (`lessonEditionId` gezet, `verseId` leeg); `resolvedSelector.originalRevisionId = resolvedRevisionId`, `normalizationVersion = 1`, 1–32 ranges.
* Samengestelde FK `(resolvedRevisionId, lessonEditionId) → StudyRevision(id, lessonEditionId)` met Restrict: de bevestigde revisie hoort aantoonbaar bij dezelfde leseditie en kan niet verdwijnen.
* Bestaande XOR-targetconstraint, verse-FK's (Restrict) en unieke (userId, targetKey) blijven ongemoeid.
* **Databehoud**: `tests/annotation-resolution-migration.test.mjs` bouwt op een tijdelijke database alle migraties vóór 4D op, voegt bestaande annotaties van alle drie de types toe, past alleen de 4D-migratie toe en bewijst met md5 over `to_jsonb(rij)` zonder de drie nieuwe kolommen dat alles byte-identiek is (incl. `Note.updatedAt`); de nieuwe kolommen zijn leeg.
* Geen destructieve down-migratie. Rollback: de nieuwe kolommen worden door oudere code genegeerd; de drie nullable kolommen kunnen later met een aparte migratie verwijderd worden zonder dataverlies voor bestaande annotaties.

## 3. Bevestigen: `POST /api/annotations/resolve`

Body: `kind`, `id`, `mode` (`proposal` | `manual`), `revisionId`, `selector`, `expectedVersion`, UUID `actionId` (strikte zod, alleen POST, same-origin, `no-store, private`, dezelfde rate limiter als de writer).

Dezelfde locks en regels als `mutateAnnotation`: collectie → les → editie (`FOR SHARE`) → eigen advisory lock op de oorspronkelijke targetKey.
Vereist: ingelogde eigenaar (ook een admin leest/schrijft niet bij een ander), actieve rij (**een tombstone wordt nooit heractiveerd**), normaal leesbare bron,
dezelfde leseditie, `revisionId` is nu werkelijk gepubliceerd, selector valideert server-side, `expectedVersion` klopt (anders 409 met actuele staat).
`proposal`: de server herberekent het voorstel; een afwijkend voorstel is 409. `manual`: de gekozen passage wordt gevalideerd; alleen toegestaan als de annotatie niet al bewezen op haar plaats staat.
Schrijft uitsluitend `resolved*`, `mutationVersion + 1`, `lastActionId/Hash`; `Note.updatedAt` blijft gelijk; geen tweede annotatie. Een identieke retry (zelfde `actionId` en inhoud) geeft `changed:false`; zelfde `actionId` met andere inhoud is 400.
Een late notitiebewerking met een oude versie krijgt daarna 409 (bestaand contract). Realtime: alleen het event `annotationsChanged`, geen tekst of selector.

## 4. Lezen en bewerken

* **Reader** (`GET /api/annotations?view=reader&lessonEditionId&revisionId`): is `revisionId` de nu voor de gebruiker gepubliceerde revisie, dan krijgt elke eigen annotatie van de editie `placement` (`status`, alleen bij `EXACT` de effectieve `selector`). `target`/`targetKey`/`id` blijven de identiteit. Een voorstel wordt niet als plaats geleverd. Zonder brontoegang of voor een oude revisie geldt de oude strikte filter. Andere reads (`getAnnotation`, `listAnnotations`, verse-API's) hebben geen nieuwe velden.
* **Schrijfrechten** (`authorize`): een eigen, actieve annotatie met een bewezen `EXACT`-plaats mag via haar oorspronkelijke identiteit (kleur, bladwijzer, notitie) bewerkt worden op de nieuwe revisie; al het andere krijgt geen nieuwe schrijfrechten voor oude, verborgen of ingetrokken content.
* **Focus** (`resolveAnnotationFocus`): `exact` (scroll/benadrukken), `proposal` (vergelijkingspaneel), `orphaned` (herstelpaneel), `missing` (niet van jou / andere editie).
* **Mijn studiemap**: per pagina (≤ 50 items) één gepubliceerde revisie per bijgewerkte les (`recovery`: `found` / `review` / `missing`), alleen voor leesbare bronnen; nooit brontekst in de lijst. Labels: "Passage gevonden", "Passage bijwerken", "Oorspronkelijke passage niet gevonden". Een ontoegankelijke bron blijft "Bron niet beschikbaar" zonder herstelstatus of -actie. Filters, cursors, deeplinks en late-responsebescherming zijn ongewijzigd.
* **Reader-UI** (`AnnotationRecovery`): bij een voorstel de oorspronkelijke en voorgestelde passage met "Ja, koppel aan deze passage" / "Niet gebruiken" (weigeren schrijft niets); bij orphan "Kies een nieuwe passage" (selecteer tekst, controleer, bevestig). De koppeling verschijnt pas na het serverantwoord (`router.refresh()`).

## 5. Publicatie en rollback

Er is geen publicatiebackfill en geen wijziging van de publicatietransactie: de effectieve plaats wordt bij elke read uit de gepubliceerde pointer berekend. Een rollback naar de oorspronkelijke
revisie laat de oorspronkelijke selector weer gelden; bevestigde koppelingen blijven bewaard (audit/herstel) maar gelden alleen voor hun eigen revisie.

## 6. Legacy

`/bookmarks` (redirect naar de studiemap), `/api/bookmarks` en de verse-only bookmark/highlight/note-endpoints blijven ongewijzigd; verse-annotaties hebben geen herstelactie
(`resolve` ⇒ 404) en geen nieuwe responsevelden; accountverwijdering en de Restrict-FK's blijven zoals in 4A. Er is niets verwijderd.

## 7. Tests

* Puur: `tests/annotation-revision-resolution.test.ts` (21 gevallen: ongewijzigd, identiek, verschoven offset, dubbele quote, vervangen/verplaatst/verwijderd blok, gewijzigde quote, meerdere ranges, NFC, emoji/surrogaten, lijst/tabel, gelijknamige secties, andere taal/collectie/editie, rollback, bevestigde koppeling).
* Integratie: `tests/annotation-recovery.integration.test.mjs` (exact, voorstel met versie/idempotentie/conflict/tampering/vreemde gebruiker/admin, orphan met handmatige herkoppeling, ontoegankelijke bron, tombstone, gelijktijdige bewerking, HTTP, databaseconstraints) en `tests/annotation-resolution-migration.test.mjs` (databehoud).
* Browser: `tests/annotation-recovery.browser.mjs` (scenario's A–E, 5 talen, 320/390/820/1280 px, 100/200%, licht/donker); bestaande suites (`study-folder`, kleuren, reader-verse-menu, annotation-foundation, kompas, live-data, `test:annotations`) blijven groen.
* Runner: `npm run test:annotations:integration -- --browser` (CI-job `content-access`).

## 8. Bekende beperkingen

* Alleen tekstblokken van één leseditie; geen taal-/uitgaveremapping, geen sociale of gedeelde notities, geen fuzzy of AI-herkenning.
* Een voorstel bestaat alleen bij precies één kandidaat in dezelfde sectie; bij ambiguïteit moet de gebruiker zelf een passage kiezen.
* Een kleine kleurwijziging op een nog niet bevestigd voorstel is niet mogelijk (alleen bewezen exacte plaatsen krijgen nieuwe schrijfrechten); notities en verwijderen blijven altijd mogelijk.
* De reader-read levert maximaal 200 annotaties per type; historische annotaties van eerdere revisies tellen daarin mee.
* Het openen van de studiemappagina leest per bijgewerkte les de gepubliceerde revisie (begrensd tot de pagina); bij zeer veel verschillende lessen op één pagina kost dat extra serverwerk.
* Kompas: de herstelteksten zijn inline uitgelegd; er is bewust geen apart Kompas-onderdeel toegevoegd.
* Uitrol: eerst migratie (additief, veilig vóór code), daarna app; terugdraaien van de app laat de nullable kolommen ongebruikt staan. Productie-uitrol is aan de eigenaar.
