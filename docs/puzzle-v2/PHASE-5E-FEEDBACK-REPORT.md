# Fase 5E — geluid en haptische feedback (technisch rapport)

## 1. Bestaande audioarchitectuur
- Voorlezen (`readAloud.ts`, `readAloudPlayerContext.tsx`) gebruikt Web Speech; `speechAudioSession.ts` zet op iOS tijdens het voorlezen `navigator.audioSession.type = "playback"` en speelt een stil herhalend `<audio>`-fragment, en zet het daarna terug op `auto`. De podcastspeler gebruikt een `<audio>`-element.
- Er was geen spelgeluid. Voorkeuren voor voorlezen staan apparaatlokaal in `localStorage` (`jehovaapp-read-aloud-*`).

## 2. Bestaande Capacitor-integratie
`src/lib/platform.ts` heeft `isNativeApp()` en `lightHaptic()` (`@capacitor/haptics`, `ImpactStyle.Light`, fouten worden ingeslikt; op web stil). Deze fase hergebruikt precies die functie voor natieve haptiek; er is geen tweede haptiekpad en geen nieuwe dependency.

## 3. Het feedbacksysteem
`src/lib/puzzle/feedback.ts`: één client-module (`createPuzzleFeedback(env)`, gedeelde instantie `puzzleFeedback()`), herbruikbaar voor andere spellen. Alle browser-API's zitten achter een omgevingsobject, zodat de logica zonder browser getest wordt. Gebeurtenissen: `pickup`, `place`, `connect`, `complete`, `record`. De engine, `solo.ts`, `coop.ts` en `match.ts` bevatten geen feedbackcode (bewaakt door een test). Aanroepen staan uitsluitend in de componenten:
- `JigsawV2Client.tsx` (Solo en Tegen elkaar): `pickup` bij het oppakken van een eigen, niet-verankerd stuk; `connect` na een door de server bevestigde `connect`-actie (één keer per verplaatsing, ook bij een keten, en niet bij de laatste snap die de puzzel voltooit); `complete`/`record` op het moment dat de voltooiingskaart verschijnt (na de laatste snapanimatie, dus in de 5D-2/5D-3-volgorde); `record` bij Solo pas nadat het antwoord juist is en de server een record `CREATED`/`IMPROVED` teruggaf.
- `PuzzleTable.tsx` (Samen): `pickup` pas als de eigen lock bevestigd is; `connect` na een bevestigde commit van de eigen verbinding. `CoopClient.tsx`: één `complete` per deelnemer als de kaart na een live voltooiing verschijnt.
- Binnenkomende remote slepen, locks, deltas en resyncs roepen nooit feedback aan.

## 4. Geluiden
Web Audio, programmatisch, zachte sinustonen (geen bestanden, geen netwerk, geen externe dienst):
| Gebeurtenis | Geluid |
|---|---|
| pickup | één zeer zachte tik (520 Hz, 50 ms) |
| place (loslaten zonder verbinding) | bewust géén effect: bijna goed klinkt nooit als succes |
| connect | twee korte tonen (660 + 880 Hz), zachte klik |
| complete | drie opklimmende tonen (C–E–G), ca. 0,55 s |
| record | vier tonen, laatste hoger (C–E–G–C), ca. 0,65 s, alleen bij een bevestigd record |
Hoofdvolume 0,12 met per toon een piek ≤ 0,55 (dus ruim onder clipping), 8 ms fade-in en exponentiële uitloop (geen klik of piek). Cooldowns per gebeurtenis (pickup 90 ms, connect 140 ms, complete/record 1,5 s) en per sleutel één viering per sessie voorkomen opeenstapeling.

## 5. Haptiek
- Web: alleen `navigator.vibrate` als de browser dat heeft; korte patronen: connect [14 ms], complete [14,60,14], record [14,60,14,60,22]. Bij `prefers-reduced-motion` altijd één puls.
- Native: de bestaande `lightHaptic()`, één impact per puls (90 ms tussenpoos).
- Nooit bij slepen, muisbeweging, pijltjestoetsen, andermans stukken, een afgewezen/bijna-snap of de pickup.

## 6. Lokale instellingen
Twee losse schakelaars (Spelgeluiden, Haptische feedback), standaard uit, in `localStorage` (`versado:feedback-sound`, `versado:feedback-haptics`; waarde `1` = aan, afwezig = uit). Geen database, geen `User`-veld, geen API, geen serververkeer (browsertest controleert dat). Plek: profiel → Voorkeuren → "Spelgeluid en haptiek" (`?view=gameFeedback`, `GameFeedbackView` met `SettingsSection`/`SettingsToggleRow`), naast Voorlezen; de voorleesinstellingen zijn ongewijzigd. De pagina zegt "Bewaard op dit apparaat." en toont een begrijpelijke uitleg als geluid of trillen niet ondersteund wordt (iPhone-browsers kennen geen `navigator.vibrate`). Ontbreekt `localStorage`, dan blijft alles uit en gaat het spel gewoon door. Teksten staan in nl, en, de, fr en es (`profile.gameFeedback.*`).

## 7. Verschillen per spelmodus
Solo en Tegen elkaar (live en asynchroon): hetzelfde pad; bij Tegen elkaar vervangt de recordtoon de gewone voltooiingstoon als de server het record bevestigt (`best.thisAttempt`), anders klinkt `complete`. Samen: alleen eigen bevestigde handelingen; iedere deelnemer krijgt zijn eigen voltooiing (als die zelf geluid/haptiek aanzette) en het heropenen van een voltooide puzzel is stil. Er zijn geen nieuwe Socket.IO-events (de browsertest vergelijkt de verzonden eventnamen met en zonder feedback). Geluid onthult niets over de tegenstander: alleen eigen gebeurtenissen klinken.

## 8. Relatie met voltooiing en records
De server legt voltooiing en eindtijd vast vóór en los van geluid. Feedback hangt aan het tonen van de bestaande kaart (`showCompletion`-reveal) en gebruikt de bestaande statussen; er is geen nieuwe voltooiingslogica. Een onjuist antwoord, een reeds beantwoorde sessie en een heropende voltooide puzzel geven niets. Recordsberekening, privacy, vraag en reeks zijn onaangeroerd.

## 9. Browserondersteuning en iOS-stilteschakelaar
Web Audio met `webkitAudioContext`-terugval. De `AudioContext` wordt niet bij het laden gemaakt: pas als geluid aan staat én er een gebruikersgebaar is geweest (`noteGesture()` bij aanraking of toets op het bord of bij het omzetten van de schakelaar); `resume()` bij een geblokkeerde context, zonder foutmelding. Hooguit één context tegelijk; die sluit 15 s na het laatste gebaar of geluid (niet na elk geluid, omdat iOS audio alleen binnen een gebaar start en de voltooiing pas na een serverantwoord klinkt). Er draait geen permanente oscillator of timer.

## 10. Native ondersteuning
Haptiek loopt via de bestaande Capacitor-integratie. Geluid in de native webview gebruikt dezelfde Web Audio-laag. Niet op echte toestellen getest.

## 11. Toegankelijkheid
Geluid en haptiek zijn aanvullend; alle visuele feedback, toetsenbord, screenreader-tekst, focus en reduced motion zijn ongewijzigd. De moeilijkheid krijgt geen extra hulp: er klinkt niets bij een bijna-snap en de pickup-tik klinkt bij elk stuk. Spelgeluiden pauzeren of stoppen het voorlezen of de podcast nooit en we zetten de audiosessie bewust niet op `playback`: op iOS blijft zo de stilteschakelaar gelden (WebAudio in de standaard-sessie wordt door de schakelaar gedempt) en mengen de tonen zacht door een lopende spraak of podcast. Die menging is niet op een echt apparaat getest en we claimen geen gegarandeerde ondersteuning; systeeminstellingen worden niet omzeild.

## 12. Testresultaten (lokaal, productiebuild, geïsoleerde testdatabase)
- Nieuwe unittests `tests/puzzle-feedback.test.ts` (13): standaard uit; aan/uit en bewaard; geluid-aan/haptiek-uit en omgekeerd; geen localStorage, AudioContext of haptiek; geblokkeerde context; pas na gebaar; cooldown; één viering per sleutel; place stil en pickup zonder trilling; patronen/reduced motion/native; sluit-timers en dispose; engine bevat geen feedback; aanroepen alleen na bevestigde gebeurtenissen en niet bij remote slepen; geen netwerk/audiobestanden.
- Nieuwe browsertest `tests/puzzle-feedback.browser.mjs` (nagebootste `AudioContext` en `navigator.vibrate`, ook in CI-script `scripts/puzzle/test-isolated.mjs`): instellingen (standaard uit, onafhankelijk, bewaard na herladen, geen serververkeer, screenshots); Solo 24 in alle vier de standen: verbinding via toetsenbord = precies één effect, voltooiing = pickup + één melodie, recordtoon pas na het antwoord, geen tweede viering bij herhaalde updates, context sluit zichzelf, serververkeer gelijk in alle standen, geen audioverzoeken; onjuist antwoord, heropenen en bijna-snap = stil; Samen 24 (met MATRIX=1 ook 150 en 300): A pickup + complete, B alleen complete, heropenen stil, socket-events gelijk met en zonder feedback; Tegen elkaar asynchroon (met MATRIX=1 ook live): één recordviering; Solo 96 (MATRIX=1): één context, één viering. Alles groen, ook met `MATRIX=1`.
- Regressie: `test:puzzle` 106/106; browsertests completion, keyboard, motion, near-snap, multiplayer, navigation, flow, drag, difficulty, mobile, hint-inventory en records groen; puzzle-integratietests groen (Solo na opruimen van achtergebleven testvarianten); `test:profile` 12, `test:focus` 22, `test:kompas` 69 groen; `tsc` schoon; `eslint` 0 fouten (bestaande waarschuwingen); i18n-check zonder ontbrekende teksten; schone productiebuild.

## 13. Prestaties (headless Chromium, `puzzle-perf.browser.mjs`, 3 runs, vóór = origin/main, na = deze branch, voorkeuren uit)
Samen 150: frame p95 16,7 ms in beide; heap 10 MB in beide; WebSocket-frames verzonden 91–94 (vóór) tegen 92–94 (na); eerste render 325–407 ms (vóór) tegen 331–362 ms (na). Samen 300: frame p95 16,7–16,8 ms in beide; heap 10–11 MB; frames 95–98 in beide. Met feedback aan: één `AudioContext` per spelsessie, 4 oscillatoren voor een volledige voltooiing met record, geen extra requests of databasequeries, geen permanente lus of timer (één sluit-timer, na 15 s). Het scripttijd-meetscript van 5D-3 is niet opnieuw gedraaid; Solo 96 is functioneel (één context, één viering) maar niet apart in tijd gemeten.

## 14. Screenshots van de instellingen
`docs/puzzle-v2/audit-evidence/phase-5e/settings-default-phone.png` (beide uit) en `settings-both-phone.png` (beide aan).

## 15. Resterende risico's
- Alleen Chromium-emulatie met nagebouwde `AudioContext`/`vibrate`; er is niets op een echte iPhone, Android-toestel, luidspreker of via Capacitor getest. Een geslaagde browsertest bewijst de aanroepen, niet dat je iets hoort of voelt.
- iOS: het gedrag bij de stilteschakelaar en bij gelijktijdig voorlezen/podcast volgt uit de standaard Web Audio-sessie en is niet op een toestel bevestigd. iPhone-browsers kennen geen webtrilling; haptiek werkt daar alleen in de Capacitor-app.
- Een context kan door de browser opgeschort worden (autoplaybeleid, achtergrond); dan blijft het stil. Na 15 s zonder gebaar sluit hij en wordt bij het volgende gebaar opnieuw gemaakt; een voltooiing die pas daarna klinkt, kan op iOS stil blijven.
- Het toetsenbord veroorzaakt geen eigen feedback behalve de bevestigde verbinding.
- De browsertests voor keyboard, completion, motion en near-snap draaien niet in de bestaande CI-lijst (alleen `feedback` is toegevoegd); dat bestond al.
