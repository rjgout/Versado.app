# Nederlandse legacy-audio gecontroleerd overzetten

Deze wijziging voegt één begrensd conversiepad toe aan **Adminbackend → Content → Audio**.
De 205 oorspronkelijke Nederlandse Boek-van-Mormon-identiteiten blijven `legacyProtected`.
Gewone download-, registratie- en bulkpublicatieaanvragen kunnen die bescherming niet uitschakelen.
Geen nieuwe cursussen, oefeningen, tekstuitgaven of voortgang worden gemaakt.

## Omvang en grenzen

De catalogus bevat 239 Nederlandse hoofdstukken: 205 legacy-identiteiten en 34 aanvullende V2-doelen.
Eén van de 205 is tevens een bestaand reviewgeval. Dat blijft geblokkeerd, evenals alle andere
18 reviewgevallen in de officiële catalogus. Momenteel zijn dus maximaal 238 Nederlandse doelen
voor gevalideerde V2-publicatie beschikbaar; een volledige teller rechtvaardigt geen uitzondering.
De zes verborgen tekstuitgaven blijven verborgen en ongewijzigd.

De conversie gebruikt dezelfde `OfficialAudioTask`, importreceipt, `AudioRecording`,
content-addressed `objects`, afspeelroutes en `AudioPublication` als het gewone beheer.
Een aparte worker-container is hiervoor niet nodig. Deze conversie genereert geen spraak.

## Bediening voor de eigenaar

1. Open **Legacy-audio overzetten naar Audio V2** en kies **Alleen-lezen inventaris openen**.
   Alle 205 bronnen staan in een gepagineerde lijst. Bekijk bestaande/nieuwe bron-URL,
   teksthash, verwachte MP3-hash, aanwezigheid en de oude verstijdcodes. Dit maakt geen taken,
   bestanden, registraties of publicaties. Een aanwezigheidscontrole bewijst geen MP3-integriteit.
2. Kies **Drie proefhoofdstukken selecteren**. De vaste selectie is:

   | Hoofdstuk | Verzen | Officiële duur | Bytes nieuwe MP3 |
   | --- | ---: | ---: | ---: |
   | 2 Nephi 22 | 6 | 67,536 s | 557.518 |
   | 1 Nephi 21 | 26 | 433,704 s | 3.486.875 |
   | Jakob 5 | 77 | 1.315,368 s | 10.540.092 |

3. Kies **Downloaden en controleren** (de knop gebruikt de bestaande downloadvertaling).
   Eerst worden uitsluitend de maximaal drie geselecteerde oude bestanden gelezen en gehasht.
   Daarna volgt een afzonderlijke bevestiging met hoofdstukken en taal. Annuleren maakt geen taak.
   Onder *Beschermde uitgangssituatie* zijn de oude bestandshashes en planhash zichtbaar.
   Een verdwenen lokaal bestand wordt expliciet getoond; de bestaande officiële terugval-URL blijft bewaard.
4. Na bevestiging wordt het plan opnieuw berekend. Alleen een identieke planhash wordt geaccepteerd.
   De server bewaart per hoofdstuk de oorspronkelijke bron-URL, bestand/bytes/SHA-256,
   hoofdstuk-/tekstidentiteit, oude kop- en verstijdcodes en relevante `ChapterAudioCheck`-status/hashes.
   Deze uitgangssituatie wordt niet vervangen bij een retry.
5. De bestaande achtergrondtaak haalt de officiële MP3 opnieuw op naar een nieuw, exclusief gemaakt
   tijdelijk bestand. Bij de eerste conversie wordt geen bestaande cache/object als vervanging voor
   die nieuwe download gebruikt. Bronpagina, exacte taal/uitgave/tekst/stem, bytes, SHA-256,
   volledige MP3-decodering en alle vastgepinde versgrenzen moeten kloppen.
6. Kies na controle afzonderlijk **Registreren**. Dit maakt of hergebruikt uitsluitend een opname;
   er wordt niets gepubliceerd. Ook een eerder via een andere import geregistreerde passende opname
   krijgt pas conversiepublicatierecht na de nieuwe download en dit afzonderlijke registratiebesluit.
7. Open de beheerpreview van ieder hoofdstuk. Beluister de opname, controleer **alle** versovergangen,
   de eerste/laatste verzen, pauzeren/hervatten en de minispeler op telefoon. De technische controles
   bewijzen tijdcode-identiteit en geldige grenzen; zij vervangen geen auditieve beoordeling.
8. Kies alleen de gecontroleerde opnamen en bevestig **Selectie publiceren** afzonderlijk.
   De transactie maakt alleen een nieuwe V2-publicatiepointer. Geen bestaande publicatie wordt vervangen;
   replay van dezelfde publicatie is herhaalveilig. De oude bestanden, `Chapter.audioUrl`,
   `Verse.audioStart` en audiocontrolemarkeringen blijven ongewijzigd.
9. Bevestig **Drie proefhoofdstukken goedkeuren** pas na de feitelijke telefoon-, vers- en
   terugvalcontroles. De server verlangt drie geregistreerde, gepubliceerde en technisch geldige
   kandidaten en bindt het besluit aan hun opname-ID's en uitgangssituaties.
10. Pas daarna verschijnt **Volgende batch selecteren** voor overige geldige legacy-hoofdstukken.
    Elke download-, registratie- en publicatieaanvraag blijft beperkt tot drie hoofdstukken.
    Blijf per batch beoordelen; registratie publiceert nooit automatisch.

Een browserbevestiging tijdens een ontwikkeltest is geen productieacceptatie door de eigenaar.
Codex voert deze stappen niet op de NAS uit. Geen deployment, productie-import of publicatie
maakt deel uit van de ontwikkeloplevering.

## Opslag, voortgang en fouten

- De bestaande appmount blijft `/volume1/docker/jehova-app/audio:/data/audio` als de eigenaar die
  daadwerkelijk zo heeft ingesteld. Er is geen nieuwe appmount, poort, SSH- of Docker-socket nodig.
- Legacy-bestanden blijven op hun oorspronkelijke plaats. Nieuwe bestanden gebruiken
  `official-cache/<sourceId>`, exclusieve tijdelijke namen en `objects/<sha256>.mp3`.
  `incoming/admin-official-<sourceId>` wordt pas na registratiegoedkeuring gemaakt.
- Geen bestand wordt overschreven. Bestaande objecten moeten dezelfde hash/bytes hebben.
  Harde links besparen ruimte; de brondownload en tijdelijke validatie kunnen tijdelijk extra ruimte vragen.
  Controleer vrije ruimte zelf op de NAS; deze PR bevestigt geen actuele capaciteit of mounts.
- Status verversen schrijft niets. De aparte inventaris laadt pas op verzoek. Verversen gebeurt
  iedere 15 seconden bij actieve taken en iedere 120 seconden bij rust; volledige legacy-hashes
  worden alleen bij voorbereiding/bevestiging en de betreffende afspeelterugval gelezen.
- Eén bestaande PostgreSQL-workerlock begrenst alle appcontainers; taakleases en fencing-tokens
  beschermen tegen een achtergebleven worker. De bestaande importlock en receipt blijven van kracht.
  De downloadaanvraag bereidt één hoofdstuk per korte commit voor; netwerkaanvragen en bestandshashes
  staan buiten de databasetransacties. Geen nieuwe Redis-lockarchitectuur.
- Autorisatie volgt het bestaande beheeraccount en `sessionVersion`. Commit en import controleren
  de actuele rechten opnieuw. Rollen intrekken blokkeert nieuwe commits, niet eerder rechtsgeldige publicaties.
- Afwijkende bron/tekst/hash/MP3/tijdcodes worden een zichtbare fouttaak en krijgen geen publicatierecht.
  Een catalogusreviewgeval kan niet door hervatten worden geforceerd. Bij fouten blijft bestaande audio actief.
- Hervatten gebruikt de bestaande FAILED/verlopen-lease-regels. Levende workers worden niet overgenomen.
  Herhalen na verloren respons of procesuitval maakt geen tweede opname of publicatie.
- SIGKILL kan een ongekoppeld tijdelijk bestand achterlaten. Verwijder niet blind cache/objecten;
  maak eerst een back-up en laat een beheerder het concrete bestand onderzoeken. Deze PR voegt
  geen automatische opschoning van audio toe.

## Terugval en herstel

Als de server een gepubliceerde V2-opname afkeurt wegens ontbrekende/corrupte bytes of ongeldige
segmenten, mag alleen een exact ongewijzigde conversie-uitgangssituatie terug naar de oude audio.
De oude lokale bytes worden tegen de bewaarde hash gecontroleerd. Als bij inventarisatie geen lokaal
bestand bestond, blijft de oorspronkelijke officiële URL de terugval. Een later toevallig verschenen
lokaal bestand wordt dan niet ongemerkt gebruikt.

De API geeft bij een bruikbare V2-opname ook de gecontroleerde legacy-terugval mee. Een afspeelfout
op de telefoon schakelt eenmaal over naar die bron, met de **oude** verstijdcode van het actieve vers
(en de oude eindgrens bij een gedeeltelijke leesles). De minispeler blijft dezelfde bron bedienen.
Stoppen/pauzeren mag geen vertraagde automatische herstart veroorzaken. Bij gewijzigde tekst of
uitgangssituatie wordt de oude opname niet aan nieuwe tekst gekoppeld; dan blijft TTS de veilige uitweg.
Een fout in beide audiobronnen start geen eindeloze retrylus.

Een hoorbare fout die niet technisch detecteerbaar is, vereist een beheerbesluit: stop verdere conversie
of publicatie en onderzoek de betrokken opname. Deze PR bouwt geen algemene intrek-/vervangfunctie
voor publicaties. Verander geen bronbestanden of databasepointers met losse SQL om dit te omzeilen.

## Migratie en compatibiliteit

Nieuwe, uitsluitend toevoegende migratie:
`20261207120000_legacy_audio_conversion`, na `20261206120000_official_audio_tasks`.
Zij voegt vijf nullable conversie-/acceptatievelden toe aan de bestaande taak en een consistentieconstraint.
Alle bestaande taken houden NULL en blijven geldig. Geen toegepaste migratie, seed of contentimport
wordt aangepast. De geïsoleerde migratieproef bewaakt alle 205 legacy-hoofdstukken en tijdcodes.

Database- en audioback-up moeten vóór uitrol door de eigenaar samen worden gecontroleerd, volgens
[productieacceptatie](PRODUCTIE-ACCEPTATIE.md). Start bij uitrol geen conversies zolang oude en nieuwe
appworkers naast elkaar draaien: oude code weigert legacy-taken en kan ze FAILED markeren.
Na volledige overstap kan de eigenaar expliciet veilig hervatten. Dit is geen opdracht tot deployment.

Bij app-rollback blijven de nieuwe nullable velden en reeds gemaakte V2-objecten behouden; rol de
migratie niet destructief terug. Oude code behoudt oude bron-URL's en bestanden, maar kent de nieuwe
conversiebediening en gecontroleerde afspeelterugval niet. Stop conversietaken vóór een rollback.
Een herstel van PostgreSQL en audiomap moet uit dezelfde gecontroleerde back-upgeneratie komen.

## Ontwikkelverificatie

`tests/audio-legacy.integration.test.ts` gebruikt eigen PostgreSQL/Redis, echte Node-processen,
synthetische MP3's en gesimuleerde officiële HTTP-responses. Bestaande audio-/content-/voortgangstests
blijven onderdeel van dezelfde runner. `tests/audio-legacy.browser.mjs` controleert autorisatie,
bevestigingsgrenzen, mobiele bediening en de bestaande speler/minispeler met een gesimuleerde afspeelfout.

`tests/audio-legacy-real.ts` is een optionele extra proef met vooraf nieuw gedownloade officiële bestanden
in een aantoonbaar eigen werkmap en wegwerpdatabase. Deze proef gebruikt de bestaande importer en
publiceert uitsluitend in die wegwerpdatabase. De werkelijk uitgevoerde uitslagen, commit en CI-status
staan in de PR-beschrijving. Geen testresultaat betekent dat de NAS, productie of een fysieke telefoon
is gecontroleerd.

Werkelijk lokaal uitgevoerd: **17 unit-tests, 65 integratietests (30 bestaande, 23 officiële,
12 conversieproeven) en 98 browserassertions**, zonder fouten of skips. Schone productiebuild,
TypeScript, Prisma-validatie en native inventariscontrole slagen. De afzonderlijke proef met drie
nieuw gedownloade officiële MP3's is eveneens geslaagd in een eigen wegwerpdatabase.
[Bronbewijs](legacy-pilot-source-check.json) bevat de concrete publieke bronidentiteiten en hashes.
De [mobiele opname](../screenshots/official-audio/legacy-conversion-320-nl.png) toont de volledige
kaart op 320 px met synthetische beheerstatus, geen productiegegevens.

De gedeelde contenttestrunner houdt de nieuwe afhankelijke migratie, net als de officiële
audiotaken, buiten de opzettelijk onvolledige eerste migratiefase. De volledige keten wordt daarna
wel toegepast. De gerichte content-/oefenregressie met deze testvolgorde is opnieuw geslaagd;
er is geen CFM-, FSY- of andere contentfunctionaliteit aangepast.
