# Vliegende Novi, Varo of Vera

Het solo-arcadespel houdt technisch de id `quick-missionary`, de bestaande
database en de routes `/snelle-zendeling` en
`/snelle-zendeling/run/[runId]`. De zichtbare identiteit is persoonlijk:
`Vliegende Novi`, `Vliegende Varo` of `Vliegende Vera`, in andere UI-talen
via een eigen natuurlijk vertaalpatroon. `User.companion` wordt uitsluitend
via het centrale companionsysteem vertaald naar naam, glide-/boostsprite en
cover. Wisselen van gids verandert geen run, score of klassement.

De startpagina blijft in Normal Mode. Een concrete run gebruikt de centrale
Immersive Mode uit `src/lib/focusMode.ts` en `ImmersiveLayout`: globale header,
bottomnavigatie en `SubpageBackBar` zijn afwezig. Op telefoon vult de game-area
`100dvh`, inclusief de bestaande safe-area-variabelen voor web, PWA en
Capacitor. Tablet en desktop houden een begrensd portraitveld. De native
statusbar wordt niet apart verborgen: de benodigde Capacitor StatusBar-plugin
is niet aanwezig en routegebonden herstel kan daarom nog niet betrouwbaar
worden gegarandeerd.

## Assets en mascotte

De bronbibliotheek staat in `snelle-zendeling-assets/`. De runtimekopieën staan
onder `public/games/snelle-zendeling/`. `manifest.json` is de bron voor de
1254×1254 canvasmaat, de gelijke pivots, Novi’s kleinere paar-schaal en de
parallaxsuggesties. De productie-assets zijn geen nieuwe algemene
`MascotState`. De centrale companionkeuze bepaalt de gameplaysprite. Glide en
boost hebben hetzelfde canvas en dezelfde rendermaat.

Spelcovers lopen generiek via de mascottevariant in `src/lib/artwork.ts`:

- Novi: `public/images/games/snelle-zendeling.png`;
- Varo: `public/images/games/vliegende-varo.png`;
- Vera: `public/images/games/vliegende-vera.png`.

`GAME_MASCOT_COVERS` koppelt deze drie covers centraal aan de companion. De
kaartcomponenten kennen geen bestandspaden of spelvarianten: de covers delen
dezelfde `quick-missionary`-identiteit en dus dezelfde scores en klassementen.

## Vaste spelregels

De logische wereld is 360×640 en wordt responsive in een begrensd portrait
canvas getoond. Physics is frame-rate-onafhankelijk:

| Constante | Waarde |
|---|---:|
| `GRAVITY` | 820 |
| `BOOST_VELOCITY` | -285 |
| `HORIZONTAL_SPEED` (basis, 100%) | 150 |
| `MAX_FALL_SPEED` | 430 |
| `OBSTACLE_WIDTH` | 58 |
| `GAP_HEIGHT` (basis, 100%) | 182 |
| `PAIR_SPACING` | 220 |

Deze waarden staan centraal in `src/lib/snelleZendeling/gameplay.ts`. Ieder
paar gebruikt exact dezelfde breedte en horizontale afstand; de opening en de
wereldsnelheid volgen de difficulty-curve hieronder. Alleen `gapY` wordt
willekeurig gekozen, binnen veilige grenzen (met de werkelijke opening van het
paar, `gapYBounds`); opeenvolgende gaps mogen maximaal 105 logische pixels
verschillen. De runtime gebruikt
`obstacle-wall-long.png` en `obstacle-rock-long.png` (beide 384×16384
bronpixels). Ze worden uitsluitend uniform geschaald met
`OBSTACLE_WIDTH / 384`: de hoogte volgt dus altijd uit die breedteschaal en
wordt nooit naar de opening uitgerekt. De bovenkant van de muur wordt exact op
`gapBottom` geplaatst en loopt onder het canvas door; de onderkant van de rots
wordt exact op `gapTop` geplaatst en loopt boven het canvas door. Het canvas
clipt alleen het overtollige lichaam. Daardoor is er bij iedere geldige gapY
geen lucht tussen een obstacle en de bijbehorende viewport-rand.

### Difficulty curve

Een run begint op 100% opening en 100% snelheid en wordt daarna geleidelijk
moeilijker op basis van de **actuele score van die run** (niet record, XP,
mascotte of vaardigheid). De opening is de primaire moeilijkheid; de snelheid
stijgt hooguit 5%, zodat de besturing hetzelfde blijft voelen. Zwaartekracht,
boost, hitbox, obstakelbreedte en paarafstand veranderen niet.

| Score | Opening | Snelheid | Opening (px) | Snelheid (u/s) |
|---:|---:|---:|---:|---:|
| 0 | 100% | 100% | 182,0 | 150,0 |
| 50 | 96% | 100,5% | 174,7 | 150,8 |
| 100 | 92% | 101% | 167,4 | 151,5 |
| 200 | 88% | 101,5% | 160,2 | 152,3 |
| 300 | 84% | 102% | 152,9 | 153,0 |
| 400 | 81% | 102,5% | 147,4 | 153,8 |
| 500 | 78% | 103% | 142,0 | 154,5 |
| 600 | 76% | 103,5% | 138,3 | 155,3 |
| 700 | 74% | 104% | 134,7 | 156,0 |
| 800 | 72% | 104,5% | 131,0 | 156,8 |
| 1000 | 70% | 105% | 127,4 | 157,5 |

- De waarden staan één keer in `DIFFICULTY_POINTS` (`difficulty.ts`) en
  `getDifficulty(score)` interpoleert stuksgewijs lineair ertussen: geen
  stappen, geen toeval, geen tijd. Client en server gebruiken dezelfde functie.
- Vanaf score 1000 blijft alles constant: de opening is nooit kleiner dan 70%
  en de snelheid nooit hoger dan 105%. Een hogere score maakt het spel dus niet
  fysiek moeilijker; de uitdaging is het volhouden.
- De opening wordt per nieuw paar bepaald uit de score op dat moment en blijft
  daarna vast (`pair.gapHeight`); een zichtbaar paar verandert nooit. De
  snelheid is één wereldsnelheid voor alle obstakels (`worldSpeed(score)`),
  dus `PAIR_SPACING` blijft gelijk. De grote lange obstakels blijven aan
  `gapTop`/`gapBottom` hangen: de opening wordt alleen kleiner doordat die twee
  dichter bij elkaar liggen, er wordt niets uitgerekt.
- `gapY` blijft willekeurig met dezelfde marges (24 px boven en onder) en
  dezelfde maximale stap; alleen de ondergrens volgt de werkelijke opening.
  De hoogste bovenrand en laagste onderrand van de opening liggen dus nooit
  verder dan bij de basisopening.
- Eén punt per volledig gepasseerd paar, zonder bonus voor een kleinere opening.
- Er is geen adaptieve of persoonlijke moeilijkheid: alle gidsen en spelers
  gebruiken dezelfde curve, zodat Vandaag en All-time vergelijkbaar blijven.
- Genees behoudt de score en daarmee de moeilijkheid; na het herstel komen drie
  nieuwe paren op de opening die bij de actuele score hoort.
- Er is bewust geen level-indicator of melding; de score is de enige indicator.
- De server houdt rekening met de snellere wereld: `maxPlausibleScore` telt de
  minimale tijd per punt op met dezelfde curve (`minSecondsToReachScore`). Een
  vaste ondergrens van 220/150 seconden per punt zou een run die het
  maximale tempo vliegt vanaf ongeveer 200 punten onterecht afwijzen.
- Alleen in ontwikkeling laat `?debugDifficulty=700` opening en snelheid spelen
  alsof de score zo hoog is, zonder de echte score te veranderen (de server
  weigert dan na enkele punten een te snelle score; dit is alleen om te
  bekijken). In productie bestaat deze code niet.
- Bij 70% blijft er 103,4 px verticale speling over rond de hitbox van 24 px;
  een tik tilt de gids ongeveer 49 px.

Wijzig de punten alleen na bewuste playtesting, en pas dan ook de tests in
`tests/snelle-zendeling-difficulty.test.ts` aan.

`obstacle-wall-stem.png` (384×960) en `obstacle-rock-stem.png` (384×912)
blijven als tileable productiereserve bewaard. De vaste wereld van 360×640
valt ruim binnen de lange assets, zodat een losse cap/stem-compositor — die
volgens de assetdocumentatie zorgvuldig op de capfase moet aansluiten — nu
niet nodig is. De lange offscreen-bitmapdelen veranderen de abstracte
collisionrechthoeken niet.

### Hitbox

De mascotte wordt op 74×74 wereldpixels getekend (`MASCOT_RENDER_SIZE`). De
botsing gebruikt één vaste ellips van 32×24 met de linkerbovenhoek van haar
omsluitende rechthoek op (26, 26) binnen die sprite (`MASCOT_HITBOX_*` in
`gameplay.ts`). Ellips tegen asgelijnde rechthoek is exact te toetsen door x
en y door de stralen te delen; alleen raken telt niet. `mascotHitbox()` geeft
de omsluitende rechthoek, onder meer voor de speelzone.

Waarom deze maat: de vorige box (42×42 op 5,5) hing 24–28 px los van het dier,
10–14 px boven de oren en 11–14 px achter de neus, dus de gids stierf in de
lucht en de kop mocht ruim in een obstakel. De nieuwe maat is gemeten aan de
zes echte sprites (drie gidsen, glide en boost): de rand ligt overal hooguit
4–6 px van zichtbaar lichaam; oorpunten en haartoefjes (7–10 px boven de
ellips), staart en de transparante rand tellen niet mee; onder en voor wijkt
de ellips 0–4,5 px af van het silhouet. De tests lezen de PNG's zelf, zodat een
vervangen sprite of een verschoven box direct opvalt.

Novi, Varo en Vera, en glide en boost, hebben exact dezelfde hitbox: de
functies kennen geen gids of pose, de pose kiest alleen de afbeelding. Obstakels,
gap, afstanden en physics zijn bij deze aanpassing niet veranderd.

Ontwikkelen: `?debugHitbox=1` tekent de werkelijke geometrie over het spel
(rood = hitbox, wit = spritegrenzen, geel = botsrechthoeken van de obstakels,
groen = de opening). De code staat achter `process.env.NODE_ENV` en wordt in
een productiebuild niet meegebouwd.

De lage voorgrond wordt vóór de obstakels getekend en blijft maximaal 8% van
de wereldhoogte zichtbaar.

## Run, Genees en vragen

De server maakt eerst een `QuickMissionaryRun` aan. De client meldt alleen de
score bij een botsing of einde; de server controleert run-eigenaarschap,
status, monotone score, maximale score en het hoogst mogelijke tempo op basis
van de servertijd. Intern blijven de stabiele `revive*`-namen bestaan. Na een
goede vraag gaat de status naar `REVIVE_READY`; de wereld blijft gepauzeerd
totdat de gebruiker tikt, waarna drie seconden veilige collisionbescherming
actief zijn. Een fout antwoord of weigeren beëindigt de run.

### Genees als voorraad en de prijs

Elke run heeft één **gratis** Genees (`reviveUsed`); die raakt de voorraad niet.
Daarna kost elke poging één Genees uit de **accountgebonden voorraad**
(`User.geneesBalance`, nooit negatief: CHECK-constraint). De poging is verbruikt
zodra de vraag wordt uitgegeven, ook bij een fout antwoord, en nooit dubbel bij
verversen of een tweede toestel. Elke Genees blijft een vraag uit de bank: de
vraagvolgorde en de gezien-geschiedenis veranderen niet.

De prijs komt uit één functie, `geneesPriceXp(voorraad)` in
`src/lib/genees/pricing.ts`: **100 + huidige voorraad × 25** (0 → 100, 1 → 125,
2 → 150). Winkel, in-game noodkoop en alle weergaven gebruiken alleen die functie.
Een aankoop (`src/lib/genees/inventory.ts`) neemt eerst een rijvergrendeling op
de gebruiker, rekent de prijs op de actuele voorraad, boekt de XP via de gewone
ledger (`XPReason.GENEES_PURCHASED`) en de divisiestand (`applyWeeklyXp`, zoals
hints en freezes: een aankoop kan de weekstand verlagen, er is geen verborgen
bescherming), en verhoogt de voorraad, atomair. `GeneesPurchase` is de
audittrail en maakt een herhaald verzoek met dezelfde sleutel idempotent.

De **in-game noodkoop** (alleen als de gratis Genees is gebruikt en de voorraad
leeg is) mag maximaal één keer per run en per speler, server-side afgedwongen
onder een rijvergrendeling op de run (`inGamePurchaseUsed`). In de winkel kun je
onbeperkt kopen. Solo en samen gebruiken dezelfde economie.

### Genees-vragen

Elke Genees-poging krijgt een nieuwe vraag, ook na een fout antwoord. De vragen
staan in een eigen, gecureerde bank (`QuickMissionaryReviveQuestion` met
`QuickMissionaryReviveOption`), los van de oefeningen van de cursussen: een
vraag hoort bij één hoofdstuk, heeft precies drie antwoorden (één goed, geen
lengtehint) en wordt nooit tijdens het spelen bedacht. Een bestaande
`Exercise` wordt dus niet meer gebruikt; de enige oude vraag (1 Nephi 1) is in
de migratie overgenomen als `legacy:`-vraag.

**Volgorde.** Hoofdstukken worden doorlopen in de echte volgorde van de
actieve uitgave: `(Book.order, Chapter.order)`, zonder vaste lijst. De plek
van de speler staat per gebruiker en per contentcollectie in
`QuickMissionaryReviveProgress` (`cursorBookOrder`/`cursorChapterOrder`,
`cycle`) en is dus server-side en gelijk op elk toestel en in elke run.

**Wat gebeurt er na een antwoord** (`reviveSelection.ts`):

- Goed: de plek gaat naar het volgende hoofdstuk, daar wordt de volgende
  Genees gesteld.
- Fout: de run eindigt zoals altijd en de plek blijft staan. De volgende Genees
  blijft bij hetzelfde hoofdstuk met een andere, nog niet geziene variant;
  heeft dat hoofdstuk er geen meer, dan gaat het naar het volgende hoofdstuk.
- Maximaal één Genees per run blijft ongewijzigd.

**Geen herhaling.** Een vraag wordt vastgelegd in `QuickMissionaryReviveSeen`
op het moment dat hij wordt uitgegeven (status `SHOWN`, daarna `CORRECT` of
`WRONG`), per cyclus en onder een per-gebruiker-lock met een unieke sleutel op
`(userId, questionId, cycle)`. Verlaten, verversen of een ander toestel levert
daardoor dezelfde vraag niet opnieuw op als een nog niet geziene beschikbaar is.

**Na het laatste hoofdstuk** zoekt de selectie opnieuw vanaf het begin, eerst
naar ongeziene varianten. Zijn alle vragen van de uitgave gezien, dan volgt een
gecontroleerde reset: `cycle` loopt op, het geheugen is weer leeg en het eerste
hoofdstuk komt weer aan de beurt (zonder de laatst geziene vraag als er een
alternatief is). Heeft een uitgave helemaal geen vragen, dan is
`reviveAvailable` onwaar en eindigt de run direct, zonder een andere regel te
verzinnen.

**Feedback.** De client ontvangt nooit een correctheidsvlag en bij een fout
antwoord ook niet het goede antwoord. Het scherm toont "Niet helemaal." met
"Lees {hoofdstuk} om het antwoord te ontdekken." en, als de leesroute bekend
is, een knop daarheen (`chapterReadHref`). Boven de vraag staat altijd het
hoofdstuk (`data-revive-chapter`). Dit pad schrijft geen oefenpoging en geeft
geen XP, reeks of competitie-XP.

**Vragenbank.** De Nederlandse bank voor het Boek van Mormon staat in
`prisma/genees/bofm-nl/` (één bestand per groep boeken, formaat en regels in
`src/lib/snelleZendeling/reviveBank.ts`): drie varianten voor ieder van de 239
hoofdstukken. Elke vraag noemt de verzen waar het antwoord staat en
controlewoorden (`check`) die letterlijk in die verzen en in het goede antwoord
moeten voorkomen. `npm run genees:check` valideert dit (drie antwoorden,
lengtehint, te veel op elkaar lijkende vragen, ontbrekende bronwoorden) en
rapporteert per boek de dekking en de hoofdstukken onder het doel van
`TARGET_VARIANTS` (3). De seed (`importGeneesBank`) laadt de bank idempotent op
`contentKey`; een admin-reseed van de content is dus nodig na de uitrol, de
migratie zelf draait bij het starten van de container. De Engelse
uitgave (`prisma/genees/bofm-en/`) heeft dezelfde 717 vragen als het
Nederlands: zelfde vraag-id, hoofdstuk en verzen, met Engelse tekst en
controlewoorden die in de Engelse brontekst staan. Hetzelfde geldt voor de
Duitse (`prisma/genees/bofm-de/`), de Franse (`prisma/genees/bofm-fr/`) en de
Spaanse uitgave (`prisma/genees/bofm-es/`), met tekst en controlewoorden uit
de eigen brontekst. Alle vijf de banken zijn volledig vertaald en komen
groen door `npm run genees:check`. Waar de brontekst van een uitgave een
andere term gebruikt dan het Nederlands (bijvoorbeeld edelstenen in 3 Nephi
22:12), volgt het antwoord de eigen uitgave; vraag-id, hoofdstuk en verzen
blijven gelijk. Een nieuwe taal of werk krijgt
een eigen bankbestand in `prisma/genees/index.ts`.

## Immersive UX en exit

De logische wereld en physics blijven gelijk; alleen de presentatie vult op
telefoon de viewport. Score, startinstructie, frozen death-state, Genees-vraag,
feedback en game-over liggen binnen dezelfde stage. De Genees-overlay gebruikt
een rustige scrim. Bij lange inhoud scrolt alleen de overlay; antwoorden houden
hun volledige tekst en natuurlijke hoogte.

Na definitief game-over zijn Opnieuw, Ranglijst en Terug naar Spelen zichtbaar.
De startpagina wordt bij het openen van een run vervangen door de runroute; een
beëindigde run wordt bij Ranglijst op dezelfde manier vervangen door
`/snelle-zendeling?view=leaderboard#quick-missionary-leaderboard`. Daardoor blijft
de afgesloten immersive run niet als back-bestemming bestaan en is de stack
normaal `Spelen → run → ranking`. De leaderboardweergave heeft `/live` als
expliciete semantische parent: de centrale `SubpageBackBar` gebruikt daar een
replace naar Spelen, ook als toevallige history beschikbaar is. Browserback en
native systeem-back gaan na game-over → ranking door de opgeschoonde stack naar
Spelen. De run-cleanup blijft een idempotente keepalive-finish sturen bij andere
verlatingen; de server blijft beslissen of score en status geldig zijn, zodat
geen herbruikbare halfopen run ontstaat.

## Ranking en tijd

Er zijn twee tabbladen: Vandaag en All-time. Een voltooide run telt voor de
dag die server-side bij het starten is berekend met `User.timeZone` en
`dayKeyInZone`. Een run die over middernacht loopt blijft daardoor bij zijn
startdag; hij kan niet door een toestelklok naar een andere dag worden
verplaatst. Dit is een persoonlijke lokale-dag-ranking: twee gebruikers
kunnen op hetzelfde UTC-moment een verschillende “Vandaag” hebben.

Per gebruiker telt alleen de hoogste geldige score. Bij gelijke scores wint de
run die die score het eerst server-side bereikte; daarna is `userId` een vaste
laatste tie-breaker. De eigen positie wordt ook buiten de eerste 50 resultaten
getoond. Genezen runs blijven gewone geldige runs en vormen geen apart
klassement. Arcade-score geeft geen XP, reeks of competitie-XP.

Novi, Varo en Vera delen exact deze ene Vandaag- en All-time-ranking. Naam,
sprite en cover zijn presentatielaag en worden niet als rankingcategorie
opgeslagen.

## Samen spelen (gezamenlijke run)

De host maakt vanaf de startpagina een lobby (`POST /api/snelle-zendeling/together`,
een `LiveGame` met mode `QUICK_MISSIONARY`) en nodigt vrienden uit via het
bestaande vriendenpaneel, de bestaande uitnodigingsmeldingen en de bestaande
Socket.io-infrastructuur (`src/server/quickMissionary.ts`, events `qm:*`).
Uitnodigingslinks wijzen naar `/live/<code>`, dat voor deze mode doorverwijst
naar de schermvullende route `/snelle-zendeling/samen/<code>`. Er is **geen
bovengrens** op het aantal spelers; vanaf twee spelers kan de host starten.

**Eén wereld voor iedereen.** Bij de start legt de server een `seed` en een
`startsAt` (servertijd, na het aftellen) vast in `QuickMissionaryMatch`.
Obstakels volgen deterministisch uit de seed (`createSharedWorld`, geen
`Math.random`), de wereld loopt op een gezamenlijke tijdlijn (`distanceAt(t)`)
en de moeilijkheid hangt af van de voortgang van die tijdlijn (het aantal
gepasseerde paren), niet van de eigen score: wie Geneest vliegt verder in
dezelfde wereld. Dezelfde curve als solo (`difficulty.ts`). De client corrigeert
zijn klok naar servertijd (`clock.ts`, kortste rondreis wint). Latency, een
herverbinding of een ander toestel veranderen de wereld dus nooit.

**Ghosts.** De anderen zijn doorzichtige mascotten (hun eigen gids, cosmetisch);
je botst alleen tegen de wereld, nooit tegen elkaar, en ghosts geven geen score.
Posities gaan vluchtig via `qm:pos`/`qm:ghosts` en bepalen nooit iets in de
uitslag. Bij heel veel spelers dunt de server de ghostupdates uit; er wordt
niemand geweigerd.

**Deelnemerstoestanden** (`matchRules.ts`, afgeleid van `QuickMissionaryRun`):
`ACTIVE` (vliegt), `REVIVE_PENDING` (gebotst, wacht op of beantwoordt een Genees;
telt nog mee), `ELIMINATED` (definitief af, met volgnummer `eliminatedSeq`) en
`FINISHED` (de overlevende). Elke wijziging loopt via `runs.ts` in één
transactie met vaste vergrendelingsvolgorde **wedstrijd → run → gebruiker**,
zodat elke eliminatie een eigen volgnummer krijgt en de beslissing "is de run
voorbij" altijd een consistente stand ziet.

**Einde van de run** (`decideMatch`, `settleMatch` in `match.ts`): zodra er nog
één deelnemer meedoet stopt de run voor iedereen; scores blijven zoals ze waren
(geen bonuspunten).
- Eén speler vliegt (of heeft een goed Genees-antwoord al verdiend): hij blijft
  over, `LAST_STANDING`.
- Blijft alleen iemand over die nog op een Genees wacht, dan vliegt er niemand
  meer: `NOBODY_FLYING`, zijn Genees vervalt. Daarna is elke Genees-actie
  `INVALID_STATE`: een correct antwoord brengt nooit iemand terug na afsluiting
  (de run is dan `FINISHED`, dat is structureel, geen aparte controle).
- Alle spelers tegelijk dood is hetzelfde geval: zodra niemand meer vliegt of kan
  terugkeren is de run definitief voorbij.

**De laatste twee (Duo).** Bij afsluiten legt de server precies één
`QuickMissionaryDuoResult` vast (`matchId` is uniek; `settleMatch` is idempotent):
de laatste twee in overlevingsvolgorde, ook bij precies twee spelers, met ruwe
scores en `participantCount`. De **scoreformule en ranking van het duo zijn nog
niet vastgelegd**; zie "Open productbeslissing: Duo-score" hieronder.

**Verbinding.** Elke client stuurt een hartslag (`qm:pos`/`qm:beat`, bewaard
hooguit eens per seconde in `QuickMissionaryRun.lastSeenAt`). Wie langer dan
`ACTIVE_GRACE_MS` (vliegend) of `PENDING_GRACE_MS` (Genees) stil is, valt af
(`DISCONNECT`); een herverbinding daarbinnen verandert niets, want gratis-Genees,
noodkoopvlag, voorraad en score staan in de database. Een frame dat langer dan
een seconde wegblijft (verborgen tabblad) telt als botsing, zodat niemand door
wanden "teleporteert". Na een herstart van de server krijgt iedereen een verse
wachttijd.

**Ranking.** Gezamenlijke runs tellen **niet** mee in Vandaag en All-time van de
solo-ranking (`matchId IS NULL`): de wereld is anders (moeilijkheid volgt de
gedeelde tijdlijn) en de run stopt door anderen, dus scores zijn niet
vergelijkbaar. Een toekomstig gezamenlijk klassement is een aparte keuze.

**Beperking.** Net als solo draait de physics op de client; de server valideert
score en tempo tegen de gezamenlijke tijdlijn (`validateSharedScore`), maar kan
niet zien of iemand een botsing heeft overgeslagen. De hartslag en de tijdlijn
begrenzen dat, ze lossen het niet op.

### Duo-ranking

**Duo-score = de hoogste individuele score van de laatste twee spelers op het
moment dat de gezamenlijke run definitief eindigt**: `max(scoreA, scoreB)`
(`duoScore` in `src/lib/snelleZendeling/duoRanking.ts`). Geen som, gemiddelde of
bonus (deelnemers, plaatsing, Genezen, XP, duur, moeilijkheid). Omdat de run stopt
zodra er nog één deelnemer overblijft, kan na het uiteenvallen van het duo geen
van beiden de score nog verhogen. Een duo wordt getoond als één entry ("A + B"),
niet als "A won".

- **Wie zijn de laatste twee:** `deriveDuo` uit de server-side eliminatievolgorde
  (overlevende + laatst afgevallene; bij twee spelers beiden). Een Genees houdt
  iemand deelnemer; pas definitief afvallen telt.
- **Identiteit:** `duoKey` sorteert de twee gebruikers-id's, dus A+B == B+A en
  A+B != A+C. `deriveDuo` slaat de twee ids gesorteerd op in
  `QuickMissionaryDuoResult` (A < B) en `rankDuos` sorteert zelf nogmaals.
- **Beste per duo, tie-break:** per duo telt het beste resultaat; een slechtere
  run verlaagt niets en alle ruwe resultaten blijven bewaard. Volgorde: hoogste
  Duo-score, dan wie die score het eerst behaalde (zoals de solo-ranking), dan de
  duo-sleutel. Een later gelijk resultaat verdringt het eerdere niet.
- **Alleen All-time:** een duo bestaat uit twee mensen met mogelijk verschillende
  tijdzones, dus er bestaat geen gezamenlijke "vandaag". Er is daarom bewust geen
  Duo-Vandaag en geen vervangende daggrens; tijdzones hebben geen invloed op de
  Duo-ranking. Resultaten van alle dagen tellen mee voor het beste resultaat ooit.
- **Query:** `getQuickMissionaryDuoLeaderboard` (`duoLeaderboard.ts`) leidt de
  score bij het opvragen af uit de ruwe resultaten; er is geen opgeslagen score.
  Ondersteunde combinaties van `GET /api/snelle-zendeling/leaderboard`
  (`parseLeaderboardQuery`): solo + `today`, solo + `all-time`, duo + `all-time`
  (`type=duo`); duo + `today` is een 400. De migratie
  `20261019100000_drop_duo_result_daykey` verwijdert de daggrenskolom van
  `QuickMissionaryDuoResult`; de ruwe resultaten blijven bewaard.
- **UI:** de bestaande ranking heeft een Solo/Duo-keuze. Solo toont Vandaag en
  All-time; bij Duo verdwijnt de bordkeuze (er is er maar één) en de Solo-keuze
  blijft onthouden voor als je terugkeert. Een duo-entry toont beide
  avatars, beide namen en één Duo-score. Een gebruiker kan met verschillende
  partners meermaals voorkomen.
- Gezamenlijke runs staan nooit in de solo-ranking.

## Database en beheer

`GameSettings.quickMissionaryEnabled` is standaard uit. De migratie maakt ook
scopes voor bestaande schriftuitgaven aan; een beheerder kan de globale toggle
en content-scopes beheren via de bestaande admincomponent. Het runmodel heeft
indexen op gebruiker/status, gebruiker/score en day/status/score. De gerichte
datamigratie `20261014100000_balance_quick_missionary_answers` maakt alleen de
drie afleiders van de bestaande Nederlandse vraag bij 1 Nephi 1 inhoudelijk
vergelijkbaarder; schema en correct antwoord veranderen niet. De migratie
`20261016100000_quick_missionary_revive_bank` voegt de Genees-tabellen toe en
neemt die ene vraag over; bestaande spelers beginnen bij het eerste hoofdstuk.
`20261017100000_genees_inventory` voegt de Genees-voorraad toe (standaard 0, geen
terugwerkende kracht) en `20261018100000_quick_missionary_matches` de
gezamenlijke runs en het duo-resultaat (bestaande runs hebben geen `matchId`).

## Platform en toegankelijkheid

Het spel gebruikt één canvas met een vaste logische wereld, waardoor fysieke
schermbreedte en refresh rate de gameplay niet wijzigen. Touch, pointer,
muisklik en Space/ArrowUp werken. `touch-action` wordt alleen op het
gamecanvas toegepast; safe areas en PWA/Capacitor lopen via de centrale
immersive shell. De renderer maakt geen React state-update per frame. Bij reduced motion
worden decoratieve bewegingen beperkt door de bestaande Versado-motionregels;
de noodzakelijke physics blijven actief.

## Tests

`tests/snelle-zendeling-difficulty.test.ts` dekt de exacte targets, de interpolatie, de opening per paar, de gapY-grenzen, de servervalidatie en de invarianten.

`tests/snelle-zendeling.test.ts` dekt vaste maten, bronafmetingen en uniforme
obstacleschaal, gap-ankers en dekking van beide wereldranden, gapgrenzen,
score-eenmalig, collision, gelijke hitboxen, Genees-opties/-status, vraagcontext,
antwoordbalans, dynamische identiteit, immersive overlays, ranking-ties en
server-side scoretempo. `tests/snelle-zendeling-genees.test.ts` dekt de
selectieregels, het hoofdstuk boven de vraag, het foutscherm zonder goed
antwoord en de bankvalidatie; `tests/snelle-zendeling-genees.integration.test.ts`
(15 databasetests, via `LEARNING_TEST_DATABASE_URL`) dekt de voortgang per
gebruiker, geen herhaling, de cyclusreset en de lege bank. De hitbox heeft
`tests/snelle-zendeling-hitbox.test.ts`. Alles samen: `npm run
test:snelle-zendeling`. Shellmodi staan in `tests/focus-mode.test.ts` en de
coverresolver in `tests/artwork.test.ts`.

De Genees-economie staat in `tests/genees-economy.test.ts` en
`tests/genees-economy.integration.test.ts` (`npm run test:genees-economy`).
Samen spelen: `tests/snelle-zendeling-match.test.ts` (gedeelde wereld, tijdlijn,
klok, toestanden, beslissingen en duo-regels) en
`tests/snelle-zendeling-match.integration.test.ts` (levenscyclus, 2/3/12
spelers, samenloop, geen resurrectie, hartslag en wegvallen, economie in een
wedstrijd, uitsluiting van de solo-ranking, Duo-ranking), beide in `npm run
test:snelle-zendeling`. De integratietests vragen `LEARNING_TEST_DATABASE_URL`.
