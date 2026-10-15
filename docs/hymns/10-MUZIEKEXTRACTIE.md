# Lofzangen: partituren uit de officiële PDF's lezen en valideren

Fase 4. Alle 202 beschikbare PDF's gaan door één extractor (`scripts/hymns/extract_score.py`). Hier staat hoe die werkt, hoe
het resultaat wordt gevalideerd en waarom een PDF die zonder foutmelding wordt verwerkt **niet** automatisch correct is.
Aantallen: `15-KWALITEITSRAPPORT.md`.

## 1. Waarom lezen en niet herkennen

De PDF's zijn vectorbestanden (lettertype "Interlude"): noten zijn tekens op een exacte positie, stokjes en balken zijn lijnen
en vlakken, de tekst staat als tekens met lettergrepen onder de noten. De extractor leest die tekenopdrachten (pymupdf); er is
geen beeldherkenning. Dat is deterministisch en herhaalbaar, maar vereist dat de rest van de notatie ook goed gelezen wordt.

## 2. Wat de extractor leest

| Onderdeel | Aanpak |
|---|---|
| Balken, sleutels | vijf lijnen op gelijke afstand; sleutel uit het meest linkse teken (ook de varianten `ß`/`Í` in twee PDF's) |
| Systemen | G-balk gevolgd door F-balk; verwacht en gecontroleerd |
| Noten | koppen `œ` (zwart), `˙` (half), `w` (heel); toonhoogte uit de y-positie; stok (soms ~1 pt scheef getekend) bepaalt de duur; bij twee stokken aan één kop (twee stemmen, dezelfde toon) telt de gebalkte |
| Balken en vlaggen | vlakken en `j`/`J`; aantal balken geeft achtste, zestiende |
| Punten | globale koppeling van punten aan koppen of rusten (laagste kosten eerst); een punt achter een akkoord geldt voor alle koppen aan dezelfde stok; dubbele punt |
| Rusten | kwart `Œ`, half `Ó`, hele maat `∑` (gecentreerd, dus tijd 0), achtste `‰`, zestiende `K` |
| Triolen | het cijfer 3 is het teken `£`; standaard de drie kolommen eromheen, bij een mislukte maatsom ook een tweenoten-triool |
| Voortekens | `#`, `b`, `n`; geldt tot de maatstreep, per balk en toonhoogte; sleutelvoorteken per balk en meerderheid |
| Maatsoort | cijfers boven elkaar, meercijferig, `c` = 4/4; wissels midden in het stuk (lofzang 11 en 15) |
| Maatstrepen | enkel, dubbel, eind, herhaling met punten (`{`); thin/thick op basis van de breedte van de beginstreep |
| Fermates | `U`/`u` bij de dichtstbijzijnde kop |
| Lettergrepen | afzonderlijke tekens; een koppelteken of spatie sluit een lettergreep |

### Systeemwisselingen en opmaten

Een maat kan over een systeemwisseling lopen: het staartfragment (na de laatste streep van een systeem) en het kopfragment
(voor de eerste streep van het volgende) zijn samen één maat. Een opmaat is een korte eerste maat die door de laatste maat wordt
aangevuld; de refrein- of coupletgrens kan midden in zo'n maat liggen, dus grenzen zijn beats en geen maatnummers.
Dit was de grootste oorzaak van foutieve lezingen (336 fouten in de eerste versie) en is structureel opgelost.

## 3. Validatie: een PDF zonder foutmelding is niet automatisch correct

De extractor geeft `problems`. Een partituur geldt alleen als gevalideerd als:

1. **Maatsom**: elke logische maat telt op tot de maatsoort (uitzondering: opmaat + slotmaat);
2. **Geen gaten**: in elke maat is elke balk op elk tijdstip door een noot of rust gedekt, en geen noot eindigt na de maat;
3. **Kolommen** stijgen strikt in tijd; triolen zijn te koppelen;
4. **Tekstcontrole** (`build_nld_music.py`): de lettergrepen onder de noten komen overeen met de officiële tekst (tekenvergelijking),
   de woordbeats stijgen en de regelstarten van couplet 1 stijgen en bestaan;
5. **Geen herhalingstekens** in de partituur (de gespeelde volgorde is dan niet de geschreven volgorde; zie 5).

Een PDF die hier niet doorheen komt, wordt **niet** als muziek opgeslagen en niet voor herkenning gebruikt; de tekst blijft
leesbaar en de reden staat in het kwaliteitsrapport. De extractor probeert zes varianten (puntkoppeling, kolomtolerantie,
rustpunten) en houdt die met de minste problemen: dat is een zoekstrategie, geen versoepeling van de eisen.

### Onafhankelijke controle met de begeleidingsopname

`scripts/hymns/audio_check.py` vergelijkt de gelezen noten met de officiële begeleidingsopname: chroma van de opname tegen de
toonklassen van de noten, subsequence-DTW, met het gemiddelde profiel afgetrokken (anders lijken alle lofzangen in dezelfde
toonsoort op elkaar). Uitkomst per lofzang: rang van de eigen compositie tussen alle gevalideerde composities. Rang 1 tot 3 telt
als **bevestigd**. Let op:

- de opname is de **Engelse** begeleiding van dezelfde melodie; een afwijkende harmonisatie in het Nederlandse boek geeft dus een
  slechtere rang zonder dat de extractie fout is (voorbeeld: een DTW-rang van 32 voor lofzang 44 terwijl een venster van 12 s
  de compositie wel als eerste vindt). "Afwijkend" blokkeert de status daarom niet, maar telt ook niet als bevestiging;
- 24 lofzangen hebben geen opname; bevestiging is voor hen niet mogelijk (**ONBEKEND**).

## 4. Wat nog niet lukt

De resterende extractieproblemen (maatsommen die niet kloppen) en tekstafwijkingen staan per lofzang met nummer en concrete reden in
`15-KWALITEITSRAPPORT.md`. De bekende klassen:

- **Triolen** met verschillende groepsgroottes in één maat en meerdere triolen met rusten (bijv. 47, 123, 167, 190);
- **Meerstemmige ritmes** waarbij stemmen op dezelfde x-positie een verschillend ritme hebben (bijv. 1, 9, 11, 99);
- **Zeldzame tekens** en tekenstijlen (lofzang 83 gebruikt een andere lijnbreedte);
- **Tekstverschillen** tussen de gedrukte bladmuziek en de webtekst (69, 85, 96, 136, 139, 150, 154): de partituur is dan zelf
  wel te lezen maar de koppeling aan de officiële tekst is onbetrouwbaar en wordt niet bewaard.

Deze lofzangen worden nooit "bijna goed" opgeslagen: ze blijven tekst-only.

## 5. Herhalingstekens

Twee PDF's (167 en 204) hebben herhalingstekens. De gespeelde volgorde is niet de geschreven; de partituur zou dus een onjuiste
volgorde aanbieden aan de volger. Daarom zijn ze **afgeschermd** (tekst-only). Uitrollen van de herhaling is een mogelijke
vervolgstap (**AANNEMELIJK**), niet gebouwd.

## 6. Prestaties en herhaalbaarheid

De extractie van alle 202 PDF's duurt ongeveer 20 s op één kern. `extract_all.py` slaat ongewijzigde PDF's over (hash + extractorcode).
De debughulp `scripts/hymns/debug_measure.py <lofzang> <maat> [beeld.png]` toont de gelezen noten van één maat met de bijbehorende PDF-uitsnede.
