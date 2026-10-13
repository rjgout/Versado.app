# Legpuzzel 2.0, fase 3: multiplayer (Samen en Tegen elkaar)

Architectuur, regels en bedrijfsvoering. Het bijbehorende verslag met bewijs en
openstaande punten staat in `19-PHASE-3-IMPLEMENTATION-REPORT.md`.

## 1. Uitgangspunten

- PostgreSQL is de bron van waarheid. Socket.IO (met de Redis-adapter) is alleen
  transport, aanwezigheid en tijdelijke sleepbeweging; niets wat een speler
  "ziet" is gezaghebbend zonder dat het in de database staat.
- De server rekent alles opnieuw na. De client stuurt nooit een uitslag, tijd of
  XP-bedrag; een tijd is altijd serverklok.
- Eén motor. Samen en Tegen elkaar hergebruiken de geometrie, snapshot,
  validatie en hints van Solo (`engine.ts`, `solo.ts`). Er is geen tweede
  puzzelmotor en Solo is niet herschreven: `applySoloAction` kreeg alleen een
  `mode` en optionele `hooks` (guard vóór, after ná de update).
- Geen nieuwe featureflag-infrastructuur. De bestaande schakelaar
  `GameSettings.jigsawEnabled` en de content-toegang (`gameKeys` bevat `jigsaw`)
  gelden voor elke route en voor de socket-acties.
- Geen nieuw XP. Samen en Tegen elkaar geven geen XP. De reeks volgt de
  bestaande regel (`recordLearningActivity`, `completeJigsaw`).

## 2. Datamodel (migratie `20261026100000_puzzle_multiplayer`, uitsluitend additief)

| Model | Doel |
|---|---|
| `PuzzleSession` (+`mode` COOP/MATCH, `matchId`) | één gedeelde (Samen) of individuele (Tegen elkaar) sessie |
| `PuzzleSessionParticipant` | deelnemers van Samen, persoonlijke hints (`includedHintsUsed`, `activeHint`) |
| `PuzzleLock` | groepsvergrendeling met lease (uniek per sessie + groep) |
| `PuzzleInvite` | uitnodiging voor Samen of een wedstrijd (uniek per sessie/wedstrijd + ontvanger) |
| `PuzzleMatch`, `PuzzleMatchParticipant` | wedstrijd: soort, status, vraag, deadlines, winnaar; per deelnemer status, tijd, rang, voortgang |
| `PuzzleAction` (+`userId`) | idempotente actie met opgeslagen delta (`sessionId`, `actionId` uniek) |

Bestaande rijen veranderen niet: alle nieuwe kolommen zijn nullable of hebben een
default, er is geen backfill nodig en geen bestaand gedrag verschuift
(Solo-sessies blijven `mode = SOLO`).

## 3. Samen

### Serialisatie
Elke commit loopt in één transactie die de sessierij vergrendelt
(`SELECT ... FOR UPDATE`, `lockCoopSession`). Met maximaal vier spelers is
serialisatie op sessieniveau goedkoper en eenvoudiger dan rij- of
groepsvergrendeling, en geeft het een totale volgorde van versies.

### Commit
`commitCoopAction(userId, sessionId, {actionId, baseVersion?, lockToken?, operation})`:
1. Idempotentie: bestaat `(sessionId, actionId)` al, dan komt de opgeslagen delta
   terug zonder bijwerking (verloren ack, dubbel versturen).
2. `baseVersion > versie` wordt geweigerd; een oudere `baseVersion` is toegestaan
   omdat de operatie opnieuw tegen de gezaghebbende stand en de lock gevalideerd
   wordt (geen blind overschrijven).
3. Lock-controle: een verplaatsing/draaiing/verankering vereist een geldige lock
   van deze gebruiker; een verbinding vereist dat je één van de twee groepen
   vasthoudt en de ander niet door iemand anders wordt vastgehouden.
4. Engine-validatie (`validPuzzleStructure`, `findSnapConnection`).
5. De versie stijgt alleen bij een echte wijziging. De delta
   (`fromVersion`, `version`, `removed`, `upserted`, `connections`, `completedAt`)
   wordt in de actie bewaard.
6. Na de transactie: `puzzle:delta` (en eventueel `puzzle:locks`/`puzzle:completed`)
   naar de room, `streak_changed` naar de maker.

### Locks
- Eén vastgehouden groep per speler per sessie; lease standaard 20 s
  (`PUZZLE_LOCK_LEASE_MS`). De client vernieuwt tijdens lang slepen (elke ~5 s).
- Verlopen locks worden bij elke `acquire` lui verwijderd en door de scheduler
  opgeruimd. Een verloren verbinding, gecrashte tab of weggevallen instance kan
  een groep dus nooit langer blokkeren dan de lease; een clean disconnect geeft
  de locks van dat socket meteen vrij (andere tabs houden de hunne).
- Na een fusie wijst de lock naar de canonieke groep.
- Sleepbeweging (`puzzle:drag`) is vluchtig, begrensd (20/s per socket) en alleen
  voor groepen die dat socket zelf vasthoudt. Nooit opgeslagen.

### Synchronisatie
- Normaal: deltas van de room. De client past ze alleen toe als
  `delta.fromVersion` aansluit; anders volgt `sync`.
- `sync(version)`: de server levert een samengevoegde patch uit de opgeslagen
  deltas (`mergeDeltas`) of, als die niet volstaat, de volledige snapshot.
  Meting: een volledige snapshot is 24 KB bij 300 stukken, een delta ongeveer 150 byte.
- Presence via `io.in(room).fetchSockets()` (werkt over instances via de adapter).

### Persoonlijke zaken
Camera, selectie en hints zijn per speler. Een hint staat in
`PuzzleSessionParticipant.activeHint`, nooit in de gedeelde snapshot. Inbegrepen
hints volgen de moeilijkheid per speler; extra hints kosten één hint uit de eigen
voorraad (bevestiging, `gt: 0`-bewaking).

### Reeks
Een zelf gemaakte, geldige verbinding (of een verankering die verbindingen maakt)
levert via `recordLearningActivity` één claim per `puzzle-coop:<sessie>:<dag>`
(dag in de tijdzone van de speler) in dezelfde transactie. Verplaatsen, meekijken,
een hint of andermans verbinding telt niet. Er is geen vraag en geen XP. Na een gat
van meerdere dagen geldt de bestaande terugkeerregel; het is één claim per dag, dus
een terugkeerdag die meerdere activiteiten vraagt wordt in Samen niet door
meerdere verbindingen op dezelfde dag gehaald (bekende, bewuste beperking).

## 4. Tegen elkaar

**Wijziging correctieronde:** de wedstrijdregels hieronder zijn regelversie 2 (`PuzzleMatch.resultRules`).
De puzzel bepaalt tijd en geldigheid; de inhoudelijke vraag staat los van de uitslag. Zie ook §12.

- **Live**: lobby (`LOBBY`) → organisator start (minstens twee geaccepteerde
  spelers; wie niet accepteerde vervalt) → `startsAt` = servertijd + aftelling
  (5 s). Sessies voor alle spelers bestaan vanaf de start en delen variant, seed,
  beginverdeling en vraag. Acties vóór `startsAt` worden geweigerd.
- **Asynchroon**: de wedstrijd loopt vanaf het aanmaken (`RUNNING`). Elke speler
  drukt zelf op "Begin": op dat moment ontstaat de sessie en loopt de servertijd.
  Eén officiële poging: opnieuw "Begin" geeft dezelfde sessie en klok.
- **Officiële finish**: zodra de laatste geldige verbinding of bordverankering de puzzel
  volledig voltooit (engine-validatie, `applySoloAction`), legt `finishAttempt` in **dezelfde
  transactie** vast: status `FINISHED`, `finishedAt` = het canonieke `completedAt` van die commit,
  `elapsedMs = completedAt − startedAt`, hintgebruik en voortgang. De klok stopt daarmee
  onmiddellijk en niet pas wanneer de client iets ontvangt. Lockvolgorde wedstrijd → sessie →
  gebruiker (de wedstrijdrij wordt vóór de sessie vergrendeld via `SessionHooks.before`).
  Een retry met dezelfde `actionId` geeft de opgeslagen uitkomst terug: geen tweede finish, geen
  andere eindtijd, geen extra hintafschrijving en geen reeksclaim. Een finish die pas ná de
  `playDeadline` zou zijn vastgelegd wordt `DNF` (de engine weigert acties na de deadline sowieso).
- **Vraag**: één vooraf vastgelegde vraag en optievolgorde voor iedereen (`questionId`,
  `optionOrder` op de wedstrijd, gekopieerd naar de sessies). Ze volgt na de voltooide afbeelding
  maar verandert nooit tijd, rang, winnaar, geldigheid of voltooiingsstatus. Ze kan alleen de
  persoonlijke reeks verlengen: één antwoord per deelnemer (`answeredAt`, idempotent via
  `completeJigsaw(..., "m:<deelnemer>")`); goed → centrale reeksregel, fout of geen antwoord → geen
  reeksverlenging en nooit `INVALID`. De vraag kan later of nooit beantwoord worden ("Later
  beantwoorden") en blijft beantwoordbaar nadat de wedstrijd is afgesloten, omdat ze de uitslag niet meer
  beïnvloedt. Het juiste antwoord blijft verborgen tot de wedstrijd gesloten is of de speler het zelf goed had.
- **Uitslag**: snelste `elapsedMs`; tie-break eerder `finishedAt`, dan `userId`. Zichtbaar voor
  een speler pas als die zelf klaar is (puzzel voltooid) of de wedstrijd voorbij is. Live voortgang
  (aantal verbonden stukken) alleen tijdens live wedstrijden.
- **Deadlines**: live vervalt een lobby na 30 min, spelers die na 60 min nog bezig
  zijn worden `DNF`; asynchroon sluiten join (48 u) en spelen (72 u). Een puzzel die vóór de deadline
  voltooid is blijft geldig, ook als de vraag later komt. De scheduler (`runPuzzleMaintenance`) en
  `getMatch`/`resume` (lui) verwerken verlopen wedstrijden idempotent.
- **Reeks**: dezelfde regel als Solo via `completeJigsaw`; alleen een goed antwoord telt. Geen XP.

## 5. Toegang en autorisatie

- Uitnodigen kan alleen onder geaccepteerde vrienden (`areAcceptedFriends`), voor
  Samen alleen door de organisator, capaciteit = deelnemers + openstaande
  uitnodigingen + nieuwe ≤ 4 (rij-vergrendeld bij accepteren).
- Elke HTTP-route begint met `puzzleRouteUser()`: ingelogd, `jigsawEnabled` (of
  beheerder) en `jigsaw` in de actieve contentkeuze. De socket-handler controleert
  `jigsawEnabled`/beheerder (15 s gecachet) vóór join/sync/lock/renew/commit en elke
  service controleert zelf deelnemerschap (`FORBIDDEN`/`NOT_FOUND`).
- Een niet-deelnemer krijgt nooit sessie-, deelnemers- of uitslaggegevens.
- Zichtbaarheid van tijden: zie §4.

## 6. Realtime en live-datalaag

Datasignalen (`SOCKET_EVENT_TO_DATA_EVENT`): `puzzle_invites_changed` →
`notificationsChanged` + `gamesChanged`, `puzzle_match_changed` → `gamesChanged`.
Schermen halen data via `useLiveQuery` (scope `games`) en muteren via
`jsonMutation` met `invalidates`; geen eigen polling. Klokken die alleen
weergeven staan in `components/puzzle/serverClock.ts` (zonder data ophalen).

## 7. Notificaties

`notifyPuzzle` (`src/lib/notify.ts`) loopt via `notifyUser` en de bestaande
categorie "social" (uitschrijfopties, voorkeuren, push). Meldingen: uitnodiging
Samen (geaccepteerd, geweigerd, ingetrokken, puzzel af), uitnodiging wedstrijd
(live/asynchroon; geaccepteerd, geweigerd, ingetrokken), live wedstrijd gestart en
uitslag beschikbaar. Alleen bij een echte statusovergang, nooit per puzzelactie. Teksten in alle vijf de talen.
Er is geen aparte instelling toegevoegd; wie sociale meldingen uitzet krijgt ze niet.

## 8. Integratie

- `activeGames.ts` / `puzzle/activity.ts`: kinds `puzzle-coop` en `puzzle-match`:
  ontvangen en verstuurde uitnodigingen, lopende puzzels, "Begin jouw puzzel"
  (asynchroon geaccepteerd = `myTurn: true`), klaar-en-wachten (`myTurn: false`).
- `openActions.ts`/Vandaag: via dezelfde bron; "Begin jouw puzzelwedstrijd" als
  actie, "Verder puzzelen" als doorgaan.
- Kompas: `play.jigsaw` versie 4, vijf stappen (Samen en Tegen elkaar toegevoegd).
- Focus mode: `/jigsaw/samen/[id]` en `/jigsaw/wedstrijd/[id]` zijn focusroutes.

## 9. Configuratie (omgevingsvariabelen, alle optioneel)

`PUZZLE_COOP_INVITE_TTL_HOURS` (168), `PUZZLE_LOCK_LEASE_MS` (20000),
`PUZZLE_LIVE_COUNTDOWN_MS` (5000), `PUZZLE_LIVE_LOBBY_MINUTES` (30),
`PUZZLE_LIVE_MAX_MINUTES` (60), `PUZZLE_ASYNC_JOIN_HOURS` (48),
`PUZZLE_ASYNC_PLAY_HOURS` (72).

## 10. Schaal

Samen: 24/48/96/150/300 stukken. Tegen elkaar: 6/12/24/48/96. Bij 300 stukken is
het verkeer klein door deltas (±150 B per actie, 24 KB voor een volledige
snapshot). Metingen en de grenzen staan in het verslag.

## 11. Uitrol en terugdraaien

1. Migratie `20261026100000_puzzle_multiplayer` uitrollen (`prisma migrate deploy`).
   Additief; oude code negeert de nieuwe tabellen en kolommen.
2. Nieuwe versie van de app uitrollen op **alle** instances tegelijk (of
   achtereenvolgens): oude en nieuwe instances kunnen samen draaien, want het
   protocol is additief (nieuwe `puzzle:*` events); een oude instance kent de
   events simpelweg niet.
3. Redis moet bereikbaar zijn voor live aanwezigheid/deltas over instances heen.
   Zonder Redis werkt alles op één instance en vallen deltas tussen instances weg;
   clients herstellen dan via `sync`/live-data bij focus en bij elke actie.
4. Terugdraaien: eerdere app-versie terugzetten. De nieuwe tabellen blijven
   ongebruikt staan (geen destructieve migratie nodig); lopende gezamenlijke
   puzzels en wedstrijden zijn dan niet bereikbaar maar gaan niet verloren. De
   legpuzzel kan via `GameSettings.jigsawEnabled` volledig worden uitgezet; dat
   stopt ook de socket-acties van Samen.
5. Geen productie-contentreload en geen destructieve migratie nodig.

## 12. Overgang oude en nieuwe wedstrijdregels (correctieronde)

- `PuzzleMatch.resultRules`: **1** = oude regels (de klok stopt bij een goed antwoord; een fout antwoord
  geeft `INVALID` zonder geldige tijd), **2** = huidige regels. De migratie
  `20261029100000_puzzle_match_result_rules` voegt de kolom toe met default 1: alle bestaande wedstrijden
  (ook lopende) blijven onder de oude regels en worden nooit herberekend; opgeslagen `FINISHED`- en
  `INVALID`-uitslagen veranderen niet. Er is geen betrouwbaar voltooiingstijdstip in oude uitslagen,
  dus een oude `INVALID` wordt nooit automatisch geldig. Alleen nieuwe wedstrijden krijgen 2
  (`CURRENT_RESULT_RULES`).
- `PuzzleMatchParticipant.answeredAt` (nieuw, nullable): moment van de vraagbeantwoording; backfill
  uit `finishedAt` voor oude deelnemers die al antwoordden. `answeredCorrect` blijft de vraaguitkomst.
- De code houdt het oude pad (`answerMatch` voor versie 1) naast het nieuwe; de UI toont bij versie 1
  de oude uitslagteksten en bij versie 2 de nieuwe flow (tijd, daarna een losse vraag).
- Terugdraaien: een eerdere appversie negeert de nieuwe kolommen; nieuwe (versie 2) wedstrijden zouden dan
  onder de oude code vastlopen op de vraag. Rol terug alleen als er geen lopende versie 2-wedstrijden zijn.

## 13. Navigatie (correctieronde)

Terug in Legpuzzel 2.0 hangt nooit van browsergeschiedenis af (`src/lib/puzzle/navigation.ts`):

| Plek | Terug gaat naar |
|---|---|
| Catalogus/overzicht `/jigsaw` | Spelen (`/live`) |
| Solo: werktafel, voltooide afbeelding, resultaat | puzzelcatalogus; de vraag → voltooide afbeelding |
| Samen: werktafel, afgeronde puzzel | `/jigsaw` (verlaat de puzzel niet; "Puzzel verlaten" is een aparte actie met bevestiging) |
| Wedstrijd: uitnodiging, lobby, werktafel, resultaat | `/jigsaw` (geen reset, geen tweede poging, klok loopt, niet annuleren); de vraag → voltooide afbeelding |

Oorzaak van het oude gedrag: de multiplayerschermen zetten het terugdoel op het vaste pad `/jigsaw` terwijl
hun route dynamisch is (`/jigsaw/samen/[id]`, `/jigsaw/wedstrijd/[id]`), waardoor de override nooit paste;
`SubpageBackBar` kende die routes niet (geen balk) en de catalogus gebruikte `router.back()`. Nu herkent
`classifyPuzzleRoute` alle routes, wordt de bestemming met `replace` afgedwongen (`forceFallback`), en is er
één eigenaar van het terugdoel (`PuzzleBackTarget` of de gedeelde werktafel, nooit beide).

## 14. Overzichten

Eén indeling voor `PuzzleTogetherOverview`, Actieve spellen en Vandaag: uitnodiging → actief
(verder puzzelen) → wachten (klaar, anderen nog bezig; geen hervatbare actie) → afgerond (bekijk resultaat).
Een voltooide gezamenlijke puzzel of een afgeronde wedstrijd staat niet meer onder actieve puzzels; resultaten
(14 dagen in het overzicht, altijd via de link) blijven bereikbaar en geen historische gegevens worden verwijderd.
