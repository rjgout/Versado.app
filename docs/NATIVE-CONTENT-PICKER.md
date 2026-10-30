# B1 — dezelfde contentkiezer op web en native

Basis: develop `0c56b029ab246da5645f20a3fd3dcdcc0e7831c1` (gedeelde shell
uit #239). De eigenaar bevestigde de fysieke iPhone-proef van die eerdere
shell. **Deze nieuwe integratie vraagt opnieuw fysieke acceptatie.**

## Werkelijke hergebruikgrens

`ContentSwitcherView` en `ContentPickerView` bevatten de bestaande React-presentatie:
bronkaarten, groepen, exacte edities, vijf talen, beschikbaarheid en actieve keuze.
De bestaande webcomponenten zijn kleine adapters voor Next-navigatie, webdata en
vertrekgeschiedenis. Native gebruikt dezelfde views, LiveDataStore en bestaande
lokale router. `ContentIcon` gebruikt één mediapoort: Next Image op web, dezelfde
lokaal gebundelde contenticonen op iOS/Android. Geen gekopieerd scherm, extra
provider, voorkeurenopslag of database.

De lokale `/content`-route toont alle door de bestaande servercatalogus toegestane
collecties en het permanente CFM-programma. Lofzangen, Mijn studiemap en beheer
zijn losse activiteitbestemmingen; hun bestaande webingangen blijven behouden,
maar native biedt ze pas aan wanneer hun echte lokale schermen zijn geïntegreerd.
Deze PR claimt daarvoor geen pariteit.

## Bestaande selectie en beveiliging

- De additieve capability `content-picker-v1` opent alleen de exacte native
  `GET`/`POST /api/v1/native/content-context`. TS, Swift en Java laten dezelfde
  route/werkwoorden toe; origins, Service Auth en credentialopslag blijven gelijk.
- GET gebruikt `getContentPickerContext` en de bestaande switcherinstelling,
  zonder impliciete voorkeuren, cursussen of voortgang te schrijven.
- POST gebruikt `applyContentSwitch`, de bestaande route-equivalentresolver en
  `commitContentSelection`. Een serveradapter controleert de actuele sessie
  binnen dezelfde transactie als de selectie. Lockvolgorde User → NativeSession;
  daarna dezelfde User-selectielock. Maximaal 1,5s lockwachten/5s transactie.
- De bestaande `contentSelectionVersion` en verwachte selectie zijn verplicht.
  Geen nieuwe migratie. A→B→A of een verloren antwoord geeft bij een oude aanvraag
  409, gevolgd door alleen leesherstel. Rechten worden binnen de commit opnieuw
  met de actuele gebruiker gecontroleerd. Databasefouten rollen de hele selectie
  terug en worden zonder serverdetails als 500 afgehandeld.
- Geen XP, reeks, hints, cursus- of leesvoortgang in deze selectieflow. Geen
  automatische schrijfretry of offline wachtrij.
- Account-ID + sessie-epoch begrenzen de gedeelde cache. Een vertraagde context-GET
  kan een hogere, bevestigde selectieversie in diezelfde store niet terugzetten.
  De bestaande store weigert ook een al ontvangen GET wanneer `setData` tussen
  ontvangst en verwerking een bevestiging plaatst. Oude successen kunnen de waarde niet
  terugzetten; een leesfout blijft zichtbaar naast de bevestiging. Nieuwe GETs
  blijven normaal werken.
  Hoofdstukken/Vandaag gebruiken ook collectie-/selectieversie, zodat oude tekst
  niet onder een nieuwe bron verschijnt. Oudere servers zonder capability
  behouden hun bestaande Foundation-flow. De beperkte Vandaag-leesproef leest
  dezelfde canonieke bron als de kiezer; een oude actieve cursus zonder expliciete
  bron mag geen andere tekst aanbieden. Dit blijft een eerste-hoofdstukproef,
  geen vervanging voor de servercursor en volledige cursussen in B3.

De native adapter start/pauzeert dezelfde `LiveDataStore.tick`-klok als web; er
is geen apart pollsysteem. De zichtbare context is 15 seconden vers, met maximaal
één extra klokseconde plus netwerkduur. Mislukte GET-pogingen tellen mee voor
het pollinterval; een fout versnelt de klok niet naar één aanvraag per seconde.
Bewust focus-/online-/hervatherstel blijft direct mogelijk.

Een native wijziging invalideert de bestaande webgebruikersroom met
`contentChanged`; de eigen native cache verwerkt de bevestiging direct. De interne
Access-build blijft **zonder WebSocket**. Webwijzigingen komen daar via dezelfde
store terug bij focus/hervatten/onlineherstel of zichtbaar uiterlijk bij de
15-secondenpoll met de bestaande één-secondenklok (geen polling op de achtergrond/offline). Dit is een expliciete
beperking tegenover onmiddellijke realtime; geen Cloudflare-bypass.

## Interne bediening

De gewone interface bevat geen permanent toegangs-/build-/toetsenbordpaneel.
Intern: compacte testbuildindicatie, `/diagnostics` via het profiel en ook via het
lokale inlog-/foutscherm. Toegang herstellen/wissen en netwerkherstel blijven
zonder werkende backend bereikbaar. De diagnoseroute accepteert geen externe
deeplink en krijgt buiten interne builds geen inhoud. Logout staat in Profiel en
gebruikt dezelfde duurzame intrekking. Juridische informatie blijft bereikbaar.

## Verificatie

De definitieve PR bevat de exacte uitgevoerde resultaten en CI-links.

- Native data-/sessie-/auth-/Access-, shell-, webdata- en contentwisselregressies.
- Geïsoleerde PostgreSQL/Redis: catalogusgelijkheid, vijf talen/exacte edities,
  hidden/draft/disabled, Bearer/webscheiding, twee echte processen, web/native
  concurrentie, ABA/retry, hoofdstukequivalent, sessie-lockrace en foutrollback.
  De canonieke leestest verwijdert zijn eigen boek in `finally` en vergelijkt de
  hoofdstuk-ID’s vóór/na: de bestaande quizvragenpool blijft exact ongewijzigd.
  De oorspronkelijke regressie voor één hintbeloning is niet aangepast.
- Echte Next-webpagina en lokale React-bundel naast elkaar, dezelfde synthetische
  gebruiker/context: 320/375/390/400px, 100/200%, vijf talen, licht/donker en tablets.
  Screenshots onder het bestaande Native Foundation-CI-artifact, submap
  `content-picker`; kaarten/teksten/klassen worden ook rechtstreeks vergeleken.
- Bestaande verplichte 2FA, logout/accountwisseling, Access-herstel en late
  leesafrondingsresponses blijven in de browserrunner getest.
- TypeScript, lint, vertalingen, schone Next-build, lokale bundel/profielen en
  iOS-/Android-compilaties. Een browser- of CI-build bewijst geen fysieke acceptatie.

## Volgende uitvoerbare fasen

Na onafhankelijke review en afzonderlijke toestemming: B2 dezelfde Vandaag-kaarten
met werkende bestemmingen; B3 dezelfde cursuskaarten en drie correcte leesroutes
(servercursor, nooit een verse-stap als compleet hoofdstuk); B4 volledig profiel.
APNs/FCM volgt als afzonderlijke vroege PR zodra account-/notificatiecontracten
vaststaan, zonder op alle spellen te wachten. Daarna B5 per bestaande functie,
met eerst een goedgekeurd beveiligd realtimecontract voor Access. Geen wijzigingen
aan CFM-CI #237, Apple-loginvoorbereidingen of infrastructuur.

### Fysieke herproef door de eigenaar

Nieuwe interne build installeren; bestaande login + 2FA en herstart testen. Open
dezelfde contentkiezer naast web, kies bron/taal/ondubbelzinnige editie, controleer
hoofdstukequivalent en behoud van voortgang. Wissel via web en hervat de app;
controleer ook de begrensde poll. Test offline fout + herstel zonder herhaalde
schrijfactie, logout/accountwisseling, interne toegang herstellen/wissen,
VoiceOver/TalkBack, kleine iPhone/iPad/Android, grote tekst en safe areas.
