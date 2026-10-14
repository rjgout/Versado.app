# Lofzangen: automatisch herkennen (proef)

"Herken lofzang": de gebruiker kiest geen nummer, de telefoon luistert en stelt een lofzang voor.
Beperkt tot de drie proeflofzangen. Termen BEWEZEN, AANNEMELIJK en ONBEKEND: zie
`01-SOURCE-AUDIT.md`. Alle metingen: `05-TEST-RESULTS.md`.

**Resultaat: gedeeltelijk geslaagd.** Op synthetische opnamen werkt het betrouwbaar (21 van 21
bekende fragmenten juist, 0 van 21 onbekende melodieën ten onrechte voorgesteld). Op de echte
begeleidingsopnamen werkt het, maar trager (25 tot 48 s) dan op synthetisch geluid. Een algemene uitspraak voor echte uitvoeringen is **nog niet** te doen.

## 1. Aanpak

Geen opname-fingerprinting (die zit vast aan één tempo en één uitvoering) en geen server. Voor elke
kandidaat-lofzang draait dezelfde score-follower als bij het volgen (`HymnRecognizer` in
`recognize/recognizer.ts`), met een beginverdeling over de hele cyclus, zonder te weten waar of hoe
snel er gespeeld wordt. Kandidaten kunnen dus op elk punt beginnen en op elk tempo spelen.

**Bewijs.** Per frame vergelijkt elke kandidaat zijn kans (met zijn eigen best gevolgde positie) met
een **nulmodel**: de gemiddelde kans over alle posities van die partituur. Het verschil
`log(kans kandidaat / kans nulmodel)` wordt opgeteld, met een halfwaardetijd van 40 s zodat oud bewijs
verdwijnt. Stilte telt niet mee. Het bewijs is dus hoeveel beter een partituur de klank verklaart
**dankzij muzikale continuïteit**, niet alleen omdat een akkoord overal past.

**Besluit** (`DEFAULT_RECOGNIZER_CONFIG`):

| Status | Voorwaarde |
|---|---|
| `listening` | Minder dan 6 s muziek gehoord. |
| `candidates` | Er is wat bewijs (meer dan 30% van de drempel), nog niet genoeg. |
| `identified` | Bewijs van de beste ≥ 70 nats én ≥ 20 nats voorsprong op de tweede. Dan is er een voorstel (`suggestion`). |
| `ambiguous` | Bewijs ≥ 70 nats, maar de voorsprong op de tweede is kleiner dan 20 nats. |
| `unknown` | Na 25 s muziek geen enkele kandidaat boven 70 nats. |

Er is geen pad waarop altijd een van de drie wordt gekozen: zonder bewijs blijft de status
`listening`, `candidates` of `unknown`. De interface toont dan de kandidaten met hun bewijs
(geen percentage), en pas bij `identified` een knop "Volg deze lofzang". Het getoonde bewijs is
geen kans; er wordt geen kunstmatig hoge zekerheid getoond. `probability` in de uitvoer is een
gedempte softmax (temperatuur 0,1) en bedoeld voor onderzoek.

## 2. Resultaten op synthetische opnamen (BEWEZEN)

Zie `05-TEST-RESULTS.md`, 4 voor de tabel van 42 gevallen (7 omstandigheden x 3 bekende en 3 onbekende
melodieën). Samengevat:

- **Bekende lofzangen: 21 van 21 juist herkend, 0 verkeerd, 0 gemist.** Mediane tijd tot het
  voorstel 7,8 s (p90 26,6 s; maximum 28,3 s). Met gemeente, ruis en nagalm duurt het 14 tot
  27 s; met 20% verkeerde noten 21 tot 28 s.
- **Onbekende melodieën: 0 van 21 ten onrechte voorgesteld.** Het hoogste bewijs voor een
  onbekende melodie was 35 nats (de drempel is 70). Na 25 s is de status `unknown`.
- **Ambiguïteit** (test in `tests/hymns-recognition.test.ts`): twee kandidaten met dezelfde melodie
  (één is een kopie van lofzang 24 onder een ander id) geven `ambiguous` en nooit `identified`; de
  twee kandidaten staan bovenaan.
- **Ruis zonder muziek** (willekeurige toonklassen) en **stilte** geven geen voorstel.
- **Tempo, instrument en beginpunt** hebben geen invloed op de uitkomst: 55 tot 100 per minuut,
  orgel en piano, voorspel vanaf 55% van de cyclus.

## 3. Resultaten op echte begeleidingsopnamen

Eerste 60 s van de officiële (Engelse) begeleidingsopnamen, zonder voorkennis:

| Lofzang | Eerste voorstel |
|---|---|
| 24 | 24 na 25,5 s |
| 36 | 36 na 47,9 s |
| 82 | 82 na 36,8 s |

Alle drie juist, maar veel later dan op synthetische opnamen. Oorzaken (**AANNEMELIJK**): de opnamen
beginnen met een voorspel dat niet in de partituur staat; de opname is van de Engelse tekst op
dezelfde melodie; en echt pianogeluid met galm past minder goed bij de eenvoudige boventoonmodel van
de referentie. Het is een kleine steekproef (3 opnamen, 1 uitvoering per lofzang).

## 4. Waarom de herkenning gevoelig is (en wat er is gemeten)

De drie lofzangen zijn tonale, homofone koraalzettingen met veel dezelfde akkoorden. Een kandidaat
kan daarom bewijs verzamelen op muziek die niet de zijne is. Wat dat bewijst en vergelijkt:

`npx tsx scripts/hymns/sweep.ts herken` (3 lofzangen en 3 onbekende melodieën, 3 omstandigheden, 22 s per fragment). Kolom 2: bewijs voor de juiste lofzang minus het beste andere, laagste waarde over de 9 bekende gevallen, na 6/10/15/21 s. Kolom 3: hoogste bewijs voor een onbekende melodie over de 9 onbekende gevallen. Een goede variant heeft een hoge kolom 2 en een lage kolom 3.

| Variant | Bewijs voor de juiste lofzang minus beste andere (minimum over 9 gevallen) na 6/10/15/21 s | Hoogste bewijs voor een onbekende melodie (6 gevallen) na 6/10/15/21 s |
|---|---|---|
| `gekozen (geen rescue, kappa 16, outlier 0,25, rateSigma 0,08)` | 2 / 10 / 6 / 20 | 14 / 38 / 33 / 31 |
| `met rescue-deeltjes (1%)` | 4 / 15 / 11 / 24 | 31 / 62 / 66 / 64 |
| `onset-term (gewicht 1,5)` | -6 / 2 / 6 / 18 | 18 / 22 / 28 / 32 |
| `kappa 24` | 3 / 8 / 11 / 16 | 13 / 13 / 14 / 13 |
| `strenge kans: kappa 10, outlier 0,04` | -24 / 12 / 39 / 124 | 78 / 63 / 79 / 107 |
| `rateSigma 0,14 (zoals het volgen)` | 3 / 10 / 8 / 21 | 15 / 36 / 32 / 50 |

Les uit de vergelijking:

- **Zonder "rescue"-deeltjes** is het bewijs voor een verkeerde kandidaat veel lager. Rescue-deeltjes
  laten een kandidaat losse stukken muziek aan elkaar rijgen; ze helpen bij herstel tijdens het
  volgen (waar ze aan staan) maar schaden de herkenning (waar ze uit staan).
- **De onset-term** vergroot het bewijs van een verkeerde kandidaat sneller dan van de juiste en
  staat daarom uit.
- **De drempel (70 nats) is nu ruim boven het hoogste bewijs voor een onbekende melodie (35)** en ruim
  onder het bewijs van de juiste lofzang in schone omstandigheden (rond 180 tot 430 na 35 s); in
  moeilijke omstandigheden (zang, ruis, galm) wordt de drempel pas na 14 tot 27 s gehaald. Dat is de
  bedoelde afweging: liever later dan een verkeerde lofzang voorstellen.
- De marge tussen "onbekend" (35) en "pas net herkend" (70) is met 6 onbekende melodieën **niet
  statistisch hard**. Met een groter boek (205 lofzangen) komen er meer lofzangen met gelijksoortige
  akkoorden en neemt het risico op een valse treffer toe. Dat is **ONBEKEND** en moet worden
  gemeten voor het zangboek wordt opengezet (zie `06-IMPLEMENTATION-ROADMAP.md`).

## 5. Gekozen en afgevallen methoden

| Methode | Uitkomst |
|---|---|
| Parallelle score-followers + bewijs t.o.v. nulmodel (gekozen) | Werkt, zie boven. |
| Eén lang gewogen DTW over alle kandidaten | Niet gebouwd; geen tempoparameter en geen betrouwbare tegenhanger voor "onbekend". |
| Alleen akkoordreeks (chroma) zonder continuïteit | Het nulmodel is precies dit: elke positie even waarschijnlijk. Zonder continuïteit is er geen onderscheid. |
| Onset-term in de kans | Afgevallen (zie 4). |
| Rescue-deeltjes in de herkenner | Afgevallen (zie 4). |
| Kansen als percentage tonen | Afgevallen: het bewijs is gecorreleerd over frames en geen kans; de interface toont het bewijs en pas bij voldoende zekerheid een voorstel. |
| Opname-fingerprint | Uitgesloten (opdracht). |

## 6. Wat nog niet werkt of onbekend is

- Echte uitvoeringen (kerk, andere organisten, gemeente): **ONBEKEND**.
- Tempoafwijkingen buiten 55 tot 110 per minuut, andere stemming dan ±30 cent: niet getest.
- Meer dan drie kandidaten, en het gedrag bij echt gelijke melodieën in het zangboek: de ambiguïteit is
  alleen getest met een nagemaakte kopie, **ONBEKEND** hoe vaak dat in het boek voorkomt (zie
  `01-SOURCE-AUDIT.md`, 4).
- Herkenning terwijl de gemeente al zingt zonder voorspel: niet apart getest.
- De drempels staan vast en zijn niet per toestel of microfoon gekalibreerd.
