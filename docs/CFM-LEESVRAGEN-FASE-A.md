# CFM-leesvragen en XP — fase A

Ontwikkelbasis: `origin/main` **39f7fd57**, inclusief de definitieve besluiten van
PR #216. Dit verslag hoort bij de afzonderlijke fase-A-draft. Geen merge,
productie-import, uitrol of wijziging van productiegegevens uitgevoerd.

## Werking en hergebruik

- Een ondersteunde leesstap biedt na de tekst drie vragen. De weekroute deelt
  dezelfde vraagidentiteiten uit in zes groepen van drie, zodra alle zes delen
  beschikbaar zijn. De beschikbaarheidscontrole staat ook op de server.
- `ExerciseSessionQuestions` is uit de bestaande `LessonFlow` gehaald en wordt
  door de hoofdstukroute én CFM gebruikt. De bestaande `ExerciseCard`,
  `SummaryScreen`, antwoordcontrole, feedbackvlag en overslaanbare correctieronde
  blijven de bouwstenen. De staproute heeft, net als `ReadingLessonFlow`, geen
  extra hoofdstukreviewronde. Een mislukte submit bewaart de inzending voor retry.
- `learning/contentProgress.ts` bevat één gezamenlijke inlevertransactie. De kleine
  StudyLesson-bronadapter kiest inhoud en bindt deze aan de bestaande zes stappen;
  zij berekent geen XP en beoordeelt geen antwoorden.
- Broncontrole: onveranderlijke publicatierevisie, normale toegang, echte taal,
  persoonlijke stap, blokhash, letterlijk aanwezig schriftcitaat en de bijbehorende
  officiële verwijzing. Een verwijzing zonder gelezen tekst is onvoldoende.
- `exerciseGen.ts` levert de bestaande invul-, woordbank- en waar/niet-waarvormen.
  Eén kandidaat per vraagtype per gecontroleerd citaat; geen extra invulvarianten
  om een tekort op te vullen. De laatste vorm verschijnt alleen waar de bestaande
  generator en de gecontroleerde bron die ondersteunen. Geen AI, interpretatievraag
  of eigen schriftcitaat. Een deel met minder dan drie geschikte vragen blijft
  zonder vragen beschikbaar om te lezen.
- De broncatalogus staat in
  [cfm-reading-question-sources.json](../data/study-content/cfm-reading-question-sources.json).
  Alleen uit die codebeoordeelde catalogus worden ontbrekende Exercise-rijen bij
  een bewuste uitgifte toegevoegd. Bestaande rijen, vraagstatussen en opties worden
  niet overschreven. Concepten/ingetrokken of afwijkende vragen zijn niet speelbaar.
  Er is geen nieuwe publieke vraagbeheer- of publicatie-API.
- Vraag-ID's zijn stabiel binnen de leseditie; credits en beloningsgrens gebruiken
  de bestaande logische weekidentiteit uit `studyLessonContentKey`. Een andere
  leesroute, herpublicatie of kalenderweek maakt geen tweede beloningsinhoud.

## Inhoudelijke dekking en grens

**17 van 624 officiële stappen** (104 lessen uit 2026/2027) hebben momenteel
voldoende gecontroleerde vragen. **Geen volledige officiële week** heeft nu een
complete achttienvragenset. Dit is een wezenlijke beperking: het einddoel van
vragen bij alle stappen en volledige weeklessen is inhoudelijk nog niet behaald.
De technische weekflow is getest met een expliciet synthetische achttienvragenfixture.

Het [dekkingsoverzicht](CFM-VRAAGDEKKING.md) noemt elke les en stap. Het betekent
‘geen goedgekeurd aanbod’ waar een nul staat, niet dat ieder mogelijk broncitaat
individueel is afgekeurd. Veel stappen bevatten studietips of alleen verwijzingen.
Verdere dekking vereist gecontroleerde schrifttekst die werkelijk tot de gelezen
inhoud behoort. De officiële lessen zijn niet uitgebreid of herschreven om dit
tekort te omzeilen. Ontbrekende contenttalen/edities krijgen geen taalvervanging.

Reproduceer het readonly rapport zonder database of import:

```bash
npx tsx scripts/study-content/cfm-exercise-coverage.ts --output docs/CFM-VRAAGDEKKING.md
```

## XP, voortgang en bescherming

`applyAttempt`, `xpRules.ts`, `awardXp`, `awardCompetitionXp`,
`recordLearningActivity` en `checkAndAwardAchievements` blijven de centrale regels.
N is de **weekset van achttien**, ook wanneer de gebruiker één deel maakt.
De huidige bovengrens volgt uit `maxContentBaseXp(18)`: 18 × 10 + 20 = 200.
Geen afzonderlijke stapbonus. De cumulatieve goede antwoorden bepalen de bestaande
bonus; een fout kan later verbeteren. Alleen een poging zonder nieuwe basis/bonus
krijgt de bestaande herhalingskorting. Competitie houdt haar eigen centrale caps.
Bij de huidige gedeeltelijke officiële dekking wordt de volledige weekbonus dus
niet toegekend.

Dezelfde ExerciseSession/ExerciseAttempt/ContentExerciseCredit/ContentProgress-tabellen
worden gebruikt. De sessie wordt eenmaal geclaimd onder de bestaande gebruikers-
en inhoudslock. De editie en studievragen zijn tijdens de afhandeling beschermd
tegen een gelijktijdige wijziging. Een verouderde revisie, vragenplan, taal of sessie
kan geen beloning claimen. CFM bewaart het bevestigde resultaat voor herstel na een
verloren serverantwoord; replay schrijft geen extra XP, reeksactiviteit of melding.
De sessie-identiteit is ook op databaseniveau onveranderlijk.

Een volledig ingeleverde deelset mag de bestaande leesstap afvinken, ook bij foute
antwoorden, overeenkomstig de gewone staproute. Dit maakt de hele les niet READ.
De bewuste READ-knop en de oude losse stapafronding blijven zonder vragen-XP.
Bestaande leesvinkjes, oudere planvoortgang en gebruikersgegevens krijgen geen
retroactieve quizcredits. Reset bewaart de bestaande monotone beloningsvelden.
Voortgang verschijnt na afronding via `studyStepsChanged` en het bestaande XP-event.

Eén volledig geoefende week is één ContentProgress-eenheid voor de bestaande
prestatie-/mijlpaalketen, geen zes plus een. Een reeds aanwezige READ-rij verhindert
het eerste oefenafrondmoment niet. Dorp blijft uitsluitend zijn bestaande canonieke
BOM-READ tellen. Er zijn geen nieuwe Dorp-punten, items of groeiacties; de bestaande
bron-/activiteits-/creditsleutels blijven bruikbaar voor een latere goedgekeurde koppeling.

## Migratie, uitrol en terugrol

[20261206120000_study_exercise_sessions](../prisma/migrations/20261206120000_study_exercise_sessions/migration.sql)
bevat uitsluitend een compatibele uitbreiding van de bestaande tabellen:

- Exercise kan óf een echt hoofdstuk óf een StudyLessonEdition met bronbewijs hebben.
  Een CHECK dwingt deze exclusiviteit af; de editie heeft een restrictieve FK.
- ExerciseSession krijgt nullable studiecontext en bevestigd resultaat. Oude
  hoofdstuksessies behouden hun bestaande target en gedrag. Nieuwe studiecontext
  blijft onveranderlijk via een trigger; resultaat vereist een geclaimde sessie.
- Geen backfill, herberekening, seed, verwijdering of reset van bestaande rijen.
  De geïsoleerde migratieproef vergelijkt alle oorspronkelijke kolommen en rijen
  en forceert een conflict halverwege de transactie om rollback te bewijzen.

Uitrol gebeurt uitsluitend later door de eigenaar via de bestaande procedure,
met bestaande back-upafspraken en `prisma migrate deploy` vóór de nieuwe backend.
Prisma's migratieregistratie voorkomt heruitvoering bij een volgende deploy;
het SQL-bestand is geen handmatig herhaalbaar beheerscript.

**Functionele terugrol/noodstop:** zet `CFM_EXERCISES=off` en herstart de compatibele
appversie. Aanbod, uitgifte, controle en inleveren van CFM-vragen stoppen; lezen en
bewaarde historie blijven beschikbaar. Laat de additieve kolommen, FK, trigger,
credits en bevestigde resultaten staan. Verwijder geen historische vragen en zet
chapterId niet terug op NOT NULL wanneer studievragen bestaan. Een code-rollback
mag alleen naar een build die de nullable targets veilig afhandelt; blind terug
naar een oudere hoofdstuk-only server is niet veilig voor nieuwe studievragen.
Geen destructieve downmigratie of automatische productieherstelactie toegevoegd.

## Verificatie

De definitieve lokale resultaten en CI-status staan in de draft-PR. De suites
controleren bronhashes en dekking van alle geregistreerde jaargangen, dezelfde
vraag-ID's per route, eerste/foute/verbeterde/herhaalde antwoorden, concurrency,
verloren response, reset, oude READ en stapvoortgang, editie/taal/revisie, noodstop,
prestaties/mijlpaal en ongewijzigde Dorp-bijdragen. De gewone hoofdstukengine wordt
tegen hetzelfde N en dezelfde XP-/herhaaluitkomsten vergeleken.

Browserbewijs betreft een eigen PostgreSQL en een echte productiebuild, op
390 px/donker en 320 px/licht met 200% tekst, inclusief touch/toetsenbord,
correctieronde, fout/retry, zes vraaggroepen, terug naar de les en cacheverversing.
De oorspronkelijke hoofdstukflow wordt eveneens bediend. De officiële 2027-vraag
wordt op een geïsoleerde kopie van de gepinde tekst gecontroleerd; de volledige
achttienvragenweek gebruikt uitdrukkelijk synthetische testinhoud.

## Nog onder fase B en inhoudelijke acceptatie

- Meer gecontroleerde brondekking, zonder vragen over alleen genoemde verwijzingen;
  de actuele nul volledige weken is geen afgeronde productacceptatie.
- Onafhankelijke inhoudelijke review van de catalogus en de gegenereerde vraagkeuzes.
- Echte iPhone Safari-, iPad- en Android-controles, lifecycle, traag/offline netwerk,
  leespositie en toegankelijkheid op toestellen. Chromium-touch is geen apparaatbewijs.
- De lokale native router mist al de CFM-studielezer en krijgt hiermee geen lokale
  vragenroute of algemeen Bearer-contract. Zie [native pariteit](NATIVE-FEATURE-PARITY.md).
  Geen web-only uitzondering of volledige native oplevering geclaimd.
- Functionele beoordeling van de bestaande prestatiebenamingen en mijlpaalervaring;
  geen nieuwe beloningsregeling of Dorp-groei in deze fase.

Het Verborgen Woord, extra spelmodi en productiehandelingen zijn niet uitgevoerd.
