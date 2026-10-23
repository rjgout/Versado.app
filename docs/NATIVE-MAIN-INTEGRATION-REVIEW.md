# Native-integratie met main — 23 oktober 2026

Dit is een integratietest, geen merge-, deployment- of releasebesluit. De onafhankelijke audit van #179 geldt voor `70f2474f9515468e1658d29b5176c9937acb7f2e`.

## Vastgelegde uitgangspunten

Main: `ef5e5e4bb614e9685fa7f09ad4a1be465d340f7f` (#181, inclusief #186, #177 en #169).
Werkbranch: `test/native-main-integratie`; aparte worktree vanaf main, één merge van de volledige #179-geschiedenis. Geen cherry-picks/dubbel toepassen, bestaande branches en bases ongewijzigd.

| PR | Head | Base | Status |
|---|---|---|---|
| #170 | `6cfac36da677d9285c47f9c4746bb6d1c8990a7f` | `main` | OPEN, draft, MERGEABLE |
| #171 | `27dd6c148ee9514f5dba0b4beefd905be59233a1` | `feat/native-volledige-functionaliteit` | OPEN, draft, MERGEABLE |
| #172 | `f539692afbfafec24261910b31c208a8771650ff` | `fix/native-sessiewisselingen` | OPEN, draft, MERGEABLE |
| #173 | `afb1362f3aec744827a9455abce82f24a113f9ca` | `feat/native-gedeelde-navigatie` | OPEN, draft, MERGEABLE |
| #174 | `5680fe5539d1affc31f723aaedb850497d89fb9d` | `feat/native-accountcontracten` | OPEN, draft, MERGEABLE |
| #176 | `28c40b855e7c0110a27377ac30948617e6cc7576` | `feat/native-buildcontrole` | OPEN, draft, MERGEABLE |
| #178 | `b5380b1bbb7dd1f33f11b3e5885345d0bd19a527` | `feat/native-wachtwoordherstel` | OPEN, draft, MERGEABLE |
| #179 | `70f2474f9515468e1658d29b5176c9937acb7f2e` | `feat/native-mailbevestiging` | OPEN, draft, MERGEABLE |

Alle heads zitten aantoonbaar in #179 (`git merge-base --is-ancestor`); iedere opvolger bevat zijn voorganger. ReviewDecision is leeg, niet gelijk aan onafhankelijke goedkeuring. #171 heeft geen standalone checks; #172 alleen parity. Hun sessiewissel- en navigatietests worden opnieuw uitgevoerd op deze gecombineerde code. De overige bestaande heads hebben geslaagde relevante checks; die tellen niet als integratiebewijs.

## Integratie

Geen tekstconflicten. Alle 27 uitsluitend op main gewijzigde bestanden zijn byte-identiek behouden. Alleen CLAUDE.md, package.json, package-lock.json en nl.ts hadden wijzigingen op beide lijnen; die zijn gericht vergeleken. De drie-wegmerge behoudt alle main-only wijzigingen, waaronder cursusreparatie in `server.ts` en `seed.ts`, doeldatabasebevestiging, Nederlandse reeksbenamingen, profielcomponenten en instructies. `server.ts` blijft gelijk aan main; `initGameServer` registreert de native realtime-authenticatie via `setRealtimeServer`. Next.js en eslint-config-next zijn 16.4.2. Native scripts en API-contracten blijven behouden. Geen auth-/beloningsrefactor, geen verandering aan webcookies, Bearer, TOTP of Apple-identiteit.

De broninventaris wordt opnieuw gegenereerd wegens gewijzigde bronhashes. Dit verhoogt geen functiepariteitsclaim.

## Migratievolgorde en bewijs

De hoofdbranch bevat reeds migraties tot `20261126120000_feedback_token_rotation`, inclusief `20261125120000_native_auth_foundation`. De native keten voegt `20261127120000_native_security_setup` en daarna `20261203120000_live_quiz_actions` toe. Er is geen latere migratie. De quizguard verwijst naar NativeSession: hernoemen naar 23 oktober zou op een lege database vóór zijn afhankelijkheid komen.

De naam blijft daarom intact: toekomstige datumdelen zijn hier bestaande volgorde-identiteiten, geen wachttijd tot uitvoering. Prisma deploy voert alle ontbrekende migraties in lexicografische volgorde uit. De bekende uitvoeringen van de quizmigratie zijn geïsoleerde tests; er is geen toegang tot blijvende databases en dus geen claim over hun feitelijke migratieregister. De eigenaar bevestigde als status **onbekend**: er is geen productie-uitrol gerapporteerd, maar handmatige toepassing kan niet worden uitgesloten. Leescontrole door de eigenaar vóór uitrol: `SELECT migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name;` (geen wijziging en geen geheimen delen). Een eventuele latere naamswijziging vereist die bevestiging én een naam ná de bestaande afhankelijkheden. Geen productiecontrole of productiequery uitgevoerd. Nieuwe afhankelijke migraties moeten ná deze migratie sorteren.

`scripts/native/test-main-upgrade.mjs` haalt schema en migraties uit exact bovengenoemde main-commit, controleert byte-identieke bestaande SQL, maakt uitsluitend een eigen PostgreSQL-container, bewaart synthetische XP, hints, StreakDay, StreakActivity en historische spelscores, vergelijkt alle bestaande tabelkolommen vóór/na upgrade, herhaalt deploy en vergelijkt met een volledig verse database. De bestaande native suite controleert daarnaast foutrollback, unieke claims, cascades en deferred commit-triggers.

Prisma diff signaleert al op main bestaande verschillen: ActivityFeedItem.updatedAt-default; FsySettings.id-default; extra indexes op IntroExercise.lessonId, IntroExerciseAttempt.exerciseId/userId, IntroExerciseOption.exerciseId; ingekorte PuzzleVariant-indexnaam. De integratieproef vergelijkt het volledige diff met die echte main-baseline en weigert ieder nieuw verschil. Dit is geen claim dat het hele bestaande schema driftvrij is. Geen ongevraagde correctiemigratie voor deze bestaande afwijkingen.

## Technische verificatie

Resultaten en exacte integratie-SHA worden na de controles vastgelegd in de integratie-PR (een bestand kan zijn eigen commit-SHA niet bevatten). Actions moeten op die exacte head zijn uitgevoerd; oude #179-checks zijn geen bewijs. Native Foundation omvat 47 sockettests en native account-/sessie-/navigatie-/browserregressies. Aanvullend: contentarchitectuur/leesvoortgang/cursusidentiteit, volledige webbrowser/sockettests, security, parity, Android debug en iOS simulator. De aparte workflow `native-main-integration.yml` bewaakt de gepinde main-upgrade en main-terminologietests.

### Vastgelegde resultaten op geïntegreerde code

Integratiecommit (beide ouders, volledige code en testproef): `cc6b874001650fcca2dcf50aa3180ae16cdeae16`. Deze rapportage wordt daarna alleen documentair aangevuld; de uiteindelijke documentatie-head en de checks op die exacte head staan in [draft-PR #188](https://github.com/rjgout/Versado.app/pull/188). Geen zelfverwijzende SHA als vermeende eigen commit.

| Controle | Resultaat op integratiecode |
|---|---|
| main-upgrade + lege database | geslaagd; 158 bestaande tabellen behouden; herhaalde deploy; geen nieuwe drift |
| native units incl. #171/#172 | 43/43, geen skips |
| native API/account/registratie | 30/30, geen skips |
| native Socket.io, twee echte processen/PG/Redis | 47/47, geen skips; replay/reconnect/sessieraces/rollback/crash/commitguards |
| native browser + gedeelde webaccountflow | vier formaten; TOTP/herstelcodes/wachtwoord/reset/mail; geslaagd |
| focus / profiel / parity | 28/28, 13/13, 6/6 |
| terminologie/leescursusregels/cursusscripts | 39/39 |
| proxy/reeks/leerregels/studiescore | 28/28 |
| content/cursusintegratie/leesvoortgang/XP/reeks | lokale volledige study-content-suite geslaagd, zonder skips; ook vier-gebruikerscursusherstel en rollback |
| volledige webbrowser (Actions) | 28 shell/spelcombinaties, 48 contentkiezercombinaties, 80 profielchecks, 131 kaartchecks |
| web Socket.io / kaartunits (Actions) | 45/45 en 9/9 |
| Prisma validate/generate, TypeScript, schone productiebuild | geslaagd lokaal en Native Foundation |
| ESLint / productie-audit | 0 fouten, 170 bestaande waarschuwingen / 0 kwetsbaarheden |
| Android / iOS | echte debugcompilatie en simulatorcompilatie zonder signing geslaagd |

De eerste lokale native-browserstart miste de in de nieuwe worktree nog niet gebouwde CSS-bundel; na native:build/cap sync slaagt dezelfde suite ongewijzigd. Geen productfix of testversoepeling. Tailwind meldt de bestaande mixed-units-waarschuwing; i18n rapporteert de bestaande vertaaldekking. Prisma-baselinedrift staat hierboven expliciet vermeld.

Actions op `cc6b8740`:

- [Native Foundation](https://github.com/rjgout/Versado.app/actions/runs/39914071232)
- [Native parity](https://github.com/rjgout/Versado.app/actions/runs/39914071260)
- [Android en iOS](https://github.com/rjgout/Versado.app/actions/runs/39914071162)
- [Main-upgradebewijs](https://github.com/rjgout/Versado.app/actions/runs/39914071306)
- [Security/privacy](https://github.com/rjgout/Versado.app/actions/runs/39914071103)
- [Volledige webbrowser](https://github.com/rjgout/Versado.app/actions/runs/39914071183)
- [Admininventaris](https://github.com/rjgout/Versado.app/actions/runs/39914071276)
- [Betaalde hints](https://github.com/rjgout/Versado.app/actions/runs/39914071208)
- [Legpuzzel](https://github.com/rjgout/Versado.app/actions/runs/39914071226)
- [Docker build, zonder push](https://github.com/rjgout/Versado.app/actions/runs/39914071184)
- [Contentarchitectuur](https://github.com/rjgout/Versado.app/actions/runs/39914071198): eerste poging acht jobs groen, content-access overschreed 20 minuten. Cacheherstel wachtte circa tien minuten met melding `Egress is over the account limit`; browserinstallatie kostte nog ruim zes minuten. Geen rode assertie; afgebroken tijdens annotatiemigraties. Ongewijzigde herhaling gestart; actuele einduitkomst en alle checks op de uiteindelijke head worden in #188 vastgelegd. De timeout is niet verhoogd en geen test is geskipt.

## Uitrol- en rollbackdraaiboek — uitsluitend eigenaar

### Voorwaarden en voorbereiding

1. Na onafhankelijke mergeaudit en aparte toestemming: noteer werkelijk draaiende appbuild, alle backendinstanties, image-ID én immutable GHCR-digest, databaseversie en Prisma-migratieregister. Bevestig geen onbekende/failed migraties; controleer of de quizmigratie onverwacht al bestaat. Bewaar de vorige image lokaal en buiten de veranderlijke latest-tag.
2. Maak een actuele databasebackup en bewijs herstel op een aparte omgeving. Leg ook config/mounts/netwerken en versleutelingssleutels veilig vast zonder ze in rapport/logs te zetten. Geen reset of gegevenscorrectie.
3. Kies een onderhoudsvenster, communiceer einde spelstarts en verwachte onderbreking. Controleer alle LOBBY/IN_PROGRESS EXERCISES en CHAPTER_GUESS-spellen en hun deelnemers. Let op dat oude status alleen in geheugen kan zitten; database én aanwezige spelprocessen moeten overeenstemmen.
4. Geen gelijktijdige oude/nieuwe backendcohorten. Een Redis-broadcast of groene healthcheck bewijst geen veilige quizoverdracht.

### Ontbrekende drainvoorziening: minimaal voorstel, nog niet uitgevoerd

De huidige proxy blokkeert nieuwe HTTP/handshakeverzoeken in onderhoud, maar sluit bestaande geüpgradede WebSockets niet en kan hun start_game-pakketten niet blokkeren. De deploy-agent heeft geen quizdrain; hij stopt de container en verwijdert de onderhoudsvlag bij gezondheid, ook na automatische rollback. Alleen afspreken dat niemand start is geen afdwingbare drain.

Minimaal voorstel voor een afzonderlijk goedgekeurde voorbereidende patch op de **oude** backend: een gedeelde, expliciet door beheer ingestelde drainstatus; server-side weigeren van nieuwe starts en deelname die een nieuwe betrokken quiz creëert, terwijl bestaande IN_PROGRESS-spellen hun normale antwoorden/afronding behouden; status met actieve quiz-aantal per instantie; pas na nul actieve spellen verbindingen sluiten en alle oude processen stoppen. Dit is geen nieuwe multiplayerarchitectuur, maar mag niet stilzwijgend aan deze integratie worden toegevoegd. De eigenaar moet dit voorstel vóór een gegarandeerde verliesvrije productieomschakeling beoordelen. De nieuwe versie alleen voorzien van drain zou de oude processen niet beschermen.

Een volledige, gecontroleerde stop zonder actieve quizzen kan een alternatief zijn als de eigenaar de quiescente toestand aantoonbaar kan afdwingen. Bij twijfel: uitrol uitstellen, geen live-quizstatus repareren of wissen.

### Omschakeling na aantoonbare drain

1. Met de goedgekeurde drain actief: wacht op nul betrokken actieve quizzen, controleer dit op alle oude processen, sluit verbindingen en stop alle oude backends. Behoud database/Redisvolumes. Verifieer dat er geen oude replica of automatisch herstartende container overblijft.
2. Zet expliciet **handmatige** onderhoudsmodus aan en houd extern verkeer geblokkeerd; bevestig dat directe apppoorten niet publiek bereikbaar zijn. Gebruik tijdens deze bijzondere overgang niet de automatische deploy-/rollbackknop: `touchMaintenanceFlag` vervangt handmatige onderhoudsstatus en opent automatisch bij gezondheid.
3. Wissel de app via gecontroleerd beheer naar de goedgekeurde immutable image, met dezelfde config/mounts/netwerken. Bij containerstart draait `prisma migrate deploy` automatisch. Geen parallelle oude app, geen handmatige productiemigratie door Codex. Controleer migratielog, healthcheck, database en Redis en cursusreparatielog.
4. Houd publiek verkeer dicht tijdens acceptatie via een bestaande afgeschermde beheertoegang. Ontbreekt die toegang, laat die eerst door de eigenaar organiseren; geen publieke apppoort als workaround. Start pas daarna andere instanties van exact dezelfde versie.
5. Pas na geslaagde functionele acceptatie handmatige onderhoudsmodus bewust uitzetten. Monitor fouten en spel-/authreconnects.

### Acceptatie door eigenaar

Weblogin en native Bearer-login; verplichte TOTP/setup en Apple waar geconfigureerd; wachtwoordherstel en e-mailbevestiging; nieuw socketbewijs bij reconnect; nieuwe quiz met meerdere gebruikers; twee retries van hetzelfde correcte antwoord met één claim, één hintbonus en één score; hintverbruik eenmaal, geen negatief saldo; XP/reeks bij afronding eenmaal; database/Redis; lezen/cursussen/cursusidentiteit. Noteer build-SHA en resultaten. Geen volledige native game-UI-pariteit veronderstellen.

### Rollbackbeslissingen

- **Start mislukt vóór nieuwe functionaliteit:** handmatig onderhoud blijft aan, controleer migratiestatus. Als geen nieuwe quizacties bestaan en oude quizzen vooraf gedraind zijn, beoordeel oude imagecompatibiliteit met het additieve schema voordat de eigenaar de vastgelegde digest kiest. Niet automatisch vrijgeven.
- **Migratie toegepast maar app faalt:** oude image terugzetten draait SQL niet terug. Bij failed Prisma-registratie eerst gerichte diagnose/compatibele herstelpatch; niet blind migrate resolve/reset/down uitvoeren. Backup is een herstelmiddel, geen toestemming om nieuwe voortgang terug te draaien.
- **Nieuwe acties reeds opgeslagen:** geen functionele terugval naar de oude bonuscode. Stop nieuwe spelacties, sluit alle verbindingen en houd publiek verkeer dicht. Behoud de volledige ledger en database. Herstel met een compatibele versie die canonieke vragen en claims respecteert. Als tijdelijk een oude image voor diagnose nodig is, blijft deze geïsoleerd van gebruikers en sockets; geen gedeeltelijk publiek bedrijf dat quizacties kan bereiken.

`last-good` van de agent is na een succesvolle update de nieuwe image, niet gegarandeerd de vorige. Een groene healthcheck mag in geen van deze foutgevallen de functionele vrijgave vervangen. Geen destructieve downmigratie en geen ledgerverwijdering.

## Native releasegrens en mergeadvies

Releaseprofiel blijft geblokkeerd; alleen Android-debug en iOS-simulator zonder signing. Geen storepublicatie. Niet-native functies blijven expliciet in de inventaris. Fysieke iPhone/iPad/Android-tests (Keychain/Keystore, levenscyclus, netwerkwissel, links, toetsenbord/orientatie) blijven een aparte releasevoorwaarde.

Voorgestelde volgorde blijft #170 → #171 → #172 → #173 → #174 → #176 → #178 → #179. Iedere echte merge vereist toestemming, onafhankelijke review en opnieuw controle op de dan actuele base/head. Werk bij iedere stap zo nodig de broninventaris opnieuw bij tegen die base: de gecombineerde groene inventaris bewijst niet dat een eerdere stacked head na een basewissel automatisch actueel blijft. De tijdelijke integratie-PR vervangt geen bestaande PR en mag niet worden gemerged. Geen force-push/basismodificatie. De integratietestbestanden en inventarisupdate moeten vóór een latere definitieve merge gecontroleerd naar de juiste featurebranch worden overgenomen; deze reviewbranch is geen alternatieve productielijn.

Open uitrolvoorwaarde: afdwingbare drain of aantoonbaar quiescente volledige stop, herstelbare backup en eigenaarsacceptatie. Andere asynchrone spelmodi krijgen door deze integratie geen nieuwe transactionele garantie; zie NATIVE-SOCKET-HARDENING.md.
