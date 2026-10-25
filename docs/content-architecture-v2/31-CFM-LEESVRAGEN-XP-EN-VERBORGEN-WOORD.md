# CFM-leesvragen, XP en Het Verborgen Woord — onderzoek en ontwerp

Onderzocht op 25 oktober 2026, vanaf `origin/main` **e7264f05** (PR #214).
Status: uitsluitend documentatie; geen implementatie- of uitroltoestemming.
De uitvoeringsvolgorde en fasecriteria staan uitsluitend in de
[bestaande roadmap, vervolg A–D](04-IMPLEMENTATION-ROADMAP.md#vervolg-a-d--cfm-leesvragen-eerst).
Dit document onderbouwt die planning; het is geen tweede roadmap.

## 1. Bestaande bronnen en werkelijke status

Lees samen met [Leervoortgang](../LEERVOORTGANG.md),
[CFM Doorlopend](../CFM-DOORLOPEND.md),
[Persoonlijke studie](../CFM-PERSOONLIJKE-STUDIE.md),
[technische afronding](../CFM-TECHNICAL-FINALIZATION.md),
[CFM-herstel #214](../CFM-HERSTEL-PLAATSING-EN-2027.md),
[expliciet gelezen](17-PHASE-2E-EXPLICIT-READ.md),
[programma-integratie](28-PHASE-3D-PROGRAM-INTEGRATION.md),
[spelresolvers 5A](29-PHASE-5A-GAME-CONTENT-RESOLVERS.md) en
[leswoordpools 5B](30-PHASE-5B-LESSON-WORD-POOLS.md).
Oudere faseverslagen zijn historisch bewijs, geen actuele implementatiestatus.
De algemene roadmap en besluiten bevatten al Het Verborgen Woord (5C/5D);
leesvragen voor CFM ontbreken daarin tot deze aanvulling.
GitHub-zoekopdrachten naar issues met ‘CFM’/‘Verborgen Woord’ en PR's met
‘leesvragen’ leverden bij dit onderzoek geen aanvullende planning op. De bestaande
repositoryroadmap blijft daarom leidend; er zijn geen nieuwe issues aangemaakt.

Alle onderstaande codepaden zijn relatief aan de repositoryroot.

| Onderdeel | Bestanden en functies | Bestaat / herbruikbaar / ontbreekt |
|---|---|---|
| Doorlopend CFM | `src/lib/studyContent/cfmVolumes.ts`, `cfmProgramme.ts`, `cfmCourses.ts`, `catalogue.ts`, `weekSelection.ts` | Eén programma boven jaargangen, stabiele les-/cursusidentiteit, toegang per collectie, archief en centrale weekkeuze bestaan. Geen nieuwe cursus per quiz of jaar nodig. |
| Persoonlijke leesinhoud | `src/lib/studyContent/personalStudy.ts`: `planPersonalStudy`, `validatePersonalPlan`; `personalStudyOverrides.ts`: `safePersonalPlan`, `personalStudyFor` | Precies zes brongebonden stappen; vrije persoonlijke studie gebruikt dezelfde inhoud. 2026-planversie 2, 2027 versie 3; oude zevenstappen- en 2027-zesstappenplannen blijven herleidbaar. Geen vragenplan. |
| CFM-reader/status | `src/components/study/StudyReader.tsx`; `src/lib/studyContent/stepProgress.ts`: `recordStepProgress`, `applyStepProgress`; `readStatus.ts`: `markStudyLessonRead`, `studyLessonContentKey` | Stap openen/afronden geeft uitsluitend studievoortgang. De aparte bewuste READ-actie telt eenmaal voor de reeks, zonder XP. Geen CFM-vraagsessie of automatische quizbeloning. |
| Schriftuurvragen | `prisma/importContent.ts`: `chapterExercises`; `src/lib/exerciseGen.ts`: `generateFillBlank`, `generateWordBank`, `generateTrueFalse`; `src/lib/exerciseHints.ts` | Deterministische generatie uit echte verzen en taalgebonden woordenlijsten; ook handgeschreven oefeningen. Geen runtime-AI. CFM-bronblokken zijn geen verzen; generator niet blind op reflectievragen of volledige lesbody toepassen. |
| Vraagidentiteit/import | `src/lib/exerciseSync.ts`: `exerciseSignature`, `planExerciseSync`; `prisma/importContent.ts` | Hergebruik van bestaande oefening-ID's bij gelijke inhoud beschermt historie. Dat patroon is bruikbaar voor een CFM-vragenpublicatie; er is nog geen koppeling met StudyLesson/Revision. |
| Drie vragen per deel | `src/lib/learning/exercisePlan.ts`: `QUESTIONS_PER_PART`, `planChapterExercises`, `pickPartExercises`, `pickChapterExercises` | Hoofdstukdelen van maximaal tien verzen, maximaal drie beschikbare vragen per deel. Volledig hoofdstuk krijgt de som van alle delen, niet slechts drie. CFM heeft zes inhoudelijke stappen, dus de verssplitsing zelf is niet bruikbaar. |
| Uitdelen/inleveren | `src/lib/learning/contentProgress.ts`: `issueExerciseSession`, `submitExerciseSession`, `SessionHooks` | Server selecteert vragen; opgeslagen set, eigenaarschap, volledige inzending, atomaire claim, gebruikerslock en inhoudslock, credits, XP en reeks bestaan. Implementatie is nog aan `Chapter`, `Exercise` en `CourseLesson` gebonden. Geen direct toepasbare StudyLesson-adapter. |
| Correctheid en herkansen | `src/lib/exerciseGen.ts`: `isExerciseCorrect`, `normalizeAnswer`; `src/app/api/exercises/[exerciseId]/check/route.ts`; `src/components/LessonFlow.tsx`: `ExerciseCard`, `onReviewDone`; `src/components/ReadingLessonFlow.tsx` | Check geeft directe feedback zonder writes; submit beoordeelt opnieuw op de server. Volledige hoofdstukflow biedt een overslaanbare correctieronde en levert de laatste antwoorden in. Stapflow gebruikt dezelfde vraagkaart maar heeft die extra reviewfase niet. Geen universele regel ‘eerste antwoord telt’ of ‘alles moet goed’ aannemen. |
| Beloning en reset | `src/lib/learning/rewards.ts`: `applyAttempt`, `maxContentBaseXp`, `withLegacy`; `contentProgress.ts`: `resetReadingProgress`; `src/lib/xpRules.ts` | Eén begrensde basisbeloning per inhoud, daarna herhalingskorting. Reset bewaart beloningshistorie. Deze regels hergebruiken; geen CFM-formule kopiëren. |
| Reeks, XP, competitie, prestaties | `src/lib/streak.ts`: `recordLearningActivity`, `grantMilestoneFreeze`; `src/lib/xp.ts`: `awardXp`; `src/lib/competitionXp.ts`: `awardCompetitionXp`; `src/lib/achievements.ts`: `checkAndAwardAchievements` | Eén centrale transactieketen. Algemene XP en competitie-XP zijn bewust verschillende bestaande ledgers; geen derde CFM-ledger. Prestaties tellen nu oefenafgeronde ContentProgress-rijen. |
| Dorp | `src/lib/dorp/growth.ts`: `countCanonicalReadContributions`, `BOFM_CANONICAL_CONTENT_KEYS`; `src/lib/dorp/service.ts`: `reconcileVillage`, `phaseForContribution` | Groei telt READ van de 239 canonieke BOM-hoofdstukken per gebruiker, route-/taalonafhankelijk. Geen algemene XP-, prestatie- of CFM-bijdrageadapter. Geen bestaande CFM-bouwbeloning om simpelweg aan te roepen. |
| Spelaanbod en bron | `src/lib/gameCatalog.ts`: `GAME_CATALOG`; `src/lib/gameContentResolver.ts`: `resolveGameContent`; `src/lib/studyContent/wordPoolResolver.ts`: `resolveLessonWordPool`; `wordPool.ts`: `extractLessonWords` | 5A/5B bestaan. Leswoordpool vereist exacte gepubliceerde editie/revisie en levert hash + ankers. Het zijn orthografische kandidaten, geen gecontroleerde inhoudelijke woordenbank met schriftbewijs/toelichting. Het Verborgen Woord staat nog niet in de spelcatalogus. |
| Samen studeren | `src/server/study.ts`: `registerStudyHandlers`, `stateFor`; `src/lib/study/units.ts`: `supportsStudy`, `publicQuestion`; `StudySession`/`StudyRound` in `prisma/schema.prisma` | Hostgestuurde lees-/vraagfasen, deelnemers, opslag/herstel en publieke vragen zonder antwoorden bestaan. `STUDY_COURSE_TYPES` ondersteunt nu geen `STUDY_STEPS`/`STUDY_FREE`; CFM-samenvragen volgen niet automatisch uit solo-leesvragen. |
| Host en beurten | `src/server/gameServer.ts`: `canActFor`, `broadcastFamilyTurn`; `src/components/FamilyGameRoom.tsx`; `src/lib/familyGame.ts`: `explanationForExercise` | Gezinsavond biedt beurtvolgorde, hostbediening, kamers en uitleg uit bronverzen. De lokale gastspelers en bestaande dobbel-/bordregels worden NIET overgenomen. Geen afzonderlijke gesynchroniseerde presentatiemodus voor dit nieuwe spel aangetroffen. |
| Realtime/web/native | `src/server/gameServer.ts`; `src/server/puzzle.ts`: `registerPuzzleHandlers`; `src/lib/native/socketAuth.ts`: `authenticateRealtimeSocket`, `validateNativeSocket`; `src/lib/data/` | Socket.IO, Redis-adapter, accountkamers, authenticatie en hercontrole bestaan. Legpuzzel levert aanvullende patronen voor gevalideerde commit/sync. Nieuwe spelrollen, beurtcommando's en veilige presentatieresponses moeten nog worden ontworpen. |

De modellen `Exercise`, `ExerciseSession` en `ContentExerciseCredit` hebben verplichte
hoofdstuk-/Exercise-relaties (`prisma/schema.prisma`). Alleen een CFM-contentKey
meegeven maakt ze niet geschikt. Geen kunstmatige Chapter/Verse aanmaken voor CFM.
De toekomstige modeluitbreiding moet additief, compatibel met bestaande clients en
onderdeel van één gedeelde oefenservice zijn; exacte DDL hoort bij het implementatiepakket.

## 2. Leesvragen en inhoudelijke gelijkwaardigheid

### Vaststaande opdracht

- Iedere CFM-leesstap krijgt drie vragen; ook in één keer lezen krijgt vragen.
- Zelfde bestaande antwoord-, XP-, voortgangs-, herkansings- en beloningsregels als
  de bijbehorende BOM-leesroute. Geen tweede XP-systeem, geen nieuwe bedragen.
- Geen dubbele basisbeloning door routewissel, opnieuw openen, kalenderwisseling,
  taalwissel, revisie of reset. Bewust opnieuw oefenen houdt de bestaande korting.
- Officiële inhoud, vragen/opdrachten daarin, media, links, annotaties en bestaande
  gebruikersgegevens blijven intact. Officiële reflectievragen worden niet automatisch
  gegradeerde oefeningen. Geen geselecteerde alinea, citaat of extra annotatieveld.

### Wat is dezelfde inhoud?

`StudyReader` filtert bij `mode="step"` op `step.blockIds`, bij `mode="free"`
op `personalBlockIds`; `mode="full"` toont de volledige oorspronkelijke body.
`planPersonalStudy` verdeelt de persoonlijke blokken eenmalig over zes stappen;
`validatePersonalPlan` controleert onder meer dekking en dubbelingen.

Daarmee geldt: **zes persoonlijke stappen = vrije persoonlijke weekstudie** voor
hetzelfde plan. De volledige officiële les bevat meer: onder meer onderwijs aan
kinderen en expliciet verborgen metadata/leeshulpen. Die extra tekst maakt geen
zevende beloningsdeel. De huidige READ-status is voor alle weergaven dezelfde
logische les, terwijl stapstatus editie-/fingerprintgebonden is. Alle zes stappen
afronden zet momenteel NIET automatisch READ. Dat bestaande onderscheid bewaren.

**Aanbevolen oefenplan, nog te bevestigen:** één weekplan met zes delen van drie
vragen (N = 18), gebonden aan de persoonlijke bronblokken. Staproute krijgt het
eigen deel; vrije studie en volledige officiële weergave krijgen dezelfde zes
delen achter elkaar. Dit volgt het hoofdstukprincipe: volledig lezen krijgt de
som van de delen. Drie losse weekvragen naast achttien stapvragen geeft ongelijke
belasting/voltooiing en is geen veilige rechtstreekse overname van de huidige regels.
Als product toch drie weekvragen wil, is eerst een expliciet alternatief
credit-/dekkingsbesluit nodig; geen stilzwijgende aparte weekbonus bouwen.

Concreet advies voor de eerste vragenbank: drie vaste goedgekeurde vraagidentiteiten
per stap per gepubliceerd plan; optievolgorde mag wisselen. De weekroute geeft de
unie van die achttien uit. Een grotere bank met willekeurige alternatieven kan later,
maar vereist eerst bewezen credit-equivalentie, zodat nieuwe varianten geen extra
basisbeloning of schijnbare dekking van een andere stap veroorzaken.

De beoogde bediening volgt de bestaande routes: stap lezen → drie vragen → bestaande
feedback en serveruitslag → verder; week in één keer lezen → expliciete leesafronding
zonder XP en aanbod van de volledige set → bestaande hoofdstukflow met review en
uitslag. Bewaar positie en herkomst bij beide routes. Een reeds afgeronde leesstap
kan nog onbeantwoorde vragen aanbieden, zonder het leesvinkje in te trekken.
De toekomstige submit-hook mag de stap bij geldige volledige inzending afvinken;
de huidige losse COMPLETE-route krijgt geen beloningsbevoegdheid. Geen stap- of
weekafronding afleiden uit alleen scrollpositie.

**Aanbevolen vraaginhoud:** drie gecontroleerde, objectief beantwoordbare vragen per
stap uit de werkelijk zichtbare tekst; bestaande keuze-/woordbank/waar-onwaarvormen,
antwoordcontrole, hint- en feedbackvoorzieningen hergebruiken waar passend.
Persoonlijke geloofservaringen, gebed, notities en reflectie hebben geen goed/foutscore.
Ook een stap die vooral een video bevat moet vanuit de aanwezige leesinhoud een
verantwoorde set hebben; anders expliciet onbeschikbaar, geen verzonnen vraag.
Met minder dan drie goedgekeurde vragen is de nieuwe vragenfunctie voor die stap
niet gereed. Lezen blijft beschikbaar en geeft geen vragen-XP. Geen andere taal of
ander jaar invullen om het minimum te halen.

### Identiteit en beloningscontract voor de latere implementatie

1. Hergebruik `studyLessonContentKey` (`study:<workKey>:<periodId>:<sourceKey>`)
   als weekgrens. Geen cursus-id, stapnummer, kalenderweek of revisie-id als nieuwe
   basisbeloningsidentiteit. Andere jaargangen zijn andere lessen; een nieuwe week
   reset nooit een eerdere beloningshistorie. Een CFM-les over Alma is niet hetzelfde
   als het canonieke hoofdstuk Alma: verwijzingen openen verdient geen credit.
2. Een gepubliceerd vragenplan legt broneditie/revisie/hash, persoonlijke planversie,
   blokdekking, vraagversie en stabiele vraagidentiteiten vast. Het bindt dezelfde
   credits aan beide routes. Geen nieuwe credits door een vraag alleen te verplaatsen,
   opnieuw te publiceren of te vertalen. N is de gezamenlijke weekset, geen sessiegrootte.
3. Gebruik de bestaande sessie-uitgifte/submitketen met een StudyLesson-adapter:
   controleer actuele rechten, exacte bron en uitgegeven vragen; beoordeel server-side;
   claim de sessie eenmaal en serialiseer per gebruiker/inhoud. Voor stale revisies
   geef herstelbare herlaadinformatie, behoud eerdere credits en betaal niets opnieuw.
   Historische voortgangsdekking is geen bewijs dat nieuwe quizvragen beantwoord zijn.
4. Gebruik uitsluitend `applyAttempt` en centrale constanten: momenteel
   `XP_PER_CORRECT_STANDARD = 10`, `XP_PERFECT_BONUS_STANDARD = 20`,
   `REPEAT_DISCOUNT = 0.1` (`xpRules.ts`). Bovengrens basis =
   `maxContentBaseXp(N)`; bij aanbevolen N=18 nu 200, ongeacht route. De bonus is
   eenmaal per weekinhoud, niet zesmaal per stap of nogmaals voor volledig lezen.
   De som van cumulatief nieuwe goede antwoorden bepaalt de bonus, niet noodzakelijk
   één perfecte poging. Geen `standardContentXp` per CFM-stap aanroepen.
5. Volledig ingeleverd is niet hetzelfde als alles goed: de bestaande oefenvoortgang
   telt gemaakte vragen, de beloningsvoortgang telt nieuwe goede antwoorden.
   Foute antwoorden kunnen in een nieuwe sessie alsnog credit verdienen tot de grens.
   `applyAttempt` geeft alleen herhalings-XP wanneer die poging geen nieuwe basis/bonus
   geeft. Algemene herhaling is gekort, niet wereldwijd op nul gecapt; competitie
   heeft daarnaast de eigen configureerbare daglimiet/afname via `awardCompetitionXp`.
   Geen nieuwe CFM-daglimiet of totale farminggarantie verzinnen.
6. Laat directe feedback niets schrijven. Gebruik de bestaande hoofdstukreview bij
   de volledige route en de bestaande stapflow voor stappen; documenteer dit huidige
   verschil. Een verloren response of dubbele submit mag geen nieuwe sessiebeloning
   veroorzaken. Een bewuste nieuwe oefenpoging is een andere sessie en valt onder
   de bestaande herhaalregels, niet onder dezelfde HTTP-retry.
7. Bewaar XP, credits, oefenstatus, route-afhandeling en centrale activiteit atomair.
   Gebruik de bestaande `CONTENT_EXERCISES`-activiteit met sessiesleutel,
   `awardXp`/`awardCompetitionXp` binnen de gedeelde service en de bestaande
   notificatie-/refreshpaden na commit. Openen, scrollen, video afspelen en de oude
   COMPLETE-knop krijgen niet alsnog XP. Een bewuste READ blijft zonder XP.
8. Bestaande `StudyStepProgress`, READ, leesposities, oudere planversies,
   annotaties en inschrijvingen blijven behouden. Geen retroactieve vragencredits,
   XP, prestaties of reeksdagen uit al afgeronde stappen afleiden. Nieuwe
   oefenvoortgang mag de oude afgevinkte leesstap niet terugzetten naar onafgerond.
   Niet blind `resetReadingProgress` inzetten: toets expliciet de nieuwe adapter,
   behoud alle beloningsvelden en creditidentiteiten.
9. Een inhoudelijk gewijzigde vraag/plan mag de weekgrens niet opnieuw uitbetalen.
   Vereis vóór implementatie een versie-/creditmapping voor vervallen/vervangen vragen
   en stabiel N. Een cosmetische correctie bewaart identiteit; bij een niet-bewezen
   omzetting blijven oude credits staan en blijft nieuwe uitgifte geblokkeerd tot
   review. Meertalige uitgaven delen de logische weekgrens alleen bij bewezen mapping.

### Prestaties, reeksbevriezingen en Dorp

`submitExerciseSession` roept nu `checkAndAwardAchievements` aan en geeft per tien
inhouden met `exercisesCompletedAt` een mijlpaalbevriezing. De prestatiequeries tellen
alle zulke ContentProgress-rijen zonder bronfilter; daardoor kan een CFM-adapter
onbedoeld ‘hoofdstuk’-prestaties activeren. De pure beloningsregels staan vast, maar
het labelen/tellen van een CFM-week als zo'n inhoudseenheid moet expliciet worden
bevestigd. Aanbeveling: hoogstens één volledig geoefende week telt als één eenheid,
nooit zes stappen plus de week; behoud bestaand bezit en geef geen historische backfill.
Ook de milestonecode moet dan veilig omgaan met een reeds bestaande READ-rij.

Dorp gebruikt momenteel een andere grondslag: canonieke BOM-READ, geen
`exercisesCompletedAt`, algemene XP of prestatie. De [Dorp-2D-specificatie](../VERSADO-DORP-FASE-2D.md)
bevestigt die 239-hoofdstukkengrens. Voorbereiden betekent bron-/activiteit-/creditsleutels
controleerbaar bewaren in de bestaande administratie, zodat een latere goedgekeurde
adapter ze kan gebruiken. **Geen fictieve BOM-READ, CFM-bouwpunten, itemtoekenning,
nieuwe Dorp-teller of mutatie bij quizafronding.** De huidige Dorp-groei moet gelijk
blijven. Hoe een CFM-week later bijdraagt is een apart productbesluit, inclusief
verhouding tot lezen versus vragen, groepsbijdragen en eventuele historie.

## 3. Het Verborgen Woord

### Definitieve afspraken uit de opdracht

- Afzonderlijk spel onder **Spelen**, met solo en klassikaal gebruik.
- Woorden bij de geselecteerde schriftuurcollectie; voorrang voor de actuele of
  door de host gekozen CFM-les wanneer die van toepassing is.
- Gecontroleerde woordenbank met schriftuurverwijzingen en toelichting.
- Host start en begeleidt rondes. Spelers raden om de beurt één letter of het hele
  woord. Iedere geraden letter wordt gedeeld; één gezamenlijk foutenbudget.
- Host kan letters namens leerlingen invoeren. Aparte presentatiemodus op een groot
  scherm, gesynchroniseerd met de hostbediening.
- Iedere deelnemer via eigen telefoon heeft een Versado-account. **Geen gastmodus**,
  ook niet door `guest:*`-spelers van Gezinsavond te kopiëren.
- Geen opgehangen persoon; bestaande Versado-vormgeving. Na afloop relevante
  schriftuur met toelichting tonen.

### Technische aanbevelingen, geen reeds bestaande functie

- Gebruik `GAME_CATALOG`, scopes, bestaande instellingen en `resolveGameContent`
  voor aanbod en start; geen zichtbaar spel zonder echte, voldoende gecontroleerde
  broninhoud. Houd kalenderweek en expliciete hostles server-side vast. De precieze
  voorrang bij een conflict tussen gekozen collectie en CFM-les vraagt nog een besluit.
- Gebruik `resolveLessonWordPool` alleen als kandidaatleverancier. Een beheerde
  bank moet kandidaten inhoudelijk goedkeuren, herkomst/versbewijs/toelichting en
  taal vastleggen. Anker in een CFM-paragraaf is geen bewezen schriftuurverwijzing.
  Bij ontbrekende bank: nette onbeschikbaarheid; geen willekeurig woord of BOM-fallback.
- Bevries bankversie, collectie/taal/editie, eventuele CFM-les/revisie, poolhash en
  regelsversie bij spelstart. Nieuwe week, bronwissel of publicatie verandert een
  lopende ronde niet. Hercontroleer intrekking van toegang; niet stil naar andere
  bron overschakelen. Hergebruik de centrale verwijzingsresolver voor de onthulling.
- Hergebruik accountauthenticatie, Socket.IO-transport en host-/lobby-/beurtpatronen.
  Maak alleen de noodzakelijke spelgebonden staat/commando's; geen algemene tweede
  multiplayer-engine. PostgreSQL is gezaghebbend, niet de in-memory roomcache.
  Gebruik atomaire commando's met actionId en verwachte toestandversie; gelijktijdige
  speler-/hostinput, duplicaten en reconnect mogen maximaal één zet opleveren.
- Maak aparte serverresponses voor speler, host en presentatie. Masker, geraden
  letters, beurt en gedeeld budget zijn publiek binnen de geautoriseerde ronde;
  geheim woord/antwoordsleutels/toelichting pas bij toegestane onthulling. Geen
  antwoord in HTML, socketpayload, bronbank of foutresponse vóór dat moment.
- Hostproxy is een expliciet toegestaan commando voor de huidige beurt, met audit
  van bedienend account; geen impersonatie of nieuwe gastidentiteit. Beslis apart
  hoe fysiek aanwezige leerlingen zonder eigen telefoon aan beurten worden gekoppeld.
- Presentatie is een leesrol, niet een tweede host. Aanbevolen: ingelogd hostaccount
  op tweede scherm, expliciet aan dezelfde sessie gekoppeld; geen anonieme deel-URL.
  Hostbediening blijft op telefoon werken. Rollen, lifecycle en synchronisatie nog bouwen.
- Gebruik de bestaande web-/native-sessies en veilige realtime-handshake, shell,
  focustoestand, i18n en Kompas. Nieuwe browsergame is niet automatisch native klaar.
  Geen XP-/reeks-/Dorp-beloning voor het nieuwe spel afleiden uit CFM-quizregels.

## 4. Productbesluiten vóór de betreffende implementatie

| Besluit | Aanbeveling / grens | Blokkeert |
|---|---|---|
| Volledige weekvragen | Dezelfde 18 vragen, in zes delen, als de stappen; geen aparte set van drie | Fase A: oefenplan/UX goedkeuren |
| Vraagproductie en review | Brongebonden, gecontroleerde vragenbank; bestaande generatoren slechts als hulpmiddel na inhoudelijke toets. Bepaal auteur, review/publicatie en dekking van alle lessen | Fase A: vraagcontent en publicatiecontract |
| Prestaties en mijlpaalbevriezing | Eén week = hoogstens één oefeninhoud; bestaande centrale voorwaarden en bezit behouden; correcte algemene labels | Fase A-contract, uiterlijk vóór fase B-acceptatie |
| Dorp-bijdrage | Geen verandering nu; apart goedkeuren hoe CFM-lezen/vragen later bijdragen | Alleen latere Dorp-uitbreiding, niet CFM-XP |
| Spelbronprioriteit | Leg conflictregel vast voor actieve schriftuurcollectie versus huidige/bewust gekozen CFM-les, en wat ‘van toepassing’ betekent | Fase C |
| Spelronderegels | Budgetaantal, rondeaantal, letter-/accentnormalisatie, herhaalde letter, fout volledig woord, beurt na goed antwoord, hints/tijdslimiet, winst/verlies en beloningen nog kiezen | Fase C; geen bedragen of zes-pogingenregel van Woord van de Dag lenen |
| Klas en presentatie | Beurtvolgorde, laat aansluiten, offline speler, hostuitval/overdracht, fysieke leerlingen zonder telefoon, koppeling/autorisatie van het tweede scherm | Fase D; accountplicht en geen gastmodus staan vast |

Deze open keuzes hoeven deze documentatie-PR niet te blokkeren. Er start geen
implementatie voordat het bijbehorende pakket is beoordeeld. Bestaande vragen-XP
wordt niet aangepast om een open spel- of Dorp-besluit alvast in te vullen.
