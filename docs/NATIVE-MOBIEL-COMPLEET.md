# Mobiel compleet maken: verwerking TestFlight-feedback (eerste oplevering)

Bron: de eerste TestFlight-ronde van de eigenaar (29 van 59 controlepunten afgevinkt). Niet-afgevinkte punten
zijn niet automatisch defecten; elke bevinding is eerst tegen de code gelegd en ingedeeld in:
**(a)** defect, **(b)** bewust nog ontbrekend, **(c)** er maar niet bereikbaar, **(d)** gegevens/instelling op de server.
Er is niets op een echt toestel getest; de eigenaar doet de fysieke iPhone-tests (zie "Acceptatie").

## Bevindingen en uitkomst

| # | Bevinding | Indeling | Oorzaak (uit de code) | Gedaan in deze oplevering |
|---|---|---|---|---|
| 1 | Reeks-/XP-/divisiechips bovenaan doen niets | (b)+(a) | `NativeShellHeader` zette `interactive={false}`: native had geen `/streak`, `/xp`, `/competition`. De chips bleven wel zichtbaar. | Die drie schermen zijn de bestaande gedeelde clients (`StreakClient`, `XpHistoryClient`, `LeaderboardClient`) in een dunne native schil (`NativeProgressView`); data via de toegestane spelbrug (`streak`, `xp-history`, `leaderboard`, alleen GET). De chips zijn aantikbaar zodra `games-v1` + realtime beschikbaar zijn. |
| 2 | Terug-knoppen | geen defect gevonden | `NativeNavigator.back(fallback)` gaat naar de geschiedenis (index > 0) en valt anders terug op een logische bovenliggende route; Android-terug gebruikt dezelfde functie. Tabwissels zijn `push`, dus terug keert naar het vorige scherm. | Geen codewijziging. Wel: het nieuwe XP-scherm toont de "XP-gids"-knop niet meer (die bestemming bestaat in de app niet), zodat er geen knop zonder werking is. |
| 3 | Cursusoverzicht alleen-lezen | (b) | `NativeLearningView` toonde `CoursesView` zonder `hide/move/add`. | Eén gedeelde hook `useCourseManagement` (nu ook gebruikt door `CoursesClient`): Verbergen (`unsubscribe`, alleen `subscribed` uit: voortgang en inhoud blijven), Cursus toevoegen (`subscribe`, achteraan), Eerder/Later (`UserListOrder` "courses"). Spelbrug: twee POST-routes erbij; `list-order` PUT bestond al. |
| 4 | Alleen computerstem | (d), mogelijk (c) | Zie "Audio". Eén echt zwak punt: een weggevallen bron was onzichtbaar. | Elke weggelaten bron krijgt een vaste, privacyvrije reden in het serverlog; de speler meldt "geen opgenomen audio op de server" bij alleen toestelstem. De bestaande keuze Opgenomen audio / Stem van dit toestel was er al en verschijnt zodra een bron bestaat. |
| 5 | Snelle Zendeling niet in Spelen | (d) | Geen native defect. `quickMissionaryEnabled` staat standaard **uit** (migratie `20261011120000`) en `isGameVisible` negeert ook admins. Daarnaast bestaat de `GameContentScope` alleen voor werken `bofm`, `dc-testament`, `pgp`. De route `/snelle-zendeling` is in de spelbrug aanwezig. | Geen codewijziging. Actie eigenaar: Adminbackend → Spellen → Snelle Zendeling aanzetten in de testomgeving en een schriftbron kiezen waarvoor het spel een scope heeft. |
| 6 | Uitnodigingen/Activiteit/Competitie | gedeeltelijk (c)/(b) | Competitie nu lokaal (zie 1). `/activity` en `/groups` hebben nog geen native scherm. | Competitie opgelost; rest in het vervolgplan. |
| 7 | Hulpmiddelen | (b) | `/tools`, `/tools/dictionary(+[word])`, `/tools/persons`, `/tools/xp-guide`; de hub en persons/xp-guide zijn server-pagina's met Prisma (niet direct herbruikbaar), het woordenboek is een client (`DictionaryClient`) met al toegestane bridge-route `dictionary/[word]`. | Alleen inventaris; zie vervolgplan. |
| 8 | Testvrienden | n.v.t. | — | `scripts/test-accounts/seed-synthetic-friends.ts` (zie hieronder). |
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

Er is **geen** nieuwe audiobron, directe link of tweede audiosysteem toegevoegd en niets is als beschikbaar gepresenteerd dat niet bewezen is.

## Testvrienden (alleen afgeschermde dev-/testomgeving)

`npx tsx scripts/test-accounts/seed-synthetic-friends.ts --voor=<handle#nr>` (dry-run); toepassen met
`VERSADO_TEST_OMGEVING=dev-test … --apply --verwacht-database=<host>:<poort>/<database>`; opruimen met `--verwijder --apply …`.
Drie accounts (`testvriend-N@example.invalid`), gemaakt met `createAccount` en gekoppeld via de bestaande uitnodigingsroute
(`becomeFriendsViaInvite`), willekeurig, niet bewaard wachtwoord, idempotent. Nooit aangeroepen vanuit seed, migratie, app-start of
deployment (bewaakt door `tests/synthetic-test-accounts.test.ts`). Voor productie niet bedoeld en niet gebruiken.

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
