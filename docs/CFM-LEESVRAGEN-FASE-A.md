# CFM-leesvragen en XP — fase A

Oorspronkelijke ontwikkelbasis: `origin/main` **55ef86e6**, inclusief de besluiten
van PR #216 en #217. PR #218 is op verzoek van de eigenaar inmiddels gemerged.
De huidige leesflowcorrectie P36 staat op dezelfde featurebranch vanaf `11c1fef9`;
geen nieuwe merge, productie-import, uitrol of productiegegevenswijziging uitgevoerd.

**Officiële pilot:** 2026/02 heeft nu zes stappen en dezelfde achttien vragen in
de weekroute, bij werkelijk beschikbare Nederlandse PGP-bronnen. Brondekking:
**22/624 stappen en één volledige week**, tegenover 17/624 en nul vóór de pilot.
Zie het [pilotverslag](CFM-PILOT-2026-02.md), de
[definitieve bron-/vraagcontrole](cfm-pilot/2026-02-voorstel.md) en het
[historische oorzakenonderzoek](CFM-VRAAGDEKKING-ONDERZOEK.md). Alleen deze week
heeft toestemming voor aanvullende zichtbare schriftlezing (P35 vervangt P34); geen massale uitbreiding.

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
- Vraag-ID's zijn stabiel binnen de leseditie; de generatorseed ligt per citaat vast
  en hangt niet af van de catalogusvolgorde. Een vergelijking over alle 104 lessen
  bevestigt dat de vastlegging geen bestaande vraag-ID, tekst of antwoord wijzigt. Credits en beloningsgrens gebruiken
  de bestaande logische weekidentiteit uit `studyLessonContentKey`. Een andere
  leesroute, herpublicatie of kalenderweek maakt geen tweede beloningsinhoud.

## Inhoudelijke dekking en grens

**22 van 624 officiële stappen** (104 lessen uit 2026/2027) hebben nu voldoende
gecontroleerde bronvragen, mits de aanvullende pilotbronnen werkelijk toegankelijk
zijn. **Eén officiële week** heeft de complete achttienvragenset: 2026/02.
De overige **602 stappen** hebben nog geen complete gecontroleerde set. Dit is
géén volledige inhoudelijke release-acceptatie van alle lessen.

Het [dekkingsoverzicht](CFM-VRAAGDEKKING.md) gebruikt de gepinde bronbestanden,
geen productie-inventaris. In de app controleert de pilotadapter normale leesrechten,
`pgp`/`pgp`/`nl`, volledige hoofdstukhashes, de exacte versselectie en de bijbehorende
CFM-blokken. Ontbrekende, verborgen of afwijkende bronnen krijgen geen fallback.
De officiële CFM-body is niet herschreven. Voor stap 1 blijven de zichtbare citaten
en bestaande vraag-ID’s behouden; de vijftien nieuwe vragen staan tegenover vijftien
echt aangeboden verzen. De aparte synthetische enginefixture blijft bestaan als
technische regressie, naast de officiële pilot.

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
Buiten de volledige pilot voorkomt gedeeltelijke dekking dat een volledige
weekbonus wordt toegekend. De pilot volgt exact dezelfde bestaande bonusregel.

Dezelfde ExerciseSession/ExerciseAttempt/ContentExerciseCredit/ContentProgress-tabellen
worden gebruikt. De sessie wordt eenmaal geclaimd onder de bestaande gebruikers-
en inhoudslock. De editie en studievragen zijn tijdens de afhandeling beschermd
tegen een gelijktijdige wijziging. Een verouderde revisie, vragenplan, taal of sessie
kan geen beloning claimen. CFM bewaart het bevestigde resultaat voor herstel na een
verloren serverantwoord; replay schrijft geen extra XP, reeksactiviteit of melding.
De sessie-identiteit is ook op databaseniveau onveranderlijk.

Een volledig ingeleverde deelset mag de bestaande leesstap afvinken, ook bij foute
antwoorden, overeenkomstig de gewone staproute. Dit maakt de hele les niet READ.
De bewuste READ-knop blijft afzonderlijk zonder vragen-XP. P36 vervangt de losse
stapafrondknop door Volgende stap; de bestaande COMPLETE-API blijft compatibel.
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

De onderstaande suites zijn historisch pilotbewijs; de actuele leesflowcorrectie
en branch-CI staan in het pilotverslag en de vervolgupdate bij de gemergede PR #218. De suites
controleren bronhashes en dekking van alle geregistreerde jaargangen, dezelfde
vraag-ID's per route, eerste/foute/verbeterde/herhaalde antwoorden, concurrency,
verloren response, reset, oude READ en stapvoortgang, editie/taal/revisie, noodstop,
prestaties/mijlpaal en ongewijzigde Dorp-bijdragen. De gewone hoofdstukengine wordt
tegen hetzelfde N en dezelfde XP-/herhaaluitkomsten vergeleken.

Browserbewijs betreft een eigen PostgreSQL en een echte productiebuild, op
390 px/donker en 320 px/licht én donker met 200% tekst, inclusief touch/toetsenbord,
correctieronde, fout/retry, zes vraaggroepen, terug naar de les en cacheverversing.
De oorspronkelijke hoofdstukflow wordt eveneens bediend. De officiële 2027-vraag
wordt op een geïsoleerde kopie van de gepinde tekst gecontroleerd; de oorspronkelijke volledige-weekfixture gebruikt synthetische testinhoud. De
[officiële pilot](CFM-PILOT-2026-02.md) heeft afzonderlijke echte bron-, route-, XP-
en browsertests; de resultaten zijn daar apart vastgelegd.

### Eerder uitgevoerde controles van de technische basis

| Controle | Resultaat |
|---|---|
| CFM-vragen: bron, gedeelde identiteit, XP, revisie, rechten, replay, concurrency | 16/16 |
| Bestaande stapvoortgang / gedeelde learning / Kompas met database | 9/9, 29/29, 69/69 |
| Persoonlijke CFM-studie / 2026–2027-media / annotatie-unitcontroles | 101/101, 35/35, 56/56 |
| Dorp, focus/shell en overige gedeelde leerregels | 56/56 en 34/34 |
| Cursus-contentisolatie van PR #217 | 1/1 |
| Migratie, 161 bestaande tabellen en geforceerde conflictrollback | Geslaagd; geen productieverbinding |
| Mobiele Chromium-browser | Zes scenario’s; zie screenshots en grenzen hierboven |
| Prisma, TypeScript, productiebuild, native broninventaris | Geslaagd |
| Volledige ESLint-run | 0 fouten, 170 waarschuwingen; gerichte eindcontrole eveneens 0 fouten |
| i18n | Nieuwe teksten in alle vijf talen; algemene audit meldt 418 bestaande ontbrekende sleutels per niet-Nederlandse taal |

Reproduceer de database-/browsercontrole op een eigen Docker-host na `npm run build`:

```bash
node scripts/content-architecture/test-access-isolated.mjs --focused --cfm-exercises --browser
```

### Mobiele screenshots

Alle beelden zijn gemaakt met Chromium en een eigen testdatabase. De officiële
2027-stap gebruikt een kopie van de gepinde bron. Week-/resultaatbeelden gebruiken
expliciet synthetische vragen; geen officiële achttienvragendekking geclaimd.

- [Officiële 2027-stap, 390 px donker](screenshots/cfm-leesvragen/official-2027-question-390-dark.png)
- [Weekvraag, 390 px donker](screenshots/cfm-leesvragen/question-390-dark.png)
- [Stapvraag, 320 px licht met 200% tekst](screenshots/cfm-leesvragen/question-320-light.png)
- [Correctieronde, 320 px donker met 200% tekst](screenshots/cfm-leesvragen/review-320-dark.png)
- [Gedeeld XP-resultaat](screenshots/cfm-leesvragen/result-390-dark.png)
- [Lezen en afronden zonder vragen](screenshots/cfm-leesvragen/reading-without-questions-320.png)
- [Browserresultaten](screenshots/cfm-leesvragen/results.json)

De actuele officiële pilotbeelden en hertests staan in het [pilotverslag](CFM-PILOT-2026-02.md).

## Nog onder fase B en inhoudelijke acceptatie

- Meer gecontroleerde brondekking, zonder vragen over alleen genoemde verwijzingen;
  één gecontroleerde pilot is geen volledige productacceptatie van 104 lessen.
- Onafhankelijke inhoudelijke review van de catalogus en de gegenereerde vraagkeuzes.
- Echte iPhone Safari-, iPad- en Android-controles, lifecycle, traag/offline netwerk,
  leespositie en toegankelijkheid op toestellen. Chromium-touch is geen apparaatbewijs.
- De lokale native router mist al de CFM-studielezer en krijgt hiermee geen lokale
  vragenroute of algemeen Bearer-contract. Zie [native pariteit](NATIVE-FEATURE-PARITY.md).
  Geen web-only uitzondering of volledige native oplevering geclaimd.
- Functionele beoordeling van de bestaande prestatiebenamingen en mijlpaalervaring;
  geen nieuwe beloningsregeling of Dorp-groei in deze fase.

Het Verborgen Woord, extra spelmodi en productiehandelingen zijn niet uitgevoerd.


## Leesflowcorrectie P36

De pilot uit PR #218 is al gemerged. De opvolgende bediening op dezelfde featurebranch
vervangt de twee losse stapknoppen door Volgende stap: leesvoortgang bewaren,
beschikbare vragen starten, bestaand resultaat en direct volgende stap. De weekroute
blijft gelijk. Zie het actuele [pilotverslag](CFM-PILOT-2026-02.md). De eerdere
verificatie in dit document is historische basis en geen bewijs voor deze correctie.
