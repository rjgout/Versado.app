# Native B3b-1 — gedeelde schriftlezer, uitsluitend lezen

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
