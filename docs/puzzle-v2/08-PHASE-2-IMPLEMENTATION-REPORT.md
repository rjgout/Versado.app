# Legpuzzel 2.0 — fase 2 implementatierapport

## Geïmplementeerd

- Pure v2-engine in `src/lib/puzzle/`: versioneerde seeded geometrie,
  complementaire gedeelde randen, groepssnapshot, verplaatsen, roteren,
  canonieke snap en voltooiing. De engine heeft geen React- of Canvasimport.
- Additief Prisma-model en migratie voor definitions, variants, duurzame
  solosessies, idempotente acties en toekomstige persoonlijke records.
- `src/lib/puzzle/solo.ts` bewaart alleen stabiele acties/snapshots, herstelt
  sessies per eigenaar, registreert hints en handhaaft vraag/reeks via de
  bestaande `completeJigsaw` zonder XP.
- Nieuwe v2 API en route-UI: Canvas-world, vrije stukken/groepen, muis/touch
  slepen, wielzoom, passen/zoomknoppen, selectable bak, Master-rotatie,
  hintacties en inhoudsvraag. De oude `/api/jigsaw` blijft beschikbaar voor
  uitgegeven legacy-JWT's; nieuwe `/jigsaw` starts gaan naar v2.

## Data en compatibiliteit

De migratie is uitsluitend additief en is niet toegepast. Definitions worden
on demand en deterministisch uit de bestaande catalogus aangemaakt; afbeeldingen,
vragen, manifest en historische `StreakActivity` veranderen niet. Een legacy
token kan de oude route gedurende zijn 24-uurs geldigheid afronden. Nieuwe
records bevatten variantregels, geometrieversie en hinttellers voor fase 4.

## UX en toegankelijkheid

De mobiele herstelronde houdt het speelveld, de viewportbediening en de
stukjesbak bewust los van elkaar. De canvascontainer reserveert vanaf rendering
minimaal 48svh en de `fit`-camera centreert de puzzel meteen. Bovenaan staan
alleen terug, context/voortgang en voorbeeld; onder het veld staan compacte
icoonknoppen voor zoom/fit en niet-afbrekende filterchips; daaronder staat een
afzonderlijke horizontale stukjesbak met grote afbeeldingsstukken. Er zijn geen
pijlen of dominante technische stuklabels meer.

De canvas gebruikt Pointer Events en `touch-action: none`: één aanraking op een
stuk sleept de groep, één aanraking op lege ruimte pant het veld en twee
aanrakingen schakelen gecontroleerd naar pinch-to-zoom. Bij het loslaten van
een vinger blijft de andere vinger een panbeweging; een drag wordt dan niet
alsnog opgeslagen. Hetzelfde wereldcoördinatenmodel wordt voor muiswiel,
trackpad en de plus/min/fit-knoppen gebruikt. Een stuk kan rechtstreeks vanuit
de bak naar het veld worden gesleept. De canvas is focusbaar; geselecteerde
stukken hebben zichtbare feedback, Master kan via knop of `R` draaien en
hints/acties geven live feedback. Reduced motion veroorzaakt geen automatische
animatielus.

## Validatie

Uitgevoerd in de herstelronde: Prisma generate, gerichte ESLint-controle en
`npm run test:puzzle` (17 tests, groen; bestaande vraag/reeks- en nieuwe
geometrietests). Er is geen echt iOS- of Android-apparaat beschikbaar; mobiele
FPS, pinch en safe-area-gedrag zijn dus niet als apparaatmeting geclaimd.

## Beperkingen/voor fase 3

Fase 2 maakt geen sockets, uitnodigingen, co-op of competitie. Het snapshot,
version- en actionId-contract is daarvoor aanwezig, maar fase 3 moet echte
transactionele row locking, TTL-locks, reconnectpatches en persoonlijke
multiplayer-viewports toevoegen. De huidige v2 Canvas-input ondersteunt
muis/touch-drag, pan, pinch, wielzoom en fit. Een volledige
screenreader-verplaatsingsdialoog en metingen op fysieke mobiele apparaten
blijven vóór een brede release nodig.
