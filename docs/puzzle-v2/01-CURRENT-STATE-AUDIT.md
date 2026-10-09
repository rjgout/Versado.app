# Legpuzzel 2.0 — huidige situatie

Status: fase 1-audit, 9 oktober 2026. **BEVESTIGD** betekent aangetroffen in de repository; **RISICO** en **VOORGESTELD** zijn toekomstig.

## Bevestigde architectuur en data

`src/app/jigsaw/page.tsx` vereist sessie, `GameSettings.jigsawEnabled` en `gameKeys.includes("jigsaw")`; daarna rendert hij `JigsawClient`. De enige API is `POST /api/jigsaw` (`src/app/api/jigsaw/route.ts`) met `start`, `resume`, `place`, `answer`.

`src/lib/jigsawGame.ts` bouwt een catalogus uit `prisma/kidsManifest.json`: 54 verhalen, 216 unieke bestaande bestanden onder `public/kids/images/`. De 162 vragen staan in `prisma/jigsawQuestions.json`, via `src/lib/jigsawQuestions.ts`, volledig voor nl/en/de/fr/es. `tests/jigsaw.test.ts` bewaakt de afbeelding-verhaalkoppeling, minstens drie vragen per verhaal en unieke opties.

Een poging is uitsluitend een gesigneerde, gebruiker-gebonden JWT met 24 uur geldigheid: afbeelding-index, 6/12/24/48, bakvolgorde, geplaatste indices, poging-id, en na voltooiing vraag plus antwoordvolgorde. Alleen het token staat in `sessionStorage`. Er is geen Jigsaw-Prisma-model, geen persistente gedeeltelijke voortgang en geen multiplayer.

`src/lib/jigsaw.ts` kiest vaste rasters (3×2, 4×3, 6×4, 8×6). `jigsawPiecePath` maakt een SVG-vorm met één afwisselende Bézier-tab; `placeJigsawPiece` accepteert een clientpositie alleen binnen het doelvak van het indexstuk. Dit is dus een server-gevalideerde rasterplaatsingspuzzel, geen vrij leggen.

Na voltooiing kiest de server een vraag. `answerJigsaw` roept `completeJigsaw` in `src/lib/streak.ts`; die claimt idempotent `jigsaw-answer:<attempt>` en doet bij een goed antwoord `finishActivity(..., {kind:"GAME"}, null, ...)`: wel reeks, bewust geen XP. Een fout antwoord is definitief. `tests/jigsaw.integration.test.ts` dekt dit wanneer `LEARNING_TEST_DATABASE_URL` bestaat.

## Huidige UI, content en hergebruik

`JigsawClient.tsx` is focusroute (`focusMode.ts`) met `FocusLayout`. Het bord is een `overflow-auto`-container met `maxHeight:48svh`, een raster van knoppen en daaronder een bak met vaste pijlen. Een stuk wordt geselecteerd en daarna op een cel getikt, of vanuit de bak gesleept. Preview en ghost-afbeelding zijn handmatige permanente toggles. Er zijn geen zoom/pan, rotatie, hints, geluiden, records, timer of multiplayer.

Alle zichtbare teksten zitten onder `jigsaw` in vijf `src/lib/i18n/messages/*.ts`. `GAME_CATALOG` bevat id `jigsaw`; de cover is `public/images/games/legpuzzel.png`; de adminschakelaar is `GameSettings.jigsawEnabled`. Behouden: catalogus, afbeeldingen, vragen, verhaalrelatie, correcte-antwoordbeveiliging, `completeJigsaw`, content-scope, `FocusLayout`, i18n, `useConfirm` en deeplink `/jigsaw`.

| Probleem | BEVESTIGDE oorzaak/bestanden | VOORGESTELDE richting | RISICO |
| --- | --- | --- | --- |
| A kleine stukken | Bakknoppen zijn `w-24 h-24`; het bord is op 48svh begrensd (`JigsawClient.tsx`). | Schaalbare bak en world-space viewport. | Safe areas/tekst mogen niet worden weggedrukt. |
| B pijltjes/selectie | `previousPieces`/`nextPieces` zijn vaste bedieningsroute; tikken selecteert vóór rastercel. | Direct drag; toegankelijke alternatieve actiepad. | Toetsenbord mag niet verslechteren. |
| C/D gelijke vormen | `jigsawPiecePath` gebruikt alleen `sign(column + row)`. | Seeded edge-descriptors met positie/breedte/diepte/tab-slot. | Legacy sessies moeten gedurende TTL afronden. |
| E lijnen altijd zichtbaar | Alle paden uit `game.order` worden met opacity .18 getekend. | Difficulty-policy voor contouroverlay; voltooid zonder naden. | Ontdekkercontrast/dark mode. |
| F laat groeiend bord | Bord verschijnt pas na `Image.onload`; startaspect 1.5 wordt daarna natuurlijke aspectratio. | Aspect vooraf catalogiseren en worldruimte vooraf reserveren. | Assetmetadata valideren. |
| G desktoptoegang | Pointer-drag/rasterknoppen, geen zoom/pan/groepfocus. | Keyboard pak/verplaats/plaats + fit/reset. | Canvas geen black box maken. |
| H lange labels | Starre `w-11 h-24`/`w-24 h-24`; oude emoji/brandstijl. | `docs/LAYOUT.md`: rem, min-h, min-w-0, `vs-wrap`. | 320px/200%/Duits testen. |

De visuele symptomen A/F/H volgen uit brononderzoek; bevestig ze vóór fase 2 op echte apparaten. **RISICO:** `server.ts` eager-importeert `gameServer.ts`; transitive modules mogen geen runtime `next/headers` importeren. Socket.IO Redis verspreidt events, maar gewone live-roomstatus staat lokaal in `Map`; dit patroon is ongeschikt voor een persistente gedeelde puzzel.
