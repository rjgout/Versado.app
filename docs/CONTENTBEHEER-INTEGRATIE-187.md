# Contentbeheer V2: integratie van PR #187 met actuele main

Oorspronkelijke basis: `main` `89b8e4a59c42daa218f9bb693f033c6e669a9ace` (#210), bestaande PR-hoofdcommit
`8c5e7626362a4eb99e8c76d0d9d1b11d9f027067`. De bestaande draft-PR wordt bijgewerkt met een normale merge van main;
geen vervangende implementatie, force-push of nieuwe feature-PR.
Tijdens de eindcontrole kwam #213 op main: `abddbe49fcda03fa9998e3326d40b8082071d19e`. Ook deze main is geïntegreerd;
de CFM-weeklabelpresentatie, browserasserties en screenshot blijven intact. De gegenereerde native inventaris is opnieuw gecontroleerd.
Daarna volgde #212 op main: `48f8974ce709444cc0fee96e61a53dd507dd87d9`. De deelknop, centrale platformadapter, vijf talen,
Kompas-uitleg en share-browserasserties zijn behouden. Het aanvullende conflict betrof uitsluitend de gegenereerde JSON-inventaris;
die is volledig opnieuw opgebouwd uit de gecombineerde bronboom. Geen audio of reeksregel is hierdoor gewijzigd.
Alle 27 checks waren groen op de voorafgaande integratiecommit `e38f565e`; de nieuwe eindcommit wordt opnieuw volledig in CI getest. De productieacceptatie blijft afzonderlijk in draft-PR #211.

## Vier conflicten en leidende implementatie

| Bestand | Besluit en reden |
| --- | --- |
| `docs/NATIVE-FEATURE-PARITY.md` | De actuele handmatige main-beoordeling en distributieprofielen blijven leidend. Het gegenereerde inventarisdeel wordt opnieuw opgebouwd uit de gecombineerde code; geen oude telling terugzetten. |
| `docs/native-feature-parity.inventory.json` | Volledig regenereren met de bestaande parity-generator. Alleen de gecombineerde bronboom kan de transitieve afhankelijkheden en nieuwe beheerroutes bepalen. |
| `tests/quick-missionary-source.integration.test.ts` | Main #200/#208 is leidend: een bronloze oude run geeft ook bij herhaald automatisch afsluiten geen reeksactiviteit. De extra #187-controles op nul XP, geen Genees-vraag en onveranderde economie blijven behouden. |
| `tests/quick-missionary-source.multi-instance.test.mjs` | De huidige brongebonden reeksregel van main blijft leidend. Een werkelijk gespeelde run mét bewezen bron telt ook na een fout antwoord; alleen starten telt niet. Extra retry via de andere Node-instance mag geen tweede activiteit opleveren. |

Ook buiten de conflictmarkeringen bleken oude #187-browserasserties nog een beloning voor bronloze runs te verwachten. De echte
spelbrowserregressie reproduceerde dit; alle betreffende asserts vereisen nu nul activiteit, op mobiel én desktop, inclusief de
lobbybevestiging na twee oude runs. De spelimplementatie van main is ongewijzigd.

Alle vijf taalbestanden zijn inhoudelijk samengevoegd: de bestaande main-teksten voor winkel, CFM en reeksbanner blijven,
naast de Contentbeheer-kaarten en fout-/bevestigingsteksten. De gezamenlijke structuur wordt met de bestaande i18n-check gecontroleerd.

## Behoud van main en ontbrekende functionaliteit

- #184: stabiele oefenidentiteit, historie, voortgang, importlock en bestaande beheerinstellingen blijven behouden.
- #194: dezelfde Audio V2-modellen, importer, onveranderlijke recordings, bronhashbinding en expliciete publicatiepointer.
  De Audio V2-migratie wordt niet gewijzigd. Geen automatische publicatie; legacy-bevestiging is geen V2-bronhashbypass.
- #195: distributieprofielen en releaseblokkades blijven intact; lokale native audiopariteit is hiermee niet bewezen.
- #200/#208: dependencybestanden blijven exact gelijk aan main, inclusief de exacte Nodemailer-pin en de nieuwere dev-dependencies.
  Ook de actuele bronloze-runregel blijft ongewijzigd in de spelimplementatie.
- #209/#210/#212/#213: de main-verbeteringen aan CFM-kaarten en reeksbanner blijven behouden.
- Uit #187: aparte aanvullende content-/Schriftkaarten, planHash-flow, ChapterAudioCheck, ContentUpdateRun, RETIRED en
  transactionele legacy-audioafhandeling. Geen tweede importer of publicatiesysteem.

Bij de integratie zijn twee aanvullende fouten gevonden en gericht hersteld:

1. `syncCourses` maakte ook cursussen voor de zes Audio V2-tekstuitgaven. Deze zes vaste identiteiten blijven uitgesloten.
   Een aanvullende contentupdate synchroniseert bovendien geen schriftcursussen of leskoppelingen (`scriptures: false`).
2. De oude herstelroutine classificeerde actieve runs op andere processen als onderbroken. Iedere run krijgt nu vóór het aanmaken
   van de logrij een eigen PostgreSQL-eigenaarslock, ook tijdens bronvoorbereiding. Herstel probeert die lock transactioneel en
   markeert uitsluitend onbeheerde oude RUNNING-rijen. Geen tabel of tweede jobsysteem toegevoegd. Startlogfouten blokkeren het
   contentwerk; eindlogfouten worden niet als succes verborgen.

De algemene importlock blijft de bestaande uitsluiting voor imports. De run-eigenaarslock bepaalt alleen de betrouwbaarheid van
het logboek en vervangt geen commitgrens voor content. Het verbreken van een databaseverbinding is geen automatische rollback van
eerder gecommitte hoofdstukken; controleer na database-/procesuitval het duurzame logboek en bereid het resterende plan opnieuw voor.

## Migratiebewijs en volgorde

Bestaande bestanden/checksums blijven exact intact:

- `20261127120000_content_beheer_v2`: `09ff08e06449733ba78ae35319faf5355839921c496fb44dbaed512e26484d66`.
- `20261204120000_audio_library_v2`: `0f53acb44a291c68369d7b68a0482bb23b919c1b98c5c5712685c8e3c640fa9b`.

De geïsoleerde audiorunner voert eerst alle historische migraties uit zonder deze twee. Daarna maakt hij de bestaande
Nederlandse bronmetadata/teksten van alle **205** legacy-audiohoofdstukken, één synthetisch hoofdstuk en een hintsaldo aan.
Vervolgens past hij Audio V2 toe en pas daarna de ontbrekende Contentbeheer-migratie. Vóór/na worden dezelfde hoofdstuk-/vers-ID's,
teksten, bron-URL's, kop- en vers-tijdcodes vergeleken. De nieuwe ChapterAudioCheck-backfill is voor alle hoofdstukken CURRENT met
de passende teksthash. Geen bestaande opname of publicatie ontstaat door een migratie.

De volledige contentrunner test daarnaast de normale migratieketen op een verse wegwerpdatabase. Geen migratienaam hernoemen,
toekomstige timestamps wijzigen, toegepaste SQL aanpassen of productie-migratiehistorie corrigeren.

Voor uitrol na aparte toestemming: consistente DB-/audioback-up, oude schrijvende processen stoppen, de normale migratieketen toepassen,
nieuwe beoordeelde image starten, alleen-lezen diagnose en acceptatie, daarna pas afzonderlijk goedgekeurde contentacties.
Oude algemene reloads mogen niet gelijktijdig blijven schrijven. Geen automatische schema-rollback: enum/tabel behouden en bij twijfel
vooruit herstellen. Het plan in #211 blijft leidend voor de NAS-pilot, opslag, back-up, vijf talen en publicatiegoedkeuring.

## Technische verificatie

De werkelijk uitgevoerde resultaten en eindcommit staan ook in de PR-beschrijving. Hoofdcontroles:

- Geïsoleerde contentrunner: 182 tests, geen fouten/skips; inclusief importlock, retries, historie, planHash, OTB-droogloop,
  bron-/DB-wijziging, actieve logrij op een ander echt Node-proces, geforceerde procesuitval en geblokkeerd startlogboek.
- Geïsoleerde Audio V2-runner: 28 integratietests, geen fouten/skips; inclusief audio → Contentbeheer-migratie,
  rollback/fouttrigger/retry van legacy-audio, V2-publicatiebehoud, twee echte importprocessen en zes verborgen uitgaven.
- Alle 205 NL-hoofdstukken: exacte metadata vóór/na beide migraties en na herimport; bij aanvullende cursussynchronisatie
  blijven tekst, audio, koppen, vers-tijdcodes, controlemarkeringen, V2-pointers en schriftlessen gelijk.
- Browser-, multi-instance-spel-, native-, beveiligings-, build-, type-, lint-, vertaal- en CI-resultaten worden op de
  gepushte eindcommit gecontroleerd; een oude groene #187-commit geldt niet als bewijs voor deze integratie.

Dit is ontwikkel-/testbewijs, geen productie- of fysieke apparaattest. Er zijn geen productie-imports, NAS-downloads, audio-
publicaties, deployments, merges of wijzigingen aan Bijbel-, CFM- of FSY-audio uitgevoerd. Brondata voor de audio-/migratietests komt uit de
repository; MP3's zijn synthetische testbestanden. De aanvullende #213-componentbrowser gebruikt één lokaal gedownloade officiële
lesafbeelding met exacte gepinde checksum; geen NAS of audio. De 19 reviewgevallen blijven buiten publicatie.


### Lay-outregressie uit de volledige CI

De navigatietest speelde werkelijk een eerste Woordzoeker uit. Sinds main #210 verschijnt de uitgestelde fullscreen reeksviering
pas bij terugkeer naar Spelen. De test klikte direct het volgende spel en raakte, afhankelijk van timing, de voorliggende dialoog.
De test controleert nu expliciet dat de resultaatkaart voorrang houdt, wacht na het verlaten op de echte viering en sluit die via
haar gewone knop voordat hij verder navigeert. Geen force-click, mock, skip of verzwakte navigatie-/beloningsassertie; geen wijziging
van de productiereekslogica. De volledige geïsoleerde layoutbrowser is met deze testcorrectie opnieuw geslaagd, inclusief alle drie Woordzoeker-spellen,
contentkiezer, profiel/gids, winkel, kaartbeheer en Socket.io-regressies. Na de laatste main-integratie volgt opnieuw de volledige CI.
