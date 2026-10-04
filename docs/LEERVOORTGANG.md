# Leervoortgang, oefeningen, XP en reeks

Hoe Versado lezen, oefenen, XP en de dagelijkse reeks bijhoudt, en aan welke
regels elke cursus (nu en later) zich moet houden. Geldt voor elke
contentbron met hoofdstukken (Boek van Mormon, Leer en Verbonden, Parel van
Grote Waarde, in elke taal) en elke leesroute.

## De invariant

> Leesvoortgang hoort bij de inhoud, niet bij de cursus.
> Lezen levert geen XP op en verlengt geen reeks.
> XP en reeks worden verdiend door betekenisvolle afgeronde leeractiviteiten.
> Voor dezelfde onderliggende inhoud zijn oefenbelasting en maximale
> basis-XP route-onafhankelijk gelijkwaardig.
> Routes bepalen hoe de inhoud wordt aangeboden, niet hoeveel de inhoud
> waard is.

Vier aparte dingen, die niet meer hetzelfde mogen betekenen:

| | Wat | Waar |
|---|---|---|
| Leesvoortgang | niet gelezen / bezig / gelezen | `ContentProgress.readStatus`, `readVerse` |
| Oefenvoortgang | hoeveel vragen van de oefenset gemaakt zijn ("8/12") | `ContentProgress.exerciseAnswered`, `exercisesCompletedAt` |
| XP | basis-XP per inhoud, begrensd | `ContentProgress.rewardCorrect`, `rewardBonusAt` + `XPTransaction` |
| Reeks | een dag met een afgeronde leeractiviteit | `recordLearningActivity` in `src/lib/streak.ts` |

## Bouwstenen (`src/lib/learning/`)

- **`contentIdentity.ts`**: welke inhoud "hetzelfde" is.
  - Een hoofdstuk is `Book.key + "#" + nummer` (bv. `bofm/alma#32`): gelijk in elke route en elke taal.
  - Zonder `Book.key` (eigen import) is het `chapter:<id>`.
  - De migratie berekent dezelfde sleutel in SQL.
- **`exercisePlan.ts`**: het oefenplan van een hoofdstuk.
  - Het hoofdstuk is verdeeld in delen van ≤10 verzen (dezelfde indeling als de stappen van Stap voor stap).
  - Elk deel heeft ≤3 vragen uit de vragen bij zijn eigen verzen; een vraag zonder bronvers hoort bij het laatste deel.
  - Het totaal N is de oefenset, in elke route even groot. Welke vragen precies, is willekeurig.
- **`rewards.ts`**: basis-XP per inhoud.
  - Het maximum is `N × 10 + 20`: XP per nieuw goed beantwoorde vraag, en de bonus één keer, zodra alle N goed zijn.
  - Daarna levert herhalen alleen de herhalingskorting (10%).
  - `withLegacy` rekent voortgang van vóór dit systeem om.
- **`streakRules.ts`**: de enige regel voor de reeks.
  - Lezen (`READING`) telt nooit.
  - Een activiteit telt alleen als hij afgerond is, met minstens één beantwoorde vraag of zet.
- **`readingTime.ts`**: leestijd uit het aantal woorden (130 per minuut). Vanaf 15 minuten raden we Stap voor stap aan.
- **`progressState.ts`**: de zichtbare status (gelezen, oefeningen x/N, afgerond = gelezen én geoefend), puur en voor elke weergave gelijk.
- **`routes.ts`**: hoe elke leesroute de inhoud aanbiedt (volgorde, wanneer de oefeningen komen, tip bij lange hoofdstukken). Alleen presentatie.
- **`contentProgress.ts`**: de enige plek die de voortgang schrijft.
  - Lezen: `markReadingStarted`, `markChapterRead`, `markStepRead`.
  - Oefenen: `issueExerciseSession` en `submitExerciseSession`.
  - Overzicht: `getChapterStates`.
  - Herbeginnen: `resetReadingProgress`.
- **`courseProgress.ts`**: telling per cursus voor de cursuslijst en Vandaag.

## Oefenen: altijd via een uitgedeelde set

1. **Uitdelen.** De pagina vraagt de server om een set (`issueExerciseSession`): de volledige set van het hoofdstuk, of de vragen van één stap. De set wordt opgeslagen (`ExerciseSession`).
2. **Inleveren.** `submitExerciseSession` doet alles in één transactie:
   - de set wordt atomair geclaimd, dus dubbelklikken of opnieuw insturen telt één keer;
   - alleen de uitgedeelde vragen tellen, en ze moeten allemaal beantwoord zijn;
   - per gebruiker en inhoud wordt vergrendeld (advisory lock), zodat twee gelijktijdige sets samen nooit boven het maximum komen;
   - per vraag wordt bijgehouden of hij al gemaakt en goed was (`ContentExerciseCredit`), zodat dezelfde vraag nooit twee keer XP geeft;
   - XP, reeks (`recordLearningActivity`), een freeze per 10 hoofdstukken met een gemaakte oefenset, en prestaties.
3. **Routegebonden afhandeling.** Wat bij één route hoort, gaat via `SessionHooks`. Stap voor stap vinkt de stap af en zet de cursor; dat staat in `src/lib/readingLessons.ts`.

## Leesroutes

| Route | Lezen | Oefenen |
|---|---|---|
| Vrije keuze | eigen keuze, "Markeer als gelezen" | daarna aangeboden: "Oefeningen maken · N vragen" |
| Hoofdstuk voor hoofdstuk | volledig hoofdstuk | daarna de volledige set; volgende hoofdstuk pas als dit gelezen én geoefend is |
| Stap voor stap | per leesgedeelte (gelezen zodra de stap is ingeleverd) | per stap de vragen van dat deel |

- **Wat al gelezen of geoefend is, telt in elke route.**
  - Een hoofdstuk dat ergens gelezen én geoefend is, telt in Stap voor stap als gedaan.
  - Een hoofdstuk waar je in een andere route mee begonnen bent, is in Stap voor stap open, zodat je een lang hoofdstuk alsnog in stappen kunt doen.
- **Een stap zonder vragen** is alleen lezen: afgevinkt, maar zonder XP en zonder reeks.
- **Live-quiz, Samen studeren, snelle ronde en raad het hoofdstuk** zijn spellen of losse oefenvormen met hun eigen (lichte) XP. Ze tellen voor de reeks, maar raken de leesvoortgang en de basisbeloning van een hoofdstuk niet.

## Een nieuwe cursus of contentbron toevoegen

Een nieuw boek met hoofdstukken valt vanzelf onder dit systeem. Zorg alleen voor:

1. `Book.key` als dezelfde tekst in meerdere talen bestaat; zonder sleutel is elk hoofdstuk eigen inhoud.
2. Goedgekeurde `Exercise`-rijen met `sourceVerseId`, zodat elke vraag in het juiste deel valt.
3. Een nieuwe leesroute? Voeg die toe aan `ROUTE_PRESENTATION` in `routes.ts`.
   - Deel uit met `issueExerciseSession` en lever in met `submitExerciseSession` (eventueel met hooks).
   - Lezen schrijf je met `markChapterRead`, `markStepRead` of `markReadingStarted`.

Niet doen:

- zelf `awardXp` of de reeks aanroepen voor lezen of oefenen bij inhoud;
- een eigen aantal vragen per route kiezen;
- voortgang aan een cursus-id hangen als de inhoud gedeeld is;
- `ChapterProgress` gebruiken (alleen nog bron van de migratie).

Een andere leeractiviteit (spel, losse oefenvorm) meldt zich via `recordLearningActivity` met een eerlijk aantal beantwoorde en vereiste vragen of zetten en een stabiele sleutel van de sessie/ronde. De sleutel blijft gelijk bij retries.

## Reeks voortzetten na een onderbreking

Een persoonlijke reeks telt verdiende actieve dagen, niet de gemiste of bevroren
dagen daartussen. Afwezigheid vernietigt het opgebouwde aantal nooit. Deze
regel verandert de afzonderlijke regels voor vriendenreeksen/groepen niet.

- `streakRules.ts` blijft de enige definitie van een geldige activiteit, ook
  voor terugkeer. Er is geen tweede lijst van activiteiten.
- `streakContinuation.ts` verwerkt afgesloten dagen met een rijvergrendeling
  op de gebruiker. Beschikbare freezes worden eerst verbruikt, ook als ze
  slechts een deel van de gemiste dagen dekken. Ze verhogen de reeks niet.
- Daarna markeert `streakInterruptedDay` de eerste onbevroren gemiste dag.
  `currentStreak` blijft staan, zonder vervaldatum zolang het account bestaat.
- `learning/streakReturnRules.ts` bevat de configureerbare drempels (3–12
  activiteiten, afhankelijk van volledig gemiste onbevroren dagen) en
  herinneringsintervallen (1, 3, 7, 14, 30, 60, 120, 240, 365, daarna jaarlijks).
- Alle vereiste activiteiten moeten op één reeksdag zijn afgerond. Een
  onafgemaakte poging begint de volgende dag opnieuw; de normale XP blijven
  behouden. De vereiste hoeveelheid wordt dan opnieuw bepaald. Er is geen
  terugkeerbonus of deadline. De geslaagde dag geeft precies +1.
- `StreakActivity` claimt elke sessie/ronde eenmaal per gebruiker, binnen
  dezelfde transactie als voortgang en beloning. Oudere cursusclients zonder
  poging-id gebruiken conservatief een hash van hun inzending; nieuwere
  clients behouden één poging-id bij retries en krijgen bij een nieuwe ronde
  een nieuwe. Hoofdstukoefeningen blijven server-uitgedeelde sessies gebruiken.
- `StreakDay` bewaart `STUDIED`, `FROZEN` of `RETURNED`. Geen rij blijft gemist.
  `StreakDayIndicator` is het centrale vervangpunt voor het voorlopige ✨.
- `StreakContinuationProvider` toont eenmaal per onderbreking/browser-sessie
  een uitleg met Vera. Dashboard, reekspagina en oefenuitslagen delen de
  voortgangskaart. Uitlezen na afronding gebeurt via het bestaande XP-event
  en een socketbericht na commit, met zichtbare polling als terugval.
- Alleen openen verdient geen dag, maar zet `streakReturnSeenAt`: de
  afwezigheidsmeldingen stoppen dan. `notifyStreakReturn` is een aparte
  categorie; kanalen, online-status en de lokale herinneringstijd blijven
  leidend. Er worden geen oude meldingen in het meldingencentrum bewaard.

Migratie `20261004090000_streak_continuation` behoudt alle tellers en
historische kalenderregels. Bestaande lopende reeksen krijgen een lokale
uitrolgrens (`streakGraceDay`), zodat oude ontbrekende dagen geen freezes
verbruiken of direct een onderbreking opleveren. De migratie maakt geen
fictieve studiedagen en reconstrueert geen vroeger verloren reeksen. De nieuwe
notificatiecategorie staat voor bestaande accounts uit tot zij haar aanzetten.

`npm run test:streak-return` test de pure regels en, met
`LEARNING_TEST_DATABASE_URL`, echte transacties, XP, gelijktijdigheid,
kalender, meldingen en de SQL-backfill op bestaande gebruikers.

## Bestaande gebruikers (migratie `20261002150000_learning_progress`)

- **Wat er wordt overgezet.** De backfill zet `ChapterProgress`, afgeronde stappen en leessessies om naar `ContentProgress`, samengevoegd per inhoud (dus ook over talen heen).
- **Idempotent.** `ON CONFLICT DO NOTHING`: nooit dubbel, en een bestaande rij wordt nooit overschreven.
- **Lezen.** Een toen afgerond hoofdstuk staat als gelezen en geoefend. Stappen geven het laatst gelezen vers; leessessies maken een hoofdstuk "bezig".
- **XP.** De XP die toen voor een hoofdstuk is verdiend (`legacyXp`), telt als al uitbetaald.
  - Niemand verliest XP.
  - Niemand kan hem opnieuw verdienen.
  - Wat de (grotere) nieuwe oefenset méér waard is, blijft te verdienen.
- **Ongemoeid.** XP-totalen, reeksen, freezes en behaalde prestaties veranderen niet.
- **Prestaties.** Hoofdstukprestaties tellen voortaan hoofdstukken met een gemaakte oefenset (`exercisesCompletedAt`); "perfect" is een helemaal goede set (`rewardBonusAt`).

## Tests

- `npm run test:learning` draait de pure regels (`tests/learning-rules.test.ts`).
- Met `LEARNING_TEST_DATABASE_URL` (een database met content, bv. een kopie van een geseede database) draaien ook de integratietests (`tests/learning-progress.integration.test.ts`). Die dekken:
  - lezen in de ene route en zichtbaar in de andere;
  - geen XP of reeks voor lezen;
  - gelijke XP per route;
  - geen dubbele basis-XP via een andere route of taal;
  - dubbelklikken en gelijktijdige inzendingen;
  - onvolledig inleveren;
  - migratiedata;
  - resetten;
  - een nieuw boek zonder sleutel.
