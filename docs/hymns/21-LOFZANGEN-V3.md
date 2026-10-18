# Lofzangen V3: één luisterknop, zang volgen, woorden synchroniseren

Productregel: *Versado luistert naar de mensen en probeert te bepalen welk woord zij zingen. Het schrijft nooit voor op welk tempo zij moeten zingen.*

Alle analyse blijft lokaal op het toestel (geen audio naar server, opslag of analytics; `tests/hymns-privacy.test.ts` bewaakt dit, ook voor de nieuwe `pitchy`-import).

## Wat er veranderd is

| Onderdeel | Bestand | Werking |
|---|---|---|
| Eén knop | `components/hymns-poc/HymnsPocClient.tsx`, `copy.ts` | "Start luisteren" → "Stop luisteren". Zonder gekozen lofzang: bibliotheekbrede herkenning; met gekozen lofzang: direct volgen. "Opnieuw herkennen", "Zing begint" en handmatig resyncen zijn secundaire knoppen. Wisselen tijdens een sessie sluit de microfoon niet. |
| Pitch | `audio/pitch.ts`, `audio/features.ts` | Pitchy (McLeod) op een venster van ~90 ms naast de chroma; `frame.pitch {hz, clarity}`, `hz=0` bij onbetrouwbaar (clarity < 0,88, buiten 75–1100 Hz). `pitch:false` laat de chroma ongewijzigd. |
| Melodiereferentie | `score/melody.ts` | Sopraanlijn uit de notatielaag (stemrichting in de G-balk). Status `ok`/`uncertain` met redenen; bij twijfel géén melodie (157 van 171 composities `ok`, 14 `uncertain`). Nooit noten verzonnen. |
| Melodieherkenning | `recognize/melodyPrefilter.ts`, `recognizer.ts` | Toonhoogteklasse-DTW met transpositie- en stemmingsschatting; alleen gebruikt als het chroma-pad niets voorstelt (orgel/piano blijven ongewijzigd). |
| Hybride volger | `follow/hybrid.ts`, `transpose.ts`, `gate.ts`, `tracker.ts` | Volledige referentie en melodiereferentie naast elkaar; bewijs-EMA met hysterese kiest de bron (`snapshot.trackSource`). Gevouwen (octaafonafhankelijke) chroma en sleutelschatting voor andere toonsoort/octaaf. Geen blinde laatste observatie; een onbetrouwbare hypothese wisselt nooit van couplet. |
| Directe a capella-start | `follow/phase.ts` | `voice-start`: zang zonder voorspelronde als de melodiebron stabiel bewijs levert; beschermingen tegen voorspel/tussenspel blijven gelden. |
| Tempo | `follow/session.ts` | Menselijk tempo volgt via de deeltjesfilter; `PositionCoaster` blijft; bij laag vertrouwen houdt de markering vast (`reliable` met `wasConfident`). |
| Evaluatie | `eval/synth.ts`, `eval/words.ts`, `scripts/hymns/lv3-*.ts` | `voiceOnly`-synthese (solo, meerdere zangers, register, vibrato, intonatie, adempauzes, octaafsprongen) en woordmetrics. |

## Eerlijk: wat werkt, en wat alleen voorbereid is

* **Woordmarkering is melodiegestuurd.** Een woord wordt gemarkeerd omdat de gevolgde melodiepositie bij de `HymnWord.b`-ankers van de gekozen tekst aankomt. Er is **geen akoestisch bewijs dat dat woord gezongen is** (geen fonemen/ASR). Het product claimt dus geen echte woordherkenning. De hybride volger is de uitbreidingsplek: een toekomstige akoestische woordbevestiging kan een tweede bewijsbron worden naast `trackSource`.
* **Geen echte Nederlandse zangopnamen** beschikbaar in deze omgeving. Daardoor zijn de zang- en woordresultaten hieronder **uitsluitend synthetisch** en niet onafhankelijk: de synthese zingt dezelfde sopraanlijn die de melodiereferentie afleidt. Het bewijst de mechaniek, niet de kwaliteit bij echte zangers. Er is geen afstel-/eindtestsplitsing met echte data; woordkwaliteit is **niet bewezen**.
* **iPhone Safari is niet getest** (niet beschikbaar hier). De CPU-kosten zijn op desktopklasse gemeten.
* Lyrics Aligner, SOFA en Sherpa-ONNX zijn per README bekeken, niet gedraaid: ze vragen Nederlandse fonemen/akoestische modellen en zware modellen (tientallen MB, ONNX-runtime), en er zijn geen gelabelde Nederlandse zangopnamen om verbetering aan te tonen. Conform de opdracht is daarom geen zwaar model toegevoegd.
* Afhankelijkheden: alleen `pitchy@4.1.0` (exact, licentie MIT; de opdracht noemde 0BSD, de geïnstalleerde versie meldt MIT) met `fft.js`. Bundelgrootte en CPU klein (zie onder).

## Metingen (synthetisch, 12 lofzangen per scenario, 80 bpm, 45 s resp. 60 s)

JSON in `docs/hymns/v3/`. Baseline = `--no-pitch --no-melody` (de ongewijzigde pijplijn).

### Herkenning (45 s audio)

| Scenario | Baseline correct | V3 correct | V3 fout | V3 eerste herkenning (mediaan) |
|---|---|---|---|---|
| piano / orgel | 12/12 | 12/12 | 0 | 13,6–13,9 s |
| solo | 0/12 | 11/12 | 0 | 16,5 s |
| solo laag register | 0/12 | 11/12 | 0 | 16,5 s |
| solo andere toonsoort | 0/12 | 11/12 | 0 | 16,5 s |
| solo + adempauzes | 0/12 | 10/12 | 0 | 18,6 s |
| solo + ruis | 0/12 | 11/12 | 0 | 17,7 s |
| groep (6 zangers, octaafsprongen) | 0/12 | 8/12 | 0 | 27,9 s |
| groep 4-stemmig | 12/12 | 12/12 | 0 | 16,7 s |
| solo + piano / gemeente + orgel / ruis + gebabbel | 11 / 12 / 11 | 11 / 12 / 11 | 0 | ongewijzigd |

Onbekende melodie (twee lofzangen uit de bibliotheek weggelaten, `--leave-out`): 2 fouten van 144 pogingen (piano en orgel, elk 1×), alle zang-scenario's 0 fout. De fouten zijn geen regressie van de melodielaag maar het bestaande chroma-pad; ze zijn niet verder onderzocht.

### Volgen (60 s, positie binnen 1 beat)

| Scenario | Baseline mediaan / p10 | V3 mediaan / p10 |
|---|---|---|
| piano, orgel, 4-stemmig, solo+piano, gemeente+orgel | ongewijzigd | ongewijzigd |
| solo | 0,99 / 0,60 | 0,99 / 0,90 |
| solo laag | 0,98 / 0,71 | 0,97 / 0,66 |
| solo andere toonsoort | 0 / 0 | 0,86 / 0,07 |
| groep | 0,92 / 0,79 | 0,92 / 0,59 |
| solo + adempauzes | 1,00 / 0,91 | 1,00 / 0,88 |

Let op: groep en solo-laag zijn in V3 in de staart (p10) niet beter dan baseline, groep zelfs iets slechter. Dat is een bekende beperking.

### Woordmarkering (alleen a capella, één ronde, zonder echte opnamen)

| Scenario | Exact (mediaan) | ±1 woord | Te vroeg | Niet gemarkeerd | Vertraging (mediaan) | Eerste markering |
|---|---|---|---|---|---|---|
| solo | 0,79 | 0,89 | 0,00 | 0,11 | 141 ms | 4,3 s |
| solo langzaam | 0,77 | 0,83 | 0,03 | 0,12 | 141 ms | 5,0 s |
| solo snel | 0,74 | 0,85 | 0,00 | 0,15 | 142 ms | 3,6 s |
| solo laag | 0,73 | 0,81 | 0,00 | 0,19 | 150 ms | 6,7 s |
| solo andere toonsoort | 0,44 | 0,54 | 0,03 | 0,30 | 169 ms | 12,0 s |
| solo + adempauzes | 0,75 | 0,89 | 0,06 | 0,11 | 128 ms | 4,5 s |
| groep | 0,29 | 0,35 | 0,00 | 0,65 | 3,6 s | 25,4 s |

Baseline markeert in deze opstelling praktisch nooit een woord (de fase-laag wacht op een voorspelronde; alleen in "solo laag" kwam er een late markering). Voor piano, orgel, 4-stemmig, solo+piano en gemeente+orgel is de woordmetriek in deze eenronde-opstelling niet zinvol (geen gezongen ronde na een voorspel binnen de meetduur); die staan daarom als 0 in de JSON en zijn niet beoordeeld.

### CPU (ms per seconde audio, desktop, rustige machine)

| Onderdeel | Zonder V3 | Met V3 |
|---|---|---|
| Extractor | 6,2 | 11,3 (pitch +5,1) |
| Volgsessie | 4,0 | 16,5 (hybride) |
| Herkenner (hele bibliotheek) | 80,6 | 144,5 |

Dit is ruim binnen real-time (< 15 % van één kern bij herkennen). Op een iPhone niet gemeten.

## Beperkingen

* Synthetisch en niet onafhankelijk (zie boven); echte opnamen zijn nodig voor een eerlijke kwaliteitsclaim, vooral voor woorden.
* 14 composities hebben geen betrouwbare melodiereferentie: daar blijft het gedrag als vóór V3.
* Zangers in een andere toonsoort of octaaf: eerste woordmarkering pas na ≈ 8–12 s; groepen met octaafsprongen zwak (eerste markering ≈ 25 s).
* Sommige lofzangen met herhaalde frasen zijn bij langzaam tempo ambigu (bv. lofzang 2 bij 60 bpm); dan houdt de markering vast in plaats van te gokken.
* Intonatietolerantie ≈ ±35 cent.

## Reproduceren

```
npx tsx scripts/hymns/lv3-eval.ts --mode recognize --count 12 --seconds 45 [--no-pitch --no-melody] [--leave-out]
npx tsx scripts/hymns/lv3-eval.ts --mode follow --count 12 --seconds 60 [--no-pitch --no-melody]
npx tsx scripts/hymns/lv3-words.ts --variant base|v3
npx tsx scripts/hymns/lv3-bench.ts
npm run test:hymns
```
