# Fase 5D-1 — visuele feedback bij bijna passende stukken (technisch rapport)

Branch `feature/puzzle-v2-phase-5d1-near-snap-feedback`, gebaseerd op `main` op `3d332b8` (fase 5C staat daar: `src/lib/puzzle/render.ts`). Alleen presentatie en lokale feedback; geen hintsysteem.

## 1. De bestaande snapregels (uit de code, niet aangenomen)
- `findSnapConnection(snapshot, geometry, difficulty, groupId, rulesVersion)` (`engine.ts`): de gesleepte groep mag niet verankerd zijn en moet `rotation === 0` hebben; de buur moet ook `rotation === 0` hebben; stukken moeten canonieke buren zijn (`areNeighbours`); de fout is de afstand tussen de werkelijke en de canonieke relatieve positie en moet `<= puzzlePolicy(...).snap` zijn; de beste kandidaat (laagste fout) wint. `connectGroups` past dezelfde afstand toe bij de echte verbinding (en valideert de structuur); de server commit opnieuw.
- `boardSnapTarget(...)`: alleen als `policy.boardSnap`, groep niet verankerd, `rotation === 0`, puzzel niet voltooid, structuur geldig, en afstand tot `boardPosition` `<= policy.boardSnapDistance`.
- Regels v2 (`PUZZLE_DIFFICULTIES`): `snap = 0,36` voor **alle** niveaus (de waarden .42/.32/.24/.20 horen bij regelversie 1), `boardSnapDistance = 0,36`; `boardSnap` = **true voor Ontdekker en Avonturier, false voor Expert en Meester**; `rotationRequired` alleen Meester (geen rotatiehulp; een gedraaide groep snapt nooit). Regelversie 1 (oude sessies): nooit bordsnap, wel de oude snapafstanden.
- **Afwijking van de opdracht: geen.** De indeling in de opdracht (Ontdekker/Avonturier verbinding + bord; Expert/Meester alleen verbindingen; Meester alleen bij de juiste rotatie) komt exact overeen met de regels. Wel opvallend: de snapafstand is in v2 voor alle niveaus gelijk; de niveaus verschillen in bordsnap, outline/spook en hints, niet in afstand.

## 2. Implementatie
- **`src/lib/puzzle/nearSnap.ts` (nieuw, puur, geen React/netwerk)**: `createNearSnapTracker().update(...)` vraagt de engine "zou loslaten hier nu snappen?": `findSnapConnection` voor verbindingen en, na een goedkope afstandspoort, `boardSnapTarget` (de autoriteit) voor de bordplek. Er is geen tweede snapengine en de afstand is niet vergroot. Het resultaat is presentatiestatus (twee randen + optioneel bordplek + `strength`). De tracker hergebruikt zijn objecten; de enige allocatie per evaluatie is de ondiepe kopie van de groepenlijst (verwijzingen) voor de lokale sleeppositie. Voltooide puzzels, verankerde groepen en onbekende groepen geven niets.
- **`src/lib/puzzle/render.ts`**: `PuzzleScene.nearSnap` en `renderPuzzle` tekent, na de groepen en vóór de hintmarkeringen, per rand halo, witte onderlaag en kern (vaste schermpixels: breedte/schaal), en voor de bordplek dezelfde drie lagen om de groepscontour op zijn bordpositie. Paden worden in dezelfde Path2D-cache bewaard (sleutel `edge:a>b`; de bordcontour hergebruikt de groepssleutel). De renderer doet geen netwerk, beslist niets en wijzigt niets.
- **`JigsawV2Client.tsx` (Solo + Tegen elkaar) en `PuzzleTable.tsx` (Samen)**: leveren alleen de status aan: ze roepen de tracker in `paint()` aan (dus hooguit één keer per frame, in de bestaande renderplanning) terwijl de speler zelf een groep sleept. Samen: alleen nadat de eigen greep gelukt is (`token`), niet na loslaten (`released`), niet voltooid en niet als een ander de groep vasthoudt (lockverlies). Remote slepers komen nooit in `drag.current` en veroorzaken dus niets. `CoopClient.tsx` en het multiplayerprotocol zijn niet aangeraakt.
- **Planning**: alleen tijdens de korte overgang bij binnenkomst (140 ms) vraagt het onderdeel een vervolgframe aan (`tracker.animating`); daarna staat het beeld stil: geen permanente `requestAnimationFrame`-lus (browsertest: 0 tekenframes bij stilstaan). Verdwijnen is onmiddellijk (buiten afstand, ongeldige rotatie, loslaten, annuleren, pinch, lockverlies, voltooid, unmount: de status leeft in refs van het onderdeel).

## 3. Gedrag per moeilijkheidsgraad
| Niveau | Verbinding tussen stukken/groepen | Bordplek | Rotatie |
|---|---|---|---|
| Ontdekker | ja (≤ 0,36) | ja, als `boardSnap` en ≤ 0,36 | niet vereist |
| Avonturier | ja | ja | niet vereist |
| Expert | ja | **nee** (`boardSnap` false) | niet vereist |
| Meester | ja, alleen bij rotatie 0 van beide groepen | **nee** | gedraaid = geen feedback, dus geen rotatiehulp |
Regels v1: nooit bordplek. Een unit-test vergelijkt over 1.500 willekeurige standen (alle niveaus, regelversie 1 en 2) de feedback met `findSnapConnection`/`boardSnapTarget` zelf: altijd gelijk.

## 4. Visuele stijl
- Alleen de aansluitende rand (aan beide kanten: het stilstaande stuk en het gesleepte stuk), geen volledige contour; bordplek als dunne contour. Rustige overgang van 140 ms, geen puls, geen flits, geen pijlen of tekst, geen nieuwe assets.
- Kleur: diep cyaan `rgb(14,116,144)` met witte onderlaag. Eerst was dit het Versado-accentblauw, maar de browsertest liet zien dat dit botste met de spelerskleur blauw (`#2563eb`) van de lock-omtrek in Samen; daarom een kleur die nergens anders op het bord iets betekent (oranje = selectie/hint, donkergroen = verankerd, blauw/roze/smaragd/paars = spelers). Kleuren staan als constanten in `render.ts`, zoals de overige canvaskleuren (het canvas leest geen CSS-tokens en het bord is in beide thema's licht).
- Contrast: kern t.o.v. de tafel `#dbe6e6` 4,2:1, bord `#edf1f2` 4,7:1, puzzelzone 5,1:1 (≥ 3:1 voor grafische elementen); op stukken zorgt de witte onderlaag voor scheiding. De tint ligt qua tint het dichtst bij het donkergroene verankerd-contour (dat altijd de hele contour is, gedempt en nooit gesleept); verschil in vorm en verzadiging is zichtbaar in de screenshots.
- Verminderde beweging (`prefers-reduced-motion`): geen overgang; direct de statische weergave op volle sterkte (browsertest: aan de ene kant direct zichtbaar, zonder de voorkeur begint de overgang zachter en eindigt gelijk).

## 5. Prestaties
Rekenkosten per evaluatie (`audit-evidence/phase-5d1-bench.ts`, node, desktop-CPU): 96 stukken 22 µs, 150 stukken 26–41 µs, 300 stukken 62–66 µs, ook bij een gesleepte groep van 25, 100 of 200 stukken (de engine zelf 3–8 µs; de rest is de ondiepe kopie). Dit gebeurt hooguit één keer per getekend frame.
Browsermeting (`phase-5c/perf-render.mjs`: 400 pointermoves, 5 runs, mediaan, headless Chromium met softwarerendering; vóór = `main` na 5C op een aparte server):
| | Scripttijd ms vóór → na | Frame p95 ms | Frames > 50 ms (max) | JS-heap MB |
|---|---|---|---|---|
| Samen 150 | 693 → 769 | 16,8 → 16,8 | 0 → 1 | 6,6 → 7,2 |
| Samen 300 | 1025 → 1055 | 33,3 → 33,3 | 4 → 1 | 6,9 → 8,1 |
| Solo 96 | 940 → 958 | 16,7 → 16,8 | 0 → 0 | 6,8 → 6,9 |
Conclusie: de extra scripttijd is +2 tot +11% (Samen 150) op deze metingen, in lijn met de microbench en binnen de spreiding tussen runs; frametijden en geheugen blijven gelijk. Geen fysiek toestel gemeten; op een telefoon kan de evaluatie een factor 4-6 trager zijn (~0,3 ms per frame bij 300 stukken, ruim binnen het framebudget).
Netwerk: geen extra serververzoeken, Socket.IO-events, polling of databasewerk (`nearSnap.ts` en `render.ts` bevatten geen fetch/socket; een statische test bewaakt dat; `CoopClient.tsx` ongewijzigd). Browsertest Samen: de socket-events tijdens slepen binnen de snapafstand zijn gelijk aan die buiten de snapafstand (alleen `puzzle:drag`) en er zijn geen nieuwe HTTP-verzoeken.

## 6. Testresultaten
| Controle | Resultaat |
|---|---|
| `npm run test:puzzle` (incl. 10 nieuwe near-snap-tests en 3 nieuwe render-tests) | 72/72 |
| Nieuwe browsertest `tests/puzzle-near-snap.browser.mjs` (productiebuild, echte muis/touch, canvaspixels, 2 browsers voor Samen) | groen |
| Browser mobile, drag, flow, navigation, difficulty, hint-inventory, records, multiplayer (300 stukken), perf | allemaal groen |
| Integratie Samen/wedstrijd/records/ranglijst; Solo + hinttegoed | 42/42; 25/25 |
| live-data, focus + shell-layout, Kompas (unit) | 52/52, 22/22, 54/54 |
| `tsc --noEmit`, eslint (0 errors), `scripts/i18n/check.ts` (geen nieuwe teksten), schone `rm -rf .next && npm run build` | ok |
Wat de near-snap-tests aantonen: feedback binnen/buiten snapafstand, terugkeren, na loslaten en annuleren geen restant, verkeerde buur (geen feedback), alle vier niveaus (bordplek alleen Ontdekker/Avonturier), Meester rotatie 0/90/180, verminderde beweging, 0 tekenframes bij stilstaan, op telefoon portrait, landscape en desktop; Samen: de slepende speler ziet het, de andere speler ziet niets (ook niet tijdens de remote sleepbeweging), geen extra verkeer, na lockverlies (een ander pakt de groep) verdwijnt de feedback terwijl de speler nog sleept, en na loslaten blijft niets achter.
Kompas/uitleg: er zijn geen nieuwe teksten; de bestaande uitleg (`jigsaw.rules*`) blijft juist, dus geen wijziging in vertalingen of `KompasTopic.version`.

## 7. Screenshotvergelijkingen
Naast elkaar vóór (main na 5C) en na (5D-1), Chromium-emulatie: `docs/puzzle-v2/audit-evidence/phase-5d1/screens/`: Solo telefoon portrait (binnen en buiten snapafstand), landscape, desktop; Ontdekker, Avonturier, Expert en Meester op de bordplek (Expert en Meester zonder hulp); Meester met juiste (0°) en onjuiste (90°) rotatie; verminderde beweging; Samen met de slepende en de andere speler naast elkaar. De cyaan rand botst niet met selectie (oranje contour blijft zichtbaar), hint (oranje markering), verankering (donkergroen) of lock (spelerskleur). Vóór-weergave: de oude build toont op dezelfde standen geen gloed (0 pixels).

## 8. Beperkingen en risico's
- Alleen Chromium-emulatie; geen WebKit of fysiek toestel. Kleur en dikte zijn op een echte telefoon niet beoordeeld.
- De feedback toont wat loslaten nu zou doen: het beste kandidaatpaar van de engine (dichtstbijzijnde fout). Pakt de speler een stuk dat al binnen de afstand ligt (bijvoorbeeld na een rotatie), dan verschijnt de gloed meteen bij het oppakken, wat klopt met de engine.
- Toetsenbordverplaatsing (pijltjes) toont geen feedback (geen sleepbeweging); niets aan het snapgedrag veranderd.
- Samen toont de feedback pas na de gelukte greep (kort na het oppakken, ongeveer een netwerkrondje) om de lockregel te respecteren.
- Na een verbinding kan de samengevoegde groep alsnog op het bord snappen (bestaand gedrag); de bordplek-feedback beoordeelt alleen de nu gesleepte groep.
- De tint ligt dichter bij het verankerd-groen dan bij de andere kleuren; zie sectie 4.
- Scripttijd stijgt licht (+2 tot +11% in de browsermeting); eventueel later te drukken met een ruimtelijke index als dat op toestellen nodig blijkt.

## 9. Bevestiging
De puzzelengine (`engine.ts`), de snapvalidatie en snapafstand (`types.ts`), moeilijkheids- en rotatieregels, hintsysteem en hinttegoed, puzzeltijd, vervolgvraag, reeksverlenging, records, ranglijsten, privacy, server-autoritaire commits, multiplayerprotocol (`CoopClient.tsx`, `src/server/puzzle.ts`), database/migraties, navigatie en de Solo-snapanimatie zijn **niet gewijzigd** (`git diff origin/main` raakt alleen `render.ts`, `nearSnap.ts`, de twee tekencomponenten, tests, `package.json` (testlijst) en documentatie/bewijs).
