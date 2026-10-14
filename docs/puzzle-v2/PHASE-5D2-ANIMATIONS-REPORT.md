# Fase 5D-2 — snapanimaties en vloeiende multiplayerbewegingen (technisch rapport)

Branch `feature/puzzle-v2-phase-5d2-animations`, gebaseerd op `main` na PR #104 (`a35fcb2`, 5D-1). Alleen visuele presentatie: engine, snapafstand, regels, servervalidatie, multiplayerprotocol (`CoopClient.tsx`, `src/server/puzzle.ts`) en database zijn niet gewijzigd.

## 1. De bestaande animatiearchitectuur
- **Solo en Tegen elkaar** (`JigsawV2Client.tsx`): `animateSnap()` werd in `action()` **gewacht vóór** `update(next)`. Na de serverbevestiging liep dus eerst een eigen `requestAnimationFrame`-lus van 140 ms (ease-out kubiek) op een synthetische `shown`-stand en pas daarna werd de bevestigde stand toegepast. Gevolg: `pending`/`aria-busy` en de overgang naar de voltooiingsstap werden 140 ms uitgesteld (gemeten: bord weer bedienbaar 285–319 ms na loslaten).
- **Samen** (`PuzzleTable.tsx`): geen snapanimatie, een verbinding sprong direct naar de nieuwe stand. Remote sleepbewegingen kwamen als `puzzle:drag` binnen (max. elke 60 ms verstuurd), werden in `remoteDrags` bewaard (700 ms geldig) en door `CoopClient` tot ongeveer 15 beelden per seconde samengevoegd (`repaintSoon`, 66 ms): de remote groep sprong van punt naar punt en bij verlopen of een bevestiging naar de nieuwe plek.

## 2. De nieuwe gedeelde animatiearchitectuur
`src/lib/puzzle/motion.ts` (nieuw, puur; geen React, netwerk, timers of eigen animatielus) levert `createPuzzleMotion(geometry)`. Eén instantie per puzzelcomponent; de component roept `update(...)` aan in zijn bestaande `paint()` en vraagt via `active()` een vervolgframe aan in zijn bestaande `schedulePaint`/`schedule`: **één** gecontroleerde planning per bord.
- **Glijden**: `update` vergelijkt de vorige en de nieuwe bevestigde stand. Alleen een groep die in een andere is opgegaan (verbinding) of nieuw verankerd is (bordplek), over een afstand die een snap kan afleggen (`max(snap, boardSnapDistance) + 0,1` uit de bestaande regels), glijdt in 140 ms met ease-out kubiek (zoals de oude Solo-animatie, binnen de gevraagde 120-180 ms) van de weergegeven plek vóór de bevestiging naar de definitieve plek. Tijdens het glijden vervangt `groups()` de samengevoegde groep door zijn delen (het gesleepte deel op de bewegende positie); daarna is het weer exact de bevestigde lijst. Elk stuk staat steeds één keer in de lijst (geen spookgroepen).
- **Bevestigde stand eerst**: de component past de serverstand direct toe. Er wordt nooit iets geanimeerd dat de server niet bevestigd heeft; een afgewezen actie verandert de stand niet en glijdt dus niet. De animatie kan de commit niet vertragen en houdt het bord niet vast.
- **Volgen van remote sleepbewegingen**: `update` leest dezelfde `remoteDrags` die `CoopClient` al vult; er is geen nieuw bericht of wijziging in het protocol.
Gewijzigd: `JigsawV2Client.tsx` (de eigen animatielus is vervangen door de gedeelde laag), `PuzzleTable.tsx`, `motion.ts`, tests en `package.json` (testlijst). `render.ts` is ongewijzigd (de renderer tekent de groepen en posities die hij krijgt).

## 3. Snapgedrag per spelmodus
- **Solo / Tegen elkaar**: de verbinding of bordplaatsing wordt bevestigd en direct toegepast (`update(next)`), het tekenen glijdt 140 ms. Het bord is bedienbaar zodra de server klaar is (gemeten 122–149 ms na loslaten in plaats van 285–319 ms). Eindtijd, wedstrijdtijd, vraag, records, ranglijsten en reeks lopen via ongewijzigde code. Bij voltooien verschijnt de voltooiingsstap direct (vroeger na 140 ms); de laatste snap wordt dan niet meer getoond.
- **Samen**: elke bevestigde wijziging die via een delta of resync binnenkomt (eigen of van een ander) wordt op dezelfde manier herkend in `paint()`; zowel de speler die verbindt als anderen zien dezelfde glijbeweging naar dezelfde definitieve stand. Een snap van een andere speler begint op de plek waar zijn sleepbeweging werd getoond (geen sprong).
- **Volgorde met 5D-1**: de bijna-passend-gloed verdwijnt direct bij loslaten (daar is `drag.current`/`released` al op afgestemd) en dus vóór de serverbevestiging en de glijbeweging; de browsertest bevestigt dat er tijdens de glijbeweging geen gloedpixels zijn. Selectie, hint- en lockkleuren blijven ongewijzigd.

## 4. Remote interpolatie
De getoonde positie van een remote gesleepte groep loopt lineair van de vorige getoonde positie naar het laatst ontvangen punt, in de tijd tussen de laatste twee ontvangen punten (begrensd op 50–120 ms). Er is **geen extrapolatie** (nooit voorbij het laatste ontvangen punt), geen voorspelling van serveracties en geen clientautoriteit: de bevestigde stand komt uitsluitend uit de snapshot. Bij uitblijvende updates blijft de groep op het laatste punt staan tot de ontvangen informatie verloopt (de bestaande 700 ms) en loopt dan in 120 ms terug naar de bevestigde positie. Wordt het sleepitem door een bevestiging verwijderd, dan loopt de weergave zacht naar de bevestigde positie of gaat over in de snapbeweging. Lokale sleepbewegingen gebruiken de laag niet (nul vertraging).

## 5. Annulering en servercorrecties
- Een nieuwe bevestigde stand voor dezelfde groep (servercorrectie) heeft voorrang: de glijbeweging vervalt direct. Een volgende snap van dezelfde groep neemt de lopende beweging over zonder sprong (één laag per doelgroep, geen dubbele animatie).
- Een sprong groter dan een snap kan afleggen (herverbinding, resync na gemiste delta's) wordt niet geanimeerd. In Solo glijdt alleen een stand die uit een bevestigde verbindings- of bordactie komt.
- Verliest een andere speler zijn lock (verlopen of vrijgegeven), dan stopt het volgen van zijn sleepbeweging direct. Verlies van de lock van de eigen speler en voltooien verbergen de bijna-passend-gloed (5D-1) en beëindigen de bewegingen; bij een voltooide puzzel is de laag uit.
- `clear()` bij unmount; een nieuwe puzzel is een nieuw onderdeel (nieuwe instantie). Geen timers: de laag gebruikt alleen de bestaande frameplanning en kan niet blijven hangen.

## 6. Reduced motion
`prefers-reduced-motion` schakelt de laag uit: geen glijden, geen interpolatie, geen terugloop; direct de bevestigde stand (Samen toont remote posities zoals voorheen). Browsertest: Solo toont met de voorkeur ten hoogste twee posities (begin en eind) en de remote sleepbeweging verandert in ~10 in plaats van ~60 beelden.

## 7. Prestatiemetingen (vóór = `main` na 5D-1, dezelfde productiebuild-scenario's, 400 pointermoves, 5 runs, mediaan, headless Chromium met softwarerendering)
| | Eerste render ms | Scripttijd ms | Frame p95 ms | Frames > 50 ms (max) | JS-heap MB |
|---|---|---|---|---|---|
| Samen 150 | 376 → 318 | 777 → 729 | 16,7 → 16,8 | 5 → 0 | 7,4 → 7,3 |
| Samen 300 | 338 → 320 | 1100 → 1097 | 33,3 → 33,3 | 0 → 1 | 8,0 → 7,7 |
| Solo 96 | 483 → 501 | 913 → 991 | 16,7 → 16,8 | 0 → 0 | 7,5 → 6,6 |
Conclusie: Samen gelijk of iets beter, Solo 96 +8% scripttijd (binnen de spreiding tussen runs); frametijden en geheugen onveranderd. Dit scenario sleept alleen lokaal; de rekenkosten van de nieuwe laag staan apart (`audit-evidence/phase-5d2-bench.ts`, node): rust 0,2–0,6 µs per beeld, twee remote slepers 5–18 µs per beeld (96–300 stukken), een snap starten 58–133 µs eenmalig, de groepenlijst tijdens een glijbeweging 3–4 µs per beeld. De laag werkt alleen op bewegende groepen; geen geometrieherberekening per frame (de Path2D-cache van 5C wordt hergebruikt). Geen fysiek toestel gemeten.
Netwerk: geen extra serververzoeken, Socket.IO-events of polling; de socket-events tijdens een snap zijn dezelfde (`puzzle:commit/drag/lock/release`) als vóór de wijziging (vergelijking in `audit-evidence/phase-5d2/metrics-*.json`); `motion.ts` bevat geen netwerk (statische test).
Bewegingsmetrics vóór → na (browsertest): Samen-snap getoond in 3-5 → 8-11 verschillende posities; remote sleepbeweging 11 → 65 veranderde beelden bij een grootste stap van 0,44 → 0,09 units; Solo bord bedienbaar 285-319 → 122-149 ms na loslaten; Solo-glijduur ongewijzigd rond 140 ms.

## 8. Testresultaten
| Controle | Resultaat |
|---|---|
| `npm run test:puzzle` (incl. 16 nieuwe `puzzle-motion`-tests) | 88/88 |
| Nieuwe browsertest `puzzle-motion` (productiebuild, echte muis/touch, canvaspixels per beeld, 2 browsers) | groen |
| Browser near-snap, mobile, drag, flow, navigation, difficulty, hint-inventory, records, multiplayer (300 stukken), perf | allemaal groen |
| Integratie Samen/wedstrijd/records/ranglijst; Solo + hinttegoed | 42/42; 25/25 |
| live-data, focus + shell-layout, Kompas (unit) | 52/52, 22/22, 54/54 |
| `tsc --noEmit`, eslint (0 errors), i18n-check (geen nieuwe teksten), schone `rm -rf .next && npm run build` | ok |
Wat de nieuwe tests aantonen: geslaagde snap (duur, ease-out, monotoon, nooit voorbij het doel), afgewezen snap (geen animatie), bordplaatsing, verbinding tussen groepen, meerdere opeenvolgende verbindingen zonder sprong, twee gelijktijdige spelers (beide verbindingen vastgelegd, geen blijvende animatie), servercorrectie tijdens animatie, herverbinden (offline tijdens de snap; eindstand bij beide spelers gelijk), uitblijvende remote updates (veilig terug), voltooien tijdens animatie (bevestigde stand leidend, geen canvas of animatie over), reduced motion, unmount tijdens animatie (navigeren geeft geen fouten en geen tekenframes), geen dubbele animatie/spookgroepen (elk stuk exact één keer in de lijst, op elk tijdstip), geen blijvende lus (0 tekenframes in rust, ook op beide Samen-clients) en geen verandering van spelresultaten (de serverstand is na elke scenario precies de verwachte).

## 9. Visueel bewijs
Frame-reeksen vóór en na onder elkaar (elk beeld waarin het bord opnieuw getekend werd, met tijdstempel): `docs/puzzle-v2/audit-evidence/phase-5d2/frames/` — Solo desktop, telefoon portrait en landscape, Solo met verminderde beweging, Samen (de speler die verbindt en de andere speler; desktop en telefoon), remote sleepbeweging met en zonder verminderde beweging. De reeksen tonen de volledige beweging: vóór springt een snap in 1-2 beelden naar de eindstand en bewegen remote stukken in stappen; na loopt de snap over ~8 beelden naar de definitieve plek en volgt de remote beweging de ontvangen punten.

## 10. Resterende risico's
- Alleen Chromium-emulatie; geen WebKit of fysiek toestel (met name de beweging op trage telefoons is niet gemeten).
- Tijdens een glijbeweging worden de delen kort met hun eigen contour getekend (zoals de oude Solo-animatie); wie in dat venster een groep pakt, pakt de bevestigde (samengevoegde) groep.
- De bewegingsdetectie hangt af van het zien van de vorige en nieuwe stand in `paint()`; bij een verborgen tabblad (geen frames) vallen meerdere wijzigingen samen en wordt een te grote sprong niet geanimeerd (veilig, direct de eindstand).
- Een snap van een andere speler in Samen toont bij ontbrekende sleep-events (korte verbinding) alleen de glijbeweging vanaf de bevestigde plek; het eerste ontvangen sleeppunt wordt in 50 ms benaderd, wat bij een ver verwijderd eerste punt zichtbaar kan zijn.
- Samen toont bij voltooien geen laatste snapbeweging (de laag wordt uitgeschakeld); Solo toont de voltooiingsstap nu 140 ms eerder.

## 11. Bevestiging
Geen wijziging aan: puzzelengine, snapafstand en -validatie, moeilijkheids- en rotatieregels, hints en tegoed, puzzeltijd, vervolgvraag, reeks, records, ranglijsten, privacy, servervalidatie, multiplayerprotocol, database of migraties, noch aan `render.ts` of `nearSnap.ts`. Geen nieuwe dependencies. Spelresultaten zijn per scenario tegen de serverstand gecontroleerd; geen extra netwerkverkeer.
