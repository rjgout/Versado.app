# Lofzangen: testresultaten

Alle cijfers komen uit scripts of tests in de repository en zijn herhaalbaar. Niets is geschat of
verzonnen: wat niet gemeten kon worden, staat in 8. Termen BEWEZEN, AANNEMELIJK en ONBEKEND: zie
`01-SOURCE-AUDIT.md`.

Datum van de metingen: 14 oktober 2026. Omgeving: Node 22 op een desktop in een cloudcontainer
(één kern per proces), Chromium 1194 (Playwright) voor de browsertest. **Geen metingen op een
telefoon.**

## 1. Hoe de werkelijke positie is vastgesteld

Voor het meten is vooraf afgesproken wat de "waarheid" is:

- **Synthetische opnamen (hoofdmeting).** `src/lib/hymns/eval/synth.ts` rendert de partituur tot audio
  met een vooraf bepaalde tijdlijn: stuksgewijs lineaire (beat → seconden) ankers voor tempo, pauzes
  en stilte. De positie op elk tijdstip is daarmee **exact bekend** (`beatAt(t)`), ook bij tempowisselingen
  en pauzes. De klank is eenvoudig (additieve synthese, orgel of piano); realisme komt uit
  verstoringen: verkeerde noten, gemeentezang op de melodie met afwijkingen, roze ruis en nagalm.
  De fout is de cyclische afstand tussen de geschatte en de werkelijke positie, in beats en (met het
  werkelijke tempo) in milliseconden.
- **Echte begeleidingsopnamen (aanvullend).** De enige echte audio is de Engelse begeleiding van de
  kerk. Er is geen bekende tijdlijn. Als "waarheid" dient een **offline (niet-causale) DTW-uitlijning**
  (`eval/offlineAlign.ts`). Dat is een schatting met dezelfde kenmerken als de engine, dus de
  overeenkomst is gedeeltelijk circulair. Daarom is er één **onafhankelijke controle zonder
  toonhoogte**: valt een duidelijke geluidsaanzet (spectrale flux) op de momenten waarop de gevolgde
  positie een nootbegin passeert, vergeleken met dezelfde momenten een halve beat verschoven.

De synthetische testopnamen zijn niet in git; de tests maken ze met een vaste seed opnieuw.
Hergebruik: `npx tsx scripts/hymns/make-test-audio.ts` schrijft een WAV.

## 2. Wat is uitgevoerd

| Controle | Resultaat |
|---|---|
| `npm run test:hymns` (nieuwe tests) | 59 van 59 geslaagd (6 bestanden: bibliotheek, coupletten, volgen, sessie, herkenning, privacy; ~1 minuut) |
| TypeScript (`npx tsc --noEmit`) | schoon (geen fouten, na `prisma generate`) |
| ESLint op de nieuwe bestanden | 0 fouten en 0 waarschuwingen op `src/lib/hymns`, `src/components/hymns-poc`, `src/app/dev`, de nieuwe tests en scripts |
| Productiebuild (`rm -rf .next && npm run build`) | geslaagd ("Compiled successfully"); de route `/dev/lofzangen` staat in de routelijst |
| Bestaande tests (zie 7) | `test:live-data` 52/52, `test:focus` 22/22, `test:profile` 12/12, `test:mascots` 10/10, `test:kompas` 60 geslaagd, 0 gefaald, 9 overgeslagen (databasetests die een eigen omgevingsvariabele vragen) |
| Browsertest met nep-microfoon (Chromium, 48 kHz) | 18 van 18 controles geslaagd, voor lofzang 82 en 24 (`scripts/hymns/e2e-browser.mjs`) |

### De 15 gevraagde tests

| # | Test | Waar | Uitkomst |
|---|---|---|---|
| 1 | Normaal pianotempo | `hymns-score-following` 1; tabel 3.1 | geslaagd |
| 2 | Langzaam pianotempo (55/min) | test 2 | geslaagd |
| 3 | Versneld pianotempo (110/min) | test 3 | geslaagd |
| 4 | Vertraagd orgelspel (100 → 55/min) | test 4, 5 | geslaagd, de bpm-schatting daalt mee |
| 5 | Tijdelijke stilte | test 6 en 7 | geslaagd: positie vast tijdens stilte, direct juist erna |
| 6 | Verkeerde noot | test 8; tabel 3.3 | geslaagd tot 50% verkeerde noten in 40% van het stuk |
| 7 | Herstart van dezelfde melodie (herhaling) | `hymns-session` 1, 5 | geslaagd: rondewissels op ±1,5 s van het werkelijke moment |
| 8 | Wisseling van couplet 1 naar 4 | `hymns-session` 2 | geslaagd: posities bit voor bit gelijk met en zonder keuze |
| 9 | Handmatige correctie | `hymns-session` 3; `hymns-stanzas` | geslaagd: nooit teruggedraaid |
| 10 | Onbekende lofzang | `hymns-recognition` 3, 4 | geslaagd: 0 van 21 vals voorgesteld |
| 11 | Ambigue melodie | `hymns-recognition` 5 | geslaagd: `ambiguous` |
| 12 | Achtergrondgeluid | test 9; tabel 3.1 | geslaagd met kanttekening: 88 tot 94% binnen 1 beat |
| 13 | Verlies en herstel van synchronisatie | `hymns-session` 6, 7; tabel 3.2 | geslaagd: onzeker, verloren, hersteld |
| 14 | Stoppen van microfoontoegang | `hymns-privacy` 6 tot 10; browsertest | geslaagd (nepomgeving en Chromium); niet op iOS/Android |
| 15 | Geheugen- en resourcecleanup | `hymns-privacy` 4, 5, 6 tot 10 | geslaagd: constant geheugen, alles opgeruimd |

## 3. Volgen op synthetische opnamen (BEWEZEN)

### 3.1 Per scenario en lofzang

100 bpm-opnamen waren niet nodig: de tempo's staan per rij. "Gesynchr. na" = tijd tot de status
`locked`. Fout = afstand tot de werkelijke positie, na de eerste 6 s en buiten pauzes. "Afwijking" =
mediaan van de getekende fout: negatief betekent dat de engine iets **achter** de muziek loopt.

| Scenario | Lofzang | Gesynchr. na (s) | mediane fout (ms) | p90 fout (ms) | binnen 0,5 beat | binnen 1 beat | mediane afwijking vooruit(+)/achter(−) (ms) |
|---|---|---|---|---|---|---|---|
| normaal 80/min piano | 24 | 4.7 | 30 | 87 | 100% | 100% | -25 |
| langzaam 55/min | 24 | 5.4 | 42 | 116 | 100% | 100% | -14 |
| snel 110/min | 24 | 3.0 | 30 | 75 | 100% | 100% | -29 |
| versnellen 60→110 | 24 | 5.4 | 37 | 100 | 100% | 100% | -31 |
| vertragen 100→55 orgel | 24 | 2.9 | 34 | 94 | 100% | 100% | 8 |
| stilte 6 s | 24 | 4.7 | 34 | 98 | 100% | 100% | -26 |
| fermate 4 s (uitklinkend) | 24 | 4.7 | 33 | 95 | 100% | 100% | -25 |
| foute noten 25% | 24 | 4.7 | 42 | 162 | 97% | 99% | -22 |
| gemeente+ruis+galm | 24 | 6.3 | 64 | 290 | 92% | 94% | -29 |
| orgel+gemeente+galm 2,2 s | 24 | 5.5 | 69 | 509 | 91% | 93% | -49 |
| voorspel vanaf 55% | 24 | 3.8 | 33 | 95 | 100% | 100% | -27 |
| stemming +30 cent | 24 | 3.3 | 37 | 81 | 100% | 100% | -36 |
| normaal 80/min piano | 36 | 4.5 | 43 | 155 | 100% | 100% | -35 |
| langzaam 55/min | 36 | 4.7 | 71 | 233 | 100% | 100% | -16 |
| snel 110/min | 36 | 3.0 | 37 | 110 | 100% | 100% | -37 |
| versnellen 60→110 | 36 | 4.4 | 49 | 164 | 100% | 100% | -45 |
| vertragen 100→55 orgel | 36 | 3.1 | 67 | 205 | 100% | 100% | 14 |
| stilte 6 s | 36 | 4.5 | 43 | 161 | 99% | 100% | -39 |
| fermate 4 s (uitklinkend) | 36 | 4.5 | 43 | 215 | 99% | 100% | -34 |
| foute noten 25% | 36 | 4.5 | 92 | 358 | 90% | 94% | -44 |
| gemeente+ruis+galm | 36 | 4.8 | 73 | 333 | 92% | 94% | -5 |
| orgel+gemeente+galm 2,2 s | 36 | 4.8 | 98 | 540 | 86% | 93% | -68 |
| voorspel vanaf 55% | 36 | 2.8 | 42 | 142 | 99% | 100% | -27 |
| stemming +30 cent | 36 | 4.3 | 38 | 166 | 99% | 100% | -35 |
| normaal 80/min piano | 82 | 3.2 | 45 | 138 | 100% | 100% | -38 |
| langzaam 55/min | 82 | 4.0 | 60 | 213 | 100% | 100% | -22 |
| snel 110/min | 82 | 2.8 | 51 | 114 | 100% | 100% | -51 |
| versnellen 60→110 | 82 | 3.7 | 63 | 179 | 100% | 100% | -53 |
| vertragen 100→55 orgel | 82 | 2.9 | 54 | 188 | 100% | 100% | 15 |
| stilte 6 s | 82 | 3.2 | 49 | 146 | 100% | 100% | -37 |
| fermate 4 s (uitklinkend) | 82 | 3.2 | 54 | 208 | 96% | 99% | -47 |
| foute noten 25% | 82 | 3.2 | 69 | 233 | 98% | 100% | -47 |
| gemeente+ruis+galm | 82 | 4.4 | 108 | 435 | 91% | 93% | -17 |
| orgel+gemeente+galm 2,2 s | 82 | 4.6 | 145 | 3081 | 82% | 88% | -79 |
| voorspel vanaf 55% | 82 | 2.9 | 43 | 126 | 100% | 100% | -35 |
| stemming +30 cent | 82 | 3.1 | 53 | 145 | 100% | 100% | -46 |

Samenvatting:

| Scenario | Mediane fout (ms), drie lofzangen | Slechtste p90 (ms) | Laagste "binnen 1 beat" | Gesynchroniseerd na (s) |
|---|---|---|---|---|
| normaal 80/min piano | 30 tot 45 | 155 | 100% | 3.2 tot 4.7 |
| langzaam 55/min | 42 tot 71 | 233 | 100% | 4.0 tot 5.4 |
| snel 110/min | 30 tot 51 | 114 | 100% | 2.8 tot 3.0 |
| versnellen 60→110 | 37 tot 63 | 179 | 100% | 3.7 tot 5.4 |
| vertragen 100→55 orgel | 34 tot 67 | 205 | 100% | 2.9 tot 3.1 |
| stilte 6 s | 34 tot 49 | 161 | 100% | 3.2 tot 4.7 |
| fermate 4 s (uitklinkend) | 33 tot 54 | 215 | 99% | 3.2 tot 4.7 |
| foute noten 25% | 42 tot 92 | 358 | 94% | 3.2 tot 4.7 |
| gemeente+ruis+galm | 64 tot 108 | 435 | 93% | 4.4 tot 6.3 |
| orgel+gemeente+galm 2,2 s | 69 tot 145 | 3081 | 88% | 4.6 tot 5.5 |
| voorspel vanaf 55% | 33 tot 43 | 142 | 100% | 2.8 tot 3.8 |
| stemming +30 cent | 37 tot 53 | 166 | 100% | 3.1 tot 4.3 |

Zonder gemeente, ruis en nagalm is de mediane fout in alle scenario's 30 tot 92 ms (afgerond), en blijft de positie in minstens 94% van de tijd binnen 1 beat. Met gemeente, ruis en nagalm is de mediane fout 64 tot 145 ms en blijft de positie in 88 tot 94% van de tijd binnen 1 beat; dat is het zwakste scenario. De engine loopt gemiddeld enkele tientallen milliseconden **achter** de muziek (negatieve afwijking): de FFT-vensters en het filter vertragen iets.

### 3.2 Hersteltijd

Lofzang 82 bij 100 per minuut. Waarheid = de bekende tijdlijn. Scripts: `npx tsx scripts/hymns/eval-synthetic.ts herstel`.

- stilte 3 s: positie weer binnen 1 beat 0.0 s na het hervatten
- stilte 6 s: positie weer binnen 1 beat 0.0 s na het hervatten
- stilte 12 s: positie weer binnen 1 beat 0.0 s na het hervatten
- onbekende muziek 6 s: onzeker na 3.8 s, verloren nooit, status weer gesynchroniseerd/hersteld 2.7 s na het einde van het gat, positie weer binnen 1 beat 0.1 s na het gat
- onbekende muziek 10 s: onzeker na 3.8 s, verloren nooit, status weer gesynchroniseerd/hersteld 4.0 s na het einde van het gat, positie weer binnen 1 beat 4.2 s na het gat
- onbekende muziek 18 s: onzeker na 3.8 s, verloren na 14.6 s, status weer gesynchroniseerd/hersteld 5.5 s na het einde van het gat, positie weer binnen 1 beat 2.9 s na het gat
- verkeerde noten 15% in 40% van het stuk: 100% van de tijd binnen 1 beat, 0x 'verloren'
- verkeerde noten 30% in 40% van het stuk: 99% van de tijd binnen 1 beat, 0x 'verloren'
- verkeerde noten 50% in 40% van het stuk: 97% van de tijd binnen 1 beat, 0x 'verloren'

Bij stilte blijft de positie vastgehouden (0 s herstel). Bij onbekende muziek in plaats van het
stuk is de status eerst `uncertain`, bij een lang gat `lost`, en keert na het gat binnen 3 tot 6 s
`locked` of `recovered` terug.

### 3.3 Foutieve noten

Zie de laatste regels van 3.2: tot 50% verkeerde noten in 40% van het stuk blijft de positie 97% van de
tijd binnen 1 beat, zonder `lost`.

## 4. Herkennen op synthetische opnamen (BEWEZEN)

Elke rij: een fragment van maximaal 35 s; "Eindstand" is de status na 35 s; bewijs in nats.

| Fragment | Omstandigheid | Eindstand na 35 s | Eerste voorstel | Bewijs per kandidaat (nats) |
|---|---|---|---|---|
| lofzang 24 | piano 80 | identified | 24 na 7.7 s | 24: 286, 82: 41, 36: 21 |
| lofzang 24 | orgel 65 | identified | 24 na 7.8 s | 24: 295, 82: 49, 36: 4 |
| lofzang 24 | piano 100 + gemeente/ruis/galm | identified | 24 na 22.5 s | 24: 105, 82: 13, 36: 5 |
| lofzang 24 | voorspel vanaf 55% | identified | 24 na 7.3 s | 24: 195, 82: 72, 36: 26 |
| lofzang 24 | piano 55 | identified | 24 na 8.3 s | 24: 283, 82: 60, 36: -10 |
| lofzang 24 | orgel 90 + gemeente/ruis/galm 2,2 s | identified | 24 na 23.2 s | 24: 105, 36: 8, 82: 8 |
| lofzang 24 | foute noten 20% | identified | 24 na 20.9 s | 24: 139, 82: 33, 36: 5 |
| lofzang 36 | piano 80 | identified | 36 na 7.6 s | 36: 321, 82: 31, 24: 9 |
| lofzang 36 | orgel 65 | identified | 36 na 7.5 s | 36: 339, 24: 25, 82: 8 |
| lofzang 36 | piano 100 + gemeente/ruis/galm | identified | 36 na 27.5 s | 36: 92, 24: 36, 82: 17 |
| lofzang 36 | voorspel vanaf 55% | identified | 36 na 7.0 s | 36: 220, 24: 16, 82: 10 |
| lofzang 36 | piano 55 | identified | 36 na 7.7 s | 36: 312, 24: 23, 82: 12 |
| lofzang 36 | orgel 90 + gemeente/ruis/galm 2,2 s | identified | 36 na 26.6 s | 36: 90, 24: 37, 82: 16 |
| lofzang 36 | foute noten 20% | identified | 36 na 28.3 s | 36: 122, 24: 32, 82: 28 |
| lofzang 82 | piano 80 | identified | 82 na 6.2 s | 82: 366, 24: 47, 36: 25 |
| lofzang 82 | orgel 65 | identified | 82 na 6.3 s | 82: 427, 36: 14, 24: 13 |
| lofzang 82 | piano 100 + gemeente/ruis/galm | identified | 82 na 16.1 s | 82: 99, 24: 44, 36: 8 |
| lofzang 82 | voorspel vanaf 55% | identified | 82 na 6.2 s | 82: 180, 36: 29, 24: 22 |
| lofzang 82 | piano 55 | identified | 82 na 6.7 s | 82: 382, 36: 32, 24: -15 |
| lofzang 82 | orgel 90 + gemeente/ruis/galm 2,2 s | identified | 82 na 14.3 s | 82: 118, 24: 54, 36: 9 |
| lofzang 82 | foute noten 20% | identified | 82 na 23.1 s | 82: 122, 24: 34, 36: 7 |
| onbekend (lofzang 26) | piano 80 | unknown | geen | 82: 11, 24: 8, 36: 1 |
| onbekend (lofzang 26) | orgel 65 | unknown | geen | 82: 13, 24: 12, 36: 2 |
| onbekend (lofzang 26) | piano 100 + gemeente/ruis/galm | unknown | geen | 82: 6, 24: 4, 36: 1 |
| onbekend (lofzang 26) | voorspel vanaf 55% | listening | geen | 82: 11, 24: 3, 36: 0 |
| onbekend (lofzang 26) | piano 55 | unknown | geen | 82: 17, 24: 7, 36: 2 |
| onbekend (lofzang 26) | orgel 90 + gemeente/ruis/galm 2,2 s | unknown | geen | 82: 11, 24: 3, 36: 1 |
| onbekend (lofzang 26) | foute noten 20% | unknown | geen | 82: 6, 24: 5, 36: 1 |
| onbekend (lofzang 100) | piano 80 | unknown | geen | 24: 25, 36: 17, 82: 3 |
| onbekend (lofzang 100) | orgel 65 | unknown | geen | 24: 35, 82: 13, 36: -1 |
| onbekend (lofzang 100) | piano 100 + gemeente/ruis/galm | unknown | geen | 36: 6, 82: 5, 24: 5 |
| onbekend (lofzang 100) | voorspel vanaf 55% | listening | geen | 36: 9, 24: 7, 82: 2 |
| onbekend (lofzang 100) | piano 55 | unknown | geen | 82: 15, 24: 6, 36: -1 |
| onbekend (lofzang 100) | orgel 90 + gemeente/ruis/galm 2,2 s | unknown | geen | 36: 8, 24: 3, 82: 3 |
| onbekend (lofzang 100) | foute noten 20% | unknown | geen | 36: 24, 82: 14, 24: 12 |
| onbekend (lofzang 12) | piano 80 | listening | geen | 82: 4, 24: 1, 36: 0 |
| onbekend (lofzang 12) | orgel 65 | unknown | geen | 82: 3, 24: 1, 36: 0 |
| onbekend (lofzang 12) | piano 100 + gemeente/ruis/galm | listening | geen | 82: 3, 24: 1, 36: 1 |
| onbekend (lofzang 12) | voorspel vanaf 55% | listening | geen | 82: 2, 24: 1, 36: 0 |
| onbekend (lofzang 12) | piano 55 | unknown | geen | 82: 4, 24: 1, 36: 0 |
| onbekend (lofzang 12) | orgel 90 + gemeente/ruis/galm 2,2 s | unknown | geen | 82: 3, 24: 1, 36: 1 |
| onbekend (lofzang 12) | foute noten 20% | listening | geen | 82: 9, 36: 1, 24: 1 |

Samenvatting: bekende lofzangen 21/21 juist herkend, 0 verkeerd, 0 niet herkend; mediane tijd tot voorstel 7.8 s (p90 26.6 s, max 28.3 s); onbekende melodieën: 0/21 ten onrechte voorgesteld.

## 5. Echte begeleidingsopnamen (indicatief)

Vergeleken met de offline uitlijning, na de eerste 30 s (daarvoor zit een voorspel dat niet in de
partituur staat).

| Lofzang | Duur | Binnen 1 beat t.o.v. offline uitlijning (na eerste 30 s) | Mediane afwijking (ms) | Rondewissels (tracker / offline uitlijning / overeenkomend binnen 2,5 s) | Onset-controle (zonder toonhoogtekenmerk) | Eerste voorstel herkenner |
|---|---|---|---|---|---|---|
| 24 | 215 s | 96% | 75 | 4 herkend, 4 volgens uitlijning, 3 juist | 82% van de aanzetten op een nootbegin (kans bij 0,5 beat verschuiving: 61%) | 24 na 25.5 s |
| 36 | 183 s | 97% | 86 | 5 herkend, 4 volgens uitlijning, 4 juist | 81% van de aanzetten op een nootbegin (kans bij 0,5 beat verschuiving: 64%) | 36 na 47.9 s |
| 82 | 252 s | 99% | 114 | 6 herkend, 6 volgens uitlijning, 5 juist | 79% van de aanzetten op een nootbegin (kans bij 0,5 beat verschuiving: 48%) | 82 na 36.8 s |

Rondewissels (tracker / offline uitlijning), in seconden:

| Lofzang | Tracker | Offline |
|---|---|---|
| 24 | 60,6 / 109,4 / 159,2 / 207,5 | 11,5 / 60,0 / 109,2 / 158,2 |
| 36 | 18,1 / 56,7 / 96,3 / 136,1 / 176,3 | 18,2 / 57,6 / 96,6 / 137,0 |
| 82 | 55,6 / 94,1 / 131,7 / 169,8 / 207,4 / 245,5 | 18,6 / 54,8 / 94,0 / 131,3 / 169,6 / 207,6 |

Elke wissel na de eerste betrouwbare synchronisatie valt binnen 1,0 s van de offline wissel. De wissel
vóór de synchronisatie (11,5 s, 18,6 s) is niet gemeld, en de laatste wissel van de tracker valt op
het einde van de opname. Opmerking: lofzang 24 heeft in de Engelse opname een ander refrein dan de
Nederlandse bladmuziek; toch volgt de engine het hele stuk binnen 1 beat (96%).

Betekenis: **BEWEZEN** dat de engine op echt pianogeluid met galm de positie volgt en de rondes
telt. **ONBEKEND** hoe dat in een echte dienst met een gemeente gaat.

## 6. Resources (BEWEZEN in Node)

```
frames: 1428, hop: 46.4 ms
FFT + kenmerken: 0.328 ms/frame; volgen (1 tracker, 600 deeltjes): 0.204 ms/frame; herkennen (3 trackers x 500): 0.646 ms/frame
CPU-belasting (Node op deze machine, 1 kern): volgen 1.1%, herkennen 2.1% van een kern
```

Eén frame komt elke 46,4 ms binnen: de engine gebruikt dus 1 tot 2 procent van één kern in Node op een
desktop; een telefoon is trager (**ONBEKEND** hoeveel). Het geheugen groeit niet (test: 11.500
frames, groei onder 25 MB, in de praktijk ruim eronder) en het aantal events groeit alleen met
statuswissels en rondes.

Serververkeer: 0 verzoeken met inhoud en 0 grote WebSocket-frames tijdens het luisteren (browsertest;
alleen het eigen achtergrondverkeer van de app, twee lege `POST /api/streak/continuation`).
Bibliotheek: 38 kB.

## 7. Bestaande functionaliteit

De proef raakt geen bestaande code. `git status` toont alleen nieuwe bestanden, plus
`package.json` (twee scripts), `.gitignore` en een sectie in `CLAUDE.md`. Gecontroleerd met:

- de bovenstaande testreeksen (de live-data-test zou falen op eigen `visibilitychange`- of fetch-logica; de proef heeft geen fetch);
- een productieserver zonder `HYMNS_POC`: `/dev/lofzangen` geeft **404**; met `HYMNS_POC=1` en niet ingelogd: **307 naar /login**; ingelogd als gewone gebruiker in productie: 404 (regel in `hymnsPocAccess`, getest);
- de lokale testdatabase kreeg alleen de nog openstaande, bestaande migraties van `main` (`prisma migrate deploy`); er zijn geen eigen migraties en geen gegevens verwijderd.

## 8. Niet gemeten of niet mogelijk

| Wat | Waarom |
|---|---|
| Echte Nederlandse orgel- of pianoopnamen in een kerk | Niet beschikbaar; de kerk biedt alleen Engelse begeleiding. |
| Nauwkeurigheid op echte opnamen in milliseconden | Er is geen exacte tijdlijn; alleen een geschatte offline uitlijning. |
| Batterij-impact | Geen toestel en geen energiemeting beschikbaar. |
| Processorbelasting op iOS en Android | Niet gemeten; alleen Node op een desktop. |
| Gedrag in Safari, Firefox, iOS WKWebView, Android WebView | Niet getest; alleen Chromium. |
| Gemeentezang met echte stemmen | Alleen gesynthetiseerde zang op de melodie. |
| Fermates in echte opnamen | Alleen lofzang 24 heeft er één, en de echte opname houdt hem niet aan. |
| Serververkeer van een volledige productieomgeving | Alleen de ontwikkelserver in de browsertest. |

## 9. Admin-only beschikbaarstelling in productie (aanvulling, 14 oktober 2026)

De metingen in 1 tot 8 zijn ongewijzigd en beschrijven de proef. Aanvullend gecontroleerd na het
beschikbaar maken voor beheerders via de contentkiezer (productiebuild, `NODE_ENV=production`, **zonder**
`HYMNS_POC`, wegwerpdatabase met alle bestaande migraties):

| Controle | Uitkomst |
|---|---|
| Beheerder ziet "Lofzangen" in `/content` en opent de route | geslaagd (`tests/content-picker.browser.mjs`, 48 combinaties van viewport, thema en tekstgrootte) |
| Gewone gebruiker: kaart niet zichtbaar, directe toegang | geen link in `/content`; `/dev/lofzangen` geeft 404 |
| Niet ingelogd | 307 naar `/login` |
| Zonder `HYMNS_POC` in productie | route werkt voor beheerders |
| `HYMNS_POC=0` (noodstop) | 404 voor een beheerder en geen kaart in `/content` |
| Actieve contentcollectie, taal en voortgang | ongewijzigd na openen (de browsertest vergelijkt de gebruikersrij voor en na) |
| Muziekanalyse en microfoon in productie als beheerder | browsertest met nep-microfoon 18 van 18 |
| Databasewijzigingen | geen eigen migraties |
| Bestaande tests | `test:hymns` 59/59, `test:content-picker` 40/40, `test:focus` 22/22, `test:live-data` 52/52, `test:profile` 12/12, `test:mascots` 10/10, `test:kompas` 60 (9 overgeslagen), `test:learning` 12/12, `test:cards` 6/6 |

**Niet getest:** mobiele Safari en Chrome op echte toestellen, en de Capacitor-apps (zie `02-ARCHITECTURE.md`, 7).
Echte uitvoeringen in een kerk zijn nog niet getest; de resultaten hierboven bewijzen geen betrouwbaarheid in een
kerkgebouw.

## 10. Voorspel, zangbegin en herkennen → volgen (fase 2, 14 oktober 2026)

Alle getallen in deze sectie zijn **synthetisch gemeten** (BEWEZEN voor de synthetische diensten, **ONBEKEND**
voor echte uitvoeringen) en reproduceerbaar met de scripts hieronder. De klank is additieve synthese
(piano of orgel), met nagemaakte gemeentezang, kinderstemmen (stemachtige bursts, 250 tot 450 Hz) en
ruis; zie 1 voor de grenzen. De eerste praktijktest van de beheerder (herkenning met spelende en
pratende kinderen) was positief, maar is geen meting en staat hier niet als resultaat.

### 10.1 Wat is uitgevoerd

| Wat | Commando |
|---|---|
| Scenario's A t/m L, tussenspel, opnieuw synchroniseren | `npx tsx --test tests/hymns-phase.test.ts` |
| Herkennen → volgen, kandidaten, onbekende melodie, achterstand, geheugen | `npx tsx --test tests/hymns-live.test.ts` |
| Statussen, karaoke, woordmarkering, scrollen, voorkeuren, ontwerpregels | `npx tsx --test tests/hymns-ui.test.ts` |
| Matrix voorspel/zangbegin (10 omstandigheden x 3 voorspellen x 3 lofzangen) | `npx tsx scripts/hymns/eval-service.ts fase` |
| Matrix herkennen in de dienst (10 omstandigheden x 3 lofzangen) | `npx tsx scripts/hymns/eval-service.ts herken` |
| Browser (Chromium, nep-microfoon): focus mode, herkennen → volgen, weergavewissel, scrollen, mic, schermmaten | `scripts/hymns/e2e-browser.mjs` (zie de kop van het bestand) |

### 10.2 Zangbegin per omstandigheid en soort voorspel (BEWEZEN, synthetisch)

Inhoud van de cel: **start +x s** = het zangbegin werd automatisch vastgesteld x seconden na het werkelijke
begin van de zang (negatief = eerder); **wacht** = geen automatisch zangbegin, de engine vraagt om
"Zang begint". "VROEGE MARKERING" zou betekenen dat er een woord werd gemarkeerd vóór de zang: dat
kwam in **geen enkel geval** voor (0 van 90). De voorspellen: *staart* = laatste derde van de melodie
(vier maten of meer, midden begonnen), *heel* = een heel couplet zonder pauze, *heel+pauze* = een heel
couplet met 2,5 s stilte voor de zang. Tempo 90/min tenzij de omstandigheid iets anders zegt.

| Omstandigheid | Voorspel | 24 | 36 | 82 |
|---|---|---|---|---|
| 1 alleen piano | staart | start +0.2 s | start +0.1 s | start +0.1 s |
| 1 alleen piano | heel | wacht | wacht | wacht |
| 1 alleen piano | heel+pauze | start -0.1 s | start -0.1 s | start -0.0 s |
| 2 alleen orgel | staart | start +0.0 s | start -0.0 s | start +0.1 s |
| 2 alleen orgel | heel | wacht | wacht | wacht |
| 2 alleen orgel | heel+pauze | start -0.0 s | start -0.1 s | start -0.0 s |
| 3 piano met pratende kinderen | staart | start +0.2 s | start +0.1 s | start +0.1 s |
| 3 piano met pratende kinderen | heel | wacht | wacht | wacht |
| 3 piano met pratende kinderen | heel+pauze | start -0.1 s | start -0.1 s | start -0.1 s |
| 4 orgel met achtergrondgesprekken | staart | start +0.2 s | start -0.1 s | start +0.0 s |
| 4 orgel met achtergrondgesprekken | heel | wacht | wacht | wacht |
| 4 orgel met achtergrondgesprekken | heel+pauze | start -0.0 s | start -0.1 s | start -0.0 s |
| 5 muziek met gemeentezang (-6 dB) | staart | start +0.2 s | start +0.1 s | start +0.1 s |
| 5 muziek met gemeentezang (-6 dB) | heel | wacht | wacht | wacht |
| 5 muziek met gemeentezang (-6 dB) | heel+pauze | start -0.1 s | start -0.1 s | start -0.0 s |
| 6 kind roept plotseling | staart | start +0.1 s | start +0.1 s | start +0.1 s |
| 6 kind roept plotseling | heel | wacht | wacht | wacht |
| 6 kind roept plotseling | heel+pauze | start -0.1 s | start -0.0 s | start -0.0 s |
| 7 kerkakoestiek (nagalm 2,5 s) | staart | start +0.3 s | start +0.2 s | start +0.2 s |
| 7 kerkakoestiek (nagalm 2,5 s) | heel | wacht | wacht | wacht |
| 7 kerkakoestiek (nagalm 2,5 s) | heel+pauze | start +0.3 s | start +0.1 s | start +0.1 s |
| 8 langzaam orgelspel (55/min) | staart | start -0.0 s | start -0.0 s | start +0.2 s |
| 8 langzaam orgelspel (55/min) | heel | wacht | wacht | wacht |
| 8 langzaam orgelspel (55/min) | heel+pauze | start -0.1 s | start -0.1 s | start +0.1 s |
| 9 snelle tempowisselingen | staart | start +0.1 s | start +0.1 s | start +0.1 s |
| 9 snelle tempowisselingen | heel | wacht | wacht | wacht |
| 9 snelle tempowisselingen | heel+pauze | start -0.1 s | start -0.0 s | start +0.1 s |
| 10 stilte tijdens het voorspel (2 s) | staart | start +0.1 s | start +0.3 s | start -0.1 s |
| 10 stilte tijdens het voorspel (2 s) | heel | wacht | wacht | wacht |
| 10 stilte tijdens het voorspel (2 s) | heel+pauze | start -0.0 s | start -0.1 s | start +0.0 s |

Samengevat over 90 gevallen: *staart* 30 van 30 automatisch (fout tussen -0,1 en +0,3 s); *heel+pauze* 30 van 30
automatisch (tussen -0,1 en +0,3 s); *heel* 30 van 30 **wachten** (bedoeld: zonder bewijs geen gok).
Gebabbel (3, 4), een plotselinge roep (6), nagalm van 2,5 s (7), een pauze in het voorspel (10), snelle
tempowisselingen (9) en langzaam spel (8) veranderden dit niet in de gemeten gevallen. Een kleine
steekproef (één opname per cel, vaste ruis- en stemmenzaden): een uitspraak over de kans dat het ook in een
echte kerk zo gaat is **niet** mogelijk.

Bij de eerste meting van deze matrix bleken 6 van de 30 *heel+pauze*-cellen te wachten, omdat de volger de
rondegrens al aan het begin van de stilte ziet (de partituur is dan af) terwijl de pauze pas voorbij is als
de gemeente begint. Dat is opgelost (`lateGap` in `phase.ts`, gedekt door scenario D2) en de matrix is
daarna volledig opnieuw gedraaid; de tabel hierboven is die tweede meting.

### 10.3 Lofzang herkennen in de dienst (BEWEZEN, synthetisch)

Tijd in seconden vanaf het begin van de muziek tot de automatische overgang naar volgen (voorspel van een heel
couplet, daarna 2,5 s pauze en de zang). **Alle 30 overgangen kozen de juiste lofzang; 0 verkeerde.**

| Omstandigheid | 24 | 36 | 82 |
|---|---|---|---|
| 1 alleen piano | 9.8 s | 9.5 s | 8.2 s |
| 2 alleen orgel | 8.7 s | 18.4 s | 8.2 s |
| 3 piano met pratende kinderen | 11.3 s | 10.2 s | 8.7 s |
| 4 orgel met achtergrondgesprekken | 11.7 s | 10.0 s | 10.2 s |
| 5 muziek met gemeentezang (-6 dB) | 9.8 s | 9.5 s | 8.2 s |
| 6 kind roept plotseling | 10.9 s | 10.2 s | 8.9 s |
| 7 kerkakoestiek (nagalm 2,5 s) | 10.2 s | 16.7 s | 8.2 s |
| 8 langzaam orgelspel (55/min) | 9.5 s | 126.1 s | 8.2 s |
| 9 snelle tempowisselingen | 9.8 s | 9.3 s | 8.2 s |
| 10 stilte tijdens het voorspel (2 s) | 9.8 s | 9.5 s | 8.2 s |

De uitschieter (lofzang 36, langzaam orgelspel 55/min: 126 s) is een echte zwakte: bij dat tempo duurt het
verzamelen van genoeg bewijs veel langer en de pauze na het voorspel valt daardoor eerder dan de herkenning.
De pagina toont tot die tijd de kandidaten en de gebruiker kan zelf kiezen. In 29 van 30 cellen gebeurde de
overgang binnen 18,4 s, vóór het einde van het voorspel van een heel couplet (27 s tot 35 s).

### 10.4 Scenario's uit de opdracht

| Scenario | Test | Uitkomst |
|---|---|---|
| A  laatste vier maten | `scenario A` | Tekst klaar zonder markering; zangbegin op de rondegrens (binnen 1,5 s), couplet 1 |
| B  heel couplet als voorspel | `scenario B` | Telt niet als couplet 1; geen markering; engine wacht en meldt dat |
| C  twee maten, gemeente direct | `scenario C` | Geen markering tijdens het voorspel; zangbegin automatisch of verzoek om bevestiging, nooit een gok |
| D  stilte tussen voorspel en zang | `scenario D`, `D2` | Pauze telt als bewijs (ook als de grens al aan het begin van de stilte is gezien) |
| E  geen stilte | `scenario E` | Wacht op handmatige bevestiging, met melding |
| F  kinderen praten of roepen in het voorspel | `scenario F`, `F2` | Geen markering, geen zangbegin; de volger blijft meestal gesynchroniseerd |
| G  instappen tijdens couplet 2 | `scenario G` | Positie herkend (meer dan 80% binnen 1,5 beat), couplet 1 niet aangenomen, kiezen en bevestigen werkt |
| H  volgorde 1 → 4 | `scenario H` | Couplet 1 klaar; na de eerste echte zangronde couplet 4 op de grens |
| I  instrumentaal tussenspel | `scenario I` | Tussenspel herkend, grens genegeerd (`lap-ignored`), geen extra couplet, geen markering tijdens het tussenspel |
| J  onzeker, gebruiker tikt "Zang begint" | `scenario B/J` | Posities, tempo, betrouwbaarheid en status bit voor bit gelijk met en zonder tik |
| K  herkenning midden in het voorspel | `scenario K` | Overgang vóór het einde van het voorspel; dezelfde extractor; toestand gelijk aan direct volgen |
| L  instrumentale muziek zonder zang | `scenario L` | Geen "gedetecteerd" zangbegin; handmatig starten werkt |

Ook getest: opnieuw synchroniseren (terug naar voorspel, couplet blijft, de volger synchroniseert weer),
een handmatig zangbegin vlak voor een rondegrens (begint pas bij die grens), een onbekende melodie (nooit
gevolgd), twee gelijke kandidaten (blijft herkennen, gebruiker kiest), wissel van lofzang tijdens het
luisteren, verwerken van het geheugen in kleine tijdsbudgetten (zelfde uitkomst) en een begrensd
frame-geheugen (zeven minuten luisteren).

### 10.5 Niveauverandering als zangsignaal (diagnose, niet gebruikt)

Het technische paneel toont de verandering van het geluidsniveau (laatste 2 s t.o.v. de 6 s ervoor).
Gemeten op de synthetische diensten (`scripts/hymns/eval-service.ts` gebruikt dezelfde opbouw), 3 s na het
zangbegin, met gemeente op -6 dB of zonder:

| Lofzang | voorspel = staart, met gemeente | staart, **zonder** gemeente | heel + pauze, met gemeente |
|---|---|---|---|
| 24 | +1,5 dB | +0,5 dB | +7,2 dB |
| 36 | +2,0 dB | +2,8 dB | +9,9 dB |
| 82 | +3,7 dB | +2,8 dB | +11,2 dB |

Na 6 s liepen de waarden uiteen van -5,9 tot +2,0 dB. Het signaal maakt dus **geen onderscheid** tussen
"met gemeente" en "zonder gemeente" (bij 36 en 82 is de stijging zonder gemeente even groot), en na een
pauze stijgt het door het hervatten van de muziek zelf (+7 tot +11 dB), niet door zang. Dat bevestigt de
keuze dat het niveau **niets beslist**; voor echte uitvoeringen is er niets gemeten.

### 10.6 Browsertest (Chromium met nep-microfoon, productiebuild)

`scripts/hymns/e2e-browser.mjs` tegen de productiebuild (`NODE_ENV=production`, **zonder** `HYMNS_POC`),
met een wegwerpdatabase, een testaccount dat via de database beheerder is gemaakt en een nep-microfoon die een
synthetische dienst afspeelt (lofzang 82: voorspel van een heel couplet, 2,5 s pauze, twee gezongen rondes).
**69 van 69 controles geslaagd.** Dit is Chromium op een Linux-machine met een viewport-emulatie: het is **geen
bewijs** voor iPhone of Android.

- *Toegang en focus mode*: Lofzangen opent vanuit de contentkiezer; header en onderbalk zijn weg, de terugbalk
  staat er ("Lofzangen"); de microfoon is uit bij het openen.
- *Herkennen → volgen in één sessie*: de lofzang wordt tijdens het voorspel automatisch herkend en gevolgd; de titel toont
  "82. Kom, volg Mij na"; **1x `getUserMedia`, 1x `AudioContext` en 1 levende track** over herkennen, volgen,
  weergavewissel en couplet kiezen heen.
- *Voorspel*: status "Voorspel", de tekst staat klaar (meer dan 4 regels), er is **geen** actieve regel of woord;
  daarna "Volgt muziek" zonder tik.
- *Actief woord*: precies één woord, computed kleur gelijk aan `rgb(var(--vs-accent))`, achtergrond
  transparant, gewicht 700; woordbreedtes en regelhoogte veranderen niet door de markering.
- *Weergavewissel tijdens het zingen* (kop-knop en instellingen): zelfde lofzang, zelfde sessie, status blijft
  "Volgt muziek" (geen reset); karaoke toont de vorige/huidige/volgende regel.
- *Couplet en volgorde*: tikken op couplet 3 toont couplet 3 met actieve microfoon; volgorde 1 → 4 wordt getoond.
- *Scrollen*: na eigen scrollen verschijnt "Zelf bladeren" met "Automatisch volgen hervatten" (sinds docs 17), de muziekvolging loopt door, na tikken verdwijnt
  de knop; de onderste bediening staat aan de onderrand.
- *Technische gegevens* (beheerder): positie, zangstatus, begin van de muziek en bewijs zijn zichtbaar.
- *Privacy en opruimen*: geen enkel verzoek met inhoud naar een lofzang-eindpunt en geen WebSocket-frame
  boven 1000 bytes tijdens het luisteren; de track is na Stop `ended`, en ook na het verlaten van de pagina via de
  terugknop (die naar de contentkiezer gaat).
- *Schermmaten*: 320x640, 375x667, 390x844, 430x932, 768x1024, 1280x800 en landscape 844x390, elk licht en donker
  en elk met 200% tekst (28 combinaties): geen horizontale overflow, de inhoud begint onder de terugbalk,
  geen onderbalk; karaoke "Extra groot" zonder overflow op 320 px en landscape; de bediening blijft boven een
  gesimuleerde onderinkeping van 34 px (390x844 en landscape).
- Geen paginafouten (de bekende hydration- en caret-color-meldingen van Playwright niet meegeteld).

Pas achteraf viel op dat de allereerste run faalde op een dubbelzinnige knopnaam in het testscript (de
nieuwe snelle weergaveknop heet ook "Karaoke per regel"); dat is in het script opgelost, niet in de app.

### 10.7 Wat niet is gemeten

- Echte kerkuitvoeringen, echte organisten en echte gemeentezang: **ONBEKEND**.
- iPhone (Safari, PWA, Capacitor) en Android (Chrome, Capacitor): **niet getest**. De browsertest is
  desktop-Chromium met een viewport-emulatie en is **geen bewijs** voor iOS of Android; safe areas zijn
  gesimuleerd met een CSS-variabele.
- Rekentijd en batterij op een echte telefoon, inclusief het opnieuw doorspelen van het geheugen na een
  overgang (in Node 0,5 ms per frame; op een telefoon **ONBEKEND**).
- Echte kerkakoestiek met lange nagalm waarin stilte niet meer als stilte klinkt: dan ontbreekt het
  pauzebewijs en vraagt de engine om "Zang begint".
- Voorspel van twee maten of korter, en een heel couplet als tussenspel: zie `07-VOORSPEL-EN-ZANGBEGIN.md`, 4.
- Lofzangen buiten de drie proeflofzangen.
