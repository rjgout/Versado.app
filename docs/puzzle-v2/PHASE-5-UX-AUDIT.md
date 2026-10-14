# Fase 5A — audit spelbeleving, UX en visuele afwerking

Alleen audit: er is geen applicatiecode gewijzigd. Basis: `origin/main` met PR #99 (fase 4). Bewijs staat in `docs/puzzle-v2/audit-evidence/`
(`phase-5a-geometry-probe.ts` rekent met de bestaande camera- en tafelfuncties, `phase-5a-screens.mjs` maakt echte schermafbeeldingen in Chromium).
Plan: `PHASE-5-IMPLEMENTATION-PLAN.md`. Eerder gedocumenteerde ontwerpkeuzes: `02-…`, `11-…`, `13-…`, `18-…`, `20-…`.

## 1. Huidige situatie in het kort
- **Twee canvasrenderers**: Solo/wedstrijd in `src/components/JigsawV2Client.tsx` (`paint()` regel 187, `animateSnap` 244, `snapAfterMove` 294, `finishDrag` 311) en Samen in
  `src/components/PuzzleTable.tsx` (eigen `paint` ≈ regel 90–150, `snapAfterMove` 200). Beide gebruiken de engine (`src/lib/puzzle/*`) en tekenen alle groepen bij elke vernieuwing.
- **Solo**: elke actie is een HTTP-aanroep (`/api/jigsaw-v2`); een loslaat-gebaar = `move` en daarna per snap een `connect` en eventueel een `anchor`, achter elkaar.
- **Samen**: lock → vluchtige `puzzle:drag` (≤ 20/s, client 60 ms) → `puzzle:commit` over Socket.IO; deltas ≈ 150 B.
- **Camera**: `initialPuzzleCamera` / `resizeCamera` / `fitCamera` / `zoomCamera` in `src/lib/puzzle/viewport.ts`; schaal start op `min(viewport)/6` (40–160 px per stuk), zoom 8–240.
- **Feedback nu**: 140 ms-animatie naar de snappositie in Solo (`JigsawV2Client.tsx:244-262`, uit bij `prefers-reduced-motion`), 2 px lift + schaduw tijdens slepen, oranje selectie/hintmarkeringen,
  sr-only `aria-live`-melding "stukken verbonden". Geen geluid, geen trilling, geen mascotte op de puzzelschermen, voltooiing = afbeelding + tekst (`Completion`, regel 384).
- **Records/ranglijsten** (fase 4): statische tekstkaart `RecordNotice` bij een nieuw record; Solo-voltooiing toont de puzzeltijd niet (alleen wedstrijd: `officialMs`).

## 2. Verifieerde bevindingen

Legenda: **A** = noodzakelijke bugfix, **B** = UX-verbetering, **C** = visuele verfijning, **D** = optioneel.

| # | Bevinding | Status | Cat. |
|---|---|---|---|
| F1 | **Samen/groot bord: lege startweergave op landscape en tablet.** Bij 300 stukken toont de startcamera 0 stukken op 740×360 en 768×1024 (150 stukken op tablet: 5; telefoon portrait: 5–10). | **Aanwezig, bewezen** (probe + screenshots `samen300-tablet.png`, `samen300-landscape.png`) | A |
| F2 | Fit-all geeft bij 300 stukken ±8 px per stuk (aanraken onmogelijk) en er is geen hulp om een los stuk te vinden. | Aanwezig (probe: `fitPxPerPiece` 8–18) | B |
| F3 | Twee renderers die uiteen kunnen lopen: Samen mist de snap-animatie van Solo; elke visuele wijziging moet dubbel. | Aanwezig | B (voorwaarde voor C) |
| F4 | Geen visuele aanwijzing dat een stuk bijna past; snap gebeurt pas na loslaten en kost 1+ serverrondes (Solo: sequentieel `move` → `connect`… → `anchor`). | Aanwezig | B |
| F5 | Geen geluid of trilling; geen centrale SFX- of voorkeurenlaag voor spellen. | Aanwezig | D/B |
| F6 | Voltooiingsschermen zijn kaal (afbeelding + tekst); geen mascotte/viering; Solo toont geen puzzeltijd. | Aanwezig | B/C |
| F7 | `paths` (Path2D-cache) wordt nooit opgeruimd (`JigsawV2Client.tsx:166/202`, `PuzzleTable.tsx:63/120`); sleutel per samengestelde groep → groeit tijdens lange sessies. | Aanwezig; in korte metingen verwaarloosbaar (heap ≈ 10 MB) | A (laag) |
| F8 | Toetsenbord: pijltjes verschuiven 0,2 eenheden **en sturen per toetsaanslag een serveractie** (`PuzzleTable.tsx:275-296`, Solo `moveSelectedBy`). | Aanwezig | B |
| F9 | Remote verplaatsingen in Samen springen (geen tween); geen subtiele melding wanneer een ander verbindt. | Aanwezig | B/C |
| F10 | Wedstrijdvoortgang van anderen alleen als tekst "n van m stukken"; geen balk of tempo-indicatie. | Aanwezig | B |
| F11 | Geen onderscheid in beleving tussen hintvrij en met hints (alleen in records/ranglijst). | Aanwezig (bewust) | D |
| F12 | Recordmelding is rustig maar visueel gelijk voor "zonder" en "met hints" en staat onder de kaart. | Aanwezig | C |
| F13 | `FriendPicker`-knoppen (`!px-3 !py-1.5 !text-xs`) blijven onder 44 px hoog (bestaand component, ook in de puzzelkeuze). | Aanwezig (niet puzzelspecifiek) | B |

## 3. Eerder gemelde problemen — wat is er echt nog?
| Melding | Uitkomst |
|---|---|
| Te klein speelveld | **Niet meer aanwezig.** Het canvas vult 85–95% van het scherm (`canvas 320×515 van 320×568` t/m `768×971 van 768×1024`); startschaal 53–128 px per stuk (probe). Landscape (307 px hoog) is krap maar bruikbaar. |
| Stukken niet goed bereikbaar | **Deels.** Solo (≤ 96): alle stukken liggen binnen de tafel en bereikbaar via pan/zoom; geen hulp om weggelegde stukken te vinden. **Samen 150/300: start leeg (F1).** |
| Onjuiste positionering | **Niet aangetroffen**: `puzzle-drag`, `puzzle-mobile` en `puzzle-flow` (echte pointer-events, zes schermmaten, naadpixels) slagen. |
| Navigatie onbetrouwbaar | **Opgelost in PR #94**; browsertest `puzzle-navigation` slaagt. **Niet getest op echte toestellen**: Android systeem-terug, iOS swipe-terug, Capacitor-WebView. |

Hoofdoorzaak F1 (`src/lib/puzzle/viewport.ts:36-37`): voor losse stukken kiest de camera het **midden tussen het dichtstbijzijnde stuk en de puzzelzone**. Bij 300 stukken ligt dat dichtstbijzijnde stuk
9,3 eenheden van het puzzelmidden (mediaan 15,8; zone 20×15), terwijl de zichtbare halve breedte bij `min(viewport)/6` slechts ≈ 3 eenheden is. Beide staan dus buiten beeld. Bij 24–96 stukken (3,6–5,2 eenheden) valt het nog binnen beeld.

## 4. Technische analyse per onderwerp
- **Interactie**: pointer-events met pointer capture; één vinger = slepen/pan, twee vingers = pinch; muiswiel zoom; toetsenbord (Enter selecteert, pijltjes, `0` = alles tonen, `R` draaien bij Meester). Prioriteit en lift gedocumenteerd in `13-DRAG-PRIORITY.md`. Geen bevindingen buiten F8.
- **Rendering/prestaties**: per vernieuwing één `clip` + `drawImage` per groep; vernieuwing alleen bij verandering (`requestAnimationFrame` op aanvraag, geen doorlopende lus). Gemeten (headless Chromium, 390×780 @2×, 12 sleepacties,
  dit is software-rendering): 150 stukken 16,7 ms mediaan en p95, 0 frames > 50 ms; 300 stukken idem; eerste render 1104/415 ms; JS-heap ≈ 10 MB; **geen fysieke toestelmeting**.
- **Netwerk (Samen)**: 12 sleepacties ≈ 12 KB uit en 12–26 KB in; delta ≈ 150 B; snapshot 11,5 KB (150) / 24,1 KB (300); commit p95 ≈ 75 ms. Drag-doorgifte is begrensd (client 60 ms, server 20/s); lockvernieuwing elke 5 s. Geen polling.
- **Batterij**: geen continue animatielus; de wedstrijdklok tikt met 500 ms, `useServerNow` met 250 ms (ook als er niets verandert): verwaarloosbaar maar vermijdbaar.
- **Toegankelijkheid**: canvas heeft `aria-label` en beschrijving; `aria-live`-melding bij verbinden; menuknoppen 60×60 px; records/ranglijsten getest op 320 px en 200% tekst; reduced motion: alleen de snap-animatie reageert (er is verder geen beweging op het bord).
  Open: contrast van oranje hintkleur (`#d97716`) en de lichte tafelkleuren is **niet gemeten**; schermlezerervaring van een canvasspel is beperkt (er is geen toegankelijk alternatief voor het slepen).
- **Geluid/haptiek**: er is **geen** centrale SFX-laag. Aanwezig: `lightHaptic()` (`src/lib/platform.ts:66`, alleen in de native Capacitor-app, nergens in de puzzel aangeroepen), voorleesaudio (`speechAudioSession`, `readAloudPlayerContext`) met een
  apparaatlokale voorkeur (patroon "bewaard op dit apparaat" in `ProfileSettingsViews.tsx`). Er is geen gebruikersvoorkeur voor effectgeluid in `User`.
- **Viering en identiteit**: mascottes via `MascotSlot`/`PersonalMascot` (`src/lib/mascots.ts`, o.a. `celebrate`, `thinking`); secundaire vieringen via `celebrationGate.ts` (nooit boven de resultaatkaart). De puzzelschermen gebruiken geen van beide.

## 5. Wat goed werkt (behouden)
Server-autoritaire validatie en tijden; scheiding puzzeltijd/vraag (`completedAt - startedAt`, `finishAttempt`); hint- en recordregistratie; reeksregel; privacy van records; deterministische startverdeling;
fullscreen werktafel zonder permanente toolbar; expliciete terugnavigatie; lock/lease-robuustheid; deltasynchronisatie; wedstrijdflow na voltooien; i18n in vijf talen; Kompas.

## 6. Verbeterkansen (samengevat; uitwerking in het plan)
Startcamera voor grote borden (A); gedeelde renderer (B/voorwaarde); advies-highlight "bijna passend" tijdens slepen met de pure engine (`findSnapConnection` < 0,1 ms), zonder server of staat;
Solo-voltooiing met puzzeltijd; keyboard-nudges samenvoegen; tween voor remote bewegingen; mascotte/viering via bestaande componenten met reduced motion; centrale, apparaatlokale feedbacklaag (haptiek + zeer terughoudend geluid) met uit-schakelaar; Path2D-cache opruimen.

## 7. Risico's
| Risico | Toelichting |
|---|---|
| Regressie in spelregels | Alles in 5B/5C is presentatie; engine, validatie, tijd, hints, reeks, records blijven onaangeroerd. Tests: bestaande 82 integratie + 7 browsersuites moeten ongewijzigd slagen. |
| Prestaties op oude telefoons | Meer tekenwerk (highlight, tween) kan frames kosten; onmeetbaar zonder toestel. Daarom: advies-highlight alleen bij slepen en met schakelaar voor reduced motion; meten op fysieke toestellen vóór en na. |
| Renderer-refactor | Raakt Solo, wedstrijd én Samen tegelijk; browsertests (`flow`, `mobile`, `drag`, `multiplayer`) zijn het vangnet; eerst gedragsgelijk refactoren, daarna pas nieuwe visuals. |
| Geluid/autoplay | Mobiele browsers vereisen een gebruikersgebaar; stille toestellen/silent switch; gebruiker verwacht controle. Geen nieuwe assets zonder licentie; synthese (WebAudio) vermijdt bestanden. |
| iOS Safari/WebView | Niet in deze omgeving te testen (alleen Chromium beschikbaar). |
| Mascot-/viering-botsing | Moet `celebrationGate` blijven respecteren (resultaatkaart eerst). |

## 8. Validatie in deze audit
Uitgevoerd op de actuele main (geïsoleerde testdatabase, productiebuild):
`npm run test:puzzle` 49/49; live-data, focus, shell-layout, Kompas, navigatie-unit 133/133; integratie (Solo, hintbudget, Kompas, Samen, wedstrijd, records, backfill, ranglijst) 82/82;
browser: `mobile`, `drag`, `flow`, `navigation`, `records`, `multiplayer`, `perf` slagen. Niet uitgevoerd: WebKit/Safari (niet geïnstalleerd), fysieke iOS/Android-toestellen, Capacitor-app, schermlezers (VoiceOver/TalkBack), contrastmeting.

## 9. Fysieke toesteltests (nodig)
iPhone Safari (en geïnstalleerde PWA): safe areas, pinch/pan zonder paginazoom, swipe-terug; Android Chrome: systeem-terug, adresbalk-resize; een oudere iPhone en een instaptoestel: framerate bij 150/300 stukken en 96 solo, warmte/batterij na 10 minuten;
landscape; VoiceOver/TalkBack basispad; haptiek en geluid (stilteschakelaar) in de Capacitor-app.
