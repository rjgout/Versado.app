# Header-overlap en Woordzoeker-layout — gerichte reparatie

Werkbranch: `fix/header-wordsearch-layout`, vanaf actuele main `ccb9d48`.
Commits: `7904d2b` (laaghiërarchie), `827d5d7` (moeilijkheidskeuze), gevolgd door
één commit met browserbescherming, bewijs en dit rapport. Geen merge naar main.

## Bevestigde oorzaken

De bestaande productie-interface is vóór de reparatie gestart met een eigen
PostgreSQL 16-wegwerpdatabase, alle migraties en echte pagina's/API's. De baseline
is gecontroleerd met computed styles, DOM-ancestry, `elementFromPoint` en screenshots.

1. **Header-overlap:** `StickyHeader` en `BottomNav` hadden `z-20`, net als het
   actiemenu van `ContentCard`. De pagina staat later in de DOM; zonder eigen
   onderliggende stacking context schilderde het kaartmenu daardoor vóór de header.
   Op het midden van een naar de header gescrolde menuknop raakte de hit-test bij
   Leren en Spelen de cirkel in het ⋯-icoon. Op Vandaag raakte dezelfde controle
   juist de header. `SortableList` gebruikt nog steeds FLIP-transforms: die maken
   tijdelijk stacking contexts, maar regelen geen permanente laaghiërarchie.
   Zijn `DragOverlay` kreeg daarnaast geen expliciete laag en gebruikte de
   standaard `z-index: 999` van dnd-kit. De ContentSwitcher staat al correct in
   een body-portal met `z-40`.
2. **Woordbreuk:** de startpagina forceerde `grid-cols-3`. De `.card`-padding en
   de `.btn`-padding lieten op 390px slechts ongeveer 97px per knop over, waarvan
   circa 40px padding was. Het globale `body { overflow-wrap: anywhere }` brak de
   labels daarom binnen woorden. In de echte browser hadden Makkelijk, Gemiddeld
   en Moeilijk op 390px ieder twee tekstregels; op 320px respectievelijk 3/4/3.
   Bij 200% tekst nam ook de rem-padding toe, waardoor het probleem verergerde.

## Technische oplossing

De bestaande gedeelde laaghiërarchie is gericht gecorrigeerd:

| Onderdeel | Laag |
|---|---:|
| Gewone inhoud en kaartmenu's | ≤20 |
| Actieve sleepkaart (`SortableList`) | 25 |
| Vaste boven- en onderbalk | 30 |
| ContentSwitcher-portal | 40 |
| Bestaande dialogen/sheets | 50 en hoger |

Alleen de lagen veranderen. Geen nieuwe stacking context op `<main>`, geen
nieuwe positioneringsmodellen, scrollcontainers, headerhoogtes of pagina-offsets.
Bestaande inline dialogen behouden hun globale laag. Kaartmenu's, herordenen,
FLIP, de sleepplaatshouder en de contentkiezer blijven werken; de sleepkaart blijft
boven andere kaarten en onder de navigatie. `docs/LAYOUT.md` en de bestaande
shell-contracttest beschrijven/bewaken deze volgorde.

Woordzoeker gebruikt lokaal:
`repeat(auto-fit,minmax(min(100%,9rem),1fr))`. De minimummaat schaalt met de
tekst en wordt begrensd door de beschikbare ruimte. De drie knoppen hebben
gelijke breedtes, `min-h-12` en `whitespace-nowrap`. Lokale horizontale padding
houdt ook bij 200% tekst ruimte voor het volledige label. De globale
woordafbreekregel en alle globale knopstijlen blijven ongewijzigd. De bestaande
kleuren, geselecteerde toestand, teksten en knop Spelen blijven behouden.

## Gewijzigde bestanden

Productiecode, uitsluitend deze vier componenten:

- `src/components/StickyHeader.tsx`
- `src/components/BottomNav.tsx`
- `src/components/SortableList.tsx`
- `src/components/WordSearchClient.tsx`

Bescherming/oplevering:

- `tests/shell-layout.test.ts`
- `tests/header-wordsearch.browser.mjs`
- `scripts/layout-audit/test-isolated.mjs`
- `.github/workflows/header-wordsearch.yml`
- `package.json`: `test:layout:browser`
- `docs/LAYOUT.md`, dit rapport en `docs/evidence/header-wordsearch/`

Geen wijzigingen aan API's, database/schema, generator, selectievalidatie,
reeks- of XP-afhandeling, contentrechten of navigatielogica.

## Uitgevoerde controles

De volledige browsertest draait op de daadwerkelijke Next-productiebuild met
echte authenticatie, API's en een eigen tijdelijke database; geen gemockte
spelresponses. De runner past alle 132 migraties toe en verwijdert zijn eigen
server/container na afloop. Productiegegevens zijn niet benaderd.

Alle onderstaande viewports zijn gemeten in licht én donker, op 100% én 200%
tekst: 7 × 2 × 2 = 28 combinaties.

| Viewport | Context | Kolommen bij 100% |
|---|---|---:|
| 320 × 844 | kleine telefoon, portrait | 1 |
| 375 × 844 | telefoon, portrait | 2 |
| 390 × 844 | telefoon, portrait | 2 |
| 430 × 932 | grote telefoon, portrait | 2 |
| 768 × 1024 | tablet, portrait | 3 |
| 1280 × 900 | desktop | 3 |
| 844 × 390 | telefoon, landscape | 3 |

Per combinatie: Vandaag/Leren/Spelen, header-hit-tests tijdens scrollen,
onderbalkpositie, contentmenu boven de balken/kaarten, Escape, tekstregels en
tekstgrenzen van alle moeilijkheden, gelijke knopbreedtes, aanraakhoogte,
selectie en daadwerkelijke bereikbaarheid van Spelen boven de onderbalk.
Safe areas zijn gesimuleerd via de bestaande centrale variabelen. De vier
andere UI-talen zijn aanvullend op 320px/200% gecontroleerd.

Aanvullend op mobiel en desktop: kaartmenu openen/toetsenbord/herordenen,
persistente volgorde na herladen, echte FLIP-frames en actieve sleepkaarten
onder de bovenbalk en (mobiel) de onderbalk. Geen clientfouten.

Alle drie moeilijkheden zijn via de UI en echte API gestart, gegenereerd en
volledig gespeeld, met een echte touchselectie bij Makkelijk. Gemeten bestaande
regels: EASY 8×8/5 woorden/10 XP, MEDIUM 11×11/9 woorden/15 XP, HARD 14×14/12
woorden/20 XP. Oplossingsposities blijven verborgen tot gevonden/voltooid. Een
retry van het laatste antwoord geeft geen dubbele XP of reekswijziging.
Terugbalk vanuit de keuze en Terug naar spellen na afronden werken.

Overige controles:

- TypeScript na beide codewijzigingen en na de schone build: geslaagd.
- 23 focus/shell-tests, 4 generator-tests en 7 kaarttests: geslaagd, zonder skips;
  het databasedeel van de kaarttests gebruikt dezelfde wegwerpdatabase.
- ESLint: 0 fouten, 132 reeds bestaande waarschuwingen; nieuwe test/runner 0.
- i18n: ongewijzigd 3652 Nederlandse sleutels, 3229 vertaald per overige taal;
  de 423 bestaande ontbrekende sleutels buiten deze reparatie blijven gelijk.
  Geen nieuwe of gewijzigde gebruikersgerichte teksten.
- Schone lokale productiebuild en git diff-check: geslaagd.
- De branchworkflow voert productiebuild, browsertest, regressietests, TypeScript,
  lint en i18n opnieuw uit op de gepushte commit; actuele runlink/status staat
  in de oplevering. Browserartifact wordt zeven dagen bewaard.

## Visueel bewijs

Vaste voorbeelden in de branch, naast de volledige CI-artifacts:

- [Leren vóór](evidence/header-wordsearch/header-before-courses-390.png) /
  [Leren na](evidence/header-wordsearch/header-after-courses-390.png)
- [Spelen vóór](evidence/header-wordsearch/header-before-live-390.png) /
  [Spelen na](evidence/header-wordsearch/header-after-live-390.png)
- [Actief slepen onder de header](evidence/header-wordsearch/drag-under-header-390.png)
- [Woordzoeker vóór](evidence/header-wordsearch/wordsearch-before-390.png) /
  [Woordzoeker na, 390px](evidence/header-wordsearch/wordsearch-after-390.png)
- [320px, 200% tekst](evidence/header-wordsearch/wordsearch-after-320-200.png)
- [Desktop, donker](evidence/header-wordsearch/wordsearch-after-desktop-dark.png)

## Grenzen en aandachtspunten

De mobiele controles gebruiken echte Chromium-touch-emulatie, geen fysieke
Safari/iPhone- of Android-WebView-test. De bestaande toegankelijkheidsregel
voor een header hoger dan 34% van de viewport blijft behouden: zo'n header
scrolt mee om ruimte voor de inhoud te laten, zoals voorgeschreven in LAYOUT.
De test bewaakt de vaste balken waar die bestaande regel niet van toepassing is.
Bij 200% tekst mag de pagina verticaal langer worden; de knoppen en Spelen
blijven volledig leesbaar en met normaal scrollen bereikbaar.

Geen bekende resterende functionele fout binnen de geteste reparaties. De
algemene lint-/i18n-achterstand hierboven is niet onderdeel van deze opdracht.
