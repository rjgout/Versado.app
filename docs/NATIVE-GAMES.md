# Native Spelen — gezamenlijke acceptatie

## Doel en releasegrens

Alle tien bestaande catalogusspellen gaan samen naar iOS. De featurebranch
begint op develop `22a1d6d3` (Liquid Glass Foundation, #282). Geen nieuwe
TestFlight-versie voordat Spelen als geheel bruikbaar en gecontroleerd is.
Deze implementatie wijzigt geen signingmiddelen, secrets, productie of NAS.
Merge, DEV-publicatie en TestFlight blijven afzonderlijke eigenaarshandelingen.

| Onderdeel | Dezelfde bestaande presentatie en regels | Native aansluiting |
| --- | --- | --- |
| Legpuzzel | JigsawV2Client; solo, samen, wedstrijd, geschiedenis en records | Bestaande puzzelservices, actuele locks en socketverbinding |
| Woordzoeker | WordSearchClient; raster, moeilijkheid, resultaat en beloning | Bestaande woordselectie en eenmalige serverbeloning |
| Woord van de dag | WordGameClient; dagelijkse poging, hints en ranglijst | Bestaande daggrens, hinttegoed en serverresultaat |
| Woordspel | Scrabble-clients; uitnodiging, bord, beurten en uitslag | Dezelfde privé-rackprojectie en beurtcontrole |
| De Slimste Heilige | Alleskenner-clients; alleen, live en seizoen | Dezelfde echte kamers, timers, vragen en realtime-events |
| Gezinsavond | FamilyGame-clients; lobby, gasten, dobbelsteen en bord | Dezelfde spelserver; opnieuw aanmelden na reconnect |
| Raad het hoofdstuk | ChapterGuess-clients; niveaus, hints, solo en live | Dezelfde vragen en score; antwoord-ID blijft buiten audio-metadata |
| Uitdagingen | ChallengesClient plus volledige LessonFlow | Dezelfde oefeningen, sessie, lees-/antwoordcontrole en challenge-resultaat |
| Vliegende gids | Quick Missionary-clients; run, hervatten, revive, samen en ranglijst | Dezelfde engine, bronrechten en serveracties |
| Het Mysterie | Alle 18 bestaande varianten en gezamenlijke presentatie | Dezelfde pogingen, revisies, clues, hints en antwoorden |

De gedeelde XP-winkel hoort bij de spelketen: hintvoorraad en Genees gebruiken
dezelfde bestaande winkel, voorraad en serverprijzen. Er is geen tweede
web/native-winkel en geen betaal- of accountintegratie toegevoegd.

## Begrensde integratie

`gamesRoutes.ts` en `gamesHandlers.server.ts` noemen iedere methode en handler
expliciet. De native API roept uitsluitend die lokale functies aan; geen URL-
proxy, webcookie, adminroute of tweede authenticatie. `requestIdentity.server.ts`
verifieert de bestaande Bearer-/NativeSession-identiteit bij iedere gedeelde
sessieopvraag; achtergrondwerk houdt die bevoegdheid niet na het antwoord.
Pagina's projecteren alleen vaste getypeerde GameScreen-gegevens. Geen HTML,
script, vrije componentnaam of uitvoerbare functie in het protocol.

Dezelfde LiveDataStore, inhoudsselectie en bestaande eenmalige Socket.IO-tickets
worden hergebruikt. In-flight antwoorden blijven aan account, sessiestamp,
epoch, taal en bronversie gebonden. Geen automatische herhaling van writes.
Swift en Java gebruiken gegenereerde, exact begrensde requestpolicies; nieuwe
endpoints vereisen code, tests en review.

## Lezen, annotaties en audio

De canonieke hoofdstukles blijft dezelfde LessonFlow. Annotaties gebruiken de
bestaande native commitgrens: User → NativeSession → bron-/versrijen, context-
controle voor en na de mutatie en dezelfde UUID-/versie-/tombstoneregels. Vrij
lezen krijgt een echte leesidentiteit; er wordt geen cursus verzonnen. De
bestaande web-annotatieroute en haar CSRF-poort blijven ongewijzigd.

Dezelfde native speler, metadata-autorisatie, lokale toestelstemmen en
beschermde MP3-ranges worden gebruikt. Quiz-intro's hebben een ondoorzichtige
vraagidentiteit; het juiste hoofdstuk blijft serverdata. Alleskenner-tekst
komt uitsluitend uit de huidige vraag van de echte spelserver voor een
bevoegde deelnemer. Geen vrije clienttekst, opname-URL of tweede audiostack.
De optionele browserdecoder is uitsluitend een geïsoleerde testfixture.

## Verificatie

Commando's zonder signing, upload of deployment:

- `npm run test:native` — bestaande controles plus spelcontracten, actor-/epochgrenzen en policies.
- `node --import tsx scripts/native/games-policy.mjs --check` — Swift/Java blijven exact synchroon.
- `CHROMIUM_PATH=/usr/bin/chromium node scripts/native/test-isolated.mjs --games` — eigen PostgreSQL/Redis, echte services en lokale browserbundle.
- `npm run build`, `npm run native:build` en bestaande unsigned iOS-/Android-PR-compilatie.
- Bestaande spel-, annotatie-, audio-, Kompas-, distributie- en releaseguards.

De uitgebreide HTTP-proef controleert alle tien ingangen, starten/hervatten,
cookie-/Bearer-scheiding, onbevoegde routes en Origins, privéannotaties,
bronwisseling en ABA, verborgen quizantwoorden, één Woordzoeker-beloning,
Scrabble-racks/beurten, native/web-livequiz met nieuw reconnectticket en echte
MP3 206/HEAD/416, vreemde sessies en bestandswijziging. Een echte Alleskenner-ronde controleert
ook dat alleen de actuele luistervraag van de spelserver metadata krijgt;
een oude vraag, vreemde speler of ingetrokken sessie wordt geweigerd. De browserproef speelt
via de echte bediening en bewaart screenshots in
`/tmp/versado-native-browser/spelen`; CI bewaart dit bestaande artifact.
Browserbewijs met gesimuleerde OS-uitvoer is geen fysieke toestelacceptatie.

## Huidig lokaal bewijs

- Laatste volledige lokale suite: 240 native unit-/contract-/distributietests en 80 datalaagtests geslaagd; daarna 25 gerichte spelcontracttests voor de extra methode-/voorkeurgrens.
- 218 bestaande spel-/puzzel-/mysterietests en 92 Kompas-/navigatie-/spelcontracttests geslaagd.
- 15 uitgebreide HTTP-integratietests op eigen PostgreSQL/Redis geslaagd.
- Tien echte spelingangen, vijf talen, 320px/200%, licht/donker: nul ontbrekende assets en nul browserfouten.
- Woordzoeker via pointerbediening voltooid, inclusief één XP-beloning.
- Uitdaging via de echte schermen: lezen, privébladwijzer, native audio-uitvoer
  (alleen de OS-decoder gesimuleerd), drie juiste antwoorden en opgeslagen serveruitslag.
- Speluitleg en native rondleiding werken met dezelfde Kompas-presentatie.
- De winkelbrowser koopt werkelijk één hint; voorraad en XP zijn daarna in de
  database gecontroleerd. De HTTP-proef controleert ook Genees-idempotentie,
  reeksbevriezingen, ongeldige aantallen en een vreemde webcookie.
- Volledige lintcontrole: nul fouten, 173 zichtbare waarschuwingen; geen regels uitgeschakeld.
- Schone lokale productiebuild geslaagd. GitHub bevestigt op `d7415e4b` de
  productiebuild en unsigned iOS-/Android-compilatie; de laatste vervolgcommit
  moet dezelfde controles opnieuw doorlopen.
- Release-/backendguards: 61 tests geslaagd, twee macOS-toolproeven lokaal niet uitvoerbaar en daarom expliciet overgelaten aan macOS-CI.

Dit is bron-/browserbewijs en geen fysieke iPhone-/Android-acceptatie.
De oorspronkelijke SQL-/HTTP-keten (167 controles) en socketketen (64 controles)
zijn geslaagd. De bestaande browserketen wordt daarnaast gecontroleerd.
Oudere backends behouden hun bestaande afgeschermde Foundation-leesroute;
alleen `games-v1` activeert daar de volledige gedeelde spel-/leespoort.
De browserfixtures gebruiken expliciet UTF-8, zoals de echte native bundel.

## Nog af te ronden vóór vrijgave

Unsigned native compilatie en onafhankelijke review moeten op de exacte
PR-head slagen. Niet-catalogusafhankelijkheden, waaronder Samen studeren met
podcastaudio en overige sociale/cursusbestemmingen, mogen niet als volledig
geïmplementeerd worden gemarkeerd. Ze blijven zichtbaar in de pariteitsmatrix
en moeten worden onderzocht waar een spelketen ze werkelijk nodig heeft.

Na review en toestemming: eigenaar publiceert de goedgekeurde backend naar DEV
met `games-v1` én `realtime-ticket-v1`; de bestaande backendcontrole weigert
een nieuwe build als deze ontbreken. Pas daarna afzonderlijk toestemming
voor de volledige TestFlight-kandidaat. Geen automatische releasehandeling.
