# Native realtime — technische hardening en acceptatiecontrole

Opdracht van 23 oktober 2026, bestaande draft-PR #179 op `feat/native-socketbewijs`.
Gecontroleerde beginsituatie: `b88f28c4b160e6f45e66d68cd228cd514785e126`.
De eigenaar heeft de gerichte Prisma/PostgreSQL-uitbreiding expliciet goedgekeurd.
Dit is technische verificatie door Codex; de onafhankelijke heraudit is van ChatGPT.

De dubbele hintbeloning is structureel vervangen door canonieke vragen en
transactionele actieclaims voor **EXERCISES en CHAPTER_GUESS**. De oorspronkelijke
rode proef is behouden en aangescherpt met claim-/scoreasserties. Andere
spelengines krijgen hiermee geen algemene beveiligingsvrijgave. PR #176, #178
én #179 blijven draft en ongemerged; er is niets gedeployd of gepubliceerd.

## Autorisatie en commitmoment

De 60s-bewijzen blijven uitsluitend eenmalige handshakes; `NativeSession` blijft
de bron van waarheid. De bestaande controle bij verbinding, elk pakket en iedere
vijf seconden blijft behouden, evenals webcookies en de Redis-adapter.
Ook uitnodigen vereist nu expliciet een host of vastgelegde deelnemer; alleen
een vriendschap en kennis van de spelcode zijn daarvoor onvoldoende.

Een pakketcontrole geeft een asynchrone handler geen blijvend mandaat. Voor de
gecorrigeerde DB-mutaties is de grens de **commit van de transactie die ook de
sessie onder rijlocks valideert**. `commitSocketMutation` vergrendelt eerst de
betrokken User en daarna diens NativeSession, in dezelfde volgorde als
logout/refresh-replay. Binnen die transactie worden intrekking, verloop,
sessieversie, verplichte beveiligingsstappen en de beveiligingssnapshot getoetst.
Een revocation die eerst commit, verhindert de mutatie. Wint de mutatie de locks,
dan wacht intrekking tot die korte transactie commit of rollback uitvoert.

Alleen de betreffende gebruiker/sessie wordt vergrendeld, geen globale lock.
Lockwachten is begrensd op 1,5s, poolwachten op 2s en de transactie op 4s. Een
fout sluit de native socket; er is geen permissieve terugval. Contentladen en
notificaties vallen buiten deze korte transactie. De quiz gebruikt ook voor web
één echte transactie met een User-lock, op basis van de bestaande cookie-identiteit.
Web heeft geen native sessie of handshakebewijs nodig. Overige bestaande webcalls
naar de helper behouden hun bestaande gedrag.

Bij `join_game` volgt de synchrone spelers-/socketcache pas na de gecommitte
deelname; bij `cancel_game` zijn cacheverwijdering en notificaties gevolgen van
een gecommitte, opnieuw op host/lobbystatus getoetste verwijdering. Legitiem
gecommitte spelresultaten worden bij een latere logout niet teruggedraaid.

**Deze helper is geen automatische bescherming van andere handlers.** Tijdelijke
spelstatus heeft elders nog een commit in procesgeheugen en meerdere vervolgwrites.
Een synchroon lokaal statebesluit kan een geautoriseerde serververvolgactie
starten; dat bewijst geen duurzame, gedeelde commit over instanties. Met name
content-awaits vóór de eerste statewijziging en transacties zonder sessiebinding
blijven expliciet niet vrijgegeven.

## Matrix van alle geregistreerde spelhandlers

Inventaris: 69 inkomende eventnamen in vijf productiemodules, plus vijf
`disconnect`-handlers en de centrale timeropruiming. Aanvullende `socket.on`-gebruikers
onder `src/lib` zijn clients (`useLobbyExit`, live-data en native socketclient).
Fixture-events bestaan uitsluitend in de geïsoleerde testserver.

Categorieën: **1** lezen/signalen, **2** aanwezigheid/rooms/leases,
**3** spelstatus in geheugen, **4** PostgreSQL, **5** economie/reeks/prestaties.
Voor alle inkomende events komt de actor uit serverauthenticatie en loopt de
bestaande pakketcontrole vóór de handler. Specifieke bevoegdheden en commitgrenzen
staan hieronder; een inhouds-/deelnemerscheck vervangt geen actuele sessiecheck.

| Module en events | Cat. | Specifieke bevoegdheid, commit en herhaling |
| --- | --- | --- |
| gameServer: `activity_update`, `presence_settings_changed`, `friend_statuses_request` | 1,2 | Eigen user, privacy uit DB; activiteit lokaal. Geen spelbeloning. Async presence-notificaties zijn geen nieuwe spelactie. |
| `data_subscribe`, `data_unsubscribe` | 2 | Vaste topiclijst, eigen socket; join/leave herhaalbaar. |
| `friendship_changed`, `friend_profile_changed`, `scrabble_changed` | 1 | Relatie/vrienden/speldeelnemer uit DB; uitsluitend ververssignalen. Herhaalde uitnodigingssignalen mogelijk, geen scorewrite. |
| `join_game` | 2,3,4 | Code, bestaande deelnemer bij hervatten, lobbystatus; nieuwe deelname nu onder native commitfence. Uniek `(gameId,userId)`; geen late spookspeler. Zes racevarianten getest. |
| `add_guest`, `remove_guest` | 3 | Host, family-lobby, gaststatus; synchrone lokale state. Add is geen idempotente request met actionId. |
| `start_game` | 3,4 | De twee quizmodi: host/deelnemer onder User → NativeSession → LiveGame; canonieke vragen en rondepositie eenmaal in één commit. FAMILY_GAME behoudt eigen lokale engine. |
| `roll_dice`, `enter_physical_roll` | 3 | Huidige speler/host namens gast, dobbelmodus en waarde; positie wijzigt vóór async kaartladen. Pending-kaart/turnstate is lokaal, geen duurzame actionId. |
| `submit_family_answer`, `choose_event` | 3 | `canActFor`, pending-kaart. Antwoord heeft awaits vóór score/reset van pending; twee vertraagde antwoorden zijn niet transactioneel afgebakend. Vervolgcontrole nodig. |
| `submit_answer` | 3,4,5 | Canonieke open vraag, deelname en sessie onder rijlocks. ANSWER-claim, score, hintbonus en uitkomst delen één commit met deferred DB-controle. Retry retourneert opgeslagen uitkomst. |
| `use_hint` | 3,4,5 | HINT_USE-claim en afschrijving atomair; saldo > 0, geen EXPERT-hints. Effect en saldo-uitkomst opgeslagen; replay schrijft niets af en onthult geen tweede willekeurige hint. |
| `forfeit` | 3,4,5 | Quiz: geautoriseerde FINISHED-write onder Game-lock; uitslag uit duurzame deelnemers/claims, bestaande XP/reekssleutel. FAMILY_GAME blijft lokaal. |
| `invite_friend` | 1,4 | Nu expliciet host/vastgelegde deelnemer, lobby en geaccepteerde vriendschap binnen dezelfde korte native commitfence. Uniek `(gameId,toUserId)` voor de uitnodiging; notificaties zijn postcommit, niet als idempotente spelbeloning aangemerkt. Buitenstaanderweigering en toegestane host/deelnemerflow getest. |
| `cancel_game` | 2,3,4 | Host en lobby opnieuw bij de korte native deletecommit; unieke verwijdering. Gecontroleerde read → logout → hervatten faalt vóór fix en slaagt erna. |
| `leave_game` | 2,3,4 | Quiz: niet-host en actuele DB-lobby onder User/Session/Game-locks; pas na commit cacheverwijdering. Kan geen claims wissen door een achterlopende lobbycache. FAMILY_GAME behoudt eigen pad. |
| alleskenner: `ak:join`, `ak:solo_join` | 2,3,4 | Uitnodiging/bestaande deelnemer/seizoenslid of eigen solorun. Laden, taalkeuze en deelname hebben awaits; geen native commitfence bij domeinwrites. |
| `ak:set_role`, `ak:set_quizmaster`, `ak:set_length`, `ak:set_teams`, `ak:set_team`, `ak:set_leader` | 3 | Host in niet-startende lobby, seizoens-/teamregels. Synchrone lokale wijzigingen, geen directe beloning; geen instantie-overstijgende lobbyclaim. |
| `ak:start` | 3,4 | Host; `starting` blokkeert lokaal dubbele start. Contentkeuze/seenregistratie/setup bevatten awaits, geen gedeelde sessie-/startcommit. |
| `ak:leave` | 2,3,4 | Niet-host in gewone lobby; lokale deelnemerslijst vóór DB-delete. |
| `ak:stop`, `ak:pass`, `ak:tap_369`, `ak:type_puzzle`, `ak:tap_grid`, `ak:tap_gallery`, `ak:choose_door`, `ak:listen_done`, `ak:qm_369`, `ak:qm_puzzle`, `ak:qm_answer`, `ak:qm_gallery` | 3,4,5 | Host, quizmaster of leider/actieve deelnemer plus ronde-/pendingvoorwaarden. Meeste beslissingen synchroon lokaal; finish/solo/seizoensregistratie is async vervolg. Solo heeft conditionele IN_PROGRESS-claim; dat bewijst geen gedeelde multiplayer-state. |
| study: `st:join`, `st:invite` | 2,3,4 | Host/uitnodiging/bestaande deelnemer en vriendschap; awaits vóór deelname/uitnodigingswrites. Geen native commitfence. |
| `st:start_round` | 3,4 | Host, open sessie, geen ronde; inhoud-awaits vóór rondecreate. Lokale dubbele-rondecheck na laden, geen native DB-commitbinding. |
| `st:begin_questions`, `st:skip_reading` | 3,4 | Host, READING; DB-fasewijziging en optioneel bestaande leesprogressieservices. Geen XP voor enkel lezen; verschillende commits, geen globale sessiefence. |
| `st:answer` | 3,4,5 | Verwachte deelnemer, ronde/index/tijd, begrensde input. Antwoordmap vóór DB-create; unieke DB-antwoordsleutel en centrale beloningssleutel beschermen bepaalde herhalingen, niet de gehele flow over instanties. |
| `st:close_round`, `st:end`, `st:leave` | 2,3,4,5 | Host voor sluiten/einde; niet-host voor vertrek. Lokale `closing`/rondefase; async DB-/rewardvervolg, niet één gedeelde domeincommit. |
| quickMissionary: `qm:join`, `qm:invite`, `qm:leave` | 2,3,4 | Lobby/uitnodiging/deelnemer; LiveGame-rowlock in lobbyservice, vriendschap bij uitnodigen. Geen NativeSession-binding in die transactie. |
| `qm:sync`, `qm:clock` | 1,2 | Eigen room/klok; sync bouwt zicht op en kan presence/sweepgevolgen tonen. Geen nieuwe clientbeloning. |
| `qm:start` | 3,4 | Host; bestaande LiveGame-lock voorkomt dubbele matchcreate. Sessiegeldigheid wordt niet in dezelfde domeintransactie vastgelegd. |
| `qm:pos`, `qm:beat` | 2,3,4 | Eigen actieve deelnemer/life, begrensde visuele waarden, flush maximaal 1/s per room/user. `recordBeat` leest match/run en schrijft daarna conditioneel score/lastSeen; conditie toetst runstatus, geen native sessie. |
| puzzle: `puzzle:join`, `puzzle:sync` | 1,2,4 | Content en deelnemer. `getCoopState` schrijft ook lastSeen: dus niet uitsluitend lezen. Roomjoin volgt awaits. |
| `puzzle:lock`, `puzzle:renew`, `puzzle:release`, `puzzle:leave` | 2,4 | Deelnemer/eigen locktoken; rowlock of conditionele leasewrite. Disconnect geeft alleen eigen tokens vrij; lease verloopt ook zonder cleanup. Geen native sessiepredicate in de leasecommit. |
| `puzzle:commit` | 4,5 | Gedeelde PuzzleSession-lock, deelnemer, locktoken en `(sessionId,actionId)` met actorcheck. Snapshot/actie/bijdrage zijn transactioneel en replayvast. **Transactie ontvangt nog geen native sessiebinding**; domein-idempotentie sluit logout tijdens een await niet uit. |
| `puzzle:drag` | 2 | Eigen room/lease, ratebucket en contentcheck; uitsluitend tijdelijk. Na content-await geen nieuwe sessiefence, geen opgeslagen spelresultaat. |
| Alle vijf `disconnect`-handlers | 2,3,4 | Timer/socket/presence/leaseopruiming. Dit moet ook na intrekking kunnen lopen. QuickMissionary elimineert bij disconnect niet direct; sweeper is serververvolg. |

Uitgesloten is geen enkele race uitsluitend omdat een service een transactie
heeft. Evenmin is een stabiele XP-sleutel bewijs dat **hintvoorraad** idempotent is.
`finishActivity` gebruikt de bestaande unieke activiteitssleutel vóór XP/competitie.
De vroegere losse hintbonus in `registerAnswer` is verwijderd. De quiz-lobbyjoin
en het lobbyvertrek serialiseren nu ook met starten via de Game-lock: een oude
lobbycache mag na starten geen nieuwe deelnemer toevoegen of actiehistorie wissen.

## Reproduceerbare bewijzen

De bestaande runner maakt eigen PostgreSQL 16 en Redis 7, twee echte
Next/Socket.io-processen en synthetische accounts. Geen productieverbinding.

1. De fixture vertraagt uitsluitend een echte, reeds uitgevoerde LiveGame-read
   voor een synthetische `RACE…`-code. Redis bevestigt dat de echte handler na de
   pakketcontrole binnen is. De test commit intrekking, geeft de read vrij en
   wacht op het volledig terugkeren van de echte handler; geen timingaanname met
   een korte sleep. De barrière en completion-observer bestaan alleen in de fixture.
2. Zes `join_game`-tests: logout, oude refresh met ander actionId, account wissen,
   echte wachtwoordwijziging, nieuwe sessie en gelijktijdige oude acties op A/B.
   **Vóór fix alle zes rood; na fix alle zes groen.** Bij account wissen werd vóór
   fix de FK-fout ingeslikt en een spookspeler uitgezonden. De nieuwe sessie mag
   zelf vers deelnemen, maar legitimeert de oude wachtende actie niet.
3. `cancel_game`: read → gecommitte logout → vrijgeven. **Vóór fix lobby weg,
   na fix lobby behouden.** De eerste autorisatie was geen verwijdercommit.
   Een aparte autorisatietest controleert dat een bevriende buitenstaander niet
   namens een vreemde lobby kan uitnodigen en host/deelnemer dit wel kunnen.
4. Beide instanties laden dezelfde lobby, starten dezelfde synthetische vraag
   op index 0 en verwerken een juist antwoord van dezelfde gebruiker. De fixture
   wacht op het terugkeren van beide echte handlers. **Nulmeting: 2 hints; na
   herstel: 1 hint, 1 ANSWER-claim en 1 scorewijziging.** De test is niet geskipt,
   versoepeld of verwijderd. Twee onafhankelijke Node-processen delen dezelfde
   eigen PostgreSQL- en Redis-instanties.
5. Bestaande tien sockettests blijven behouden: 60s/GETDEL/replay, origins/cookies,
   rooms over Redis, logout/password/accountdelete, reconnect, refresh/replay,
   echte Redis-uitval en echte geblokkeerde PostgreSQL-controle. Een aanvullende
   domeintest blokkeert de deelname-upsert met een echte PostgreSQL-tablelock en
   laat de sessie tijdens die wacht vervallen; de eindcontrole moet de write
   terugrollen. Rijlocks alleen houden het verstrijken van tijd niet tegen.

Volledige herhaling: `npm run test:native:integration`. Alleen API/socket:
`npm run test:native:integration -- --no-browser`. De runner verzamelt nu ook
browserbewijs als een sockettest faalt en eindigt daarna nog steeds met foutstatus.
De suite is uitgebreid van 21 naar 47 sockettests. De uiteindelijke uitslag staat
in de verificatietabel hieronder en in Actions op de exacte PR-head.

## Capaciteit: berekening versus meting

Een gerichte test meet de echte `activeNativeSession`-aanroep met Prisma queryevents:
**twee SELECTs per controle** (NativeSession en gerelateerde User). De twee
primaire sleutels bestaan; de test legt ook EXPLAIN ANALYZE-plannen vast. Dit is
een kleine wegwerpdatabase, geen capaciteitsbenchmark of productieplanbewijs.
In de gerichte meting koos PostgreSQL een NativeSession-PK Index Scan en voor de
kleine User-tabel een Seq Scan. Er is geen claim dat beide reads altijd een
indexscan gebruiken; de User-PK is wel aanwezig.

| Gelijktijdige idle native sockets | Controles/s bij 5s | SQL SELECTs/s bij 2/check | Controles/min |
| ---: | ---: | ---: | ---: |
| 1.000 | 200 | 400 | 12.000 |
| 10.000 | 2.000 | 4.000 | 120.000 |
| 50.000 | 10.000 | 20.000 | 600.000 |

Dit is alleen de extra periodieke last. Elk inkomend pakket heeft eveneens een
controle; bij E events/s komen ongeveer `2 × E` SELECTs/s erbij. Handshakes,
HTTP, domeinwrites en de nieuwe korte commitfences komen daar bovenop. Er is geen
gemeten claim dat deze database 1.000, 10.000 of 50.000 sockets aankan.

- Lookup gebruikt de UUID-/User-PK, niet een scan over alle sessies als vereiste.
  Werkelijk plangebruik staat in de testoutput en hangt af van omvang/statistieken.
- `db.ts` specificeert geen poolmax; de gebruikte pg-pool default is 10 per
  Prisma-client. Aantal actieve clients/pools per proces en deployment is niet
  gemeten. Pool-/netwerkcapaciteit is geen afgeleide van de socketsom.
- Verbindings-/poolwachten is 15s; de native validator sluit na 2s. Die
  `Promise.race` annuleert de achterliggende SQL niet. Onder druk kan werk na
  socket-disconnect nog verbindingen gebruiken. Parallelle inkomende pakketten
  hebben geen gedeelde in-flight-check. Periodieke timers kunnen na massale
  connect/reconnect in dezelfde periode afgaan; dit geeft pieken en event-looplast.
- Een idle sessiecontrole doet geen Redis-roundtrip. Bewijsuitgifte/-verbruik en
  adapterverkeer wel. GETDEL is één claim, geen per-socket Redis-sessiekopie.
  Redis-uitval geeft geen lokale authentificatieterugval.
- Rowlocks van de correctie horen alleen bij de expliciet gecorrigeerde korte
  mutaties, niet bij iedere ghostpositie of iedere timer. Er is geen globale
  transactie om een volledige spelhandler heen gezet.

Schaalvoorstel, **niet geïmplementeerd**: eerst een geïsoleerde duur-/bursttest met
realistische events, SQL/poolwachttijden, timers en disconnect-latenties. Daarna
gebonden batches van sessie/User-controles per instantie, begrensd in-flight-werk,
jitter en daadwerkelijke queryannulering onderzoeken. DB-fouten blijven gesloten;
geen langer geldige permissiecache. Redis-intrekkingssignalen versnellen het
sluiten, maar vervangen de DB-autorisatie bij een definitieve domeincommit niet.
Een dergelijke wijziging wordt eerst als concreet ontwerp ter goedkeuring aangeboden.

## Oorzaak, canonieke vragen en transactionele acties

Voorheen koos iedere CHAPTER_GUESS-room willekeurige vragen in een lokale Map.
`askQuestion` opende alleen lokale state; `registerAnswer` bepaalde correctheid,
score en `answeredAt` lokaal en startte een losse, niet afgewachte hint-increment.
`use_hint` schreef eerst SQL af en zette pas daarna een lokale vlag. Zowel twee
processen als overlappende awaits konden daardoor dezelfde vraag meermaals betalen.
LiveGamePlayer had alleen een totale score, geen vraag- of actie-identiteit.
De bestaande StreakActivity voorkomt dubbele eind-XP, maar geen losse hintbonus.

Het bestaande LiveGame/LiveGamePlayer/HintBalance-domein blijft in gebruik:

- `LiveGame.quizIndex`: duurzame actuele ronde, null vóór canonieke quizstart.
- `LiveQuizQuestion`: PK `(gameId, questionIndex)`, een kleine JSON-snapshot van
  vraag/oplossing/opties/modus/niveau en benodigde weergavevelden; plus startedAt,
  deadline en revealedAt. Geen hele hoofdstukken, contentcollecties of mediabestanden.
  Exercise-antwoorden en hoofdstuk-ID's worden uitsluitend server-side gelezen.
- `LiveQuizAction`: PK **`(gameId, questionIndex, userId, actionKind)`**. ANSWER is
  één definitieve poging (ook een fout antwoord); HINT_USE is één hintverbruik.
  JSON bevat de definitieve correctheid/punten/score óf het hint-effect en het
  saldo op dat commitmoment. Geen socket-ID, clienttijd of proces-ID in de sleutel.
- FK naar de canonieke vraag én naar de bestaande deelnemer `(gameId,userId)`.
  Gameverwijdering cascadeert vragen/claims; accountverwijdering cascadeert de
  eigen deelnemers/claims. Andere gebruikersaldi en resultaten worden niet gewist.

`startLiveQuiz` bereidt content buiten de transactie voor en schrijft onder de
Game-lock de eerste canonieke vragenlijst en status/index. Een tweede start neemt
de reeds opgeslagen lijst over, inclusief antwoordopties en oplossing. De klok
voor vraagstart, deadline, score en voortgang komt uit PostgreSQL in UTC.

`actInLiveQuiz` haalt de actor uitsluitend uit de bestaande socketauthenticatie.
De volgorde is **User → NativeSession (alleen native) → LiveGame → eigen
LiveGamePlayer/actie**. Onder deze locks worden sessie, fingerprint, deelname,
spelmodus, actuele ronde en open vraag gecontroleerd. Dan volgen claim,
antwoordvalidatie, score en hintwijziging en definitieve uitkomst in **dezelfde
PostgreSQL-commit**. Geen Redis-aanroep of contentnetwerkwerk binnen de transactie.
Een conflicterende insert gebruikt ON CONFLICT DO NOTHING en retourneert de
bestaande uitkomst; geen tweede beloning. Er wordt geen tweede User-lock genomen
nadat de Game-lock vaststaat. De bestaande shop vergrendelt eveneens eerst User.
Systeemovergangen vergrendelen alleen Game en nemen geen User-/sessielocks.

Een correcte BEGINNER-/ADVANCED-hoofdstukraadactie verdient één hint; EXPERT en
EXERCISES geen. De bestaande 50–100 tijdsscore en hintkosten blijven behouden.
Een hint kost één voorraadpunt, nooit meer dan één per vraag. Saldo nul geeft
geen claim: na een latere aankoop kan dezelfde vraag alsnog een geldige hint
geven. Een replay retourneert de oorspronkelijke saldo-snapshot; die is geen
belofte dat het actuele saldo na andere aankopen/acties nog hetzelfde is.

### Commitfase en sessieraces

User-/NativeSession-locks serialiseren intrekking, refresh-replay,
wachtwoordwijziging en accountdelete met de actie. Een eerder gecommitte
intrekking sluit de actie uit; een reeds gecommitte actie wordt niet teruggedraaid.
De bestaande pakket-/idlecontrole en eindcontrole in de helper blijven aanwezig.
Ook klokverloop tijdens een lockwacht moet rollback geven.

Voor het tijdvenster tussen de laatste applicatiecontrole en COMMIT gebruikt de
migratie deferred constraint-triggers. Die controleren met PostgreSQL
`clock_timestamp()` de vraagdeadline en (voor native) de bestaande NativeSession,
User-versie en verplichte beveiligingsstatus. De helper geeft uitsluitend
**transactielokale** sessie-ID-/versiemetadata via set_config(..., true) door;
die verdwijnt bij commit/rollback en is geen persistent bewijs of sessiesysteem.
De gedeelde native predicate geldt ook bij quizstart/deelname/vertrek/opgeven via
LiveGame-/LiveGamePlayer-triggers. Zonder native binding volgt geen native-only
eis voor web. Andere spelmodi zijn voor die statetriggers uitgezonderd.

De test vertraagt expliciet de deferred COMMIT met pg_sleep en bevestigt via
pg_stat_activity dat PostgreSQL werkelijk in COMMIT wacht. Verloop van sessie of
vraag ná de applicatiecontrole moet claim, score en hint samen terugrollen.
Een aparte startproef vereist dat status, rondepositie en álle canonieke vragen
terugrollen wanneer de sessie in die commitfase verloopt.

### Meerdere instanties, retries en procesverlies

| Onderdeel | Autoriteit |
| --- | --- |
| Vragen, ronde/index, open/gesloten, acties, score, voorraad | PostgreSQL |
| Timers, socketsets en schermpresentatie | Tijdelijke procescache |
| Gebruikersnotificaties, overige realtime-events en intrekkingssignalen | Bestaande Redis/Socket.io-adapter |

`advanceLiveQuiz` sluit alleen de actuele vraag wanneer alle duurzame deelnemers
antwoordden of de deadline voorbij is. Na de bestaande revealpauze wordt de
volgende duurzame ronde geopend. Twee timers kunnen geen verschillende geldige
rondes maken. Iedere betrokken instantie ververst zijn quizcache maximaal elke
seconde met één in-flight-verversing per room en toont alleen de canonieke vragen.
Een verlaten lobby stopt die poller. Dit is geen gemeten capaciteitstest; deze
extra roomqueries komen bovenop de eerder beschreven sessiecontroles.

Nieuwe clients sturen questionIndex mee. Oudere payloads zonder index worden
gebonden aan de laatst aan die socket getoonde canonieke vraag; de bestaande
native transportlaag speelt geen gebufferde acties automatisch opnieuw af.
Alleen een expliciete index kan een historische retry na rondewissel aanduiden.
Een oude reeds geclaimde actie geeft dezelfde uitkomst; een ongeclaimde actie op
een gesloten/achterhaalde vraag wordt geweigerd. Reconnect vraagt een nieuw
handshakebewijs en hervat vanuit PostgreSQL, inclusief een reeds getoonde reveal.

Procesverlies vóór commit laat geen claim of saldo-/scorewijziging achter.
Na commit is de opgeslagen uitkomst leidend, ook zonder response of broadcast.
Een retry op een ander proces betaalt nooit opnieuw. De tests stoppen echte,
eigen Node-processen in beide vensters. Injectiefouten na claim/score of tijdens
hintafschrijving rollen de gehele transactie terug. Redis-uitval tijdens een
bestaande verbinding kan geen tweede SQL-beloning maken; nieuwe native bewijzen
blijven gesloten afwijzen. DB-intrekking blijft bij pakketten/commit geldig.

Eind-XP/reeks blijft de bestaande domeinservice met sleutel `live:${gameId}`
gebruiken, los van de korte antwoordcommit. De uitslag wordt voortaan uit duurzame
scores/ANSWER-claims opgebouwd; een achterlopende cache schrijft geen score terug.
Een opnieuw geladen FINISHED-quiz hervat ontbrekende eindregistratie. Een fout
wordt herprobeerd; alleen na succesvolle verwerking markeert de lokale cache
haar afronding als klaar. Een al uitgekeerde activiteit betaalt niet opnieuw.
Dit behoudt de bestaande spelregel dat deelname ook zonder gewonnen XP kan tellen.

## Migratie, bestaande data en rollback

Migratie: `prisma/migrations/20261203120000_live_quiz_actions/migration.sql`.
Additief en transactioneel: één nullable veld, twee tabellen, één enum,
PK-/FK-constraints, ondersteunende index en drie deferred guards met gedeelde
sessiepredicate. Geen saldo-/voortgangsbackfill of dataverwijdering.
Prisma-schema en gegenereerde client zijn gevalideerd; PostgreSQL-triggers staan
expliciet als normale migratie-DDL in versiebeheer.

De geïsoleerde migratieproef bewaart 155 bestaande tabellen, 449 constraints,
drie native auth-tabellen en synthetische bestaande gebruikers-/spelgegevens
(onder meer 7 hints, 11 XP en een score van 23). Een geïnjecteerde migratiefout
laat geen halve tabellen, kolommen of triggers achter; twee keer deploy behoudt
alle oude gegevens. Nieuwe FK-/unieke constraints en game-/accountcascades zijn
apart gecontroleerd. Er is uitsluitend tegen eigen wegwerpdatabases gemigreerd.

**Uitrolvoorwaarde voor de eigenaar, geen uitgevoerde deployment:** laat bestaande
IN_PROGRESS-geheugenquizzen op de oude servercohort afronden vóór overschakeling.
Hun vroegere willekeurige vraag is niet betrouwbaar uit de database te reconstrueren.
Nieuwe code weigert zo'n oude actieve quiz veilig te hervatten; hij wist niets.
Bestaande lobbyrecords kunnen wel onder de nieuwe code canoniek starten.

Oude en nieuwe backendprocessen mogen dezelfde actieve quiz niet samen verwerken:
oude code kan nog rechtstreeks hints incrementeren zonder actieclaim. De additieve
DDL maakt die oude bonuscode niet veilig. Drain de betrokken quizflow en wissel de
backendcohort als geheel; dit vereist geen oude appgegevens of voortgang te wissen.
Oudere clients blijven met de beschreven optionele index compatibel. Andere
spelmodi worden niet naar deze quizstructuur gemigreerd.

Bij rollback: blokkeer eerst nieuwe betrokken quizacties en laat verwerking
uitlopen/stoppen. Bewaar canonieke vragen en claims; zet niet de oude onbeschermde
bonuscode naast actieve nieuwe quizzen. Rol bij voorkeur voorwaarts met een
compatibele correctie. Geen DROP van gevulde actietabellen, reset, handmatige
saldocorrectie of productiemigratie is uitgevoerd. Het bewaren van de ledger is
essentieel om oude retries ook na een code-rollback niet opnieuw betaalbaar te maken.

## Testinventaris en werkelijk resultaat

- Nulmeting op b88f28c4: 20/21 sockettests; dubbele beloning **2 in plaats van 1**.
- Na transactioneel herstel: alle oorspronkelijke 21 tests groen, geen skip of
  versoepeling; vervolgens 44/44 sockettests, 30/30 API/accounttests, 43/43 native
  unittests en vier native browserformaten groen.
- Eindrun op de gewijzigde bron: **47/47 sockettests, 30/30 API/accounttests**,
  nul failures/skips. Inclusief extra start-/vraag-commitverloop en lobbyvertrek
  na start. De Actions-uitslag op de exacte gepushte head staat op PR #179.
- Nieuwe dekking: twee echte instanties, canonieke start, score-/hintreplay,
  fout antwoord, meerdere deelnemers/vragen, BEGINNER/ADVANCED/EXPERT/EXERCISES,
  cookie-webclient, saldo nul, reconnect/verloren response, beide procesuitvallen,
  antwoord-/hintrollback, Redis-uitval, zes intrekkingsvarianten, echte lockwacht,
  commitklokverloop, eind-XP/reeksherstel, unieke sleutel en account-/gamecascade.
- Overige lokale controles: 45/45 bestaande web-socketcontroles en 9/9 kaarttests;
  native pariteitscontrole en 6/6 inventaristests; 28/28 focus- en 13/13 profieltests;
  4/4 security-unitproeven; Prisma validate/generate, TypeScript, i18n-controle en
  schone productiebuild geslaagd. Productie-dependencyaudit: 0 kwetsbaarheden.
- Bestaande waarschuwingen afzonderlijk: ESLint 0 fouten/170 bestaande warnings;
  Tailwind meldt gemengde schermmaat-eenheden; de i18n-inventaris meldt bestaande
  ontbrekende vertalingen. De SQL-/Redis-fouten in de foutinjectietests zijn
  verwachte testcondities, geen genegeerde testfailures.
- Android-debugbuild, iOS-simulatorbuild en volledige browserregressies worden
  op de gepushte head door Actions gecontroleerd; links en uitslag staan op PR #179.
  Geen lokale Xcode/Android-SDK- of fysieke apparaatvalidatie geclaimd.
- Andere asynchrone handlers: zie matrix; FAMILY_GAME, Alleskenner, Study,
  QuickMissionary en Puzzle hebben hiermee **geen** algemene native commitfence
  of herbouwde multi-instance-engine gekregen. Aanwezigheidsreset/tellers blijven
  eveneens bestaande housekeeping, geen bewijs van volledige clusterconsistentie.

## Gewijzigde bestanden in deze herstelopdracht

- Domein/server: `src/lib/liveQuiz.ts`, `src/lib/native/socketMutation.ts`,
  `src/lib/chapterGuess.ts`, `src/server/gameServer.ts`.
- Database: `prisma/schema.prisma` en
  `prisma/migrations/20261203120000_live_quiz_actions/migration.sql`.
- Clients: `src/components/GameRoom.tsx`, `src/components/ChapterGuessGameRoom.tsx`.
- Tests: `tests/native-socket.integration.test.ts`, `tests/native-socket.test.ts`,
  `tests/fixtures/native-socket-server.ts`, `scripts/native/test-isolated.mjs`.
- CI: `.github/workflows/native-foundation.yml`.
- Rapportage: dit rapport, `docs/NATIVE-FEATURE-PARITY.md`,
  `docs/native-feature-parity.inventory.json`.

## Accountregressies, PR-keten en acceptatie

De bestaande 30 API/account/registratietests worden herhaald, niet gekopieerd.
Ze dekken reset-claim/replay/expiry/verkeerd doel/parallelle winnaar, intrekking
web én native, TOTP en opnieuw inloggen; registratie-/legacy-confirmatie,
parallelle claims, transactionele rollback, verkeerde credentials en webredirects.
De native browserproeven controleren lokale linkinvoer, history en opslag zonder
mailbewijzen. Deze tests toetsen de gecombineerde stack, niet productiegegevens.

GitHub-keten bij aanvang: alle onderstaande PR's OPEN/draft/ongemerged en
MERGEABLE tegen hun eigen base. Geen van deze acht heads staat als ancestor op
`main` (`8c59304775bcbbc61ff875b0c9b7bf7a72401d26`). Geen rebase of basewijziging.

| PR | Head bij aanvang | Base |
| --- | --- | --- |
| #170 | `6cfac36d` | `main` |
| #171 | `27dd6c14` | `feat/native-volledige-functionaliteit` (#170) |
| #172 | `f539692a` | `fix/native-sessiewisselingen` (#171) |
| #173 | `afb1362f` | `feat/native-gedeelde-navigatie` (#172) |
| #174 | `5680fe55` | `feat/native-accountcontracten` (#173) |
| #176 | `28c40b85` | `feat/native-buildcontrole` (#174) |
| #178 | `b5380b1b` | `feat/native-wachtwoordherstel` (#176) |
| #179 | `b88f28c4` | `feat/native-mailbevestiging` (#178) |

Er zijn nu geen gemelde mergeconflicten in die keten. Dat is een momentopname,
geen bewijs van gecombineerde functionele acceptatie met toekomstige main-wijzigingen.
Eventuele latere volgorde: **170 → 171 → 172 → 173 → 174 → 176 → 178 → 179**, pas na
de vereiste onafhankelijke beoordelingen, herstel van de blokkades en expliciete
merge-toestemming. De latere PR's horen na elke merge opnieuw tegen de actuele
base te worden gecontroleerd. #176/#178 worden niet stilzwijgend mee gemerged.

De PR-beschrijving bevat de uiteindelijke exacte head-SHA, alle Actions-links en
de werkelijke eindstatus. Oude groene of rode
CI op `b88f28c4` is geen bewijs voor de gewijzigde head. TypeScript, ESLint,
unittests, account-/socket-/webbrowserproeven, platformbuilds en productie-audit
worden afzonderlijk gerapporteerd; een failure wordt niet door andere groene
checks vervangen.

Fysieke iPhone/iPad/Android-tests ontbreken: echte Keychain/Keystore,
achtergrond/foreground, OS-kill, netwerkovergangen, toetsenbord/safe areas,
oriëntatie en echte OS-linkafhandeling. Simulator-/SDK-build en Chromium zijn
geen vervanging daarvan. Geen productie-/NAS-toegang, deployment, release of merge.

**Eindconclusie volgt uitsluitend na de eindtests en Actions op de gepushte head; onafhankelijke heraudit blijft vereist.**
