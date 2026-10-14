# Lofzangen: ontwikkelplan

Volgorde van werk om van de technische proef naar een betrouwbare functie te komen, met per fase wat
er klaar moet zijn voordat de volgende begint. Termen BEWEZEN, AANNEMELIJK en ONBEKEND: zie
`01-SOURCE-AUDIT.md`.

## Conclusie van de proef

Geschikt voor de bestaande Versado-app: **ja, als gedeelde web-code zonder nieuwe afhankelijkheid**
(de engine is ongeveer 1.700 regels TypeScript (zonder testhulpmiddelen), kost 1 tot 2 procent van een processorkern in Node en
draait zonder server). Offline gebruik van de engine is **BEWEZEN** haalbaar; het offline leveren
van de bibliotheek is **AANNEMELIJK** (voorstel in `02-ARCHITECTURE.md`).

De proef is **gedeeltelijk geslaagd** volgens de acceptatiecriteria uit de opdracht: het volgen werkt
op synthetische opnamen en op de officiële begeleidingsopnamen, maar er is nog **geen test op echte
Nederlandse orgel- of pianoopnamen in een kerk**, en de automatische herkenning is beperkt tot drie
lofzangen en nog niet getest op echte opnamen buiten de officiële begeleiding. Zie `05-TEST-RESULTS.md`.

## Stand na de tweede ontwikkelronde (voorspel en meezinginterface)

Gebouwd (zie `07-VOORSPEL-EN-ZANGBEGIN.md`): een voorspel-/zangfaselaag zodat een voorspel nooit als gezongen
couplet telt, handmatig "Zang begint" en "Opnieuw synchroniseren", herkennen en volgen in één
luistersessie, en een nieuwe meezinginterface in focus mode met twee tekstweergaven. Alles synthetisch
gemeten; **de eerste praktijktest van de beheerder (met spelende en pratende kinderen) was positief maar
is geen meting**. Wat dat op een echte uitvoering betekent is nog **ONBEKEND**.

Direct na deze ronde zinvol, in volgorde: (1) opnamen van echte diensten met de beheerders-app laten
loggen **zonder audio** (alleen de technische gegevens: positie, fase, bewijs, door de gebruiker handmatig
te bevestigen), zodat de zangbegin-regels op echte uitvoeringen zijn te meten; (2) de drempels (0,8 score,
60% dekking, 20 dB pauze) per toestel en ruimte bijstellen; (3) pas daarna overwegen of lokale stem- of
zangdetectie als extra bewijs zin heeft, met een echte meetset en nooit als doorslaggevend signaal.

## Fase 1: rechten en bronnen vastleggen (voorwaarde, geen code)

1. Schriftelijke licentie of toestemming vastleggen voor het opnemen van tekst en bladmuziek in de
   app, per bron (zie `01-SOURCE-AUDIT.md`, 6). Zonder dat blijft de bibliotheek in de repository
   een proefbestand.
2. Beslissen hoe de bibliotheek wordt geleverd (achter inlog, per uitgave).
3. Bij het nieuwe wereldwijde zangboek: dezelfde stappen voor die bronnen.

## Fase 2: echte meetgegevens (grootste risico)

Alle metingen tot nu toe zijn synthetisch of van een begeleidingsopname met een geschatte
tijdlijn. Voor een betrouwbaar oordeel zijn echte opnamen nodig:

1. 10 tot 20 opnamen van echte uitvoeringen met een telefoon in een kerkgebouw: orgel en piano,
   verschillende organisten, gemeentezang, nagalm, voorspel van verschillende lengte, versnellen en
   vertragen, fermates.
2. De werkelijke positie vaststellen: de organist speelt mee op een digitaal instrument dat MIDI
   uitvoert (de tijdlijn ligt dan exact vast), of een handmatig geannoteerde maatlijn per opname.
3. Daarmee de drempels (betrouwbaarheid, herkenning) kalibreren en de foutmarges uit
   `05-TEST-RESULTS.md` vervangen door echte.
4. Gemeten verwachting op basis van de proef: het volgen werkt, maar de herkenning is het zwakst en
   moet het zwaarst worden getest (zie 04, 6).

## Fase 3: engine versterken

In volgorde van verwachte opbrengst:

1. **Stemming schatten**: kerkorgels staan vaak lager of hoger dan A=440. De extractor heeft
   `tuningSemitones`; een schatting uit de eerste seconden is nodig (**AANNEMELIJK**: ±30 cent werkt
   al, zie 05).
2. **Melodie in het kenmerk**: de herkenning wordt het meest gehinderd door gelijksoortige
   akkoordreeksen. Een tweede kenmerk voor de hoogste partij (of onset-ritme) kan de scheiding
   verbeteren. De eenvoudige onset-term uit de proef maakte het slechter (04, 5); het moet
   zorgvuldiger.
3. **Refreinen en herhalingen** (zoals de extra tekstrijen in lofzang 36) in het model opnemen.
4. **Rondes**: voorspel van een heel couplet kiezen (`preludeLaps`) en gemiste rondes beter
   afleiden.
5. **Verwerking in een worker** (AudioWorklet of Web Worker) in plaats van de hoofdthread, zodat
   interface en analyse elkaar niet hinderen. Nu staat de analyse op de hoofdthread (0,5 ms per
   frame in Node).
6. **Batterij en processorbelasting meten op echte toestellen** (iOS en Android). **ONBEKEND**:
   nu alleen in Node gemeten.

## Fase 4: gegevens voor het hele zangboek

1. De extractor uitbreiden voor wat nu meldingen geeft: rusten, herhalingstekens, tweede
   eindes, drie of meer stemmen per balk, andere lettergrepen. Doel: elke lofzang slaagt of krijgt
   een duidelijke melding.
2. Elke gemelde lofzang handmatig controleren; een controle op toonhoogte tegen de begeleidingsopname.
3. Melodieën vergelijken (melodienaam plus intervalreeks) om dubbele melodieën vast te stellen
   voordat herkenning voor het hele boek wordt aangezet.
4. Importeer naar de databasetabellen uit `02-ARCHITECTURE.md` met een migratie volgens het
   migratiebeleid, via het bestaande contentbeheer.

## Fase 5: integratie in de app

1. Plaats kiezen (voorstel: onder Leren of Spelen), met de shell- en focusmodusregels uit
   `docs/LAYOUT.md`. Eerst een aparte beslissing nodig over navigatie.
2. Alle teksten via i18n in alle `uiReady`-talen; uitlegonderwerp in Kompas; test via
   `npm run test:kompas` en `npx tsx scripts/i18n/check.ts`.
3. Offline bibliotheek (IndexedDB) volgens `02-ARCHITECTURE.md`, 5; serviceworker ongewijzigd.
4. Microfoonpermissies voor iOS en Android toevoegen via `src/lib/platform.ts` en
   `NativeAppBridge.tsx`, pas wanneer de feature ze nodig heeft, en testen in `remote-preview`.
5. Privacytekst en toestemming in het profiel/Privacy-onderdeel; geen analytics op audio.
6. Toegankelijkheid: schermlezer (de actieve regel is `aria-current`), grote tekst, bediening met
   één hand; de proef is gecontroleerd op 320 px en 200% tekst in Chromium.

## Fase 6: nieuw zangboek en andere talen

Zie `02-ARCHITECTURE.md`, 8. Eerst het huidige Nederlandse boek betrouwbaar, pas daarna het
nieuwe wereldwijde zangboek, en daarna andere talen. Per taal: eigen bladmuziek-PDF's en een
herhaling van de koppeling en de tests.

## Wat nu direct nodig is (volgende concrete ontwikkelfase)

**Fase 2, opname- en meetcampagne in een kerkgebouw**, gekoppeld aan fase 1, punt 1. Pas daarmee is
vast te stellen of de nauwkeurigheid die op synthetische opnamen is gemeten ook in een echte dienst
haalbaar is, en of de herkenning een voorstel mag doen. Tot dat moment: alleen als ontwikkelroute.
