# 18 · Bladmuziek per couplet (derde weergave)

Lofzangen heeft naast "Volledig couplet" en "Karaoke" een derde weergave: **Bladmuziek**. Elk couplet krijgt zijn eigen,
dynamisch gegraveerde partituur (SVG) met de Nederlandse tekst van dat couplet onder de noten; het refrein volgt op hetzelfde
blad. De officiële PDF is de bron en blijft leidend; de weergave verzint niets.

Alleen voor beheerders (zelfde toegang als de rest van Lofzangen). Chromium-emulatie is de enige browsercontrole die hier is gedaan:
**geen bewijs voor iPhone-Safari, een WKWebView of een echt toestel.**

## Lagen

| # | Laag | Waar | Wijzigt de analyse? |
|---|------|------|---------------------|
| 1 | Analysegegevens (herkennen, volgen) | `library/data/music/*.json`, `types.ts` | Nee, onaangeroerd |
| 2 | Gestructureerde notatie | `library/data/notation/<slug>.json`, `src/lib/hymns/notation/` | Nieuw, los ervan |
| 3 | Coupletteksten | `library/data/text/*.json` | Nee |
| 4 | Lettergreep → noot per couplet | `library/data/link/NNN.json`, `notation/lyrics.ts` | Nee |
| 5 | Muzikale ↔ visuele positie | `notation/measureMap.ts` (beat → maat), `SheetMusicView.tsx` (maat → rechthoek) | Nieuw |

De notatie komt uit **dezelfde PDF-extractie** als de analyse (`scripts/hymns/extract_score.py`, additief uitgebreid met spelling,
stokrichting, balken, bogen, rusten en fermates). `scripts/hymns/build_nld_notation.py` bouwt de bestanden en controleert dat
ze exact dezelfde noten beschrijven als de analyse. De bestanden zijn afgeleide gegevens: nooit met de hand bewerken, de
bronbestanden (PDF's) staan niet in git. Elk notatiebestand bewaart `pdfSha`, `extractor` en `v` (notatieversie); de lofzang↔compositie-relatie
zit in `compositionId`.

`notation/musicxml.ts` bouwt per couplet MusicXML (puur en deterministisch): twee balken (G/F), stemmen per stokrichting,
akkoorden, balken, triolen, overbindingen, legatobogen, fermates, opmaat, maatwissel en de lettergrepen van dát couplet plus het
refrein. Wat niet past wordt als `SheetProblem` gerapporteerd; er wordt niets gegokt.

## Renderer

OpenSheetMusicDisplay 2.2.1 (BSD-3, rendert MusicXML naar SVG, per maat positie-informatie). Beproefd op lofzang 24 (refrein, fermate,
twee balken), 82, 112. VexFlow 5 is onderzocht maar niet gebruikt: het is een lagere laag en zou een eigen graveerengine voor
meerstemmigheid, tekst en systeemafbreking vragen — precies wat niet de bedoeling is.

| Meting (desktop-Chromium, 358 px breed, zoom 60%) | 24 (refrein) | 82 | 112 |
|---|---|---|---|
| MusicXML laden | 138 ms | 37 ms | 49 ms |
| Graveren | 201 ms | 82 ms | 66 ms |
| SVG | 637 KB / 3034 knopen | 306 KB / 1113 | 462 KB / 1331 |

OSMD is 1,4 MB (362 KB gzip) en staat in een apart chunk (`dynamic import`, `next/dynamic` met `ssr:false`): pas geladen als Bladmuziek
gekozen wordt. Graveren draait op de hoofdthread; het gebeurt alleen bij een ander couplet, zoom of breedte, **nooit** bij een
positie-update (de maatmarkering is een overlay). Op een telefoon is de graveertijd niet gemeten; verwacht een veelvoud van de
desktopwaarden. Geen tegenwoordige claim over invloed op de audio-analyse: niet gemeten.

## Weergave en gedrag

- Derde modus `sheet` in `hymnPrefs.ts` (bewaard), toggle cyclisch couplet → karaoke → bladmuziek, ook in het instellingenpaneel.
- Zoom: `−`/`+` in de kop (70–200%, 100% = ca. drie maten per systeem op een telefoon); het blad herverdeelt systemen, de pagina krijgt nooit
  horizontale scroll. Pinch-zoom is niet gebouwd; browserzoom is niet geblokkeerd.
- Verticaal scrollen in de bestaande leesruimte; geen overlap met de bediening (getest). Couplet wisselen gebeurt zonder herladen
  en zonder nieuwe microfoon- of muzieksessie.
- **Niveau A** lezen zonder microfoon: altijd. **Niveau B** maatmarkering: alleen bij betrouwbare positie (`locked`/`recovered`, niet gepauzeerd),
  tijdens de zang (niet in het voorspel), in het getoonde couplet én een gevalideerde coupletgravure (`markableMeasure`).
  Anders verdwijnt de markering. **Niveau C** (noot): niet gebouwd.
- Handmatig bladeren: dezelfde leesstand als karaoke (`useReadingScroll`, `reading.ts`): eigen scrollgebaar zet alleen de automatische
  navigatie op pauze ("Zelf bladeren" + "Automatisch volgen hervatten"); engine en microfoon lopen door; geen terugscroll.
- Geen notatie of geen betrouwbare tekstkoppeling: eerlijke melding; de noten staan er zonder verzonnen tekstplaatsing en de tekst blijft
  leesbaar in de andere weergaven.
- **PDF-fallback: niet ingeschakeld.** Rechten voor het tonen van de originele PDF's zijn niet bevestigd en de bronbestanden staan bewust niet
  in git of in de Docker-image. Er is dus geen route die ze serveert; wie de fallback wil, moet eerst de rechten vastleggen
  (`01-SOURCE-AUDIT.md`) en een admin-only route met configureerbare bronmap toevoegen. Lofzangen zonder notatie vallen terug op de tekst.

## Beveiliging, caching, offline

- `GET /api/hymns/<n>/sheet`: eerst `hymnsApiAllowed()`, anders 404 (ook uitgelogd); geen statische bronbestanden in `public/`.
  Het antwoord bevat alleen notatie, validatiestatus en lettergrepen; nooit audio of persoonsgegevens.
- Client: `loadHymnSheet` (`hymnLibraryClient.ts`) bewaart per lofzang in IndexedDB, met de sleutel `sheet:v<NOTATION_VERSION>:<n>` en de dataversie van de
  bibliotheek. **Verander je de notatie of de MusicXML-bouw, verhoog dan `NOTATION_VERSION`** (`notation/types.ts`).
- Alleen de geopende lofzang wordt opgehaald; er wordt niet voorgeladen (alle coupletten van een lofzang delen dezelfde notatie).
  Volledig offline is alleen getest voor de tekst; offline bladmuziek is niet apart gemeten en wordt niet beloofd.

## Tests

- `npm run test:hymns` (incl. `tests/hymns-sheet.test.ts`): notatie ↔ analyse, lettergrepen, MusicXML (sleutels, fermate, tekst, refrein), couplet 2 = dezelfde noten
  met andere tekst, **maatsommen van alle 173 lofzangen** (vond een echte fout in de backup-berekening), positiemapping, voorkeuren, beveiliging, privacy.
- `scripts/hymns/e2e-sheet.mjs` (22 controles: iPhone 390, 320, landschap, tablet, desktop, donker, zoom, coupletwissel, geen overflow, geen
  overlap met de bediening, 404 voor gewone gebruikers) en `scripts/hymns/e2e-sheet-sync.mjs` (11 controles met nep-microfoon, lofzang 82: geen markering in het voorspel,
  markering volgt de zang, zelf bladeren zonder terugscroll, één microfoon bij weergavewissel, hervatten).
- Audit voor het rapport: `npx tsx scripts/hymns/sheet-audit.ts [uitvoer.json]`.

## Kwaliteitsrapport

Peildatum: bibliotheek `dataVersion d1abcf327ed0`. Aantallen komen uit `sheet-audit.ts` en het manifest.

| Maatstaf | Aantal |
|---|---|
| Officiële Nederlandse lofzangen | 205 |
| Met beschikbare officiële PDF | 202 |
| Met gestructureerde notatie (171 unieke composities) | 173 |
| Met correct gegenereerd couplet 1 (tekst onder alle noten, geen problemen) | 161 |
| Met alle coupletten correct (584 coupletten met notatie, 530 correct) | 145 |
| Met correct weergegeven refrein (van 34 lofzangen met refrein en notatie: refrein gekoppeld 32; refrein én alle coupletten correct 28) | 32 |
| Met gevalideerde maatmarkering (minstens één couplet `ok`: 167; alle coupletten `ok`: 145) — in de browser gemeten met echte synchronisatie: alleen lofzang 82 (nep-microfoon, synthetische dienst) | 167 |
| Met gevalideerde nootmarkering | 0 (niveau C niet gebouwd) |
| Alleen PDF-fallback | 0 (fallback niet ingeschakeld; rechten onbevestigd) |
| Zonder dynamische bladmuziek | 32 |

Een geslaagde render zonder tekstvalidatie telt niet als gevalideerd coupletblad: een couplet is `ok` alleen als elke lettergreep aan een noot hangt en de bouw geen problemen meldt.

### Lofzangen zonder dynamische bladmuziek (32)

- **29** met PDF maar `onzeker` in de analyse (extractie klopt niet met de maatsoort, namelijk 1, 9, 11, 47, 57, 69, 80, 83, 84, 85, 96, 99, 105, 107, 119, 123, 136, 138, 139, 146, 150, 154, 164, 167, 170, 179, 181, 190, 204); 154 bovendien met een harde
  tekstafwijking in het refrein. Een notatie zonder gevalideerde maatlengte zou muzikaal onjuist zijn.
- **2** zonder tekst door een licentiebeperking (54, 151) en **1** zonder muziek (86: geen PDF beschikbaar).

### Coupletten zonder tekst onder de noten (54 van 584)

- 22 coupletten in 9 lofzangen (6, 23, 53, 82 couplet 5–6, 100, 103, 127, 131, 160) hebben alleen een regelkoppeling: de lettergreepposities ontbreken, dus er komt bewust geen tekst onder de noten; de noten staan er wel.
- 31 coupletten (lofzangen 36, 37, 61, 66, 71, 112, 116, 134, 141, 142, 145, 162, 185, 188, 191, 197): een lettergreep valt op een beat waar de G-balk geen noot begint (meestal een langere noot
  uit de vorige beat of een noot alleen in de F-balk). Dit is **structureel oplosbaar in de importpipeline**: bewaar bij de koppeling ook de x-positie van de lettergreep en koppel aan de
  dichtstbijzijnde noot van de zangbalk in plaats van de dichtstbijzijnde notenkolom.
- 1 couplet met een woord zonder lettergreepkoppeling.

### Bekende beperkingen

- 447 bogen (op 171 composities) kon de extractor niet aan twee noten koppelen (`unresolvedCurves`); die staan niet op het blad. Dat is een omissie in de gravure van legatobogen, geen onjuiste noot. Structureel
  oplosbaar in `extract_score.py`.
- Refrein: alleen de eerste variant wordt aan het blad gekoppeld; afwijkende refreinvarianten (ook bij lofzang 154) zijn niet beschikbaar.
- Triolen, balken en bogen zijn gecontroleerd op een steekproef (24, 82, 112 en de maatsommen van alle lofzangen), niet visueel op alle 173 composities. Een volledige visuele vergelijking met de PDF's is niet uitgevoerd.
- Geen test op echte iPhone-/Android-toestellen; geen pinch-zoom; geen offline-meting; geen meting van de graveertijd op een telefoon.
