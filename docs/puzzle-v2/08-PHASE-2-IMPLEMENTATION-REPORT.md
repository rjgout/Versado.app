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

De canvascontainer reserveert vanaf rendering een vaste ruimte en gebruikt de
focus-shell. De bak heeft geen pijlen en alle stukken blijven als DOM-knoppen
bereikbaar. De canvas is focusbaar; de geselecteerde stukstatus en hints hebben
live feedback. Reduced-motion veroorzaakt geen automatische animatielus.

## Validatie

Uitgevoerd: Prisma validate/generate, TypeScript, lint, `test:focus`, oude
`jigsaw.test.ts` en nieuwe `puzzle-engine.test.ts`. Er is geen echt iOS- of
Android-apparaat beschikbaar; mobiele FPS, pinch en safe-area-gedrag zijn dus
niet als apparaatmeting geclaimd.

## Beperkingen/voor fase 3

Fase 2 maakt geen sockets, uitnodigingen, co-op of competitie. Het snapshot,
version- en actionId-contract is daarvoor aanwezig, maar fase 3 moet echte
transactionele row locking, TTL-locks, reconnectpatches en persoonlijke
multiplayer-viewports toevoegen. De huidige v2 Canvas-input ondersteunt
muis/touch-drag en wielzoom; pinch/pan en de volledige screenreader
verplaatsingsdialoog zijn de eerste UX-verdieping die vóór een brede release
handmatig getest en aangescherpt moet worden.
