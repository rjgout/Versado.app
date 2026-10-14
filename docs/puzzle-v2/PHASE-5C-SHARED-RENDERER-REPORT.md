# Fase 5C — gedeelde canvasrenderer (technisch rapport)

Branch `refactor/puzzle-v2-shared-renderer`, gebaseerd op `main` na de squash-merge van PR #101 (fase 5B-1). Gedragsgelijke refactor: geen nieuwe animatie, effect, geluid of spelmechaniek.
Wijzigt niet: puzzelengine, servervalidatie, puzzeltijd, vervolgvraag, hinttegoed, reeks, wedstrijdresultaten, records, ranglijsten, privacy, database/migraties, multiplayerprotocol; geen nieuwe dependencies.

## Oorspronkelijke architectuur
Twee bijna identieke `paint()`-functies (audit F3):
- `JigsawV2Client.tsx` (Solo én Tegen elkaar: wedstrijdpoging is dezelfde `Puzzle`-component met `match`-context).
- `PuzzleTable.tsx` (Samen, alleen gebruikt door `CoopClient`).
Beide tekenden achtergrond, groepen, schaduw, selectie, hintmarkeringen en hielden een eigen Path2D-cache. Elke visuele wijziging moest dubbel; Samen kon daardoor niet meeliften met Solo-effecten.

## Nieuwe architectuur
`src/lib/puzzle/render.ts` bevat `renderPuzzle(canvas, scene)` en de typen `PuzzleScene` en `GroupPlacement`. Het kent geen React, HTTP, Socket.IO, Prisma, gebruiker of serverstatus; het leest alleen de aangeleverde scène.
- **Gedeeld**: canvasformaat en device pixel ratio (max. 2), camera-transformatie, tafel en puzzelzone (achtergrond, spookbeeld, gestippelde rand), groepen met beelduitsnede (één clip per echte groepscontour), schaduw en lift van 2 schermpixels, filterhint (dimmen + oplichten), selectiecontour, verankerde contour, lock-contour, hintmarkeringen (locatie, verbinding, filter), Path2D-cache (sleutel = stukkenlijst, `filter:`-sleutels).
- **Per modus via parameters** (bewust behouden verschillen): `place(group, out)` (positie, opgetild, lock-kleur; Samen: lokale sleeppositie, remote sleeppositie en lock van een ander; Solo: alleen de eigen sleepgroep), `backdrop`/`ghost`/`outline` (Solo: `rulesVersion === 1 || …`; Samen: alleen als de puzzel niet voltooid is), `edges` (Samen: uit na voltooiing), `anchoredStroke` (Solo 0,70 dekking, Samen 0,35), tekenvolgorde (`groups`, door de component bepaald: Samen legt remote sleepgroepen bovenop).
- **Blijft in de componenten**: interactie (pointer/touch/toets), camera, puzzelstatus, netwerk en locks, animatieplanning (`animateSnap` van Solo, ongewijzigd; Samen heeft nog geen snapanimatie, dat is fase 5D), lifecycle, toegankelijkheid, `puzzleRenderOrder`/remote-volgorde.
- **Prestatiekeuzes**: de scène wordt per frame als één object aangemaakt; `place` vult één hergebruikt `GroupPlacement`-object (geen object per groep per frame); Path2D-cache en canvas-instellingen zijn identiek aan voorheen; geen extra tekenoperaties, netwerkverkeer of serveracties. Het bestand `PuzzleTable.tsx` is 75 regels korter, `JigsawV2Client.tsx` 68.

Gewijzigd: `src/lib/puzzle/render.ts` (nieuw, 120 regels), `src/components/JigsawV2Client.tsx`, `src/components/PuzzleTable.tsx`, `tests/puzzle-render.test.ts` (nieuw, opgenomen in `npm run test:puzzle`), `package.json` (alleen die testlijst), meetgereedschap en bewijs in `docs/puzzle-v2/audit-evidence/phase-5c/`.

## Pixelvergelijking vóór/na
Gereedschap: `phase-5c/render-compare.mjs` (echte productiebuild, echte browser, geïsoleerde database, echte pointer/touch). Per scenario een sha256 van de canvaspixels (`canvas.toDataURL`). Deterministische testtoestand: een samengestelde groep (stukken 0-1-2), een verankerde groep, MASTER-draaiingen. Schermen: telefoon 390×844 (DPR 3 → canvas-DPR 2), landscape 740×360, desktop 1280×900.
Scenario's: Solo 24 Avonturier, 48 Ontdekker (spookbeeld + rand), 96 Deskundige, 24 Meester (rotaties) × initieel/geselecteerd/slepen (muis of echte touch, vastgehouden)/passen-op-bord; hints locatie/verbinding/filter (telefoon en desktop); Tegen elkaar 24 (initieel, slepen); Samen 150/300 Avonturier, 96 Ontdekker, 24 Meester × initieel/geselecteerd/slepen en remote-slepen met lock (twee browsers); Samen 150 hints.

| Controle | Resultaat |
|---|---|
| Deterministische scenario's (113 + 3 Samen-desktop-hints) | **116 van 116 pixel-identiek** (sha256 gelijk), geen enkel afwijkend pixel |
| Basislijn zelf, twee runs oude code | 117/121 gelijk; de 4 afwijkers zijn remote-sleepscenario's |
| Remote-slepen met lock (8 scenario's) | 6 identiek aan de oude code; 2 verschillen (3.080 en 3.537 px van 1280×847 en 780×1582) maar die twee verschillen ook tussen twee runs van de **oude** code onderling (remote positie vervalt na 700 ms en de opname is tijdsgevoelig); verklaard, geen regressie |
| Kruiscontrole Samen-desktop-hints | oude build (worktree van `origin/main`, aparte server) vs nieuwe build: 3/3 identiek |
Verklaarbare verschillen: alleen de tijdsgevoeligheid van remote-slepen. Er zijn geen onverklaarde visuele verschillen in naden, schaduw, selectie, hints, canvaspositie of schaling. Voltooide Samen-borden tonen geen canvas (completion-overzicht); de `edges: false`-tak is door een unit-test gedekt, niet door een pixeltest.
Voorbeelden (nieuwe build, pixel-identiek aan de oude): `phase-5c/screens/`; alle hashes: `phase-5c/hashes-*.json`.

## Tests
| Controle | Resultaat |
|---|---|
| `npm run test:puzzle` (incl. nieuwe `puzzle-render.test.ts`, 7 tests) | 59/59 |
| `tsc --noEmit`, eslint (0 errors; 135 bestaande warnings, geen in gewijzigde bestanden), `scripts/i18n/check.ts`, schone `rm -rf .next && npm run build` | ok |
| live-data / focus + shell-layout / Kompas (unit) | 52/52, 22/22, 54/54 |
| Integratie Samen, wedstrijd, records, ranglijst | 42/42 |
| Integratie Solo + hinttegoed | 25/25 (één test faalde eerst door achtergebleven testgegevens van mijn eigen meetruns in de wegwerpdatabase — unieke sleutel; na opruimen van die testrijen 25/25) |
| Browser (productiebuild): mobile, drag, flow, navigation, difficulty, hint-inventory, records, multiplayer (300 stukken, 500 frames: mediaan 16,7 ms, p95 16,8 ms), perf | alles groen |
Geen prisma-wijziging, dus `prisma validate/generate` niet nodig. Niet getest: Safari/WebKit en fysieke toestellen (alleen Chromium-emulatie).

## Prestaties vóór/na
Scripts: `phase-5c/perf-render.mjs` (400 pointermoves met volledig beeld, 390×780 DPR 2, mediaan van 3 runs, CDP `Performance.getMetrics`) en `tests/puzzle-perf.browser.mjs`. Headless Chromium met softwarerendering, geen fysiek toestel.
| | Eerste render (ms) | Scripttijd (ms) | JS-heap (MB) | Frame p95 (ms) | Frames > 50 ms (max van runs) |
|---|---|---|---|---|---|
| Samen 150 vóór → na | 317 → 390 | 765 → 689 | 7,3 → 6,5 | 16,8 → 16,7 | 1 → 0 |
| Samen 300 vóór → na | 302 → 343 | 1208 → 1046 | 7,9 → 8,2 | 33,4 → 33,4 | 2 → 1 |
| Solo 96 vóór → na | 540 → 531 | 916 → 902 | 7,2 → 6,2 | 16,7 → 16,8 | 0 → 1 |
Conclusie: geen aantoonbare verslechtering; de scripttijd is 1-12% lager, binnen de ruis van deze meetmethode. De eerste rendertijd varieert per run met paginalaad (netwerk, hydratatie) en wordt niet door de tekenmodule bepaald. De losse frames > 50 ms (Solo 96: 1, Samen 300: 1) zijn enkelvoudige uitschieters die ook in de basislijn voorkomen (Samen 300: 2). Netwerkverkeer en serveracties zijn ongewijzigd (de actie- en netwerkcode is niet aangeraakt; de renderer doet geen verzoeken).

## Resterende risico's
- Pixelgelijkheid is aangetoond voor de genoemde scenario's en schermen op Chromium; andere engines (Safari) kunnen dezelfde canvasaanroepen anders renderen, maar de aanroepen zelf zijn ongewijzigd.
- Remote-slepen is tijdsgevoelig en daarom niet strikt pixelvergelijkbaar (zie boven); de logica ervan staat in de component en is niet gewijzigd.
- De Path2D-cache wordt nog steeds niet opgeruimd (audit F7, fase 5B-2): bewust niet meegenomen.
- Snapanimatie voor Samen volgt in fase 5D en wordt dankzij de gedeelde module één wijziging; die is hier niet gebouwd.
