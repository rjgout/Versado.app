# Fase 5D-3 — voltooiingsbeleving en toegankelijkheid (technisch rapport)

Branch `feature/puzzle-v2-phase-5d3-completion`, gebaseerd op `main` na PR #105 (`7e334e6`, 5D-2). De 5D-2-volgorde (server legt voltooiing direct vast, laatste snap 140 ms, rustpauze 120 ms, dan de kaart) is ongewijzigd en blijft de enige route naar de kaart. Geen fase 5E (geluid en haptiek).

## 1. De bestaande voltooiingsarchitectuur
- **Solo/Tegen elkaar** (`JigsawV2Client.tsx`): stap `COMPLETE` toonde een kale kaart (afbeelding, titel, bij wedstrijden de officiële tijd, knop "Verder"), daarna `QUESTION` en `RESULT`. De uitslagkaart (`Result`) toonde altijd de kop "Puzzel compleet!", ook na een onjuist antwoord.
- **Samen** (`CoopClient.tsx`): een eigen, aparte voltooiingskaart (afbeelding, titel, deelnemers, terugknop). Geen tijd of record; geen vraag.
- **Gegevens**: de Solo-staat had geen tijd of recordinformatie vóór het antwoord. Records: `PuzzleBestRecord` per variant, modus (Solo/Tegen elkaar) en hintcategorie; Solo-record ontstaat bij een goed antwoord, wedstrijdrecord bij de finish (`registerBestRecord`); Samen heeft geen snelheidsrecord. Privacy: `sharePuzzleRecords` regelt alleen wat vrienden zien; eigen records zijn altijd eigen gegevens.
- **Mascotte**: `PersonalMascot` (gekozen gids via `CompanionProvider`) → `MascotSlot` (register, statische WebP, geen paden in pagina's); de reeksviering is een aparte overlay die al is uitgesteld op activiteitsroutes (`celebrationGate`).

## 2. Het nieuwe ontwerp
Eén gedeelde presentatiecomponent `src/components/puzzle/CompletionCard.tsx` (en `CompletionRecord`) voor Solo, Tegen elkaar (live en asynchroon), Samen en de uitslag na de vraag: geen tweede voltooiingssysteem. De oude `Completion`/`Result`/Samen-kaart zijn erdoor vervangen.
- Inhoud: voltooide afbeelding, de gekozen gids (`celebrate`), de kop, de puzzeltijd (groot, `tabular-nums`), details (niveau, aantal stukjes, hintcategorie), recordinformatie, een regel die zegt dat er nog één vraag volgt en de primaire knop onderaan ("Naar de vraag"). Design tokens (`vs-*`, `btn-primary`, `card`-stijl), geen emoji, geen decoratie, geen nieuwe kleuren; de recordnadruk gebruikt dezelfde `vs-xp`-stijl als `RecordNotice`.
- Layout: kolom op portrait; op korte schermen kleinere mascotte (80 px), kleinere kop en tijd, compacte details; onder 640 px hoogte in portrait zonder afbeelding en met de tijdtoelichting alleen voor schermlezers; in landscape (≤ 520 px hoog) twee kolommen (gids, kop en tijd links; details, record en vervolg rechts) met de knop eronder. De safe areas komen uit de shell (`--main-pad-bottom` in focusmodus).
- i18n: 13 nieuwe sleutels onder `jigsaw.completion.*` in nl, en, de, fr en es (de check meldt voor alle talen 3714/4132; geen nieuwe verschillen). Bestaande sleutels hergebruikt (`jigsaw.complete`, `puzzleRecords.*`, `puzzleTogether.match.*`, `puzzleTogether.coop.*`).

## 3. Mascotte
`<PersonalMascot state="celebrate" size={104} />` met de gekozen gids (Novi/Varo/Vera getest). Na een onjuist antwoord `encourage` (bemoedigend, nooit afkeurend); een leeg of ontbrekend asset rendert niets (`MascotSlot`), zonder emoji of andere gids; de kaart en knop blijven werken (browsertest blokkeert alle mascotbestanden). De mascotte is decoratief (`aria-hidden`), een statisch beeld: er is geen eigen animatie en dus geen herhaalde start bij herhaalde updates (de kaart wordt één keer gemonteerd, `celebrationGate` blijft ongemoeid). Eén afbeelding per kaart, `decoding="async"`, geen extra netwerkverzoeken behalve die ene WebP.

## 4. Puzzeltijd en records
- **Tijd**: alleen server-gegevens, alleen-lezen. `publicState` (`solo.ts`) geeft bij een voltooide Solo- of wedstrijdsessie een veld `completion` mee: Solo `elapsedMs = completedAt - startedAt` (dezelfde formule als het record); Tegen elkaar de door de server vastgelegde finishtijd van de deelnemer (`elapsedMs` van de `FINISHED`-deelnemer); de client rekent niets en toont `formatPuzzleTime`. Ontbreekt de tijd (`null`), dan "Tijd niet beschikbaar". Het tonen van de kaart en de vervolgvraag veranderen de tijd niet (integratietest: dezelfde `elapsedMs` vóór en na het antwoord). Samen heeft geen puzzeltijd (spelers leggen verspreid over momenten) en toont er geen; dus ook geen verschillende tijden voor dezelfde gedeelde voltooiing.
- **Records** (alleen weergave van bevestigde serverdata): `completion.hintCategory` (via `hintCategoryFor`, dezelfde regel als het record) en `completion.best` (bestaand record in die categorie, met `thisAttempt`). Solo vóór het antwoord: "Nog geen eerdere tijd in deze categorie." of "Je beste tijd (Zonder hints): 2:31", plus "Beantwoord de vraag goed: dan telt deze tijd voor je record." (een record ontstaat pas dan; er wordt vóór het antwoord nooit "nieuw record" beweerd). Na een goed antwoord toont de bestaande `RecordNotice` het door de server bevestigde nieuwe record; na een onjuist antwoord is er geen record. Tegen elkaar: het record is bij de finish vastgelegd; `thisAttempt` geeft de nadrukkelijke melding "Nieuw persoonlijk record!", anders de beste tijd. Samen: niets.
- Privacy: alleen de eigen records van de ingelogde gebruiker, geen gegevens van vrienden, geen wijziging aan `sharePuzzleRecords` of de recordopslag; de lees-query volgt `userId_variantId_mode_hintCategory`. Geen client-berekening van records.

## 5. De vervolgvraag
De kaart zegt "Nog één vraag, dan is deze activiteit afgerond." en de primaire knop "Naar de vraag" leidt naar de bestaande `Question` (selectie, inhoud, validatie, hints, reeks en wedstrijdresultaten ongewijzigd). Er is geen overslaan; de stap wordt bij herladen hersteld zoals voorheen. Nieuw is alleen dat de focus naar de kop van de vraag gaat. Een onjuist antwoord wordt niet meer als afgeronde activiteit gepresenteerd: kop "De puzzel ligt, de vraag niet", de bemoedigende gids en de regel "Deze activiteit telt niet als afgerond: er is geen reeks of record bijgeschreven." (volgt de bestaande regel dat alleen een goed antwoord de reeks verlengt en een record geeft). Bij een goed antwoord: "Activiteit afgerond." met het bevestigde record.

## 6. Verschillen per spelmodus
| | Tijd | Record | Vraag | Gids |
|---|---|---|---|---|
| Solo | server (`completedAt - startedAt`) | bestaande beste tijd; nieuw pas na een goed antwoord | ja | eigen gids |
| Tegen elkaar (live en asynchroon) | officiële finishtijd van de server (eigen poging) | bevestigd nieuw record of beste tijd | ja | eigen gids |
| Samen | geen | geen (geen snelheidsrecord) | nee | eigen gids per speler (A en B zien elk hun eigen gids) |
Eén kaart per speler, ook na reconnect en herhaalde updates (zie 5D-2-tests en de nieuwe tests).

## 7. Toegankelijkheid
- Kaart is een `section` met `aria-labelledby`; bij verschijnen verplaatst de focus naar de kop (`tabIndex=-1`, zonder scroll), zodat schermlezers de kaart voorlezen en Tab daarna op de knop uitkomt (getest). Bij het openen van de vraag gaat de focus naar de kop van de vraag (focusherstel nadat de knop verdwijnt). Er is geen modal, dus niets om te sluiten of te herstellen.
- Details staan in een lijst met `aria-label`; de mascotte is `aria-hidden`; de recordblokjes hebben `role="status"`.
- Knop minstens 44 px (min-h-12), zonder scrollen bereikbaar op elk getest scherm (zie 9); bij 200% tekst op 320 px geen horizontale overflow en de knop blijft bereikbaar (soms met scrollen, zoals bij grotere tekst te verwachten).
- Reduced motion: de kaart heeft geen eigen beweging; de 5D-2-wachttijd vervalt (kaart ~tientallen ms na de serverbevestiging; browsertest: geen lopende animaties, `document.getAnimations()` is leeg).
- Contrast: uitsluitend bestaande tokens (`vs-fg`, `vs-fg-2`, `btn-primary`, `vs-line`, `vs-xp`); geen nieuwe kleuren. Een formele contrastmeting van de tokens is niet opnieuw uitgevoerd.

## 8. Toetsenbordbediening van de puzzel
**Probleem uit de 5A-audit: bevestigd in de actuele code.** Elke pijltjesaanslag gaf een eigen serveractie: Solo `move` per aanslag (aanslagen tijdens een lopende actie gingen bovendien verloren), Samen `lock` + `commit` + `release` per aanslag (drie rondes en een broadcast per stap). Gemeten (10 aanslagen, `tests/puzzle-keyboard.browser.mjs`, vóór = main na 5D-2): Solo 10 `move`-acties, Samen 10 commits + 10 locks + 10 releases.
**Oplossing (klein en veilig):** de verplaatsing is direct zichtbaar en wordt na 280 ms stilte als één absolute `move` (met één snapcontrole, `snapAfterMove`) verstuurd; Samen doet dan één greep, één commit en één loslaten. Andere toetsen, een pointer, rotatie en hints sturen eerst een lopende verplaatsing door; een lopende actie wacht (geen verlies van aanslagen); unmount wist de timer. Serverautoriteit, lock- en commitprotocol en de snapregels zijn ongewijzigd; de stapgrootte (0,2) en klem (`clampGroupPosition`) blijven gelijk, dus de eindpositie is exact. Na: Solo 1 `move` (+ `connect` bij een snap), Samen 1 commit, 1 lock, 1 release; een pijl-naar-snap verbindt (`move`, `connect`). Geen nieuw bericht of event.

## 9. Testresultaten
| Controle | Resultaat |
|---|---|
| `npm run test:puzzle` | 93/93 |
| Integratie Solo + hinttegoed (incl. 2 nieuwe `completion`-tests) | 27/27 |
| Integratie Samen/wedstrijd/records/ranglijst | 42/42 |
| live-data, focus + shell-layout, Kompas (unit) | 52/52, 22/22, 54/54 |
| Browser flow, mobile, records, navigation, difficulty, hint-inventory, drag, motion (5D-2), near-snap (5D-1), multiplayer (300 stukken), perf | groen (flow, navigation, hint-inventory en motion alleen aangepast op de nieuwe knoptekst "Naar de vraag") |
| Nieuwe browsertests `puzzle-completion` (met `MATRIX=1`) en `puzzle-keyboard` | groen |
| `tsc --noEmit`, eslint (0 errors; geen nieuwe warnings in gewijzigde bestanden), i18n-check, schone productiebuild | ok |
`puzzle-completion` toetst: kaart zonder record, met bestaand record, met hints (categorie Met hints) en zonder hints; juist antwoord (record uit de server, in de database aanwezig) en onjuist (geen record, geen viering, bemoedigende gids, niets in de database); Samen zonder tijd, record en vraag; Tegen elkaar asynchroon en live (getoonde tijd = `elapsedMs` van de server, nieuw record door de server bevestigd); reduced motion; ontbrekende mascotte; direct openen van een voltooide puzzel; vervolgvraag bereikbaar en niet over te slaan; één kaart ook bij herhaalde updates; focus op de kop; Tab bereikt de knop; knop zonder scrollen bereikbaar, ≥ 44 px, geen horizontale overflow en geen overlap met een onderbalk op: 320×568, 390×844, 740×360 (landscape), 768×1024 en 1280×900 × Solo 6, 24, 96 stukken; Samen 24, 150, 300; en 200% tekst op 320 px. Reconnect, navigatie en herhaalde updates tijdens de voltooiing worden door de 5D-2-tests (`puzzle-motion`) bewaakt (ook voor de nieuwe kaart).

## 10. Screenshots
`docs/puzzle-v2/audit-evidence/phase-5d3/screens/` (JPEG, verkleind): Solo 24 op kleine telefoon (320×568), landscape en desktop; met bestaand record en hints; uitslag na een goed en na een onjuist antwoord; 200% tekst; Samen 24, 150 en 300; Tegen elkaar asynchroon en live; matrix (tablet 24, telefoon 96, kleine telefoon 6, landscape 96).

## 11. Prestatiecontrole (5 runs, 400 pointermoves, scripttijd ms; vóór = main na 5D-2)
| | Scripttijd | Frame p95 | Heap MB | Eerste render |
|---|---|---|---|---|
| Samen 150 | 785 → 808 | 16,7 → 16,8 | 7,1 → 7,6 | 354 → 340 |
| Samen 300 | 1145 → 1153 | 33,3 → 33,4 | 7,2 → 7,1 | 340 → 339 |
| Solo 96 | 1044 → 1000 | 16,8 → 16,8 | 7,0 → 6,8 | 603 → 506 |
Gelijk binnen de spreiding. De kaart voegt geen frames, polling of permanente lus toe; hij verschijnt pas na de bestaande wachtlogica. Eén extra afbeelding (de mascotte, ~100 kB WebP, statisch) en voor de wedstrijd/Solo-staat twee extra leesqueries op een voltooide sessie. Geen nieuwe serververzoeken door de client. Het toetsenbord vermindert serveracties (sectie 8).

## 12. Resterende risico's
- Alleen Chromium-emulatie; geen WebKit of fysiek toestel (met name de compacte indeling op 320×568 en landscape is afgeleid van pixelmetingen, niet beoordeeld op een echt apparaat).
- De Solo-tijd is `completedAt - startedAt` van de server; sessies die over dagen worden hervat tonen dus de volledige verstreken tijd (bestaand gedrag van het record).
- Bij Tegen elkaar is `best.thisAttempt` leidend voor de melding "Nieuw persoonlijk record"; bij een gelijke tijd blijft het oude record (geen melding, zoals de recordregels bepalen).
- Het toetsenbord wacht 280 ms stilte: een speler die direct na de laatste aanslag de pagina verlaat verliest die laatste verplaatsing (puur visueel op een los stuk; geen spelresultaat).
- De alleen-lezen velden in `publicState` (`completion`) zijn een kleine toevoeging aan het HTTP-antwoord van Solo/wedstrijd (geen protocol-, schema- of opslagwijziging).

## 13. Bevestigingen
Niet gewijzigd: puzzelengine, snapafstand, moeilijkheids- en rotatieregels, serverautoriteit en -validatie, puzzeltijdregistratie, recordopslag en -berekening, `sharePuzzleRecords` en privacyregels, vraagselectie, -inhoud en -validatie, hinttegoed, reeksverlenging, wedstrijdresultaten, database en migraties, het multiplayerprotocol (socket-events, `CoopClient`-logica buiten de kaart), de 5D-1-feedback en de 5D-2-animaties. Geen nieuwe dependencies.
