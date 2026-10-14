# Lofzangen: score following (proef)

Hoe Versado live piano- of orgelspel volgt en de tekst laat meelopen. Termen BEWEZEN, AANNEMELIJK en
ONBEKEND: zie `01-SOURCE-AUDIT.md`. Meetresultaten: `05-TEST-RESULTS.md`.

## 1. Wat er gebouwd is

Een score-follower die in de browser draait:

1. **Kenmerken** (`audio/features.ts`). Per 46 ms een FFT over 186 ms audio (Hann-venster).
   Frequenties tussen 90 en 2200 Hz worden per halve toon op 12 toonklassen gezet, in **twee
   banden** (onder en boven 260 Hz: baspartij en tenor versus alt, sopraan en bovenspelen), wortel-
   gecomprimeerd en genormaliseerd: een vector van 24 getallen. Daarnaast het niveau (dBFS), een
   onset-sterkte en of er "stilte" is (30 dB onder het recente pieklevel, of onder -62 dBFS).
2. **Referentie** (`score/reference.ts`). Uit de noten van de partituur dezelfde 24 getallen per
   achtste beat, met de eerste acht boventonen (1/h) en een lichte uitsmering van een kwart beat.
   De tijdas is de partituur (beats), niet een opname.
3. **Tracker** (`follow/tracker.ts`). Een deeltjesfilter over (positie in de cyclus, tempo) met 600
   deeltjes. Elke frame beweegt een deeltje met zijn eigen tempo; het gewicht komt uitsluitend van de
   overeenkomst (cosinus) tussen gehoorde en geschreven toonklassen. Stilte houdt de positie vast.
4. **Sessie** (`follow/session.ts`). Betrouwbaarheid, status, rondes en couplet (zie 5).
5. **Weergave** (`follow/display.ts`). Regel- en woordmarkering uit de positie.

De positie wordt dus nergens berekend uit verstreken seconden: een opname die 55 of 110 keer per
minuut wordt gespeeld, levert dezelfde partituurposities (test 11 in `tests/hymns-score-following.test.ts`).

## 2. Methoden vergeleken

| Methode | Nauwkeurigheid | Reactie | Processor / geheugen | iOS en Android | Offline | Onderhoud | Besluit |
|---|---|---|---|---|---|---|---|
| **Toonklassen + deeltjesfilter** (gekozen) | **BEWEZEN** 30 tot 70 ms mediane fout op synthetische opnamen, 75 tot 114 ms t.o.v. de offline uitlijning op echte opnamen | Gesynchroniseerd na 3 tot 6 s | **BEWEZEN** 0,5 ms per frame in Node; geheugen constant | **AANNEMELIJK** (alleen Web Audio) | Ja | Eigen code, 1.700 regels | Gekozen |
| Toonklassen + online DTW (Dixon) | **AANNEMELIJK** vergelijkbaar bij stabiel tempo | Goed | Geheugen groeit niet (venster); een kostenmatrix met pad | **AANNEMELIJK** | Ja | Eigen code | Niet gebouwd. Tempo is geen toestand, dus geen temposchatting of vastlopen-detectie; herstel na verlies vraagt aparte logica. Wel gebruikt als **offline** DTW voor de waarheid bij echte opnamen. |
| Hidden-Markov-model op een positiegrid | **AANNEMELIJK** vergelijkbaar | Goed | Groter (positie x tempo) | **AANNEMELIJK** | Ja | Eigen code | Het deeltjesfilter is dezelfde benadering met minder geheugen en een continu tempo. |
| Onset-/beat-tracking (tempo uit aanzetten) | **ONBEKEND** | Snel | Laag | **AANNEMELIJK** | Ja | Veel bibliotheken | Alleen als extra term geprobeerd (3.3); geeft zelf geen positie in de partituur. |
| Toonhoogtetranscriptie (bijv. een neuraal netwerk) en dan uitlijnen | **ONBEKEND** | Trager | Zwaar (model van enkele MB, WebGL of WASM) | **ONBEKEND** | Ja, met modelbestand | Externe modellen | Niet geprobeerd: te zwaar voor het doel, en de eenvoudige route haalt de eis al. |
| Opname-fingerprinting (zoals Shazam) | Past niet: de uitvoering verschilt per organist | | | | | | Bewust uitgesloten (opdracht). |
| Server-side herkenning | Past niet | | | | Nee | | Uitgesloten (opdracht). |

Waarom het gekozen model past: de muziek is homofoon (vier stemmen, blokakkoorden), de toonklassen
van de partituur zijn exact bekend, en het tempo is veranderlijk. Een filter met expliciet tempo en
een kleine kans op verlies is daar de kleinste oplossing die de eisen haalt.

### 2.1 Bibliotheken en licenties

Onderzocht via het npm-register (14 oktober 2026): er is **geen** bruikbare, onderhouden
JavaScript-bibliotheek voor score following (zoekopdrachten "score following" en "online dynamic time
warping" gaven niets relevants, alleen een generieke offline DTW-bibliotheek).

| Bibliotheek | Licentie | Laatste wijziging | Oordeel |
|---|---|---|---|
| `meyda` (kenmerken) | MIT | april 2024 | Bruikbaar voor FFT/chroma, maar de proef heeft een eigen FFT van 67 regels nodig om de toonklassen per band te sturen. Niet gebruikt. |
| `essentia.js` | **AGPL-3.0** | mei 2022 | Copyleft en zwaar (WebAssembly). Niet gebruikt. |
| `aubiojs` | geen licentieveld in het register; aubio zelf is volgens de projectpagina GPL (niet nagelopen) | nov 2022 | Niet gebruikt. |
| `pitchfinder` | GPL-3.0 | dec 2025 | Eenstemmig; past niet bij akkoorden. Niet gebruikt. |
| `dynamic-time-warping` | MIT | 2022 | Alleen offline en `O(n·m)`; de proef heeft een eigen, kleinere offline variant voor de waarheid. |
| `@spotify/basic-pitch` | Apache-2.0 | aug 2025 | Neurale toonhoogtetranscriptie; zwaar. Niet gebruikt. |

Gevolg: **geen nieuwe afhankelijkheid** in `package.json`, geen licentierisico en geen extra
bundlegrootte.

## 3. Wat is geprobeerd en wat afviel

Alle cijfers komen uit `npx tsx scripts/hymns/sweep.ts volg` (18 moeilijke synthetische gevallen:
3 lofzangen x {voorspel vanaf 25, 55 en 80% van de cyclus, normaal, gemeente + ruis + galm, orgel +
gemeente + galm}; "binnen 1 beat" na de eerste 6 s). Het gaat om gevallen die in dezelfde reeks ook
voor de afstelling zijn gebruikt; ze zijn dus een vergelijking, geen onafhankelijke toets.

| Variant | Gemiddeld binnen 1 beat | Slechtste geval | Gevallen onder 90% |
|---|---|---|---|
| `gekozen: 2 banden grens 260 Hz, wortel, kappa 16, outlier 0,25` | 97.1% | 88% | 82 orgel+gemeente+galm 88% |
| `1 band (12 toonklassen)` | 86.5% | 7% | 24 voorspel 25% 88%, 24 gemeente+ruis+galm 7%, 24 orgel+gemeente+galm 11%, 36 orgel+gemeente+galm 89%, 82 gemeente+ruis+galm 85%, 82 orgel+gemeente+galm 87% |
| `2 banden grens 200 Hz` | 95.6% | 74% | 24 voorspel 25% 90%, 24 voorspel 55% 74% |
| `3 banden 200/500 Hz` | 96.6% | 83% | 24 voorspel 25% 83% |
| `4 banden 150/300/600 Hz` | 95.8% | 66% | 24 voorspel 25% 66% |
| `2 banden 260 Hz, power 0,8` | 96.3% | 91% | geen |
| `2 banden 260 Hz, power 1,0` | 93.4% | 86% | 24 voorspel 25% 86%, 82 voorspel 55% 89%, 82 voorspel 80% 86%, 82 orgel+gemeente+galm 89% |
| `2 banden 260 Hz, power 0,35` | 95.7% | 77% | 24 voorspel 25% 89%, 24 orgel+gemeente+galm 77%, 82 orgel+gemeente+galm 84% |
| `kans: kappa 10, outlier 0,04` | 92.2% | 63% | 24 voorspel 25% 90%, 24 gemeente+ruis+galm 70%, 24 orgel+gemeente+galm 81%, 36 gemeente+ruis+galm 63%, 36 orgel+gemeente+galm 89%, 82 gemeente+ruis+galm 83%, 82 orgel+gemeente+galm 83% |
| `kans: outlier 0,1` | 93.0% | 44% | 24 gemeente+ruis+galm 85%, 24 orgel+gemeente+galm 44%, 36 orgel+gemeente+galm 86%, 82 orgel+gemeente+galm 83% |
| `kans: kappa 24, outlier 0,25` | 96.9% | 88% | 24 voorspel 25% 88%, 82 orgel+gemeente+galm 88% |
| `z-score-kans (beta 1,5, outlier 0,2)` | 91.6% | 62% | 24 voorspel 25% 88%, 24 gemeente+ruis+galm 89%, 24 orgel+gemeente+galm 85%, 36 gemeente+ruis+galm 62%, 36 orgel+gemeente+galm 73%, 82 gemeente+ruis+galm 73%, 82 orgel+gemeente+galm 84% |
| `onset-term (gewicht 1,5)` | 95.8% | 83% | 36 gemeente+ruis+galm 86%, 82 gemeente+ruis+galm 83%, 82 orgel+gemeente+galm 89% |
| `geen rescue-deeltjes` | 93.2% | 21% | 24 voorspel 25% 21%, 82 orgel+gemeente+galm 89% |
| `1200 deeltjes` | 96.6% | 83% | 24 voorspel 25% 83%, 82 orgel+gemeente+galm 88% |
| `300 deeltjes` | 94.8% | 47% | 24 voorspel 25% 47% |

### 3.1 Samenvatting van wat uit de vergelijking volgt

- **Tolerante kans is nodig.** Een strenge kans (kappa 10, kleine foutmarge) verliest veel eerder de
  sync bij een verkeerde noot, zang of galm; een foutmarge van 0,25 en kappa 16 houdt de sync.
- **De kenmerkindeling doet ertoe.** Eén band (alleen toonklassen) vindt bij een voorspel vanaf het
  refrein van lofzang 24 het verkeerde punt: couplet en refrein hebben dezelfde akkoorden. Twee
  banden met een grens bij 260 Hz hebben het beste gemiddelde; sterkere compressie (macht 0,35)
  stort in bij galm; macht 0,8 houdt het volgen goed maar maakt de herkenning slechter (04).
- **De z-score-kans** (overeenkomst t.o.v. alle posities van dat frame, bedoeld om zich aan ruis aan te
  passen) is slechter en is afgevallen als standaard. De z-score wordt wel nog uitgegeven als
  diagnostiek.
- **De onset-term** (een positie waar net een noot begint krijgt meer gewicht bij een aanzet) helpt het
  volgen niet en schaadt de herkenning; hij staat uit.
- **Meer deeltjes** (1200) helpt niet; **minder** (300) is iets slechter. 600 is een goed punt.

## 4. Hoe de eisen uit de opdracht zijn ingevuld

| Eis | Hoe | Status |
|---|---|---|
| Langzaam, snel | Tempo is toestand (0,45 tot 2,2 maal het aangegeven tempo). | **BEWEZEN** 55 en 110 per minuut. |
| Geleidelijk versnellen en vertragen | Tempo is een willekeurige wandeling per deeltje; de geschatte bpm volgt mee. | **BEWEZEN**: tests 4 en 5 controleren ook dat de bpm-schatting meebeweegt. |
| Fermates en tijdelijke stiltes | In een fermate mag het tempo naar bijna nul; stilte houdt de positie vast. | **BEWEZEN** voor stilte en uitklinkend akkoord; **ONBEKEND** voor een fermate in echte opnamen (alleen lofzang 24 heeft er één). |
| Verkeerde noten | Begrensde straf per frame. | **BEWEZEN** tot 25% verkeerde noten in 40% van het stuk. |
| Orgelregistraties, piano | Twee timbres (orgel met harmonischen, piano met verval). | **BEWEZEN** synthetisch; echte registraties **ONBEKEND**. |
| Gemeentezang, nagalm | Zang op de melodie met afwijkingen, ruis en nagalm in de testopnamen. | **BEWEZEN** synthetisch (gedeeltelijk, zie 05: 88 tot 94%); echte gemeente **ONBEKEND**. |
| Voorspel | Beginverdeling is gemengd (helft rond het begin, helft overal); voorspel vanaf elke plek. | **BEWEZEN**. |
| Herhaling van dezelfde melodie | De cyclus is rond; een rondewissel is een gebeurtenis. | **BEWEZEN**. |
| Niet op seconden gebaseerd | Zie 1. | **BEWEZEN**. |
| Betrouwbaarheid | `confidence` 0 tot 1 uit de log-waarschijnlijkheidsverhouding en de concentratie van de deeltjes. | **BEWEZEN** in tests; de drempels zijn **niet** op echte opnamen gekalibreerd. |
| Onderscheid betrouwbaar / onzeker / verloren / hersteld | Zes statussen: `idle`, `acquiring`, `locked`, `uncertain`, `lost`, `recovered`. | **BEWEZEN** (test: onbekende muziek midden in het stuk). |

## 5. Betrouwbaarheid, status, rondes en couplet

### 5.1 Betrouwbaarheid

De kwaliteit is een voortschrijdend gemiddelde (1 s) van `log(kans onder de partituur / kans onder
een nulmodel)` per frame. Het nulmodel is de gemiddelde kans over **alle** posities van de
partituur: een frame dat overal even goed past, zegt niets. Dat past zich vanzelf aan ruis en
nagalm aan, in tegenstelling tot een vaste drempel op de overeenkomst. De betrouwbaarheid is dat
getal, geschaald naar 0 tot 1, maal hoe geconcentreerd de deeltjes rond één plek staan.

Gemeten spreiding (synthetisch, gemeente + ruis + galm, lofzang 24, 36 en 82): kwaliteit bij een
juiste positie p10 0,05 tot 0,08, mediaan 0,14 tot 0,22, p90 0,25 tot 0,33; bij een verkeerde
positie rond 0 (p90 hoogstens 0,10). Op de echte opnamen overlappen de twee sterker, omdat het
begin (voorspel) niet in de partituur staat en daar de "verkeerde" positie ook niet bekend is.

### 5.2 Status

| Status | Wanneer |
|---|---|
| `acquiring` | Nog geen betrouwbare positie (< 0,55 gedurende 1,5 s). |
| `locked` | Betrouwbaarheid 1,5 s boven 0,55. |
| `uncertain` | Betrouwbaarheid 1,5 s onder 0,35. De markering blijft staan; de gebruiker leest zelf verder. |
| `lost` | 5 s onder 0,2. |
| `recovered` | Terug boven 0,55 na `lost`, of na lange onzekerheid; blijft 4 s zichtbaar, daarna `locked`. |

Stilte is geen statuswissel: de positie wordt vastgehouden en `paused` is waar. Na 25 s stilte wordt
de status onzeker. De drempels zijn op synthetische opnamen en twee begeleidingsopnamen gekozen
en nog **niet** op echte opnamen in een kerk gekalibreerd.

### 5.3 Rondes en coupletten

(Bijgewerkt in fase 2; zie `07-VOORSPEL-EN-ZANGBEGIN.md`.) Een ronde telt pas als er na het
vastgestelde zangbegin genoeg van de melodie is doorlopen (dekking van minstens 60%), zodat een
tussenspel van twee regels geen extra couplet oplevert. `StanzaPlan` schakelt dan naar het volgende
couplet uit de gekozen volgorde. Een handmatige keuze heeft voorrang en wordt nooit teruggedraaid;
na de keuze gaat het automatisch verder vanaf de gekozen plek. Tijdens een verlies kan een ronde
gemist zijn: dat wordt gemeld (`lapUncertain`) en niet stil aangenomen. De volger start sinds fase 2
met een uniforme beginverdeling, omdat een voorspel overal in de melodie kan beginnen.

## 6. Weergave (fase E en F)

(De weergave is in fase 2 vervangen door de meezinginterface uit `07-VOORSPEL-EN-ZANGBEGIN.md`, 7.
De regels hieronder over markering, springen en onzekerheid gelden nog steeds; het actieve woord heeft
nu de accentkleur in plaats van een achtergrond.)

- Regelmarkering altijd; woordmarkering alleen als de lettergrepen aan noten zijn gekoppeld
  (`linking: "word"`). Anders een melding "alleen de regel is te volgen". Geen schijnnauwkeurige
  woordtijden: een woordmoment is de beat van de noot waaronder de lettergreep staat.
- De markering springt binnen een ronde alleen vooruit (en niet meer dan één regel per update) en
  blijft staan zolang de status onzeker is (gedimd). Bij `lost` toont de interface geen markering
  meer en staat er "lees zelf verder" (de sessie bewaart de laatste regel wel, zodat de markering
  bij herstel op een logische plek terugkomt). Een sprong is alleen toegestaan na herstel,
  een nieuwe ronde of een handmatige coupletwissel. Getest (`tests/hymns-stanzas.test.ts`,
  `tests/hymns-session.test.ts`).
- Coupletknoppen (1, 2, 3, ...), "Volgorde kiezen" voor bijvoorbeeld 1 → 4, rustige kleuren uit de
  `vs`-tokens, donkere weergave, coupletknoppen van 44 px (overige knoppen 40 px, de bestaande
  Versado-knopstijl), geen overflow op 320 px bij 200%
  tekst (gemeten in Chromium).

## 7. Wat nog niet werkt of onbekend is

- **Echte opnamen in een kerk**: niet gemeten. Alle echte audio is begeleidingsopname (Engels).
- **Voorspel dat niet in de partituur staat**: de echte opnamen beginnen met een voorspel van een
  deel van de lofzang; de eerste 10 tot 25 s zitten daar de tracker en de offline uitlijning vaak
  naast, omdat wat gespeeld wordt niet (precies) in de partituur staat.
- **Lofzang 36 heeft herhalingstekst** die de partituur niet modelleert; lofzang 24 lijkt een ander
  refrein te hebben dan de Engelse opname.
- **Stemming**: ±30 cent verschil gaat goed; grotere afwijkingen zijn niet getest.
- **iOS, Android, Safari, Firefox**: niet getest.
- **Batterij**: niet gemeten.
- **Acht of meer coupletten, andere maatsoorten (6/8, 12/8)**: de extractor en referentie
  ondersteunen alleen wat in de drie lofzangen voorkomt (2/4, 3/4, 4/4).
