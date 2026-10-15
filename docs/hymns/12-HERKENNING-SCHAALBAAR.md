# Lofzangen: schaalbare herkenning voor de hele bibliotheek

Fase 4. Herkennen tegen 171 unieke composities (173 lofzangen met gevalideerde muziek) in plaats van drie. Alles blijft lokaal op het toestel.
Begrippen **BEWEZEN / AANNEMELIJK / ONBEKEND** als in `01-SOURCE-AUDIT.md`. Meetscripts: `scripts/hymns/eval-library.ts`,
`eval-prefilter.ts`, `calibrate-evidence.ts`; tests: `tests/hymns-recognition-library.test.ts`.

## 1. Waarom de oude aanpak niet schaalt

De proef draaide één score-follower (deeltjesfilter, 500 deeltjes) per kandidaat. Dat is bij drie lofzangen goedkoop; bij 171 is het te zwaar voor
een telefoon, en bovendien onbetrouwbaar: **BEWEZEN** (eerste meting op de echte begeleidingsopnamen): met alle kandidaten stelde de herkenner
bij 18 testlofzangen in 6 gevallen als eerste uitspraak een verkeerde lofzang voor, omdat een paar harmonisch "algemene" lofzangen (zoals 152, 125 en 176) op bijna
elke muziek veel bewijs verzamelen. Eén rekenkundig te zware én statistisch verleidelijke aanpak dus.

## 2. Ontwerp: kandidaten kiezen, daarna verifiëren

```
FeatureFrame (12 toonklassen x 2 banden, 46 ms)
   │
   ├─▶ voorfilter (recognize/prefilter.ts): laatste ~12 s, DTW tegen ALLE composities, tempo-onafhankelijk, in kleine stukjes per frame
   │        → rangorde + "kop" (wie staat eerst, hoe lang al, voorsprong)
   │
   └─▶ score-follower (follow/tracker.ts) voor de beste 6 (+ de beste 3 op bewijs, maximaal 9), met inhalen van het recente geheugen
            → tracker-bewijs per kandidaat, omgerekend naar z (kalibratie per compositie)

besluit (recognizer.ts):  voorfilter-kop stabiel + tracker bevestigt   →  identified
                          tracker duidelijk en tevens bovenaan voorfilter →  identified
                          geen van beide                                →  candidates / ambiguous / unknown
```

### 2.1 Voorfilter

- Gehoord: per 0,19 s de gemiddelde toonklassen; een venster van maximaal 64 stappen (~12 s). Referentie: per compositie de toonklassen per
  halve beat (met boventonen en lichte uitsmering), twee cycli achter elkaar zodat een venster over de cyclusgrens past.
- Eerst het gemiddelde toonklasseprofiel aftrekken (anders lijken alle lofzangen in dezelfde toonsoort op elkaar), dan **subsequence-DTW**:
  vertragen en versnellen is toegestaan, dus het tempo hoeft niet bekend te zijn.
- De rekenlast wordt verdeeld: elke seconde een ronde, over de frames gespreid (10 composities per frame); elke zesde ronde over de hele
  bibliotheek, de rondes ertussen alleen over de beste 24 van de vorige.
- **BEWEZEN** (`eval-prefilter.ts`, 137 opnamen): na 30 s staat de juiste compositie bij 114 van 137 bovenaan en bij 132 van 137 binnen de beste elf.
  Een eerdere versie op akkoordwisselingen was veel zwakker (juiste compositie pas na ~20 s of niet); de versie op vensters is gekozen.

### 2.2 Score-follower met z-genormaliseerd bewijs

- Alleen voor de kandidaten van het voorfilter (6 + hysterese, nooit meer dan 9 tegelijk). Een nieuwe kandidaat haalt de laatste 15 s van het
  kenmerkgeheugen in (maximaal 60 frames per aanroep), zodat zijn bewijs niet achterloopt.
- **Kalibratie** (`scripts/hymns/calibrate-evidence.ts`, `data/evidence-calibration.json`): per compositie is vastgelegd hoeveel bewijs hij
  gemiddeld en hoe wisselend op 24 ANDERE opnamen haalt, op 10/20/30/45/60 s. Het bewijs wordt omgerekend naar z = (bewijs - gemiddelde) / spreiding.
  Zo verliezen vaste "aantrekkers" hun voordeel. De kalibratie hoort bij de bibliotheek: bij elke wijziging opnieuw draaien.

### 2.3 Besluit in twee niveaus

Alleen in de grote bibliotheek (meer kandidaten dan `activeLimit`); bij hooguit zes kandidaten geldt de oude regel ongewijzigd (de bestaande tests).

| Status | Voorwaarde | Gevolg |
|---|---|---|
| `identified` (zeker) | **voorfilter-kop**: minstens 8 s muziek, kop 5 rondes achter elkaar eerste, voorsprong ≥ 0,08, tracker-z ≥ 3 én (z niet meer dan 1 onder de beste rivaal, of voorsprong ≥ 0,10); **of tracker-gedreven**: z ≥ 6 met 3 z boven de rest én dezelfde kandidaat is de stabiele kop van het voorfilter (3 rondes, voorsprong ≥ 0,06) | de app begint zelf te volgen (na 2 s stabiel) |
| `suggested` (waarschijnlijk) | kop 5 rondes stabiel, voorsprong ≥ 0,04, tracker-z ≥ 1,5 én niet tegengesproken | knop "Dit lijkt de lofzang: n. titel"; de gebruiker bevestigt, de app volgt niet zelf |
| `ambiguous` | de kop is stabiel maar de voorsprong is kleiner dan 0,04 | geen keuze |
| `unknown` | na 25 s geen enkele kandidaat met bewijs | "Zoek zelf" |

Het voorfilter en de tracker zijn twee onafhankelijke getuigen; spreken ze elkaar tegen, dan wacht de herkenner (nooit een gok). Waarom twee niveaus:
**BEWEZEN** (leave-one-out, zie 3): als de gespeelde lofzang niet in de bibliotheek staat, lijkt hij toch op een andere lofzang; met alleen
het lage niveau volgde de app dan in 21 % van de gevallen (32 van 152) zelf een verkeerde lofzang. Met het hoge niveau voor automatisch volgen en het
lage niveau als voorstel is dat 1 van 152. De drempels zijn gekozen op de echte begeleidingsopnamen (zie 3: dezelfde opnamen dus **geen**
onafhankelijke testset; ze zijn daarna ook op de helft van de opnamen gecontroleerd die niet in de kalibratiepool zaten).

### 2.4 Gedeelde melodieën

Composities met precies dezelfde noten zijn één kandidaat. Bij een gedeelde melodie weet de muziek niet welke tekst gezongen wordt: de engine
kiest dan **nooit** zelf (geen automatisch volgen); het herkenscherm toont de lofzangen met die melodie en de gebruiker kiest de tekst
(`CandidateScore.sharedWith`, `tests/hymns-recognition-library.test.ts`). In de huidige bibliotheek zijn er 2 gedeelde melodieën.

## 3. Meting op echte opnamen (BEWEZEN, geen echte dienst)

`npx tsx scripts/hymns/eval-library.ts --seconds 90 --results-out ...`: elk van de 152 gevalideerde lofzangen met een officiële begeleidingsopname
(piano/orgel, studio), de eerste 90 s, door dezelfde extractor en herkenner als de app. Alleen de **eerste uitspraak** telt (de app begint dan te volgen).

| Meting | Uitkomst |
|---|---|
| Lofzangen met opname | 152 |
| De app volgt zelf, en juist (`identified`) | **139 van 152 (91 %)** |
| De app volgt zelf, maar verkeerd | **0** |
| Juist als voorstel dat de gebruiker bevestigt (`suggested`) | 11 |
| Niet herkend binnen 90 s | 2 (lofzang 7 en 17; status "onbekend" of "ambigu", nooit een gok) |
| Luistertijd tot automatisch volgen | mediaan 13 s, P90 57 s, maximaal 85 s |
| Onbekende melodie (leave-one-out: de lofzang zelf is geen kandidaat), 152 opnamen | de app volgt zelf een verkeerde lofzang bij **1 van 152** (lofzang 19); bij 28 komt een (verkeerd) voorstel dat de gebruiker kan negeren |
| CPU per frame (46 ms interval), ontwikkelmachine, gemiddeld | ~5,5-6 ms (piek per frame ~90-160 ms bij het activeren van kandidaten) |
| Geheugen (bibliotheek + herkenner na 60 s) | ~11 MB |
| Gelijktijdig actieve score-followers | maximaal 9 |

Ontwikkeling van de aanpak, ter eerlijkheid: de eerste versie (alleen tracker-bewijs, alle kandidaten) gaf op 18 lofzangen 10 goed, 6 fout en 2 niet herkend;
het voorfilter als kop gaf 141 van 146 goed en 4 fout; met z-normalisatie en tegenspraakregel 150 van 152 en 1 fout; met een tweede (tracker-gedreven) weg
152 van 152 maar 21 % verkeerd bij onbekende melodieën, en daarom de twee niveaus hierboven. Dat is dus afstellen op dezelfde opnamen.

Wat dit **niet** zegt: de opnamen zijn schoon begeleidingsspel van de Engelse uitvoering, zonder gemeentezang, galm, pratende kinderen of een
orgel met afwijkende stemming. De Nederlandse notatie wijkt soms af van de Engelse opname. **Praktijkresultaat in een kerk: ONBEKEND.**

## 4. Robuustheid (synthetisch en bewerkte opnamen)

Dezelfde herkenner, dezelfde 27 lofzangen (een op de drie bij een gespreide steekproef), eerste 90 s van de officiële opname, bewerkt. Gemeten met
`eval-library.ts --tempo/--noise`. "Juist" = de eerste uitspraak is de goede lofzang.

| Bewerking | Lofzangen | Juist | Verkeerd | Niet herkend | Mediaan | P90 |
|---|---|---|---|---|---|---|
| tempo ×0,75 (langzamer) | 27 | 22 | 0 | 5 (67, 94, 198, 70, 149) | 14,8 s | 52,3 s |
| tempo ×1,35 (sneller) | 27 | 23 | 0 | 4 (116, 148, 198, 174) | 9,6 s | 47,8 s |
| ruis 0,05 (witte ruis) | 27 | 24 | 0 | 3 (23, 67, 94) | 17,8 s | 57,9 s |

Lezing: bij vertraagd, versneld of ruizig geluid wordt een lofzang vaker niet herkend (11-19 %), maar nooit een verkeerde zeker gekozen (0 van 81).
Dat is de bedoelde afweging: liever "niet herkend, zoek zelf" dan een verkeerde lofzang. **BEWEZEN** alleen voor deze bewerkingen op studio-opnamen; echte
kerkakoestiek, gemeentezang en kinderen zijn niet gemeten.

## 5. Regressie lofzang 36 bij 55 per minuut

In de dienstmatrix van fase 2 duurde herkenning van lofzang 36 bij 55/min orgel 126 s (alleen drie kandidaten). `tests/hymns-recognition-library.test.ts`
("regressie") bewaakt dat 36 bij 55/min orgel tegen de **hele** bibliotheek binnen 40 s synthetisch juist herkend wordt. Op de echte opname:
lofzang 36 wordt na ~41 s herkend. **BEWEZEN** voor synthetisch geluid en de studio-opname; niet voor een echte uitvoering van 55/min.

## 6. Beperkingen

- Alleen composities met gevalideerde muziek zijn herkenbaar (173 van 205); de overige 32 zijn tekst-only.
- Transponeren (een orgel dat een halve toon anders speelt of een gemeente die lager inzet) wordt niet ondersteund; er wordt in de notatie-toonsoort geluisterd.
- Een lofzang waarvan de Nederlandse notatie wezenlijk afwijkt van wat gespeeld wordt, wordt niet herkend.
- Zonder verbinding werkt de herkenning alleen als de bundel vooraf is geladen (`13-PRESTATIES-EN-OFFLINE.md`).
