# Native realtime — technische hardening en acceptatiecontrole

Opdracht van 22 oktober 2026, PR #179 op `feat/native-socketbewijs`.
Gecontroleerde beginsituatie: `925f4d305ed23362dc81794c0274ee7f8a1e68ce`.
Dit is technische verificatie door Codex; de onafhankelijke heraudit is van ChatGPT.

**Nog niet klaar, met concrete blokkades.** De bewezen deelname- en
annuleringsrace zijn gericht gecorrigeerd. De live-quiz kan over twee instanties
nog steeds dezelfde vraag tweemaal met hintvoorraad belonen. De nieuwe test
verwacht één beloning en blijft daarvoor rood. Een groen resultaat van andere
controles is geen acceptatie van deze fout, alle spelmutaties of native pariteit.

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
notificaties vallen buiten deze korte transactie. De webauthenticatie verandert
niet; web gebruikt de bestaande client zonder de native sessielocks.

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
| `start_game` | 3,4 | Host/lobby; statewijziging en DB-/timervervolg. Geen gedeelde startclaim over instanties: dubbele start bewezen in beloningsproef. |
| `roll_dice`, `enter_physical_roll` | 3 | Huidige speler/host namens gast, dobbelmodus en waarde; positie wijzigt vóór async kaartladen. Pending-kaart/turnstate is lokaal, geen duurzame actionId. |
| `submit_family_answer`, `choose_event` | 3 | `canActFor`, pending-kaart. Antwoord heeft awaits vóór score/reset van pending; twee vertraagde antwoorden zijn niet transactioneel afgebakend. Vervolgcontrole nodig. |
| `submit_answer` | 3,4,5 | Deelnemer en lokaal `answeredAt` voorkomen herhaling binnen dezelfde room. Hintbonus is een losse User-increment; **geen gedeelde vraagclaim, bewezen dubbele beloning op twee instanties**. |
| `use_hint` | 3,4,5 | Deelnemer, niveau, lokaal gebruikt-vlaggetje; SQL `hintBalance > 0` voorkomt negatief saldo, maar bewijst niet één afschrijving per vraag. Vlag wordt na await gezet; niet vrijgegeven voor dubbele events/instanties. |
| `forfeit` | 3,4,5 | Huidige room/partij; lokale FINISHED-vlag voorkomt dubbele lokale afronding. XP/reeks via centrale activiteitssleutel; roomstate zelf niet gedeeld. |
| `invite_friend` | 1,4 | Nu expliciet host/vastgelegde deelnemer, lobby en geaccepteerde vriendschap binnen dezelfde korte native commitfence. Uniek `(gameId,toUserId)` voor de uitnodiging; notificaties zijn postcommit, niet als idempotente spelbeloning aangemerkt. Buitenstaanderweigering en toegestane host/deelnemerflow getest. |
| `cancel_game` | 2,3,4 | Host en lobby opnieuw bij de korte native deletecommit; unieke verwijdering. Gecontroleerde read → logout → hervatten faalt vóór fix en slaagt erna. |
| `leave_game` | 2,3,4 | Niet-host, lobby; eigen deelnemer. Tijdelijke cache en DB-delete zijn nog verschillende stappen. |
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
`finishActivity` gebruikt de bestaande unieke activiteitssleutel vóór XP/competitie;
de losse bonus in `registerAnswer` loopt daar niet doorheen.

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
   wacht op beide echte User-increments. **Gemeten bonus: 2; vereist: 1.** De test
   is niet geskipt of aangepast om de fout groen te kleuren.
5. Bestaande tien sockettests blijven behouden: 60s/GETDEL/replay, origins/cookies,
   rooms over Redis, logout/password/accountdelete, reconnect, refresh/replay,
   echte Redis-uitval en echte geblokkeerde PostgreSQL-controle. Een aanvullende
   domeintest blokkeert de deelname-upsert met een echte PostgreSQL-tablelock en
   laat de sessie tijdens die wacht vervallen; de eindcontrole moet de write
   terugrollen. Rijlocks alleen houden het verstrijken van tijd niet tegen.

Volledige herhaling: `npm run test:native:integration`. Alleen API/socket:
`npm run test:native:integration -- --no-browser`. De runner verzamelt nu ook
browserbewijs als een sockettest faalt en eindigt daarna nog steeds met foutstatus.
De suite bevat 21 sockettests; één bekende beloningsblokkade is geen succesvolle suite.

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

## Nog benodigde gerichte ontwerpkeuze

De beloningsfout kan niet betrouwbaar met alleen een Redis `SET NX` vóór een
losse SQL-increment worden hersteld: proces-/DB-falen tussen die stappen verliest
de beloning of maakt een retry opnieuw betaalbaar. De bestaande LiveGamePlayer
heeft geen duurzame claim per vraag/actie. De StreakActivity-tabel voor een
losse hintbonus misbruiken zou de betekenis van de leerregistratie veranderen.

Voorstel voor afzonderlijke goedkeuring: sla de canonieke live-vragen en een
actieclaim met unieke sleutel `(gameId, questionIndex, userId, actionKind)` in
PostgreSQL op. Laat de bestaande domeinservice sessiecontrole, claim, score en
voorraadwijziging in één transactie uitvoeren, met vaste domein/User/NativeSession-
lockvolgorde en een geteste wisselwerking met accountcascade/delete. Een replay
retourneert de eerdere uitkomst. Pas na commit volgt Redis-broadcast/cache.
Dezelfde centrale guard moet bij de nog onbewezen asynchrone domeincommits
worden aangesloten; geen gekopieerde autorisatie in iedere eventlistener.

Dit vraagt een datamodel-/migratiebesluit en raakt gedeelde spelautoriteit. De
opdracht verbiedt databasewijzigingen zonder voorafgaande toestemming en vraagt
goedkeuring vóór ingrijpende architectuurwijzigingen. Daarom zijn **geen** nieuwe
tabellen, migraties, gedeelde spelstate of globale locks geïntroduceerd. Ook de
overige gemarkeerde async-paden krijgen geen groen acceptatieoordeel op basis van
alleen de drie gewijzigde handlers. De nieuwe User/sessie-lockvolgorde mag niet
blind om bestaande domeintransacties worden gezet: onder meer match/run/user-
locks en accountcascade moeten gezamenlijk op deadlocks en rollback worden getest.

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
| #179 | `925f4d30` | `feat/native-mailbevestiging` (#178) |

Er zijn nu geen gemelde mergeconflicten in die keten. Dat is een momentopname,
geen bewijs van gecombineerde functionele acceptatie met toekomstige main-wijzigingen.
Eventuele latere volgorde: **170 → 171 → 172 → 173 → 174 → 176 → 178 → 179**, pas na
de vereiste onafhankelijke beoordelingen, herstel van de blokkades en expliciete
merge-toestemming. De latere PR's horen na elke merge opnieuw tegen de actuele
base te worden gecontroleerd. #176/#178 worden niet stilzwijgend mee gemerged.

De PR-beschrijving bevat de uiteindelijke exacte head-SHA, alle Actions-links en
de werkelijke eindstatus (inclusief de falende beloningsregressie). Oude groene
CI op `925f4d30` is geen bewijs voor de gewijzigde head. TypeScript, ESLint,
unittests, account-/socket-/webbrowserproeven, platformbuilds en productie-audit
worden afzonderlijk gerapporteerd; een failure wordt niet door andere groene
checks vervangen.

Fysieke iPhone/iPad/Android-tests ontbreken: echte Keychain/Keystore,
achtergrond/foreground, OS-kill, netwerkovergangen, toetsenbord/safe areas,
oriëntatie en echte OS-linkafhandeling. Simulator-/SDK-build en Chromium zijn
geen vervanging daarvan. Geen productie-/NAS-toegang, deployment, release of merge.

**Technische conclusie: nog niet klaar, met concrete blokkades.**
