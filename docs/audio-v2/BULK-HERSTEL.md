# Bulkvoorbereiding en afzonderlijke publicatie

Deze correctie volgt op de adminbediening uit #220, vanaf main `b322b455fbd763cfba99ecf373defa8a8bfc6ae4`.
Er zijn geen productie-, NAS-, Portainer-, import-, deployment- of audiopublicatiehandelingen uitgevoerd.

De actuele vervolgcorrectie verwijdert de pilotpoort en verduidelijkt de Nederlandse telling: zie [Nederlandse voortgang](NL-VOORTGANG.md). De tests en screenshots onderaan dit document horen bij #221.

## Oorzaak en bewijs

De Engelse Boek-van-Mormon-selectie telt 478 gevalideerde stemvarianten voor 239 hoofdstukken. De oude interface stuurde die hele selectie terwijl zowel API als domein maximaal 300 IDs accepteerden. De 32.055 bytes JSON passen wel binnen de bestaande 32-KiB-bodygrens: bij deze selectie was het aantal IDs de blokkade. Duits heeft 238 gevalideerde kandidaten, Frans 240 en Spaans 239; Nederlands heeft 34 aanvullende kandidaten buiten de 205 beschermde legacy-hoofdstukken.

Daarnaast werd de volledige groepsvoorbereiding onder één Prisma-transactie van 30 seconden uitgevoerd, inclusief bron-/tekstqueries en lezen/hashen van bestaande cache/objecten. Een regressie met de volledige Duitse selectie zonder pilot (237 kandidaten) en een PostgreSQL-trigger met 140 ms vertraging per nieuwe taak reproduceert `P2028` na circa 30,1 seconden. De oude transactie rolt de hele selectie terug. Dezelfde ongewijzigde regressie slaagt na de correctie, ook als de totale voorbereiding langer dan 30 seconden duurt. De vertraging is synthetisch; deze proef bewijst de foutmogelijkheid en is geen meting van de productie-NAS. Zonder productielogs wordt niet geclaimd welke fout daar precies optrad.

Onverwachte databasefouten werden bovendien vertaald naar ‘Ongeldige invoer’. Deze krijgen nu een afzonderlijke, vertaalde serverfout; bezette database/lockwachten geven een herhaalbare melding. Prisma-querytekst, paden, credentials en interne foutdetails gaan niet naar de browser.

De Nederlandse situatie met 34 gecontroleerde en geregistreerde opnamen is geen nieuw download- of registratiewerk. De oude groepskaart bood echter geen publicatiestap. De nieuwe lijst toont bestaande registraties en biedt die stap expliciet aan.

## Bediening op mobiel

1. Open **Adminbackend → Content → Audio** en de gewenste bron/taal. Ververs zo nodig het overzicht. Alleen status lezen verandert niets.
2. Downloaden, registreren en hervatten blijven afzonderlijke bevestigde acties. Grotere selecties worden automatisch verdeeld over aanvragen van maximaal 20 kandidaten. Het voortgangscijfer telt voorbereide kandidaten, inclusief al bestaande taken; het is geen claim dat alle downloads al klaar zijn.
3. Open **Selecteer geregistreerde opnamen om te publiceren**. Per hoofdstuk zijn registratie, publicatie en eventuele fout zichtbaar, met een beheerpreview. De lijst heeft pagina’s van 25 rijen.
4. Selecteer afzonderlijke opnamen, of alle beschikbare hoofdstukken in deze groep. Er wordt hoogstens één stem per hoofdstuk geselecteerd. Reeds gepubliceerde doelen, beschermde legacy-hoofdstukken, reviewgevallen en ontbrekende bestanden zijn niet selecteerbaar.
5. **Geselecteerde opnamen publiceren** toont de exacte hoofdstukken, talen en stemmen ter bevestiging. Annuleren verandert niets. Registratie en download publiceren nooit automatisch. De bestaande kwaliteits-, tekst-, bestands- en beheercontroles blijven ook op de server verplicht.
6. Bij een deelfout blijven geslaagde commits behouden en worden mislukte publicaties met hun hoofdstuk gemeld. Ververs en beoordeel alleen de resterende kandidaten. Een eerdere succesvolle publicatie wordt bij een retry niet opnieuw geschreven.

De eerdere Ether 1-pilotpoort uit #221 is inmiddels vervallen; beheer gebeurt normaal per bron en taal, met behoud van de afzonderlijke registratie- en publicatiebevestiging. De zes verborgen tekstuitgaven blijven verborgen; ontbrekende teksten worden niet aangemaakt. De 205 legacy-hoofdstukken en 19 reviewidentiteiten blijven beschermd.

## Transacties, herstart en gelijktijdig beheer

- Bestaande `OfficialAudioTask`, worker, leases, importlock, Audio V2-importer, opslag en afspeelroutes blijven de enige keten. Geen schemawijziging, nieuwe jobengine of extra audiosysteem.
- Voorbereiding heeft één korte commit per kandidaat, een Prisma-deadline van 5 seconden, PostgreSQL-locktimeout van 1,5 seconde, statementtimeout van 4 seconden en maximaal 2 seconden wachten op een poolverbinding. Bestanden lezen/hashen en bronselectie gebeuren buiten die transactie. Bestaande volgorde User → pilotpolicy → taak blijft behouden; worker/importer controleren tekst en rechten opnieuw vóór hun eigen commit.
- De API accepteert maximaal 20 kandidaten per aanvraag; de beheerpagina verstuurt batches achter elkaar. De interne domeinservice kan een volledige catalogus afhandelen zonder één lange groepstransactie. Bij een latere fout bevat het antwoord het voorbereide aantal en de resterende IDs. Eerdere commits blijven zichtbaar en retries maken geen dubbele taken.
- Alleen reeds bevestigde batches worden voorbereid. Sluiten van de pagina kan ongestuurde batches achterlaten; opnieuw openen toont de duurzame taken, waarna alleen de rest wordt aangeboden. De bestaande worker hervat ontvangen taken na herstart.
- De nieuwe bulkpublicatie gebruikt de bestaande `publishAudio`-transactie met een aanvullende ‘alleen indien ongepubliceerd’-voorwaarde. Twee beheerders kunnen hetzelfde doel niet naar verschillende nieuwe opnamen laten wijzen: de eerste commit wint, de tweede krijgt een conflict. Een retry voor dezelfde opname retourneert de bestaande pointer zonder versie- of tijdswijziging.
- Publicatie vindt per kandidaat plaats. Een bevestigde groep is dus niet alles-of-niets: succesvolle hoofdstukken blijven gepubliceerd als een ander hoofdstuk faalt. De interface meldt die deelfout; er is geen automatische publicatie-rollback of vervanging van bestaande pointers.

## Belasting en grenzen

De nieuwe officiële statusquery ververst niet meer elke vijf seconden: 15 seconden bij actieve taken en 120 seconden zonder actieve taken. De bestaande algemene Audio V2-query blijft iedere 30 seconden verversen. De gedeelde datalaag pauzeert polling bij een verborgen tab; focus, mutaties en de handmatige verversknop blijven beschikbaar.

Bestanden van onbekende bronnen zonder taak of registratie worden niet langer onnodig op de NAS gecontroleerd. Per overzicht worden gelijke objectpaden eenmaal gecontroleerd, met maximaal acht gelijktijdige kandidaatcontroles. Er worden geen MP3’s gehasht of gedecodeerd in het alleen-lezen overzicht. De registratielijst rendert maximaal 25 rijen per groep.

De lokale taakrijke proef gebruikt de vijf volledige echte Boek-van-Mormon-tekstuitgaven, 1.229 taakregels en eigen PostgreSQL/Redis. De laatste lokale run mat 151 ms en 721.147 bytes JSON. Deze meting is geen benchmark van een volledig geregistreerde bibliotheek en geen NAS-meting. De werkelijke Synology-latentie, schijfbelasting en mobiele fysieke afspeelervaring blijven eigenaaracceptatie na afzonderlijk goedgekeurde uitrol.

## Verificatie

De PR rapporteert de werkelijke eindresultaten van:

- De eerst rode en daarna groene Duitse timeoutregressie.
- Volledige vijf taalcollecties, echte teksthashes, batches en twee verschillende beheerders; geen dubbele taken of gewijzigde content/publicaties.
- Gedeeltelijke databasefout en retry met behoud van eerdere commits; lockwachten en veilige foutclassificatie.
- Gelijktijdige publicatie, replay, afwijkende opname voor hetzelfde doel, ingetrokken rechten en beschermde bronnen.
- Bestaande Audio V2-/legacy-/verborgen-uitgave-/rollbacktests en twee echte Node-downloadworkers.
- Werkelijke HTTP-invoergrenzen en onverwachte foutafhandeling zonder detaillek; mobiele bulkbediening met gecontroleerde HTTP-fixtures voor 478 Engelse kandidaten en 34 Nederlandse registraties, inclusief annuleren, deelfouten en retries.
- TypeScript, schone productiebuild, ESLint, vijf talen, Prisma-validatie, native broninventaris, productie-dependencyaudit en GitHub Actions op de eindcommit.

De volledige taalproef test bulkvoorbereiding en tekstvalidatie. Er wordt niet geclaimd dat alle 1.229 officiële MP3’s zijn gedownload, beluisterd of gepubliceerd. De netwerk-/MP3-/importketen wordt met synthetische bestanden en echte bestaande validators in de geïsoleerde suites getest. Geen fysieke NAS- of apparaattest uitgevoerd.

## Uitgevoerde eindcontroles

| Controle | Lokale uitkomst |
|---|---|
| Audio-units | 15 geslaagd, 0 fouten/skips |
| Bestaande integraties | 30 geslaagd, 0 fouten/skips |
| Officiële-audioketen en bulkregressies | 20 geslaagd, 0 fouten/skips |
| Bestaande browsercontroles | 34 geslaagde assertions |
| Pilot en nieuwe mobiele bulkbediening | 61 geslaagde assertions; geen browser-/hydratie-excepties |
| TypeScript en schone productiebuild | Geslaagd |
| ESLint | 0 fouten; 171 bestaande waarschuwingen in ongewijzigde bestanden; gewijzigde code zonder waarschuwingen |
| Vertalingen | Alle 73 officialAudio-sleutels aanwezig in vijf talen; bestaande globale achterstand van 418 sleutels per overige taal niet uitgebreid |
| Prisma-validatie en bestaande migratieproeven | Geslaagd; geen schema- of migratiewijziging |
| Native broninventaris en bijbehorende test | Geslaagd; geen claim van volledige native audiopariteit |
| Productie-dependencyaudit | 0 kwetsbaarheden; dependencies ongewijzigd |

De definitieve GitHub-checks en commit-SHA staan in de PR-beschrijving. Opzettelijke foutinjecties en locktimeouts verschijnen als Prisma-errors in de log; de bijbehorende assertions slagen. De foutieve lokale browserstarts door een overlappende herbouw en ontbrekende Playwright-executable tellen niet als geslaagde runs; de uiteindelijke volledige run gebruikte een voltooide build en de geïnstalleerde systeem-Chromium.

Screenshots uit de gesimuleerde ontwikkelomgeving, geen productiebeelden:

- [320 px Nederlands: bestaande registraties en afzonderlijke selectie](../screenshots/official-audio/bulk-320-nl.png)
- [390 px Duits, donker, 200% tekst](../screenshots/official-audio/bulk-390-de-dark200.png)
