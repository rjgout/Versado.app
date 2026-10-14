# Fase 5B-1 — startcamera grote puzzelborden (technisch rapport)

Branch `fix/puzzle-v2-start-camera-large-boards`. Alleen `src/lib/puzzle/viewport.ts` (`initialPuzzleCamera`) en `tests/puzzle-fit.test.ts` zijn gewijzigd; geen engine,
spelregels, database, tijdregistratie of multiplayerprotocol. Audit: `PHASE-5-UX-AUDIT.md` (F1); plan: `PHASE-5-IMPLEMENTATION-PLAN.md` (5B-1).

## Oorzaak
Voor losse stukken kiest de camera het midden tussen het dichtstbijzijnde stuk en de puzzelzone en een schaal van `min(viewport)/6`. Bij 300 stukken ligt het dichtstbijzijnde stuk 9,3 eenheden
van het puzzelmidden, terwijl een tabletscherm op die schaal slechts ≈ 3 eenheden halve breedte toont: beide vielen buiten beeld (0 zichtbare stukken). De audit-probe liet zien dat ook kleinere puzzels
op een tablet slechts 2 stukken toonden.

## Oplossing
- Een bord met **voortgang** (samengestelde groep) opent ongewijzigd op die groep.
- Bij alleen losse stukken moet het beeld het **puzzelmidden** en minstens **vier losse stukken** tonen (`MIN_START_VISIBLE_GROUPS`, rand van 0,35 stuk, voor het midden 0,5 stuk).
- Is het bestaande beeld daarvoor goed, dan blijft het **exact** zoals het was (kleinere puzzels, bestaande bediening). Anders zoomt de camera in stappen van ×0,92 uit tot ten minste `MIN_START_SCALE` = 30 px per stuk (grote borden starten dus
  niet volledig uitgezoomd; fit-all was 8–18 px) en probeert drie middens: het oude, het midden tussen puzzelmidden en de vier dichtstbijzijnde stukken, het puzzelmidden. Ontbreekt een geslaagde combinatie, dan kiest de camera op de minimumschaal de
  stand met de meeste zichtbare stukken (puzzelmidden eerst).
- Pannen en zoomen werken ongewijzigd (zelfde `constrainCamera`, zoom 8–240); de camera wordt alleen bij de eerste weergave berekend, resize houdt de bestaande stand (`resizeCamera` onveranderd). De functie is puur en deterministisch.

## Resultaat (rekenprobe, `probe-before.txt` → `probe-after.txt`)
| Scherm (stukken) | zichtbaar vóór → na | schaal px/stuk vóór → na |
|---|---|---|
| 740×360 (300) | **0 → 11** | 42 → 30 |
| 768×1024 (300) | **0 → 7** | 128 → 84 |
| 768×1024 (150) | 5 → 5 (≥ 4) | 128 → 118 |
| 360×740 (300) | 5 → 4 | 60 → 60 |
| 320×568 (300) | 5 → 12 | 53 → 42 |
Elders ongewijzigd of verbeterd. Schermafbeeldingen vóór/na (headless Chromium, DPR 2): `audit-evidence/phase-5b1/*-before.png` / `*-after.png` (Samen 300 op tablet, landscape en 320 px; Samen 150; Solo 24 tablet; Solo 96 landscape; wedstrijd 96).

## Tests
| Controle | Resultaat |
|---|---|
| `tests/puzzle-fit.test.ts` (uitgebreid): 5 schermen × 2 balkhoogtes × 24/48/96/150/300 stukken × 4 seeds: ≥ 4 stukken zichtbaar, puzzelmidden in beeld, schaal 30–160; goede oude beelden exact gelijk; voortgang ongewijzigd; zoom/resize; determinisme | 8/8 (slaagt niet met de oude code: `768×1024/916 24 stukken: 2 stukken zichtbaar`) |
| `npm run test:puzzle` | 52/52 |
| live-data, focus, shell-layout, Kompas, navigatie (unit) | 133/133 |
| Integratie Samen, wedstrijd, records, ranglijst | 38/38 |
| Browser (productiebuild): mobile, drag, flow, multiplayer (300 stukken), navigation, difficulty, hint-inventory, records, perf | allemaal groen |
| Prestaties (perf-test, 150/300 stukken) | frame p95 16,8 ms, 0 frames > 50 ms, eerste render 349/276 ms, heap ≈ 10 MB: niet slechter dan vóór de wijziging |

## Beperkingen
- Op de kleinste landscape-schermen start een 300-stukkenbord op de minimumschaal van 30 px per stuk (kleiner dan een ideaal aanraakdoel van 44 px); de gebruiker kan inzoomen.
- Alleen Chromium getest (geen Safari/WebKit, geen fysieke toestellen); schermafbeeldingen zijn emulatie.
- Vervolgstappen (5B-2, 5C, 5D…) zijn niet gestart.
