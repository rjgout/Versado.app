# Fase 4A — gedeeld annotatiefundament

## Scope en basis

Gebaseerd op main `a0f21277111f960d0121b0e38d3d917f9a427d18`, inclusief
workflow-PR #126. Tijdens implementatie zijn #127/#128 voor het leespad in main
`2698acb7` gemerged; die wijzigingen zijn behouden. Alleen de CI-regressielijst
had een conflict; zowel leespad- als annotatietests blijven actief. De aangeleverde audit is gevolgd; alleen annotatiecode en
noodzakelijke afhankelijkheden zijn gecontroleerd. Geen nieuwe readerbediening,
studiemap, revisieherstel, FSY-conversie of productiehandeling.
De latere leespadverbetering #130 (`5370e0f0`) is eveneens zonder conflicten
geïntegreerd; de uitgebreide leespad-unitreeks slaagt met 20 tests.

## M4-migratie en databehoud

`20261104120000_annotation_targets` breidt uitsluitend Bookmark, Highlight en
Note uit: nullable verseId; lessonEditionId/revisionId/selector/targetKey;
anchorStatus, mutationVersion, lastActionId/hash en deletedAt. Geen vierde
aantekeningentabel of bulkcopy. Bestaande targetKeys worden `verse:<verseId>`;
alle oorspronkelijke kolommen, inclusief Note.updatedAt, blijven ongewijzigd.
Defaults geven versie 0, EXACT en geen tombstone/actiehistorie.

XOR-CHECKs eisen precies een vers óf een complete leseditie/revisie/selector.
De samengestelde revisie-FK bindt de revisie aan dezelfde leseditie. De bestaande
(userId, verseId)-unique blijft; (userId, targetKey) dedupliceert lestargets.
Legacy directe versinserts mogen een null targetKey houden; de service vindt
ze via de bestaande versuniciteit en normaliseert de key bij een bewuste write.

Alleen de drie annotatie→Verse-FK's veranderen van Cascade naar Restrict;
leseditie/revisie krijgen eveneens Restrict. Contentverwijdering die annotaties
zou verliezen faalt atomair. Andere deleteketens zijn niet aangepast. Account-
verwijdering behoudt de bestaande User-cascade voor privégegevens. Een import
mag deze bescherming niet met een algemene delete of cascade omzeilen.

## Selectorcontract v1

`src/lib/annotations/contract.ts` is herbruikbaar voor 4B. Een selector bevat
originalRevisionId, sectionAnchor, 1–32 ranges met blockId/start/end,
exact/prefix/suffix en normalizationVersion=1.

- Inline text/link/reference-labels worden direct aaneengevoegd, zonder
  verzonnen spaties tussen tekstfragmenten.
- Daarna Unicode NFC, alle Unicode-witruimte naar één spatie en trim.
- Offsets tellen Unicode-codepunten, niet UTF-16-code-units. Een toekomstige
  DOM-adapter moet dit expliciet converteren.
- Stabiele tekstankers omvatten paragrafen, koppen, citaten met bronregel,
  vragen/opdrachten, lijstitems, geneste blokken/kinderen, tabelcellen en captions.
  Alttekst en ruwe HTML zijn geen selectiebron. Volgorde volgt RichContentBlocks:
  itemtekst, geneste blokken, daarna aanvullende kinderen.
- Ranges staan in bronvolgorde, overlappen niet; aangrenzende ranges binnen
  hetzelfde blok moeten eerst worden samengevoegd. Quotes worden met één
  newline tussen ranges gecombineerd; prefix/suffix omvatten maximaal 32
  codepunten rond begin/einde. Exact is maximaal 12.000 UTF-16-code-units.
- De server vergelijkt offsets, quote en context exact met de immutable revisie.
  Geen fuzzy matching of automatisch herstel. TargetKey hasht editie, revisie,
  sectie en ranges; quote/context kunnen dezelfde passage niet dubbel maken.

## Service, API en concurrency

`src/lib/annotations/service.ts` is de enige writer voor nieuwe acties en de
bestaande verse-adapters. Nieuwe PUT/DELETE op `/api/annotations` gebruiken
kind, getypeerd target, expectedVersion en UUID actionId. PUT accepteert alleen
de passende note-text (maximaal 2.000 tekens) of highlightkleur. DELETE heeft
geen payloadvelden. Geen client-userId of leesbezoektoken toegestaan.

GET leest een eigen kind/id of eigen records voor één verseId/lessonEditionId,
begrensd tot 200 per type. Dit is geen studiemap-/zoekcontract. Het retourneert
uitsluitend opgeslagen privégegevens, geen volledige bronbody of profiel.
Een adminrol verleent geen toegang tot annotaties van anderen. Bestaande eigen
quotes en notities blijven leesbaar als de brontoegang vervalt; nieuwe broninhoud
wordt niet toegevoegd. DELETE van eigen gegevens blijft mogelijk.

Nieuwe PUTs eisen normale bronrechten en de actuele gepubliceerde revisie.
Beheerders mogen verborgen vrijgegeven content gebruiken; DRAFT/disabled blijven
uitgesloten. Een historisch leesbezoekbewijs geeft geen annotatieschrijfrecht.
De transactie vergrendelt collectie, les en editie/vers, daarna het eigen
kind/target met PostgreSQL advisory xact lock. Publicatie- en beschikbaarheids-
wijzigingen worden afgewacht en de rechten worden na de locks gecontroleerd.

Iedere geaccepteerde mutatie verhoogt mutationVersion éénmaal. De laatste
actie-ID plus requesthash maakt een identieke retry zonder tweede write mogelijk;
dezelfde actuele ID met andere payload is ongeldig. Oudere requests conflicteren
op expectedVersion (409 met alleen de actuele eigen annotatie). De client moet
na herstel een nieuwe actionId gebruiken, niet een oude actie herschrijven.
Dit is geen onbeperkt historisch actielog.

DELETE bewaart een tombstone in dezelfde rij. Versie/identiteit blijven bestaan;
Note.text wordt leeggemaakt. Daardoor overschrijft een oude DELETE een bewuste
heraanmaak niet en brengt een oude PUT een verwijderde annotatie niet terug.
Herbruikbare rijen behouden ID en oorspronkelijke createdAt, ook bij heraanmaak;
dit is de bewuste opslagtrade-off. Selector en laatste receipt blijven privé
bewaard om het target en retries te herkennen. Een DELETE van een nooit bestaand
target valideert eerst de actuele gepubliceerde bron en bewaart ook een
tombstone op versie 1. Zo kan een vertraagde eerste PUT op versie 0 het
verwijderverzoek niet terugdraaien. Bewuste heraanmaak vereist de nieuwe versie.

Sessies en strikte Origin-controle beschermen mutaties, ook de legacyadapters.
Bestaande browsercalls sturen Origin automatisch; andere API-clients moeten die
header leveren. Payloads zijn streaming begrensd (128 KiB nieuw, 16 KiB legacy
notities). Responses zijn private/no-store en variëren op Cookie. Geen ruwe
DB-fouten of privétekst in logs/analytics/realtime. Alleen na commit wordt het
eigen annotationsChanged-event verstuurd, met uitsluitend de annotations-scope.
Geen XP, credits, hints, reeks, leesmoment of voortgangsmutatie.

## Legacycompatibiliteit

De POST-toggles en Note PUT/lege-tekst-verwijdering houden hun responseformaten.
Een oude toggle heeft geen actionId en blijft één toggle per ontvangen POST;
alleen het nieuwe expliciete PUT/DELETE-contract garandeert retry-idempotentie.
De oude lezers en `/api/bookmarks` filteren deletedAt=null en uitsluitend verzen;
null-relaties worden niet naar BookmarksClient gestuurd. Die query gebruikt ook
de nieuwe annotatiescope. De inventarisatie telt alleen ontbrekende niet-null
versrelaties als fout, geen geldige lestargets.

## Uitrol en veilige terugval

De eigenaar verzorgt uitrol en live acceptatie; deze PR doet geen productie-
controle, backup, deployment of migratie. Synology past de additieve migratie bij
containerstart toe. Bescherm bestaande data en pin de geverifieerde 4A-image.

Een volledig pre-4A-image is na de eerste lestarget- of tombstone-write **geen
veilige rollbackbinary**: die kent nullable targets en de nieuwe schrijver niet.
Gebruik uitsluitend een compatibele 4A-image met de verse-only adapters/filters.
De technische terugvalstand `STUDY_ANNOTATION_WRITES=0` blokkeert nieuwe passage-
PUTs in de domeinservice; eigen readback, DELETE en de versadapters blijven werken.
Dit is een noodstop voor writes, geen publicatie- of zichtbaarheidsschakelaar.
Zonder deze instelling zijn de nieuwe passagewrites beschikbaar.

Bij terugval: nieuwe passagewrites stoppen, compatibele image behouden en gericht
voorwaarts repareren. Geen downmigratie, verwijdering van lestargets/tombstones of
herimport. Oudere appcode vereist eerst een afzonderlijk geteste compatibiliteits-
patch. Deze M4-releasegrens vervangt geen technische verificatie en blokkeert
geen ontwikkel-PR vanwege ontbrekende productiecontroles.

## Technisch bewijs

Lokale controles:

| Controle | Resultaat |
| --- | --- |
| Selectorcontract, Unicode, inline/nesting, multiranges en ongeldige input | 14 geslaagd, geen skips |
| Annotatie-integratie/HTTP, privacy, concurrency, DELETE/heraanmaak, pointerrace, taaleditie en terugvalstand | 14 geslaagd, geen skips |
| Bestaande contenttoegang/inventarisatie-unittests | 40 geslaagd |
| Live-data-architectuur en invalidatie | 52 geslaagd |
| Geïntegreerd leespad / Focus | 20 / 28 geslaagd |
| Inventarisatie HTTP/browser op wegwerpdatabase | 20 combinaties + vier vertalingen geslaagd; bronverwijdering behoudt annotaties vóór expliciete fixture-opruiming |
| Bestaande toegang-, context-, contentwissel-, cursus- en studiecontentregressies | 281 checks geslaagd; annotaties draaien apart op eigen fixtures |
| Migratieketen en herhaalde migrate deploy | Geslaagd; 146 bestaande tabellen en oorspronkelijke kolomwaarden behouden |
| Prisma validate/generate, TypeScript, i18n en schone productiebuild | Geslaagd |
| ESLint | 0 fouten, 159 bestaande waarschuwingen op de gecombineerde main; geen nieuwe annotatiewaarschuwingen |

De test injecteert een indexnaamconflict na eerdere ALTER/UPDATE-statements:
alles wordt teruggerold, inclusief oorspronkelijke Note.updatedAt. Invalid FK,
XOR, dedupe en het weigeren van bronverwijdering zijn met echte PostgreSQL getest.
De annotatieservice laat alle andere userId-gebonden tabellen en de User-rij
ongewijzigd. De privé-cachetest controleert Cookie binnen Next.js' samengestelde
Vary-header. Een eerdere te brede Origin-aanpassing in de testhelper is beperkt
tot versannotaties; spelasserties zijn niet versoepeld.

Annotatiefixtures gebruiken de bestaande runner met --focused op een eigen
wegwerpdatabase. Mengen met de bestaande bronwijzigende fixtures wordt expliciet
geweigerd. CI voert beide suites afzonderlijk uit en controleert ook de 14
selector-unittests. Feitelijke CI-resultaten horen bij de exact gepushte PR-head.
Geen handmatige browseracceptatie voor een 4B-interface die hier nog niet bestaat;
de eigenaar doet de live acceptatie. Er zijn geen productiecontroles uitgevoerd.
