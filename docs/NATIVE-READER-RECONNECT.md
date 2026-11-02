# Schriftlezer: herstel na tijdelijk netwerkverlies

Gerichte correctie op `develop` na PR #256 (`e0562ef8`), naar aanleiding van de
iPhone-waarneming in build 2495. Nieuwe fysieke acceptatie is nog nodig.

## Aangetoonde oorzaak

De deterministische browserproef liet bij een mislukte hervat-GET met een
502-HTML-respons zien dat LiveDataStore de bevestigde hoofdstuktekst nog bevatte
en de sessie-epoch gelijk bleef. Toch verdwenen alle veertig versteksten uit de
DOM. `nativeLearningTransientError` herkende `invalid_response` met status 502
niet als tijdelijke transportfout. `NativeReaderView` verborg daardoor de data.
De documenthoogte kromp, de browser begrensde de scrollpositie en de positiehook
verloor de mislukte actie bij het opruimen van de verdwenen readerdata.

Daarnaast wisselde `NativeLearningView` tussen een losse Reader en een Reader
onder providers wanneer het leerpad later binnenkwam. Die andere React-structuur
remountte dezelfde reader ondanks zijn key, waardoor herstelreferenties en een
mislukte schrijfintentie verloren konden gaan.

Swift en Java rapporteerden een HTML-5xx zonder de verwachte API-headers als
`access_invalid_response`. Diezelfde foutcode beschermt ook tegen ongeldige
succesresponsen. De exacte respons op de fysieke iPhone is niet opgenomen;
de laboratoriumreproductie bewijst deze codepaden, niet het oorspronkelijke
netwerkpakket op dat toestel.

## Correctie en veiligheidsgrenzen

- Behoud één providerstructuur en Reader-instantie zolang account, sessie-epoch,
  bron, taal en route gelijk blijven, ook bij koude of tijdelijk falende padqueries.
- Behoud bevestigde data uitsluitend bij bekende transportfouten en de beperkte
  5xx-foutcodes. Onbekende fouten, 401/403/404/409, Access-weigeringen en ongeldige
  200-responsen blijven blokkeren. Een harde ouderqueryfout blokkeert ook een
  succesvol gecachte Reader. Handmatige GET-retry hercontroleert falende ouders.
- De native bridges verwerpen een 5xx onmiddellijk als
  `access_network_unavailable`; zij accepteren of retourneren de inhoud niet.
  Redirect-, authenticatie-, CORS-, inhouds- en omvangcontroles op overige
  responsen blijven behouden.
- De bestaande positiehook, actie-UUID, verwachte versie, LiveDataStore,
  sessie-epoch en scrollherstel blijven leidend. Er komt geen cache of outbox bij.
  Een mislukte positie-POST wordt uitsluitend met de bestaande handmatige
  retry herhaald. Achtergrond-GETs mogen de zichtbare lokale positie niet resetten.
- Geen wijzigingen aan backend, schema, migraties, READ, XP, reeksen, vragen of
  afronding. Voor deze reparatie is een nieuwe native bundel/installatie nodig;
  er is geen nieuw backendcontract of backenddeployment vereist.

## Regressiebewijs

`tests/native-reader.browser.mjs` controleert in de echte Foundation + gedeelde
schriftlezer, met geïsoleerde PostgreSQL/Redis en de bestaande native API:

1. Vers 5 opslaan, offline naar vers 20 gaan, opslag laten mislukken.
2. Internet herstellen met een mislukte 502-GET en later geladen ouderqueries.
3. Dezelfde gedeelde DOM-node, veertig teksten en dezelfde viewportpositie van
   vers 20 (marge 3 pixels) behouden; cache en sessie-epoch apart controleren.
4. Een vertraagde succesvolle GET met serverpositie 5 laten terugkomen, zonder
   lokale sprong of automatische POST.
5. Handmatig opslaan met exact dezelfde UUID, verwachte versie en vers; heropenen
   op de daarna bevestigde serverpositie 20, zonder extra POST.
6. Een expliciete ouderweigering en echte ingetrokken collectierechten laten
   blokkeren; handmatige GET-retry herstelt pas na geslaagde rechtencontrole.

De bestaande vijf talen, drie leeswijzen, bron-/accountwisselingen,
sessie-intrekking, read-only SQL-controles en webversmenu blijven meedraaien.
Swift- en Java-transporttests controleren apart dat HTML-5xx-inhoud wordt
weggegooid en ongeldige succesresponsen nog steeds worden geweigerd.

De tijdelijke testobservatie van cache/epoch en schrijfinput wordt alleen door
het esbuild-browserharnas geïnjecteerd, nooit in de distributiebundel.
De werkelijk uitgevoerde controles en definitieve CI-resultaten staan bij de PR.

## Fysieke acceptatie — nog uit te voeren

Na goedkeuring via de bestaande Mac → Capacitor → Xcode/iPhone-werkwijze een
nieuwe build installeren. Android afzonderlijk accepteren.

| Handeling | Verwacht | Foutverschijnsel |
| --- | --- | --- |
| Lang hoofdstuk openen, scrollen, wachten op opgeslagen positie | Positie bevestigd | Ongevraagde afronding of beloning |
| Wifi én mobiele data uit, verder scrollen | Tekst blijft staan; opslagfout | Verdwenen tekst of sprong naar boven |
| Internet aan, wachten op verversen | Zelfde zichtbare vers; opslagfout blijft handmatig | Automatische schrijfretry of scrollreset |
| Opnieuw proberen bij de opslagfout | Positie opgeslagen, tekst en positie blijven staan | Leeg scherm of onverwachte sprong |
| App sluiten en heropenen | Laatst bevestigde serverpositie | Onbevestigde offline positie als opgeslagen presenteren |
| Account/bron wisselen | Alleen nieuwe toegestane teksten | Oude tekst van ander account of bron |

Geen fysieke acceptatie, merge, deployment of productiehandeling is onderdeel
van het automatische testbewijs.
