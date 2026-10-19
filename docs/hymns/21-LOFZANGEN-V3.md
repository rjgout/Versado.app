# Lofzangen V3: één luisterknop, zang volgen, woorden synchroniseren

Productregel: *Versado luistert naar de mensen en probeert te bepalen welk woord zij zingen. Het schrijft nooit voor op welk tempo zij moeten zingen.*

Alle analyse blijft lokaal op het toestel (geen audio naar server, opslag of analytics; `tests/hymns-privacy.test.ts` bewaakt dit, ook voor de nieuwe `pitchy`-import).

## Wat er veranderd is

| Onderdeel | Bestand | Werking |
|---|---|---|
| Eén knop | `components/hymns-poc/HymnsPocClient.tsx`, `copy.ts` | "Start luisteren" → "Stop luisteren". Zonder gekozen lofzang: bibliotheekbrede herkenning; met gekozen lofzang: direct volgen. "Zang begint" en "Opnieuw synchroniseren" zijn secundaire knoppen; "Andere lofzang herkennen" staat in het instellingenpaneel (de microfoon blijft aan). |
| Pitch | `audio/pitch.ts`, `audio/features.ts` | Pitchy (McLeod) op een venster van ~90 ms naast de chroma; `frame.pitch {hz, clarity}`, `hz=0` bij onbetrouwbaar (clarity < 0,88, buiten 75–1100 Hz). `pitch:false` laat de chroma ongewijzigd. |
| Melodiereferentie | `score/melody.ts` | Sopraanlijn uit de notatielaag. Status `ok`/`uncertain` met redenen; bij twijfel géén melodie (157 van 171 composities `ok`, 14 `uncertain`). Nooit noten verzonnen. |
| Melodieherkenning | `recognize/melodyPrefilter.ts`, `recognizer.ts` | Toonhoogteklasse-DTW met transpositie- en stemmingsschatting; alleen als het chroma-pad niets voorstelt (orgel/piano blijven ongewijzigd). **Acht** rondes achter elkaar dezelfde kop (was vier), zonder getoonde kans (`probability: null`). |
| Hybride volger | `follow/hybrid.ts`, `transpose.ts`, `gate.ts`, `tracker.ts` | Volledige referentie en melodiereferentie naast elkaar; bewijs-EMA met hysterese kiest de bron (`snapshot.trackSource`). Gevouwen chroma en sleutelschatting voor andere toonsoort/octaaf. |
| Vertrouwen bij alleen melodie | `follow/session.ts` | Strengere concentratie-eis (0,80–0,90), lagere kwaliteitsondergrens bij koor, strengere bij één heldere stem, vergrendelteller die bij een dip half terugloopt. Geldt alleen als de melodie de bron is; bij instrumenten ongewijzigd. |
| Directe a capella-start | `follow/phase.ts` | `voice-start`: zang zonder voorspelronde als de melodiebron stabiel bewijs levert; beschermingen tegen voorspel/tussenspel blijven. |
| Evaluatie | `eval/synth.ts`, `eval/words.ts`, `scripts/hymns/lv3-*` | `voiceOnly`-synthese en woordmetrics (`exact`, `wrong`, `none`, vertraging). |

## Wat is waarmee getest

**Echte opnamen: alleen de officiële instrumentale begeleiding** (piano/orgel van de kerk, 39 lofzangen, 60 s). Er zijn **geen echte Nederlandse zangopnamen**. Alle zang- en woordresultaten zijn daarom **synthetisch** (en niet onafhankelijk: de synthese zingt dezelfde sopraanlijn die de referentie afleidt). Woordkwaliteit bij echte zangers is **niet bevestigd**, evenmin iPhone Safari (Chromium-emulatie), een echte microfoon en echte groepszang.

| | Synthetisch | Echte opnamen | Niet bevestigd |
|---|---|---|---|
| Herkennen van zang (solo, a capella, koor) | ja | nee | echte stemmen |
| Instrumentale herkenning | ja | **ja** (officiële opnamen) | – |
| Woordmarkering | ja | nee | echte zangers en woordtijden |
| Valse herkenning bij onbekende melodie | ja (zang), ja (piano) | **ja** (officiële opnamen, weggelaten lofzang) | echte onbekende liederen |
| Volgen met een verkeerde lofzang | ja | nee | echte gemeentezang |
| Chromium-e2e (fake-mic met echte audiobestanden) | – | ja (bestand als microfoon) | iPhone, echte microfoon |

## Controle 1: Chromium-e2e met de nieuwe audio-engine

Alle bestaande Lofzangen-e2e-scripts opnieuw gedraaid tegen een productiebuild (isolated Postgres, seed, fake-mic met het echte bestand).

| Script | Resultaat |
|---|---|
| `e2e-browser` (bediening, schermmaten, thema, tekstschaal, privacy, één microfoonsessie) | 146 OK, 0 fout |
| `e2e-library-access` | 20 OK |
| `e2e-reading` (lezen eerst, bladeren, grote tekst, 320 px, landscape) | 60 OK, 0 fout (oorspronkelijke engine: 60 OK) |
| `e2e-sheet`, `e2e-sheet-sync` | 22 OK, 11 OK |
| `e2e-meelezen` (couplet- en bladmuziekweergave, gat) | 9 OK, 8 OK |
| `e2e-live-audio` (recognize en follow) | 3 OK, 3 OK |
| `e2e-live-failures` (8 scenario's) | alle OK |
| `e2e-sunday` | niet gedraaid (nagebootste klok); gedekt door CI `hymns-availability` |

Gevonden en hersteld: (a) een derde knop ("Opnieuw herkennen") in de bedieningsbalk liet de balk bij grote tekst en op 320 px buiten beeld wrappen → de knop staat nu in het instellingenpaneel; (b) het label "Stop luisteren" is langer dan "Stop": op 844×390 met grote tekst viel de bediening 18 px buiten beeld → de minimale lyricsruimte is van 7rem naar 5rem; (c) de scripts waren verouderd (oude ingang via de contentkiezer, drie weergaven, "Start luisteren" op het kiesscherm = automatisch herkennen) en zijn bijgewerkt. Zichtbare ingang via de contentkiezer ("Zang & muziek") wordt door `e2e-sunday` en CI gedekt.

## Controle 2: woordnauwkeurigheid bij groepszang

Synthetisch, 12 lofzangen, 6 zangers met onderlinge tijds-/toonverschillen en octaafsprongen (`scripts/hymns/lv3-words.ts --scenarios groep`, diagnose per seconde met `lv3-words-diag.ts`).

Oorzaak: de positie werd bij koorzang wél goed gevolgd (melodiebron kiest vanaf ~3 s, positie klopt), maar het vertrouwen (kwaliteit × concentratie) schommelt per frame sterk; de teller die 1,5 s onafgebroken boven de grens eiste werd bij elke dip op nul gezet, waardoor de status tientallen seconden op "acquiring" bleef en de markering bevroren stond.

| Groep (12 lofzangen) | Voor | Na |
|---|---|---|
| Eerste markering (mediaan) | 25,4 s | 17,3 s |
| Zonder markering (aandeel zangtijd) | 65% | 56% |
| Exact goed | 29% | 33% |
| Fout (> 1 woord naast) | 0% | 0% |
| Per lofzang | – | tussen 9 s en nooit; 4 van 12 nooit gemarkeerd |

Eerlijk: de verbetering is bescheiden en sterk afhankelijk van de lofzang. Bij vier van de twaalf lofzangen blijft de markering uit (liever geen markering dan een gok). Koorzang met octaafsprongen blijft het zwakste scenario. Instrumentale herkenning is ongewijzigd (zie controle 4).

Afstelling (parametersweep in `docs/hymns/` niet bewaard; reproduceerbaar met `--cfg`): de strengere concentratie-eis hoort bij controle 3 (een onjuiste lofzang moet minder vaak vergrendelen); de lagere kwaliteitsondergrens en de halve teller-afname bij dips maken koorzang mogelijk.

## Controle 3: waarschijnlijkheid en valse herkenning bij de melodieroute

**Bevinding.** De melodieroute toonde een verzonnen kans (`min(0,99; 0,5 + marge × 5)`, in de praktijk 0,65–0,81) en nam een lofzang aan na vier opeenvolgende rondes dezelfde kop met een kleine marge. Een kalibratie (30 lofzangen × 6 scenario's, `lv3-melody-calibration.ts`) liet zien: bij onbekende zangmelodieën deed de route in **28%** van de gevallen toch een voorstel (en in 3% van de instrumentale opnamen, ook op de officiële opname van lofzang 122 bij een weggelaten lofzang), en van de voorstellen bij marge 0,03–0,05 was 34% fout. Over een lange opname en 171 kandidaten (met vrije transpositie) komt zo'n reeks bij toeval voor.

**Wijziging.** Beslisregels achteraf vergeleken op dezelfde trajecten (`lv3-melody-rules.ts` + `lv3-melody-rules.py`, 144 + 144 + 38 + 38 trajecten):

| Rondes dezelfde kop | Herkend (met lofzang) | Fout herkend | Vals bij onbekende zang | Vals bij instrument | Mediane herkentijd |
|---|---|---|---|---|---|
| 4 (oud) | 97,2% | 0% | 28,5% | 2,6% | 12,4 s |
| 6 | 95,8% | 0% | 2,8% | 0% | 13,4 s |
| **8 (nieuw)** | **95,8%** | **0%** | **0%** | **0%** | **15,4 s** |
| 12 | 89,6% | 0% | 0% | 0% | 19,5 s |

Gekozen: 8. Bij 0 van 144 + 38 onbekende melodieën is de 95%-bovengrens van de valse-herkenningskans ongeveer 2%; dat is geen bewijs voor nul en alleen synthetisch/instrumentaal gemeten. De kans is geen getal meer: `RecognitionSuggestion.probability` is `null` bij de melodieroute (de chroma-route houdt een relatieve softmax-weging die niet aan gebruikers wordt getoond).

**Verkeerde automatische herkenning of verkeerde keuze.** Wat doet de volger als er een andere lofzang gezongen wordt dan gevolgd wordt (`lv3-wrong.ts`; aandeel van de tijd, na 10 s, met een gemarkeerd woord of regel):

| Gezongen | Juiste lofzang gevolgd | Verkeerde lofzang gevolgd |
|---|---|---|
| solo | 92% | 14% (was 31%) |
| solo lager register | 83% | 3% |
| solo andere toonsoort | 74% | 3% |
| koor | 60% | 0% |
| piano / ruis + gebabbel | – | 0% |

Aanpassing: bij de melodiebron is de concentratie-eis van de positie strenger (de positie moet echt op één plek samenkomen) en heeft één heldere stem een hogere kwaliteitseis. Resterend risico: een verkeerd gevolgde lofzang kan bij solozang nog in ongeveer een zevende van de tijd markeren; een echte onbekende zanger is niet getest.

## Controle 4: officiële instrumentale baselinetests, V3 tegen de oorspronkelijke engine

De officiële opnamen (`scripts/hymns/eval-library.ts --every 4 --seconds 60`, 39 lofzangen; oorspronkelijke engine = `origin/main` in een aparte worktree, V3 = deze branch), resultaten in `docs/hymns/v3/official/`:

| Variant | Engine | Correct | Fout voorgesteld | Niet herkend | Mediaan / p90 herkentijd |
|---|---|---|---|---|---|
| gewoon | oorspronkelijk | 31 | 0 | 8 | 11,3 / 44,8 s |
| gewoon | **V3** | 31 | 0 | 8 | 11,3 / 44,8 s |
| tempo 0,85 | oorspronkelijk | 30 | 0 | 9 | 15,7 / 54,3 s |
| tempo 0,85 | **V3** | 30 | 0 | 9 | 15,7 / 54,3 s |
| ruis 0,05 | oorspronkelijk | 31 | 0 | 8 | 13,7 / 48,1 s |
| ruis 0,05 | **V3** | 31 | 0 | 8 | 13,7 / 48,1 s |
| lofzang weggelaten (onbekend) | oorspronkelijk | 39 goed (niets voorgesteld) | 0 | – | – |
| lofzang weggelaten (onbekend) | **V3** | 39 goed (niets voorgesteld) | 0 | – | – |

Per lofzang zijn herkenning en herkentijd **identiek** in alle vier de varianten. Vóór de aanpassing in controle 3 stelde V3 bij lofzang 122 (weggelaten) één keer een foute lofzang voor; dat is hersteld. Tevens: dit is echte audio, maar het zijn instrumentale opnamen (Engelstalige begeleiding van dezelfde melodieën), geen zang.

## Synthetische metingen (definitieve code), 12 lofzangen per scenario, 80 bpm

JSON in `docs/hymns/v3/`. Baseline = `--no-pitch --no-melody` (de ongewijzigde pijplijn).

### Herkenning (45 s audio)

| Scenario | Baseline correct | V3 correct | V3 fout | V3 herkentijd (mediaan) |
|---|---|---|---|---|
| piano / orgel | 12/12 | 12/12 | 0 | 13,9 / 13,6 s |
| solo | 0/12 | 10/12 | 0 | 19,7 s |
| solo laag register | 0/12 | 11/12 | 0 | 20,6 s |
| solo andere toonsoort | 0/12 | 10/12 | 0 | 19,7 s |
| solo + adempauzes | 0/12 | 9/12 | 0 | 20,6 s |
| solo + ruis | 0/12 | 10/12 | 0 | 19,7 s |
| koor (6 zangers, octaafsprongen) | 0/12 | 8/12 | 0 | 34,9 s |
| koor 4-stemmig, solo + piano, gemeente + orgel, ruis + gebabbel | 12 / 11 / 12 / 11 | 12 / 11 / 12 / 11 | 0 | ongewijzigd |

Onbekende melodie (lofzang weggelaten, alle 12 scenario's × 12): **0 fout** (voorheen 2 in piano/orgel).

### Volgen (60 s, positie binnen 1 beat)

| Scenario | Baseline mediaan / p10 | V3 mediaan / p10 |
|---|---|---|
| piano, orgel, koor 4-stemmig, solo+piano, gemeente+orgel | ongewijzigd | ongewijzigd |
| solo | 0,99 / 0,60 | 0,99 / 0,90 |
| solo laag | 0,98 / 0,71 | 0,97 / 0,66 |
| solo andere toonsoort | 0 / 0 | 0,86 / 0,07 |
| koor | 0,92 / 0,79 | 0,92 / 0,59 |
| solo + ruis | 0,96 / 0,84 | 0,97 / 0,91 |

### Woordmarkering (alleen a capella, één ronde, 12 lofzangen)

| Scenario | Exact (mediaan) | Fout | Niet gemarkeerd | Vertraging (mediaan) | Eerste markering |
|---|---|---|---|---|---|
| solo | 0,76 | 0,00 | 0,18 | 141 ms | 5,1 s |
| solo langzaam | 0,74 | 0,00 | 0,17 | 171 ms | 8,8 s |
| solo snel | 0,74 | 0,00 | 0,18 | 135 ms | 4,7 s |
| solo laag | 0,72 | 0,02 | 0,21 | 169 ms | 8,3 s |
| solo andere toonsoort | 0,38 | 0,06 | 0,35 | 343 ms | 14,4 s |
| solo + adempauzes | 0,72 | 0,00 | 0,13 | 140 ms | 5,2 s |
| koor | 0,33 | 0,00 | 0,56 | 2,3 s | 17,3 s |

De basisvariant markeert in deze opstelling praktisch nooit een woord (de fase-laag wacht op een voorspelronde). Voor piano, orgel, 4-stemmig en gemeente+orgel is de woordmetriek in deze eenronde-opstelling niet zinvol; die staan als 0 in de JSON en zijn niet beoordeeld. De strengere vertrouwensregels (controle 3) maken solozang iets trager dan de eerste V3-versie (eerste markering 4,3 → 5,1 s, exact 0,79 → 0,76), in ruil voor veel minder valse markering bij een verkeerde lofzang.

### CPU (ms per seconde audio, desktop, rustige machine)

| Onderdeel | Zonder V3 | Met V3 |
|---|---|---|
| Extractor | 6,2 | 11,3 (pitch +5,1) |
| Volgsessie | 4,0 | 16,5 (hybride) |
| Herkenner (hele bibliotheek) | 80,6 | 144,5 |

Binnen real-time (< 15% van één kern bij herkennen). Op een iPhone niet gemeten.

## Wat werkt en wat alleen voorbereid is

* **Woordmarkering is melodiegestuurd.** Een woord wordt gemarkeerd omdat de gevolgde melodiepositie bij de `HymnWord.b`-ankers van de gekozen tekst aankomt. Er is **geen akoestisch bewijs dat dat woord gezongen is** (geen fonemen/ASR); de hybride volger is de uitbreidingsplek voor akoestische woordbevestiging. Het product claimt dus geen woordherkenning.
* Lyrics Aligner, SOFA en Sherpa-ONNX zijn per documentatie bekeken, niet gedraaid: ze vragen Nederlandse fonemen/modellen van tientallen MB en er zijn geen gelabelde Nederlandse zangopnamen om verbetering aan te tonen. Er is geen zwaar model toegevoegd.
* Afhankelijkheden: alleen `pitchy@4.1.0` (exact; de opdracht noemde 0BSD, de geïnstalleerde versie meldt MIT) met `fft.js`.

## Beperkingen

* Zang- en woordresultaten zijn synthetisch en niet onafhankelijk; de afstelling (concentratie, kwaliteit, rondes) is op die data gedaan en kan bij echte zangers anders uitvallen (liefst nog strenger dan te los: de fouten zijn dan "te weinig markering", geen foute).
* 14 composities hebben geen betrouwbare melodiereferentie: daar blijft het gedrag als vóór V3.
* Andere toonsoort/octaaf: eerste woord pas na ≈ 14 s; koor met octaafsprongen zwak (eerste markering ≈ 17 s mediaan, 4 van 12 lofzangen nooit).
* De melodieroute herkent zang later dan instrumenten (mediaan ≈ 20 s) en misschien niet bij onzuivere of rommelige zang.
* Lofzangen met herhaalde frasen zijn bij langzaam tempo ambigu (lofzang 2 bij 60 bpm); dan houdt de markering vast.
* Lege plekken: iPhone Safari, echte microfoon, echte Nederlandse zangopnamen, echte onbekende liederen.

## Reproduceren

```
npx tsx scripts/hymns/lv3-eval.ts --mode recognize --count 12 --seconds 45 [--no-pitch --no-melody] [--leave-out]
npx tsx scripts/hymns/lv3-eval.ts --mode follow --count 12 --seconds 60 [--no-pitch --no-melody]
npx tsx scripts/hymns/lv3-words.ts --variant base|v3 [--cfg '{"melodyConcFloor":0.8}']
npx tsx scripts/hymns/lv3-words-diag.ts --scenario groep --hymn 98
npx tsx scripts/hymns/lv3-wrong.ts --count 12
npx tsx scripts/hymns/lv3-melody-calibration.ts --count 30 --seconds 45
npx tsx scripts/hymns/lv3-melody-rules.ts --out traj.json && python3 scripts/hymns/lv3-melody-rules.py traj.json
npx tsx scripts/hymns/eval-library.ts --every 4 --seconds 60 [--leave-out] [--tempo 0.85] [--noise 0.05] [--no-melody]
npx tsx scripts/hymns/lv3-bench.ts
npm run test:hymns
```
