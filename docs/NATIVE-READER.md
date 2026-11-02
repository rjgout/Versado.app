# Native schriftlezer — B3b-1, B3b-2a en B3b-2b

De eerste secties beschrijven B3b-1 en het bijbehorende historische testbewijs.
De eigenaar accepteerde B3b-1 inmiddels op iPhone build 2494. De aanvullende
hervatpositie/hoofdstuknavigatie en nieuwe fysieke acceptatie staan [onderaan](#b3b-2a--duurzame-hervatpositie-en-hoofdstuknavigatie).

De aansluitende B3b-2b-uitbreiding gebruikt hetzelfde versmenu en dezelfde
annotatie-editor als web; zie [gedeelde annotaties](NATIVE-ANNOTATIONS.md) voor
contracten, beveiliging, tests en de nog openstaande fysieke acceptatie.
De historische secties hieronder blijven het bewijs van hun eigen fase.

## B3b-1 — gedeelde schriftlezer, uitsluitend lezen

Uitvoering van [issue #251](https://github.com/rjgout/Versado.app/issues/251), vanaf develop
`0716e2666daee1d81560ad1310c76b0e9d1b0ab2`. Bij aanvang stond #252 nog open als draft;
na de merge is de branch zonder conflicten op de nieuwe develop-basis gebracht. Deze PR voegt
geen CFM-herstel-, #237-, import-, media- of publicatiewijzigingen toe. Deze fase ondersteunt
uitsluitend reeds toegankelijke uitgaven van het Boek van Mormon en bestaande cursus-/stapidentiteiten.

## Werkende eerste fase

- Stap voor stap opent het exacte bestaande `CourseLesson`-versbereik.
- Hoofdstuk voor hoofdstuk opent het gekozen, volgens het bestaande pad toegestane hoofdstuk.
- Vrije keuze opent elk toegestaan gekozen hoofdstuk uit de cursus.
- Web `ReaderView` en native `NativeReaderView` gebruiken **dezelfde** `ScriptureReaderView` voor
  titel, typografie, tekstgrootte, versnummers, selecteerbare tekst en tekstmarkeringen/presentatieslots.
  De bestaande webaudio-/annotatieadapters blijven bij `LessonFlow`; ze komen niet in de lokale bundel.
- Native toont bron/taal, leest een reeds bevestigde verspositie en gebruikt centrale focus-/scrollcoördinatie.
  Het leerpad blijft tijdens lezen verborgen gemount, met behoud van open groepen en bestaande LiveDataStore-data.
  Er komt geen tweede cache of leesvoortgangssysteem bij. Tijdens lezen is er geen leerpadpoll.
- De oude `/lesson/<id>`-Foundation-proef toont een terugverwijzing naar Leren. De losse tekstkopie en
  hoofdstukafrondknop zijn verwijderd uit de nieuwe app. Bestaande backendcontracten blijven voor oude apps bestaan.

Dit is **geen volledige lezerpariteit**: native audio/TTS, annotaties, nieuwe duurzame leespositie-opslag,
vorig/volgend hoofdstuk en verdere lezeracties blijven B3b-2. Vragen, les-/stapafronding, XP en beloningen
blijven B3c. Er zijn geen verborgen of niet-werkende actieknoppen voor die functies. Openen of scrollen
registreert geen READ, cursusstart, oefensessie, reeks of beloning.

## Contract en beveiliging

Capability `scripture-reader-v1`, versie 1; uitsluitend:

```
GET /api/v1/native/courses/<courseId>/read/steps/<lessonId>
GET /api/v1/native/courses/<courseId>/read/chapters/<chapterId>
```

Lokale routes hebben dezelfde contextdragende grammatica zonder `/api/v1/native`.
De kleine linkadapter vertaalt uitsluitend `/reading-lesson/<id>` binnen de actuele cursus en
`/lesson/<id>?cursus=<dezelfde-courseId>`. Andere queries, vreemde cursus-ID's, encoded paden en
niet-ondersteunde bestemmingen blijven geweigerd. De algemene native router accepteert nog steeds geen querystrings.
Nieuwe GET-paden zijn exact toegestaan in TypeScript, Swift en Java; POST/PUT/PATCH/DELETE/HEAD niet.
Geen proxy, webcookies, nieuwe authenticatie of Cloudflare-uitzondering.

De server hergebruikt `nativeCoursePath` en daarmee `loadReadingPath`, `getStepOverview`,
`loadChapterPath` en `chapterLocks`. De geselecteerde ingeschakelde bron, cursusmethode, deelname-/leesrechten,
hoofdstukrelatie en beschikbare stap blijven leidend. Na de tekstquery worden sessie, bronselectieversie (ook ABA),
taal, context en cursus-/staprechten opnieuw gecontroleerd. Maximaal 500 aaneengesloten verzen,
20.000 tekens per vers en 512 KiB JSON; ontbrekende of te grote tekst geeft geen afgekapt hoofdstuk.
Geen SSR-loader die `markCourseStarted` of `issueExerciseSession` aanroept wordt native hergebruikt.

LiveDataStore-keys bevatten account, epoch, taal, bron/selectieversie, cursus, leeswijze en doel-ID.
Late antwoorden na logout/account-/bronwisseling worden verworpen. Tijdelijke netwerkfouten mogen reeds geladen
tekst laten staan; 401/403/404/409 en Access-weigering tonen die tekst niet. Er zijn geen offline mutaties of schrijfretries.
Op oudere backends zonder capability blijft de nieuwe lezer expliciet niet beschikbaar.

## Testbewijs

Lokale verificatie op de geïntegreerde develop-basis:

- `test:native`: 111 native- en 80 datatests geslaagd.
- Gecombineerde reader-/cursus-/CFM-contract-/webversmenu-unitproeven: 19/19 geslaagd.
- Volledige standaard `test:native:integration`: 80/80 API-/databaseproeven en 64/64
  socket-/content-/actieraces geslaagd, plus alle dertien browserprogramma’s. Daarbinnen reader-SQL 6/6;
  standaardmigratiebehoud/foutrollback van de runner behouden.
- Readerbrowser: alle drie leeswijzen in vijf talen; 25 screenshots; vertraagd A-antwoord na B-login,
  bron/capabilityweigering, offline herstel en zes minuten behoud van open boekgroepen geslaagd.
- Bestaande Access-browser: vijf taal-/layoutconfiguraties met gesimuleerde native Service Auth-bridge;
  echte read-only cursusroute, late A-verscursor na B-login, intrekking/enrollment, geen secrets in JS
  en geen WebSocket geslaagd. Een unieke A-kop in de vertraagde fixture-response bewijst
  dat de actuele B-presentatie na die levering intact blijft; deze proef steunt niet op de tijdelijke versmarkering. De oude afrondings-UI-proef is vervangen; de bestaande backward-compatible
  POST-bevestiging-/GET-foutcontracten blijven in de runtime-unittests gecontroleerd.
- Bestaande contentkiezerbrowser gebruikt nu de echte cursus-/readerroute na bronwisseling:
  100 gekoppelde web/native screenshots en selectie-, terug-, account- en offlinecontroles geslaagd.
- Bestaande Foundation-/accountbrowser, B3a-cursusbrowser (54 web/native screenshots) en
  webversmenu-/audio-/annotatiebrowser (40/40 controles) geslaagd.
- Routefocus: 16 viewport-/tekst-/themacombinaties, drie oude-backendgevallen en acht gecombineerde
  content-/scroll-/sessieflows geslaagd. Focus-/shell-unitproeven 28/28; pariteitstests 6/6.
- Schone Next-productiebuild, TypeScript, ESLint (geen fouten), vertaalcontrole, lokale native bundel,
  Capacitor-sync en beide distributieverificaties geslaagd. Repositorywaarschuwingen bij ESLint en
  dynamische bestandstracering bij Next en bestaande `pg`-concurrentie-deprecaties in de media-/CFM-browsertests blijven apart van fouten; de bestaande fontscale-effectwaarschuwing
  verhuisde met de gedeelde tekstpresentatie.
- De Linux-omgeving voert geen Xcode-simulatorcompilatie uit. iOS-/Android-compilatie en de volledige
  bestaande integratieketen moeten op de definitieve PR-head via de bestaande CI slagen.

De actuele PR bevat de definitieve commit, onafhankelijke review en werkelijke CI-status.
De gerichte SQL-suite gebruikt uitsluitend eigen PostgreSQL/Redis en synthetische hoofdstukken:

- Exact stapbereik, drie leesmethoden, echte gekozen hoofdstukken en cursors.
- Fingerprints van **alle tabellen** vóór/na herhaalde GET, ook sessies, XP, oefensessies en voortgang.
- Onbevoegde/methode-/cookie-/bron-/cursus-/slotgevallen en ontbrekende/te grote tekst.
- Echte tekstquery-wachttijd via een tijdelijke testview en advisory lock: intrekking, verloop,
  verplichte beveiliging, bron-ABA, taal en ingetrokken rechten tijdens laden. Geen productietesthooks.
- Runtime-unitproeven verwerpen late antwoorden na account-/epoch-/bron-/taalwisseling.
- Browservergelijking met de echte webschriftlezer; vijf talen, 320px/200%, licht/donker,
  veilige schermranden, selectie, terugnavigatie, langdurig geopende groepen en capabilityfallback.
- Bestaande webversmenu-/audio-/annotatieregressies en native login-/sessietests blijven van toepassing.

Gerichte lokale runner (bestaande infrastructuur, geen externe contentdownloads):

```
node scripts/native/test-isolated.mjs --reader-only
```

`--no-browser` beperkt de lokale ontwikkelronde tot SQL; CI gebruikt de volledige bestaande keten.
Screenshots komen in `native-foundation-browser`, map `reader`. Simulator-/browser-/compilatiebewijs
is geen fysieke iPhone- of Android-acceptatie.

## Vergelijkende screenshots

Synthetische inhoud uit de geïsoleerde database; echte React-schermen en CSS.
Geen productiegegevens en geen fysieke toestelacceptatie.

| Weergave | Bewijs |
| --- | --- |
| Native stap, Nederlands, 320px/200% | [Twee juiste verzen](native-reader/nl-step-native.png) |
| Native hoofdstuk, Engels, 390px/donker | [Volledig hoofdstuk](native-reader/en-FREE_CHOICE-native.png) |
| Dezelfde tekst in de weblezer | [Webhoofdstuk](native-reader/en-FREE_CHOICE-web.png) |
| Native stap op tablet, Frans/donker | [Tablet](native-reader/fr-step-native.png) |

## Eigenaaracceptatie — PENDING PHYSICAL ACCEPTANCE

Eerst afzonderlijk goedgekeurde merge en door de eigenaar uitgevoerde update van alleen de bestaande development-app.
De backend moet `scripture-reader-v1` bieden. Geen migratie, seed, import of publicatie nodig voor deze codewijziging.
Bouw daarna op de Mac met de bestaande [interne Capacitor/Xcode-procedure](NATIVE-CLOUDFLARE-ACCESS.md#interne-build-maken-geen-secrets-nodig-of-toegestaan).
Een bestaande geïnstalleerde app krijgt geen nieuwe lokaal gebundelde schermen zonder nieuwe build/installatie.

| Handeling op iPhone/Android | Verwacht | Foutverschijnsel |
| --- | --- | --- |
| Aanmelden met 2FA, app sluiten/heropenen | Juiste gebruiker en sessie hersteld | Andere gebruiker, herhaalde setup of verdwenen sessie |
| Leren → Stap voor stap → huidige stap | Juiste boek/hoofdstuk, uitsluitend de aangegeven verzen | Eerste hoofdstuk, hele hoofdstuktekst of vergrendelde stap |
| Hoofdstuk voor hoofdstuk → toegestaan hoofdstuk | Volledig gekozen hoofdstuk, juiste bron/taal | Ontbrekende verzen of verkeerd hoofdstuk |
| Vrije keuze → ander boek/hoofdstuk | Exact de gekozen tekst | Stilzwijgend de eerste cursuspositie |
| Groepen openen, lezen, teruggaan | Open groepen en logische terug-/scrollpositie blijven behouden | Inklappen, verspringen of focusrand |
| Grote tekst, licht/donker, lang indrukken/kopiëren | Leesbare tekst, geen horizontale overflow; selectie werkt | Afgesneden tekst, geblokkeerd kopiëren of onbruikbare knoppen |
| Tijdens lezen offline en weer online; app hervatten | Begrijpelijke status; geen automatische schrijfactie | Verloren tekst bij tijdelijke fout of onverwachte afronding |
| Bron/taal of account wisselen | Juiste nieuwe context; geen oude tekst | Tekst of cursor uit de vorige bron/gebruiker |
| VoiceOver/TalkBack en systeemterug | Juiste kop, leesvolgorde, focus en terugbestemming | Focus in verborgen leerpad of vastlopende terugknop |
| XP/reeks/leesvoortgang vergelijken vóór/na lezen | Ongewijzigd | Nieuwe READ, XP, stapafronding of vragen |

B3b-2/B3c en fysieke toestelacceptatie worden afzonderlijk beoordeeld. Deze PR merge/deployt niets en raakt
main, productie, NAS, Portainer, Cloudflare, CFM of bestaande gebruikersgegevens niet.

## B3b-2a — duurzame hervatpositie en hoofdstuknavigatie

Basis: `develop` `309ea557a244f70760601c6ff6ca436287043777`, na #253.
De eigenaar heeft B3b-1 op een fysieke iPhone (build 2494) in alle drie de
leesmethoden geaccepteerd. Dat bewijs geldt niet als toestelacceptatie van 2a.

De bestaande `ScriptureReaderView` blijft dezelfde React-presentatie voor web
(`LessonFlow.ReaderView`) en native (`NativeReaderView`). De webadapter,
annotaties en audio veranderen niet. Native voegt uitsluitend een adapter toe
voor het waarnemen van een stabiel zichtbaar vers en bestaande route-navigatie.

### Opslag en compatibiliteit

`ContentProgress.readVerse` is voltooide gedeeltelijke leesvoortgang, met
bestaande READ-/lesregels; de canonieke contentKey wordt bovendien tussen talen
en cursussen gedeeld. Dat veld gebruiken voor een zichtbare scrollcoördinaat zou
betekenissen vermengen. De CFM-ReadingPosition is revisie-/lesgebonden en blijft
onaangeroerd. Zonder schema-uitbreiding is afzonderlijk bewaren per uitgave,
cursus en leesstap daarom niet veilig mogelijk.

De additieve migratie `20261208120000_scripture_reader_positions` voegt alleen
`ContentProgress.readerPositions JSONB NOT NULL DEFAULT '{}'` toe. Bestaande
rijen, oude readVerse-posities en alle andere velden blijven behouden. De sleutel
is een JSON-tuple van collectie, brontaal, cursus, leeswijze, doel en hoofdstuk;
de gebruiker volgt uit de bestaande ContentProgress-relatie. Het is een
hervatcoördinaat, geen tweede voortgangs-/beloningssysteem.

Capability `scripture-reading-position-v1` activeert twee exacte nieuwe routes:

- GET `courses/<id>/read/<steps|chapters>/<target>/resume`: bestaande
  reader-v1-data, opgeslagen focusvers/versie en toegestane hoofdstukburen.
- POST `courses/<id>/read/<steps|chapters>/<target>/position`: actie-UUID,
  verwachte versie, exacte hoofdstuk-/versgrenzen, actuele
  collectie/selectieversie/UI-taal en zichtbaar vers.

Het oorspronkelijke `scripture-reader-v1`-GET-contract blijft ongewijzigd, omdat
oudere apps het strikt valideren. Zonder nieuwe capability blijft de huidige
read-only lezer werken. TypeScript, Swift en Java staan uitsluitend GET resume
en POST position toe; geen wildcard, query, cookies of andere transportlaag.

### Wanneer wordt bewaard?

Openen, GET, focus, programmatisch scrollherstel en app-hervatten schrijven niets.
Pas echte wiel-/aanraak-/lees-toetsinteractie activeert observatie. Na minimaal
één seconde rust moet hetzelfde zichtbare vers nog 1,5 seconde stabiel blijven.
Verzen worden alleen binnen het daadwerkelijk geopende bereik waargenomen;
ook een lang vers hoeft niet volledig in het scherm te passen. Er geldt minimaal
acht seconden tussen opslagpogingen en maximaal één lopende poging. Een nieuwe
stabiele waarneming tijdens een lopende poging mag na bevestiging volgen.

Vóór de eenmalige positie-POST controleert een bestaande read-only GET `me`
de sessie. Zo kan het bestaande korte access-token veilig worden vernieuwd
zonder de schrijfactie opnieuw te versturen. De account-/epoch-/broncontrole
wordt ook na deze leescontrole uitgevoerd. Geen tweede authenticatielaag.

Alleen serverbevestiging toont 'opgeslagen'. Bij een fout blijft een handmatige
retry beschikbaar in werkgeheugen; online komen verstuurt geen schrijfactie.
Een onbekende uitkomst wordt alleen expliciet met dezelfde actie-identiteit
herhaald. Bij versieconflict moet de gebruiker eerst de serverstand opnieuw
laden en daarna opnieuw lezen; een oude intentie wordt niet blind overschreven.
Verlaten van de route/logout verwijdert observaties en timers; geen offline
opslag of mutatiewachtrij. Afsluiten vóór een stabiel vers is bevestigd kan dus
alleen de laatst bevestigde positie herstellen.

### Commitgrens en gegevensveiligheid

De bestaande `commitAccountMutation` serialiseert User → NativeSession en
controleert de sessie vóór en na het werk, ook na lockwachten. Vervolgens worden
collectie → cursus → boek → hoofdstuk → leesdoel gedeeld vergrendeld; het bestaande native leerpad
en de lezer controleren opnieuw rechten, selectie en toegestane versgrenzen.
De bestaande context-, pad- en readerloaders ontvangen dezelfde tx; er wordt
binnen de commit geen tweede poolverbinding gevraagd. Een geïsoleerde proef met
één verbinding reproduceerde de oude pooluitputting en slaagt met deze doorvoer.
Ook wijzigingen aan boekidentiteit en stapgrenzen wachten tot de commit.
Binnen dezelfde transactie claimt compare-and-swap de positieversie en wordt
alleen readerPositions geschreven. Een herhaling van exact de laatste actie
levert dezelfde versie op; een oude actie na een nieuwere commit geeft 409.
Teruglezen mag een lager vers bewaren, nooit een lagere versie.

De gerichte SQL-update laat zelfs updatedAt ongemoeid, zodat een gelijktijdige
web-voortgangsupdate en de bestaande cursus-hervatselectie behouden blijven.
Een nieuwe ContentProgress-rij krijgt alleen normale lege defaults. Geen
readStatus, readVerse, readAt, cursus-/lesafronding, oefensessie, XP of reeksactie
wordt door deze positie-opslag aangepast. De bevestiging wordt via dezelfde
LiveDataStore geprojecteerd; diens schrijfversie beschermt tegen oude GETs.
Sessie-epoch en account-/brongebonden keys voorkomen hergebruik tussen accounts.

### Hoofdstukken en grenzen

Hoofdstuk voor hoofdstuk en Vrije keuze gebruiken de bestaande cursusvolgorde en
`chapterLocks`. Een vergrendelde of lege buur wordt niet aangeboden. Iedere
geopende bestemming wordt opnieuw geautoriseerd door de server. Cursuscontext,
herkomst, focus en terugnavigatie blijven via de bestaande adapters lopen.
Stap voor stap blijft binnen het eigen versbereik en biedt geen hoofdstukoverslag.
Geen van deze routes rondt iets af.

B3b-2b (markeringen/notities/bladwijzers), B3b-2c (audio/TTS), B3c (vragen,
afronding/beloningen) en CFM blijven buiten deze PR. De bestaande weblezer
gebruikt zijn huidige hervatlogica; er wordt geen nieuwe automatische webschrijfactie
aangezet en geen bestaande positie naar het nieuwe veld gemigreerd.

### Migreren en terugrollen

Alleen de eigenaar mag later volgens de bestaande deploymentprocedure de
additieve migratie uitvoeren. Deze ontwikkelopdracht voert dat uitsluitend uit
op eigen wegwerpdatabases. Oudere server-/appversies negeren het nieuwe veld.
Bij rollback van de app blijft de kolom staan; verwijder haar niet, zodat nieuw
opgeslagen hervatpunten behouden blijven. Geen seed, reset of inhoudsimport nodig.

### Gericht automatisch bewijs B3b-2a

- Native-/datalaagunitketen: 121 + 80 = 201 geslaagd. Daarbinnen 14 readerproeven,
  inclusief laat antwoord na accountwissel, oude/mislukte GET na bevestigde POST,
  oude writer-port, late me-controle vóór opslag en GET-tokenherstel gevolgd
  door exact één POST.
- Reader-API/SQL: 17 geslaagd op eigen PostgreSQL/Redis. Alle drie leeswijzen en
  vijf talen; tabel-fingerprints bij GET; alleen readerPositions bij opslag;
  replay/CAS; laatste vers zonder ontgrendeling; rollback; migratiebehoud; bron/taal/ABA; User-lockraces met logout,
  verloop, wachtwoord-/setup-/2FA-wijziging en accountverwijdering.
- Dezelfde gebruiker houdt twee posities bij twee uitgaven met dezelfde
  canonieke contentKey. UI-taalwisseling behoudt de positie binnen die uitgave.
- Een apart Node-proces met één poolverbinding controleert alle drie de
  leesmethoden. De eerste featureversie faalde hier reproduceerbaar met
  `timeout exceeded when trying to connect`; doorvoer van tx lost dit op.
- Een echte databasebarrière onderbreekt de cursorupdate na autorisatie:
  gewijzigde stapgrenzen en boekidentiteit worden aantoonbaar geblokkeerd tot
  de commit. Er staan geen productietesthooks in de app.
- De echte gedeelde readerbrowser vergelijkt vijf taal-/layoutconfiguraties
  met de bestaande webschriftlezer. Hoofdstuknavigatie werkt in alle vijf;
  bewaren/heropenen, offline handmatige retry, twee-sessieconflict, capability-
  fallback en late accountresponse worden op NL/320px/200% uitgeoefend.
- Bestaande socket-/actieraces: 64 geslaagd. De standaard CI behoudt alle
  API-, web-/native browser-, audio-/annotatie- en platformcontroles. De
  definitieve commit en complete CI-status worden op de PR geregistreerd.

Screenshots gebruiken uitsluitend synthetische inhoud uit de geïsoleerde test:

| Weergave | Bewijs |
| --- | --- |
| Opgeslagen positie, NL/320px/200% | [Native](native-reader/b3b2a-nl-opgeslagen.png) |
| Offline fout met handmatige retry | [Native](native-reader/b3b2a-nl-offline.png) |
| Hoofdstuknavigatie, Engels/donker | [Native](native-reader/b3b2a-en-hoofdstukken-native.png) |
| Dezelfde tekst, bestaande webreader | [Web](native-reader/b3b2a-en-hoofdstukken-web.png) |

### PENDING PHYSICAL ACCEPTANCE — iPhone en Android afzonderlijk

| Handeling | Verwacht | Foutverschijnsel |
|---|---|---|
| App openen zonder scrollen | Geen opslagactie; bestaande tekst/range | Spontane afronding of XP |
| Elk van drie leesmethoden openen, echt scrollen, enkele seconden rustig lezen | 'Leespositie opgeslagen' binnen eigen bereik | Fout vers of melding zonder bevestiging |
| App volledig afsluiten, heropenen en dezelfde leesstap/hoofdstuk openen | Laatst bevestigde vers, ook halve leesstap | Eerste hoofdstuk/verkeerde helft |
| Bij hoofdstukken vorige/volgende kiezen, daarna terug | Juiste cursusvolgorde, toegestane hoofdstukken, logisch terugpad | Vergrendeld hoofdstuk open of verkeerde bron |
| Stap voor stap openen | Alleen eigen verzen, geen hoofdstukoverslag | Volgende les/afronding zonder vragen |
| Internet uit tijdens opslag; daarna aan | Fout zichtbaar, uitsluitend handmatige retry | Automatisch herhaald schrijven of gewiste tekst |
| Tweede toestel wijzigt hetzelfde hervatpunt | Conflict veilig herstellen; verderlezen kan opnieuw bewaren | Oud punt overschrijft nieuwer punt |
| Uitloggen/A→B en bron-/taalwisseling | Eigen tekst/posities; geen gegevens van A | Verkeerde bron of account zichtbaar |
| Licht/donker, grote tekst, safe areas, VoiceOver/TalkBack | Tekst kopieerbaar en bediening bruikbaar | Overlap, afgesneden knoppen of focusverlies |

Lokale snelle ontwikkelronde: `node scripts/native/test-isolated.mjs --reader-ui-only`
draait de reader-SQL-suite en de echte readerbrowser. De standaardrunner/CI
blijft alle bestaande integratie- en browserprogramma’s uitvoeren.

Automatische resultaten en onafhankelijke review worden bij de definitieve
PR-head vermeld. Compilatie en Chromium-tests vervangen bovenstaande
fysieke acceptatie niet.
