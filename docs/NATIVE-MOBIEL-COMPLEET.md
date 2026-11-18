# Mobiel compleet maken: verwerking TestFlight-feedback (eerste oplevering)

Bron: de eerste TestFlight-ronde van de eigenaar (29 van 59 controlepunten afgevinkt). Niet-afgevinkte punten
zijn niet automatisch defecten; elke bevinding is eerst tegen de code gelegd en ingedeeld in:
**(a)** defect, **(b)** bewust nog ontbrekend, **(c)** er maar niet bereikbaar, **(d)** gegevens/instelling op de server.
Er is niets op een echt toestel getest; de eigenaar doet de fysieke iPhone-tests (zie "Acceptatie").

## Bevindingen en uitkomst

| # | Bevinding | Indeling | Oorzaak (uit de code) | Gedaan in deze oplevering |
|---|---|---|---|---|
| 1 | Reeks-/XP-/divisiechips bovenaan doen niets | (b)+(a) | `NativeShellHeader` zette `interactive={false}`: native had geen `/streak`, `/xp`, `/competition`. De chips bleven wel zichtbaar. | Die drie schermen zijn de bestaande gedeelde clients (`StreakClient`, `XpHistoryClient`, `LeaderboardClient`) in een dunne native schil (`NativeProgressView`); data via de toegestane spelbrug (`streak`, `xp-history`, `leaderboard`, alleen GET). De chips zijn aantikbaar zodra `games-v1` + realtime beschikbaar zijn. |
| 2 | Terug-knoppen | open UX-probleem, deels opgelost, **niet bewezen opgelost** | Zie "Terugnavigatie": de systeemterugknop sloot alleen `<dialog open>` (de meeste modals zijn `div role=dialog`) en gebruikte een andere terugval dan de terugbalk. | Beide gecorrigeerd en met scenariotests vastgelegd. Of de melding van de eigenaar hiermee verdwenen is, blijkt pas op de iPhone. |
| 3 | Cursusoverzicht alleen-lezen | (b) | `NativeLearningView` toonde `CoursesView` zonder `hide/move/add`. | Eén gedeelde hook `useCourseManagement` (nu ook gebruikt door `CoursesClient`): Verbergen (`unsubscribe`, alleen `subscribed` uit: voortgang en inhoud blijven), Cursus toevoegen (`subscribe`, achteraan), Eerder/Later (`UserListOrder` "courses"). Spelbrug: twee POST-routes erbij; `list-order` PUT bestond al. |
| 4 | Alleen computerstem | (d), mogelijk (c) | Zie "Audio". Eén echt zwak punt: een weggevallen bron was onzichtbaar. | Elke weggelaten bron krijgt een vaste, privacyvrije reden in het serverlog; de speler meldt "geen opgenomen audio op de server" bij alleen toestelstem. De bestaande keuze Opgenomen audio / Stem van dit toestel was er al en verschijnt zodra een bron bestaat. |
| 5 | Snelle Zendeling niet in Spelen | (d) | Geen native defect. `quickMissionaryEnabled` staat standaard **uit** (migratie `20261011120000`) en `isGameVisible` negeert ook admins. Daarnaast bestaat de `GameContentScope` alleen voor werken `bofm`, `dc-testament`, `pgp`. De route `/snelle-zendeling` is in de spelbrug aanwezig. | Geen codewijziging. Actie eigenaar: Adminbackend → Spellen → Snelle Zendeling aanzetten in de testomgeving en een schriftbron kiezen waarvoor het spel een scope heeft. |
| 6 | Uitnodigingen/Activiteit/Competitie | gedeeltelijk (c)/(b) | Competitie nu lokaal (zie 1). `/activity` en `/groups` hebben nog geen native scherm. | Competitie opgelost; rest in het vervolgplan. |
| 7 | Hulpmiddelen | (b) | `/tools`, `/tools/dictionary(+[word])`, `/tools/persons`, `/tools/xp-guide`; de hub en persons/xp-guide zijn server-pagina's met Prisma (niet direct herbruikbaar), het woordenboek is een client (`DictionaryClient`) met al toegestane bridge-route `dictionary/[word]`. | Alleen inventaris; zie vervolgplan. |
| 8 | Testvrienden | n.v.t. | — | Losse testset met twee inlogidentiteiten en alle vriendschapsscenario's; zie "Testvrienden". |
| 9 | CFM | gepauzeerd | — | Niet aangeraakt. |

## Audio: waarom hoor je alleen de toestelstem?

Het native audiopad (`src/lib/native/audio.server.ts`) neemt alleen een bron op als de server die kan bewijzen. Per taal geldt:

* **Opname (Audio V2)**: de opname moet toegankelijk zijn, bij dit hoofdstuk horen, **gepubliceerd** zijn op `chapter:<id>` (`AudioPublication`), en het bestand `objects/<sha256>.mp3` moet bestaan in `AUDIO_DIR`, met kloppende hash en grootte.
* **Oude opname (legacy)**: `Chapter.audioUrl` moet naar de eigen server gespiegeld zijn (`/api/audio/<bestand>`, `mirrorChapterAudio`), er moet een `ChapterAudioCheck` bestaan met status `CURRENT` en een tekst-hash die bij de huidige verzen past (anders is het hoofdstuk "ter controle"), en elk vers heeft een starttijd nodig.
* Voldoet een bron niet, dan valt hij weg en blijft alleen de toestelstem over. Het web is hier minder strikt (speelt legacy-audio ook zonder `ChapterAudioCheck`); dat verschil is bewust (native bewijst ook de tekstovereenkomst) en is **niet** versoepeld.

De meest waarschijnlijke oorzaak voor "alleen computerstem" is een **testbackend zonder NAS-audio**: de proxy/testserver die de TestFlight-build gebruikt heeft vermoedelijk een lege of afwijkende `AUDIO_DIR`, geen gespiegelde legacybestanden of geen `ChapterAudioCheck`/`AudioPublication`-rijen. Dit is vanuit de code niet te bewijzen. Controleer in het serverlog (zoek op `[native-audio] bron weggelaten`) welke reden per hoofdstuk wordt gegeven:

| Reden | Wat te doen |
|---|---|
| `bestand_ontbreekt_op_server` | Audiobestand staat niet in `AUDIO_DIR` van deze omgeving (NAS-volume niet gekoppeld). |
| `oude_audio_niet_gespiegeld_naar_server` | `npm run audio:mirror` (of seed) is niet gedraaid; `Chapter.audioUrl` wijst nog naar de kerkbron. |
| `geen_audiocontrole_vastgelegd` / `tekst_wijkt_af_van_audiocontrole` / `tekst_gewijzigd_audio_ter_controle` | `ChapterAudioCheck` ontbreekt of het hoofdstuk is ter controle (Adminbackend → audiocontroles). |
| `opname_niet_gepubliceerd` / `opname_niet_toegankelijk` / `opname_hoort_bij_ander_hoofdstuk` | Geen `AudioPublication` voor dit hoofdstuk of opname niet vrijgegeven. |
| `versmarkeringen_ontbreken` / `versmarkeringen_onvolledig` | Verstijden ontbreken voor het gevraagde bereik. |

**Diagnostiek is geen werkende opname.** Wat deze PR oplevert is zichtbaarheid (log + melding in de speler), géén bewijs dat NAS-opnames in de app klinken. Pas wanneer in de testomgeving een hoofdstuk in de speler "Opgenomen audio" aanbiedt én op de iPhone daadwerkelijk de opname afspeelt, is dat aangetoond; dat is nog niet gebeurd en is een eigenaartest.

Er is **geen** nieuwe audiobron, directe link of tweede audiosysteem toegevoegd en niets is als beschikbaar gepresenteerd dat niet bewezen is.

## Testvrienden (alleen afgeschermde dev-/testomgeving)

`scripts/test-accounts/seed-synthetic-friends.ts` maakt een **volledig losstaande** set; er wordt nooit een bestaand account aangepast.
Vijf vaste accounts, allemaal `@example.invalid`:

| Account | Inlog | Vriendenlijst |
|---|---|---|
| Test A | ja | 1 bestaande vriend (TestVriend), 1 **inkomend** verzoek (van TestVerzoekIn), 1 **uitgaand** verzoek (naar TestVerzoekUit) |
| Test B | ja | **leeg**, geen relatie met Test A (zelf verzoek sturen en accepteren; tweede toestel) |
| TestVriend, TestVerzoekIn, TestVerzoekUit | nee | tegenpartijen |

De wachtwoorden van A en B zijn willekeurig en worden één keer op stdout getoond (niet bewaard; opnieuw tonen kan niet: verwijderen en opnieuw aanmaken).
Aanmaken gebruikt `createAccount`, de uitnodigingsroute (`becomeFriendsViaInvite`) en de dienst achter `/api/friends/request` (`createFriendRequestOnce`).

**Beveiliging: een omgevingsvariabele is bewust geen toestemming.** Het script weigert tenzij álle feiten uit de database en omgeving kloppen (`scripts/test-accounts/guard.ts`):
1. de database draagt het testmerk dat de eigenaar eenmalig zelf zet: `COMMENT ON DATABASE "<naam>" IS 'versado-test-omgeving';` (niet via app, migratie of seed te zetten);
2. de databasenaam bevat een los `test` of `dev`;
3. `APP_URL` is geen productiedomein (`versado.app`, `jehova.app`);
4. de database heeft al gebruikers (anders zou `createAccount` het eerste testaccount beheerder maken);
5. voor wijzigen: `--apply` én de letterlijke `--verwacht-database=<host>:<poort>/<database>`.
Verwijderen werkt uitsluitend op de vijf exacte e-mailadressen (geen `deleteMany`). Gebruik: dry-run `npx tsx scripts/test-accounts/seed-synthetic-friends.ts`; toepassen met `--apply --verwacht-database=…`; opruimen met `--verwijder --apply …`. Niets in seed, migratie, deployment of app-start roept dit aan (bewaakt door `tests/synthetic-test-accounts.test.ts`). Lokaal geprobeerd tegen een eigen wegwerp-Postgres: weigeringen zonder merk/bevestiging/met productiedomein, aanmaken (3 relaties correct), tweede keer weigeren, opruimen.

## Terugnavigatie (onderzoek en bewijs)

Mechaniek: `NativeNavigator` (hashgeschiedenis, `back(fallback)`: met geschiedenis naar het vorige scherm, zonder naar de terugval). Tabwissels zijn `push`.
Gevonden en gecorrigeerd:
* **Systeemterug sloot alleen `<dialog open>`.** De meeste modals (Vrienden, Activiteit, FriendPicker, Chapter-popup, bevestigingen, feedback) zijn `div role="dialog" aria-modal="true"`; Android-terug navigeerde dan weg terwijl het venster open stond. Nu sluit terug eerst het bovenste modale venster (Escape, zoals op het web; `modalBack.ts`).
* **Twee verschillende terugvallen.** De terugbalk kende de logische bovenliggende route, de systeemterugknop viel altijd op Vandaag. Nu één bron: `backTarget.ts` (`nativeBackFallback`), voor profielsubschermen, lessen, spelen, vrienden, cursusroutes en tabhoofdschermen (nooit op zichzelf terugvallen).
Scenariotests (`tests/native-back-navigation.test.ts`, 8 stuks): tabwissels, detail vanaf een tab, heropening/deeplink zonder geschiedenis voor 24 routes, profielketen, navigatiebewaker, modale sluiting, gedeelde bron.
**Niet bewezen:** dit is getest tegen de navigator en DOM-stubs, niet op een toestel. Tabwissels blijven `push`, dus terug na meerdere tabwissels loopt de tabgeschiedenis terug; of de eigenaar dat als logisch ervaart (alternatief: per-tab-stapels) is een productbeslissing na de iPhone-test. Controleer op het toestel: terug na tabwissels, vanuit een profielsubscherm, vanuit een les, vanuit een spel, met een open venster, en iOS-veeggebaar.

## CI en beveiliging rond deze PR

* `ios-glass-evidence` werd **geannuleerd, niet gefaald**: het stopte na ~9 minuten in de stap "Meetapp bouwen" (simulator meldde nog "Waiting on System App"), ruim voor de timeout van 35 minuten; er was geen concurrerende run in dezelfde groep. Dat wijst op een runner-/simulatorafbreking, niet op deze wijzigingen. Er is één run per push; de definitieve commit krijgt een nieuwe run (zie reviewrapport voor de uitkomst).
* PR #295 (picomatch/OSMD-lockfile): `npm audit --omit=dev --audit-level=high` meldt op deze branch **0 kwetsbaarheden** (Development-controles groen). Deze PR wijzigt `package-lock.json` en dependencies niet, dus #295 wordt niet overschaduwd of gewijzigd; het blijft een afzonderlijke beslissing van de eigenaar.

## Vervolgplan (nog niet gedaan, geordend)

1. **Toestelacceptatie** van alles hierboven (eigenaar): chips → Reeks/XP/Competitie en terug; cursus verbergen, terugzetten, volgorde, voortgang intact; audiokeuze.
2. **Activiteit (`/activity`) en Groepen (`/groups`, `/groups/new`, `/groups/leaderboard`)**: gedeelde clients + spelbrugroutes + routes; sluit aan op `docs/NATIVE-VRIENDEN.md` fase C. Tot dan geen native link (`NativeLink` toont een uitgeschakelde link; de Vandaag-weergave een melding).
3. **Hulpmiddelen**: eerst Woordenboek (`DictionaryClient`, route bestaat al), daarna Personen en XP-gids via gedeelde presentatiecomponenten (nu server-only pagina's met Prisma: eerst data-contract splitsen), tot slot de hub. Alles achter bestaande contentbeschikbaarheid (`docs/CONTENT-AVAILABILITY.md`).
4. **Snelle Zendeling**: eigenaar zet de beheerschakelaar aan (zie bevinding 5); daarna toestelcontrole van de run en de ranglijst.
5. **Audio**: na het serverlog van de testomgeving beslissen of het een data/omgevingskwestie is (waarschijnlijk) of een echte bron-/koppelingsfout.
6. **Dode-link-bewaking**: een test die alle zichtbare `href`s van de native schermen tegen `nativeRoute` houdt (nu alleen voor de nieuwe chips).
7. **Kompas**: Kompas-uitleg (`kompas.topics.*`) voor Reeks/XP/Competitie bestaat voor het web; controleer of de tekst "in de app" nog klopt (teststap `npm run test:kompas`).

## Acceptatie (eigenaar, fysiek toestel)

Niet gedaan en niet geclaimd: iPhone/iPad- en Android-toesteltests. Geen NAS-uitrol, geen TestFlight-upload, `main` ongewijzigd.
