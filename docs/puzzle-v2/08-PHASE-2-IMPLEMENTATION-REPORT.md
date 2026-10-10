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

De verplichte engine- en UX-correctie heeft de permanente stukjesbak verwijderd.
Alle stukken liggen nu eenmaal, direct en zonder duplicaat op een begrensde
werktafel. De centrale puzzelzone is zichtbaar maar geen kunstmatige barrière;
eromheen liggen losse stukken in deterministische, niet-overlappende posities.
De tafel en de camera gebruiken dezelfde world-coördinaten, zodat `fit` altijd
alle relevante stukken bevat en pan niet naar lege wereldruimte verdwijnt.

Een groepsfusie behoudt nu het bestaande groepsanker in plaats van de leden te
sorteren en daarna een andere ankerbetekenis aan dezelfde coördinaten te geven.
Daardoor renderen, hitdetectie, opslag en servervalidatie dezelfde groepsdefinitie.
De renderer draait een hele groep rond dat anker, in plaats van losse leden
onafhankelijk te draaien. Canvasresolutie wordt alleen bij echte resize vernieuwd
en tekenen wordt per animation frame samengevoegd; dit voorkomt het eerdere
flikkeren tijdens drag.

De canvas gebruikt Pointer Events en `touch-action: none`: één aanraking op een
stuk sleept de hele groep, één aanraking op lege ruimte pant het veld en twee
aanrakingen annuleren een onvoltooide drag gecontroleerd en schakelen naar
pinch-to-zoom. Hetzelfde wereldcoördinatenmodel wordt voor muiswiel, trackpad
en plus/min/fit gebruikt. De canvas is focusbaar; Master heeft een zichtbare
draaiknop (en `R`), en hints/acties geven live feedback. Reduced motion
veroorzaakt geen automatische animatielus.

## Validatie

Uitgevoerd in de herstelronde: Prisma generate, gerichte ESLint-controle en
`npm run test:puzzle` (22 tests, groen; bestaande vraag/reeks- en nieuwe
geometrie-, groeps-, worktable-, camera- en snaptests). Er is geen echt iOS- of
Android-apparaat beschikbaar; mobiele FPS, pinch en safe-area-gedrag zijn dus
niet als apparaatmeting geclaimd.

## Beperkingen/voor fase 3

Fase 2 maakt geen sockets, uitnodigingen, co-op of competitie. Het snapshot,
version- en actionId-contract is daarvoor aanwezig, maar fase 3 moet echte
transactionele row locking, TTL-locks, reconnectpatches en persoonlijke
multiplayer-viewports toevoegen. De huidige v2 Canvas-input ondersteunt
muis/touch-drag, pan, pinch, wielzoom en fit. Een volledige
screenreader-verplaatsingsdialoog en metingen op fysieke mobiele apparaten
blijven vóór een brede release nodig.
