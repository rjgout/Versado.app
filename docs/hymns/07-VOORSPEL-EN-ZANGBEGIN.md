# Lofzangen: voorspel, zangbegin en de meezinginterface (fase 2)

Termen **BEWEZEN** (gemeten of getest in deze repository), **AANNEMELIJK** (volgt uit het ontwerp of
uit eerdere metingen maar is niet apart gemeten) en **ONBEKEND** (niet onderzocht of niet te meten
zonder echte kerkopnamen) zijn die uit `01-SOURCE-AUDIT.md`. Alle metingen: `05-TEST-RESULTS.md`, 10.

## 1. Het probleem

De volger weet **waar** in de melodie de muziek is. Hij weet niet of de gemeente al zingt. Een organist
die het voorspel speelt (de laatste regel, vier maten, een heel couplet) speelt dezelfde noten als bij de
samenzang. Uit toonhoogtes alleen is dat onderscheid dus niet te maken. In de eerste versie liep de
tekst daardoor al mee terwijl het voorspel nog klonk.

Herkennen welke lofzang het is en vaststellen dat het zingen begint zijn **twee verschillende
problemen**. Het eerste mag tijdens het voorspel al klaar zijn; het tweede heeft eigen bewijs nodig.

## 2. Aanpak: een fase-laag op structuur, geen zware AI

`SingingPhase` (`src/lib/hymns/follow/phase.ts`) staat bovenop de bestaande volger en gebruikt alleen wat
de volger al levert (positie, tempo, concentratie) plus het geluidsniveau. Er is geen model, geen
spraakherkenning en geen netwerk. De fasen zijn:

| Fase | Betekenis | Wat de gebruiker ziet |
|---|---|---|
| (geen sessie) | Nog niet gestart of de lofzang wordt herkend | "Lofzang herkennen…", kandidaten |
| `acquiring` (volger) | Muziek wordt nog gezocht | "Muziek zoeken…" |
| `prelude` | De volger weet waar de muziek is; het zangbegin is nog niet vastgesteld | "Voorspel", tekst staat klaar, geen markering |
| `prelude` + `waiting` | Een rondegrens zonder genoeg bewijs is gepasseerd, of we stapten halverwege in | "Voorspel" + hint: wachten op het zangbegin |
| `singing` | Zangbegin vastgesteld | "Volgt muziek", woordmarkering loopt mee |
| `interlude` | Na het zingen sprong de muziek elders heen (instrumentaal tussenspel) | "Tussenspel", tekst voor het volgende couplet staat klaar |
| `uncertain` / `lost` / `recovered` (volger) | Synchronisatie onzeker, verloren of hersteld | Ongewijzigd uit fase 1 |

### 2.1 Welke signalen worden gebruikt

1. **Rondegrens.** Het voorspel eindigt waar de melodie eindigt; de zang begint waar de melodie begint.
   Een grens telt alleen als de positie eerst minstens 0,8 s in het laatste derde van de cyclus is gezien
   en dan van voorbij 80% naar onder 20% gaat.
2. **Waar de muziek begon.** Begon de muziek na een stilte (de uitgangsruis is eerst gemeten en de muziek
   komt er minstens 12 dB boven uit) en midden in de cyclus, dan is het voorspel een deel van het einde
   (scenario A en C). Is er sinds de eerste klank een heel couplet gespeeld of begon de muziek bij het
   begin, dan kan het voorspel een heel couplet zijn (scenario B, D, E). Stapte de gebruiker halverwege
   in (geen stilte vooraf), dan is er niets te zeggen over het begin (scenario G).
3. **Pauze bij de grens.** Een stilte van minstens 0,5 s die rond de grens begint of eindigt. Stilte is
   een daling van minstens 20 dB onder het recente maximum (kerkakoestiek maakt zelden digitale stilte)
   of de stilte die de extractor al kende. De volger ziet de grens soms al aan het begin van de stilte;
   een pauze die er kort daarna uit blijkt te bestaan telt alsnog mee (`lateGap`).
4. **Dekking.** Een ronde telt als gezongen couplet pas als minstens 60% van de melodie is doorlopen
   sinds de vorige grens. Een tussenspel van de laatste regels dekt veel minder.
5. **Sprongen.** Verspringt de positie langer dan twee seconden stabiel meer dan 15% van de cyclus
   (zonder dat het een grens is), dan is dat een onderbreking: tijdens het zingen wordt het `interlude`.
6. **Geluidsniveau (alleen diagnose).** De verandering van het niveau (laatste 2 s t.o.v. de 6 s
   ervoor) wordt getoond in het technische paneel. Ze beslist niets: in de synthetische diensten
   onderscheidde ze "met gemeente" niet van "zonder gemeente" (`05-TEST-RESULTS.md`, 10.5), er zijn geen
   opnamen van echte gemeentezang gemeten, en pratende of roepende kinderen laten het niveau ook stijgen.

Zangdetectie op de stem is **niet** gebouwd. Spraak- of stemdetectie zou nooit doorslaggevend mogen
zijn; zonder echte opnamen kan ze bovendien niet worden gekalibreerd.

### 2.2 Besluitregel voor het zangbegin

Bij een rondegrens in `prelude`: score = 0,30 (grens) + 0,55 (de muziek begon midden in de cyclus) +
0,60 (pauze bij de grens). Vanaf 0,80 begint het zingen automatisch:

| Situatie | Score | Uitkomst |
|---|---|---|
| Voorspel begon midden in het couplet (deel van het einde) | 0,85 | zangbegin op de grens |
| Heel couplet als voorspel, pauze bij de grens | 0,90 | zangbegin waar de muziek na de pauze klinkt |
| Heel couplet, geen pauze | 0,30 | **wachten**; de gebruiker tikt "Zang begint" |
| Halverwege ingestapt, pauze bij de grens | 0,90 | zangbegin |
| Halverwege ingestapt, geen pauze | 0,30 | **wachten** |

Er is geen pad waarop zonder bewijs toch een zangbegin wordt aangenomen.

### 2.3 Handmatig

- **Zang begint** (alleen zichtbaar tijdens het voorspel): de fase wordt `singing` op dit moment. De
  muziekvolging, de microfoon en de gevolgde positie worden niet aangeraakt (bewezen: de posities zijn
  bit voor bit gelijk met en zonder tik). Tik vlak voor een rondegrens (laatste 20% van de cyclus), dan
  begint het zingen pas bij die grens. De eerste grens na een handmatig begin telt als einde van het
  gezongen couplet.
- **Opnieuw synchroniseren** (tijdens het zingen): terug naar `prelude` zonder markering; de volger zoekt
  zijn plek opnieuw (uniforme beginverdeling); het gekozen couplet blijft; de microfoon en de extractor
  lopen gewoon door.
- Een handmatige keuze (zangbegin of couplet) heeft altijd voorrang op automatische aannames.

## 3. Coupletten, volgorde en tussenspelen

- `StanzaPlan` is ongewijzigd. Het ontvangt alleen nog rondes uit `SingingPhase`: nooit voor het
  zangbegin, dus een voorspel telt nooit als gezongen couplet.
- Volgorde 1 → 4: couplet 1 staat klaar tijdens het voorspel; na de eerste echte zangronde gaat het naar
  couplet 4 (scenario H).
- Tussenspel van de laatste regels: de rondegrens aan het einde ervan heeft te weinig dekking en wordt
  genegeerd (`lap-ignored`); daarna hervat de zang zonder extra couplet (scenario I).
- Een **heel couplet** als tussenspel is niet te onderscheiden van een gezongen couplet. Dat is een
  bekende beperking: de gebruiker corrigeert het couplet zelf.
- Instappen midden in de samenzang (scenario G): de positie wordt wel herkend, maar couplet 1 wordt niet
  aangenomen; de gebruiker kiest het couplet en tikt "Zang begint".

## 4. Beperkingen en onzekerheden

- Echte kerkuitvoeringen: **ONBEKEND**. Alle metingen zijn synthetisch (piano- en orgelklank, nagemaakte
  gemeente, kinderstemmen en ruis) of op begeleidingsopnamen.
- Geen pauze én een voorspel van een heel couplet: de engine kan het zangbegin niet bepalen en vraagt
  erom. Dat is bedoeld (zie 2.2), geen fout.
- Voorspel van twee maten of korter: de volger heeft soms te weinig tijd om vóór de grens te
  synchroniseren. Dan wacht de engine of start hij bij de grens; er wordt niet gegokt (zie 05, 10).
- Een pauze wordt gemist als nagalm de stilte opvult (lange kerkakoestiek): dan geen pauzebewijs.
- Het begin van het tussenspel wordt pas ~4 s later herkend (twee seconden stabiele sprong plus de tijd
  die de volger nodig heeft om zijn plek te vinden); in die tijd is de markering bevroren.
- Lofzang 24 heeft een eerste tien seconden waarin de volger bij een voorspel dat midden begint
  vaak eerst op een gelijkende plek zit (zie `03-SCORE-FOLLOWING-POC.md`); het zangbegin wordt dan
  later vastgesteld.
- Het niveau-diagnosesignaal is niet gevalideerd op echte gemeentezang.

## 5. Herkennen en volgen: één luistersessie

`HymnLiveEngine` (`src/lib/hymns/live.ts`) is de enige ingang voor de pagina.

- Eén `ChromaExtractor` en één `MicListener` voor de hele sessie. Geen tweede
  `getUserMedia`-aanvraag, geen tweede `AudioContext` (bewezen in de browsertest: 1 en 1).
- De engine bewaart de laatste 90 s **kenmerkframes** (24 getallen per 46 ms, geen audio, alleen in het
  geheugen, begrensd). Herkenner en volger zijn verschillend afgestelde deeltjesfilters; hun toestand wordt
  daarom niet overgezet. Bij de overgang spelen de recente frames, inclusief het begin van het voorspel,
  opnieuw door de volger. Die staat daarna **precies** waar hij zou staan als hij vanaf het begin had
  meegeluisterd (bewezen: gelijke positie, tempo, betrouwbaarheid en fase). De fase-laag heeft het voorspel
  dus ook gezien.
- De frames worden in tijdsbudgetten van 8 ms verwerkt zodat de telefoon niet hapert (bewezen: dezelfde
  uitkomst met een minuscuul budget); of dat op een echte telefoon soepel genoeg is, is **ONBEKEND**.
- Automatisch volgen alleen bij status `identified` (bewijs ≥ 70 nats én ≥ 20 voorsprong op de tweede)
  die 2 s achter elkaar hetzelfde voorstel blijft. Bij `ambiguous`, `candidates` of `unknown` kiest de
  engine niet: de pagina toont de kandidaten en de gebruiker tikt. Een onbekende melodie wordt nooit
  gevolgd (bewezen met drie onbekende melodieën, in `tests/hymns-live.test.ts`).
- Een wissel van lofzang tijdens het luisteren speelt het geheugen opnieuw door de nieuwe volger.

## 6. Privacy

Ongewijzigd en strenger bewaakt (`tests/hymns-privacy.test.ts`): geen netwerk, geen opslag, geen analytics
in `src/lib/hymns` en `src/components/hymns-poc`. Het kenmerkgeheugen bevat geen audio, is begrensd
(bewezen) en verdwijnt met de pagina. De microfoon stopt bij Stop, bij het verlaten van de pagina
(browsertest: de terugknop stopt de track) en bij naar de achtergrond gaan.

## 7. Interface

> Bijgewerkt in fase 3: de indeling (werkruimte, panelen, bediening, schermtoestanden) staat in
> `08-MOBIELE-UX.md`. Wat hieronder over de markering, het scrollen en de voorkeuren staat, geldt nog; de
> sticky bedieningsbalk en de inline instellingen bestaan niet meer.

- **Focus mode.** `/dev/lofzangen` staat in `FOCUS_ROUTES` (`src/lib/focusMode.ts`): de globale
  header en onderbalk verdwijnen, de centrale terugbalk ("← Lofzangen") blijft en gaat terug naar de
  vorige pagina of de contentkiezer. Geen eigen verbergklassen. Een onderste bedieningsbalk is `sticky`
  in de paginastroom (geen eigen fixed-model).
- **Tekst centraal.** Boven de tekst staan alleen nummer en titel, de status, de microfoonindicator en
  de instellingsknop. Coupletnummers en volgorde staan direct boven de tekst.
- **Volledig couplet** (standaard): alle regels leesbaar, de actieve regel heeft subtiele nadruk (donkerder
  tekst en een linkerrand), het actieve woord krijgt de Versado-accentkleur en een zwaarder gewicht.
  De breedte van elk woord is vooraf op de vette maat gereserveerd (`.hymn-word`, `globals.css`), dus
  er verschuift niets. Past het couplet op het scherm, dan wordt er niet gescrold.
- **Karaoke per regel**: vorige regel (subtiel), huidige regel (groot, vast in het verticale midden via
  een grid met drie rijen) en volgende regel. Geen bewegende vlakken, bolletjes of horizontale tekst.
- Zonder woordkoppeling (couplet 5 en 6 van lofzang 82) krijgt de **hele regel** de accentkleur; er
  wordt nooit een woordtiming verzonnen.
- **Scrollen.** Geen `scrollIntoView`. De pagina scrolt alleen met `window.scrollBy` als de actieve regel
  buiten het gebied tussen terugbalk en bedieningsbalk valt, rustig, en nooit als het hele couplet past.
  Wiel, vinger of toetsen pauzeren het meescrollen; "Automatisch volgen hervatten" sluit weer aan (docs 17). De engine merkt
  daar niets van. Bij een nieuw couplet sluit het scrollen vanzelf weer aan.
- **Instellingen** (inline paneel): tekstweergave, tekstgrootte (normaal, groot, extra groot), automatisch
  meescrollen, rustige kerkweergave, en de lofzang.
- **Rustige kerkweergave**: geen statuskleuren (alleen tekst), geen volgordemenu, geen introtekst en
  geen technisch paneel; geen mascottes, XP, reeksen of geluiden (die zijn er sowieso niet).
- **Technische gegevens** (alleen beheerders, standaard dicht): positie, BPM, betrouwbaarheid, kandidaten
  en bewijs, voorspelstatus, zangbegin en het bewijs daarvoor, rondetelling, tussenspelen, niveau
  (diagnose), achterstand en het lokale testbestand.
- **Voorkeuren** (`src/lib/hymnPrefs.ts`): vier waarden (weergave, grootte, meescrollen, rustig) in
  `localStorage`, op dit toestel, met terugval op de standaard als opslag ontbreekt. Een eigen laag buiten
  de engine; de privacytests voor de engine blijven strikt. Een weergavewissel verandert alleen de
  interface (bewezen in `tests/hymns-ui.test.ts` en in de browsertest).

## 8. Tests en reproduceerbaarheid

| Wat | Waar |
|---|---|
| Scenario A t/m L, tussenspel, opnieuw synchroniseren | `tests/hymns-phase.test.ts` |
| Herkennen → volgen, kandidaten, onbekend, achterstand, geheugen | `tests/hymns-live.test.ts` |
| Statusteksten, karaoke, woordmarkering, scrollen, voorkeuren, ontwerp | `tests/hymns-ui.test.ts` |
| Privacy (statisch en dynamisch) | `tests/hymns-privacy.test.ts` |
| Focus mode voor `/dev/lofzangen` | `tests/focus-mode.test.ts` |
| Browser met nep-microfoon, schermmaten, thema, 200% | `scripts/hymns/e2e-browser.mjs` |
| Meetmatrix voorspel en herkenning (10 omstandigheden) | `scripts/hymns/eval-service.ts fase\|herken` |
| WAV van een "dienst" voor de nep-microfoon | `scripts/hymns/make-service-audio.ts` |

`npm run test:hymns` draait de eerste vier en de bestaande suites.
