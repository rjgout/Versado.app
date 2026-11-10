# Native hoofdstukaudio — B3b-2c, transportfundering

## Status en integratievolgorde

B3b-2c deel 2 sluit de bestaande gedeelde speler, mini-speler en provider aan op
PR #261 (develop `77de2d13dd7f0dfea48e0dbfa3b2fc80b4226979`). Web blijft
HTMLAudioElement/Web Speech gebruiken; native gebruikt een uitvoeradapter.
`scripture-audio-v1` maakt de bediening uitsluitend beschikbaar in de bestaande
interne Service Auth-build. Andere distributieprofielen krijgen geen onbeveiligde
terugval. Geen migratie, nieuwe audio, import, publicatie of voortgangsmutatie.

De transportfundering hieronder blijft van toepassing. Nieuwe native code vereist
een nieuwe lokale bundel, Capacitor-sync en Xcode-/Android-installatie. Alleen
backend bijwerken maakt een eerder geïnstalleerde app niet geschikt.

## Speler, TTS en lifecycle

- `ReadAloudPlayer`, `ReadAloudMiniPlayer` en `ReadAloudPlayerProvider` zijn
  dezelfde React-componenten op web en native. NativeReadAloudPlayer levert
  metadata via LiveDataStore, geen tweede afspeelinterface of serverdatacache.
- Opnamekeuze begint bij de teksttaal; andere talen vragen een expliciete keuze.
  Computerstemmen komen uitsluitend uit de daadwerkelijk beschikbare native
  stemmenlijst en moeten bij de geopende teksttaal passen. Een ontbrekende
  webstemvoorkeur wordt geen stem in een andere taal. Toestelstemvoorkeuren worden
  per taal bewaard en overschrijven de bestaande Nederlandse webstem niet. Native tekst voor TTS
  komt uit de geautoriseerde serverresponse, nooit uit een JS-spreekcommando.
- Alle vijf snelheden, verskeuze, vorige/volgende vers, pauze, hervatten en stop
  delen de bestaande bediening. iOS AVPlayer begrenst met forwardPlaybackEndTime;
  Android Media3/ExoPlayer met ClippingMediaSource. Geen UI-timer als stapgrens.
  De enige nieuwe Android-runtimeafhankelijkheid is Media3 exoplayer 1.11.1;
  deze gebruikt de bestaande begrensde transportadapter, geen eigen HTTP-stack.
  Media3 kan vierbyte-peeks doen. De native decoder heeft daarom één tijdelijk
  64KiB-read-aheadblok (maximaal vier tijdelijke fills), nooit een MP3-bestandscache.
  Ook bufferaflevering loopt door de bestaande lifetime-/close-gate. Close annuleert
  netwerk-I/O vóór het bufferlock en wist de bytes; netwerk-I/O houdt geen lock vast.
  iOS vraagt circa 15 seconden voorwaartse buffering; AVFoundation beheert de
  daadwerkelijke decoderbuffers. Werkelijk toestelgeheugen moet nog worden gemeten.
- Deze fase is **uitsluitend voorgrond**. Achtergrond, schermslot, onderbreking,
  verlies van audiofocus, loskoppelen hoofdtelefoon en verlaten van de lezer
  stoppen en ruimen uitvoer/buffers op. Geen automatische hervatting, background
  audio entitlement, media service of claim van lockscreenbediening.
- iOS kan een TTS-uitspraak pauzeren/hervatten; Android hervat het huidige vers
  opnieuw, omdat TextToSpeech geen betrouwbare woordcursor/pauze biedt.
  Beschikbaarheid/offlinewerking en verstaanbaarheid vereisen toestelacceptatie.
- Podcast en schriftvoorlezen blijven elkaar uitsluiten via bestaande events.
  De mini-speler staat binnen de gedeelde header en vouwt op kleine schermen.
  Hoofdstukwisseling stopt; het volgende hoofdstuk vraagt nieuwe autorisatie.
- Voorlezen vanuit het bestaande annotatiemenu respecteert notitieconcepten en
  onzekere annotatieschrijfacties. Audio markeert alleen het vers; native volgt
  niet automatisch met scrollen. Bediening ontwapent de leespositietimer,
  behoudt een mislukte positie-intentie voor handmatige retry en schrijft niets.

## Verzegelde native context en vernieuwing

Een niet-geheime UUID-requeststamp volgt de bestaande NativeSessionClient-epoch.
De native reset moet bevestigd zijn vóór de volgende Access-request. Alleen een
succesvol bestaand native login-/refresh-/setupantwoord kan een token voorbereiden.
Pas nadat hetzelfde refreshpaar veilig is opgeslagen, wordt het native anchor
actief. Dit is een tijdelijke geheugenbinding, geen tweede sessie of tokenopslag.
Oude outbox-writes mogen geen nieuw account activeren of zijn voorbereide paar
wissen. Falen van de bijbehorende veilige opslag maakt het paar onbruikbaar.

De native capsule bevat sessie-ID/-versie, gebruiker, exacte leesscope,
selectieversie, tekst, bron/publicatie-identiteit en beschikbare opnamen. JS geeft
alleen eigenaar, command-ID, oplopende actiesequentie, versindex, snelheid en
opname-/stem-ID door. Credentials en MP3-bytes blijven native. Een nieuwe
reader-eigenaar voorkomt ook hergebruik na verlaten en heropenen van dezelfde route.

De geldigheid is maximaal vijf minuten en nooit langer dan de bestaande JWT,
inclusief verstreken aanvraagtijd en drie seconden marge. Voor lang luisteren
vraagt de adapter vóór afloop uitsluitend nieuwe leesautorisatie aan via de
bestaande refreshqueue. Er is geen schrijf-retry of nieuwe refreshimplementatie.
Tijdens spelen controleert dezelfde metadataquery elke 30 seconden opnieuw de
rechten, uitsluitend op de voorgrond. Lokale logout/account-/bron-/Accesswissel
stopt direct. Een op afstand ingetrokken recht kan pas bij de volgende controle
worden waargenomen (of eerdere streamrequest); offline geldt de harde leasetijd.
Reeds afgespeelde bytes kunnen niet worden teruggenomen. Een streamingfout
beëindigt audio, maar trekt niet zelfstandig de hele Versado-sessie in.

## Audit en hergebruik

De webspeler gebruikt HTMLAudioElement en speechSynthesis. De huidige JSON-Access-brug
is begrensd op 1 MiB en is ongeschikt voor MP3/base64. De bestaande native
NativeSessionClient blijft eigenaar van login, Bearer, refresh en logout.
Service Auth blijft uitsluitend in native code en Keychain/Keystore.

`chapterAudioEditions` bevat de ongewijzigde selectie uit de bestaande webroute:
canoniek boek/hoofdstuk, leesrechten en dezelfde work + editionKey-familie.
De webroute houdt dezelfde authenticatie, respons en fouten. Native hergebruikt
de bestaande publicatie-/opnamerechten, `activeChapterAudio`, segmenten en mirror.
Een externe legacy-URL wordt hier nooit opnieuw opgehaald. Ontbrekende lokale
mirror betekent onbeschikbaar. Legacy vereist een reeds bestaande actuele
tekstcontrole; een GET voert geen audioherstel of goedkeuring uit.
Een onbruikbare V2-publicatie wordt niet willekeurig door legacy vervangen;
alleen de bestaande gecontroleerde fallback mag worden aangeboden.

## Contract en servergrenzen

Uitsluitend binnen de bestaande native readercontext:

```
GET courses/<courseId>/read/{steps|chapters}/<targetId>/audio
GET courses/<courseId>/read/{steps|chapters}/<targetId>/audio/playback
GET courses/<courseId>/read/{steps|chapters}/<targetId>/audio/<sha256-id>/stream
HEAD courses/<courseId>/read/{steps|chapters}/<targetId>/audio/<sha256-id>/stream
```

Alle paden vallen onder `/api/v1/native/`. Alleen de kleine JSON-catalogus is aan
de TypeScript-/Swift-/Java-JSON-allowlists toegevoegd. Die bruggen blijven binaire
streamroutes en HEAD weigeren. De aparte native adapters valideren exact het
binaire pad en gebruiken uitsluitend de bestaande dev-origin. Geen querytokens,
cookies, redirects, algemene proxy, nieuwe origin of Cloudflare-uitzondering.

De catalogus bevat bronmetadata, sessie-ID, leesscope, readerHash en versgrenzen;
geen URL's, credentials of audiobytes. De bron-ID is identiteit, geen toegangsbewijs.
Identiteit bindt account/sessie, selectieversie, cursus/doel, teksthash, publicatie,
controlemarkering, bestandshash en tijdcodes. Andere talen blijven expliciete
keuzes binnen dezelfde uitgavefamilie; standaard is de geopende teksttaal.
Een stap zonder bewezen eindgrens wordt niet aangeboden. Geen verzonnen tijdcodes.

Iedere stream controleert JWT/sessie, reader-/cursusrechten, actuele bron en
publicatie opnieuw. Dezelfde controles worden voor en na ieder gelezen blok
uitgevoerd voordat het wordt afgeleverd. Account- of bronwissel maakt oude IDs
onbruikbaar, ook na een ABA-wissel. Reeds afgeleverde decoderbytes zijn niet terug
te halen; de spelerintegratie stopt daarom ook onmiddellijk en geeft zijn buffers vrij
bij lokale contextintrekking.

GET accepteert uitsluitend één eindige Range van maximaal 256 KiB en geeft 206;
ontbrekende, te grote, open of meervoudige ranges geven 416. HEAD geeft alleen
metadata. Maximaal 256 MiB per bron. Responses zijn private/no-store/no-transform.
Ratebudgets: 20 catalogusvoorbereidingen en 240 rangeverzoeken per minuut/gebruiker.
Metadata-caches zijn begrensd, tijdelijk en nooit autorisatie: iedere chunk krijgt
opnieuw rechtencontrole. Dit is geen accountspecifieke clientcache.

Het geopende bestand wordt via dezelfde descriptor gecontroleerd en gestreamd.
SHA-256, grootte, MP3-signatuur en inode-/nanoseconde-statkenmerken worden
gecontroleerd; symlinks en niet-reguliere bestanden worden geweigerd. Alleen
positieve integriteitsmetadata worden kort gecachet, nooit MP3-bytes. Annuleren
sluit de descriptor. Gewijzigde bestanden of intrekking na de headers breken de
body af; er is geen automatische retry.

## Historisch transportbewijs uit PR #261

Apple: AVAssetResourceLoader met eigen scheme, URLSession ephemeral, begrensde
64 KiB chunks, maximaal vier wachtende laadverzoeken; AVFoundation krijgt geen
credential-URL. Android: bestaande OkHttp + MediaDataSource, eindige reads tot
256 KiB, maximaal vier gelijktijdige requests en geen netwerk op de hoofdthread.
Geen extra mediabibliotheek of dependency. Beide controleren 206, MIME, omvang,
Content-Range, identity-encoding en bestaande exacte CORS-origin.

Een native lifetime is maximaal vijf minuten en gebruikt een continue klok die
ook toestelstandby meet (mach_continuous_time / elapsedRealtimeNanos). Invalidatie
en definitieve byte-aflevering delen dezelfde synchronisatiegrens. Native
callbacks mogen daarbinnen geen langdurig werk of synchrone crossqueue-wacht doen.

De nog te bouwen verzegelde context moet de bestaande gevalideerde bridge-response
gebruiken, met serverTime/maxAgeMs, JWT-verval en monotone starttijd. Zij mag geen
nieuwe JS-credentialsetter of tweede refreshmechanisme introduceren. Enrollment-
epoch alleen is onvoldoende voor logout/account-/bronwissels: de echte
sessie-epoch en contextovergangen moeten vooraf invalidatie afdwingen. Dit is een
activatievoorwaarde voor PR2, niet iets dat deze inactieve PR al bewijst.
Keychain `WhenUnlockedThisDeviceOnly` blijft ongewijzigd; vernieuwing bij een
vergrendeld toestel en achtergrond-/lockscreenwerking zijn niet gegarandeerd.

Officiële platformdocumentatie:
- [Apple AVAssetResourceLoaderDelegate](https://developer.apple.com/documentation/avfoundation/avassetresourceloaderdelegate)
- [Android MediaDataSource](https://developer.android.com/reference/android/media/MediaDataSource)

## Uitgevoerde lokale verificatie

- Schone Next-productiebuild en TypeScript geslaagd.
- 10 transport-/contractunits: finite ranges, descriptorbehoud, annulering,
  intrekking, corruptie en ongewijzigde web-200/206/416/HEAD.
- 14 geïsoleerde PostgreSQL/Redis-integratieproeven: drie leesmethoden × vijf
  talen, echte synthetische Audio V2-import/publicatie, twee Node-processen,
  rechten/intrekking/bron-ABA, vertraagde catalogus, 140 gelijktijdige catalogi,
  tekstwijziging bij onveranderde anderstalige audio en legacy-controle.
- SQL-snapshots bewijzen dat GET geen User-/gebruikersvoortgang-, oefensessie-,
  Chapter-/Verse-/audio-/publicatieregistraties wijzigt. Migratiebehoud en rollback
  van de bestaande geïsoleerde runner slagen; deze PR heeft geen migratie.
- Bestaande `test:audio:browser` inclusief Audio V2-/official-/legacy-regressies
  geslaagd met geïsoleerde data en zonder externe-downloadflags.
- Eigen synthetische MP3 in tests, geen officiële audio of providercredentials.

Onafhankelijke review vond twee P2-risico's: globale metadata-evictie kon een
lopende catalogus laten crashen; daarnaast kon intrekking tussen native controle
en byte-aflevering komen. De stressproef reproduceerde eerst de crash en slaagt
na lokale snapshotcorrectie. Beide platformadapters hebben nu een gedeelde
aflever-/invalidatiegrens en gerichte concurrencytests. ReaderHash voorkomt ook
hergebruik van een bron-ID na tekstwijziging bij onveranderde anderstalige audio.

De eerste echte AVFoundation-duurproef ontdekte daarnaast dat de loader zijn
laadverzoek uitsluitend via een weak callback vasthield. Apple vereist expliciet
een sterke referentie bij asynchroon laden. De pending-tuple houdt het verzoek nu
vast tot finish/cancel; dezelfde echte MP3-duurproef slaagt na die correctie.
De native CI installeert ffmpeg/ffprobe net als de bestaande Audio V2-workflow,
zodat de importer echte MP3-validatie uitvoert; geen mock of tests skippen.

Swift/AVFoundation- en Android/JVM-proeven plus echte platformcompilatie worden
in de bestaande GitHub Actions uitgevoerd. Hun actuele resultaat en definitieve
SHA staan op de PR; lokale Linux-tests bewijzen die compilaties niet. De Swiftproef
laadt een echte AVURLAsset uit synthetische MP3; de JVM-proef bewijst het protocol
en MediaDataSource, geen Android-decoder of fysieke audio-uitvoer.

De extra web-audioproeven hergebruiken de bestaande productiebuild. Er is geen
extra workflow of externe audiodownload. NAS-prestaties zijn niet gemeten;
rechtencontrole per chunk moet later op een developmenttoestel worden beoordeeld.

## PENDING PHYSICAL ACCEPTANCE

De nieuwe speler-/TTS-aansluiting is nog niet fysiek geaccepteerd. Op iPhone én Android controleren:

1. Juiste teksttaal, expliciete andere audiotaal, echte stemmen en ontbrekende bron.
2. Start/pauze/stop, versselectie, vorig/volgend vers en alle vijf snelheden.
3. Stapbereik stopt op de juiste eindgrens; hoofdstukwissel behoudt context.
4. Offline/online, langzame verbinding: geen ongeautoriseerde of dubbele retry.
5. Logout/account-/bronwissel en ingetrokken rechten stoppen oude audio.
6. Achtergrond/voorgrond, schermslot, telefoongesprek en hoofdtelefoon loskoppelen.
7. Tweede audioactie en lezer verlaten: één speler, expliciete stop-/minispelerregels.
8. Licht/donker, 320 px, 200% tekst, VoiceOver/TalkBack en safe areas.

Geen van deze punten is hier als fysieke acceptatie geslaagd gemeld. #258/#259,
B3c, CFM, imports en publicaties blijven buiten scope.


## Verificatie deel 2 en bewijsgrenzen

Lokaal uitgevoerd: TypeScript; 41 gerichte audio-/Access-/session-gatetests;
14 geïsoleerde PostgreSQL/Redis-audioproeven, inclusief drie leesmethoden × vijf
talen, twee Node-processen, ingetrokken rechten tijdens vertraagde playback-GET,
140 gelijktijdige catalogi en ongewijzigde gebruikers-/audiotabellen. De
bestaande 170 migraties zijn uitsluitend op de eigen wegwerpdatabase toegepast;
deze wijziging heeft geen migratie. Pariteitscontrole en zes pariteitstests slagen.

De browserproef gebruikt dezelfde echte React-speler, mini-speler en lezer met
synthetische metadata en OS-uitvoer. Vijf talen × opname/TTS, 320px/200% donker,
ontbrekende toestelstem, geen leespositiewrite en stop tijdens een vertraagde
start zijn afgedekt. Voorbeelden: [web](screenshots/native-audio/web-nl-390-light.png),
[native](screenshots/native-audio/native-nl-390-light.png) en
[native 320px/200%](screenshots/native-audio/native-nl-320-200-dark.png).
Dit zijn browserbeelden, geen iPhone-screenshots.

De bestaande platformworkflow voert nu native contextproeven uit voor
secure-storage-commit, oude outbox/refresh, account-/bron-/achtergrond-epochs,
vertraagde antwoorden en harde JWT-/lifetimegrenzen. AVFoundation decodeert
synthetische MP3 naar PCM via de bestaande resource-loader; de Android-proef
gebruikt dezelfde SourceData, ExoPlayer en ClippingMediaSource op één emulator.
Alleen HTTP-antwoorden zijn daarin gesimuleerd. Het geslaagde uitvoeren hiervan
en de compilaties moet uit de GitHub-checks op de definitieve PR-head blijken;
toegevoegde tests zijn op zichzelf geen geslaagd platformbewijs.

De afzonderlijke securityreview vond een P2 in Android-audiofocus: na een
geweigerde aanvraag kon hervatten de nieuwe focusaanvraag overslaan. De tijdelijke
focuslease wordt nu alleen na OS-bevestiging verleend, wordt bij weigering,
pauze en einde vrijgegeven en weigert callbacks van eerdere leases. Drie echte
lokale JVM-tests slagen; de herreview vindt geen resterende P0–P2. Platformresultaten
blijven een voorwaarde vóór een mergeadvies. Fysieke
luidsprekeruitvoer, stemkwaliteit, schermslot, gesprekken, Bluetooth en langdurig
luisteren zijn **PENDING PHYSICAL ACCEPTANCE**. Gebruik de bovenstaande checklist
met hetzelfde testaccount op web/iPhone/Android. Controleer daarbij expliciet
het stap-eindvers, geen voortgangswijziging door audio, behoud van een open
notitieconcept en onmiddellijke stop bij logout of bron-/hoofdstukwisseling.


### Gerichte regressies tijdens deze implementatie

De eerste emulatorproef faalde met een bronfout. De synthetische Android-JWT
bevatte base64url-padding; de bestaande transportregex weigert die terecht.
De fixture gebruikt nu dezelfde paddingloze vorm als echte server-JWT's. De
transportcontrole is niet versoepeld; de nieuwe OS-run moet de diagnose bevestigen.

Een apart browserrepro leverde één ongewenste positie-opslag op bij scrollen in
het portaal van de nieuwe stemkeuzelijst. Role=listbox/option telt daarom niet
meer als leesinteractie; dezelfde proef verwacht en krijgt nu nul opslagacties.
Ook toestelstemkeuze per taal en ontbrekende/mislukte eventregistratie hebben
regressies: een webstem blijft behouden, en audio start pas met werkende native
eventafhandeling. Een expliciete nieuwe poging kan die lokale koppeling herstellen.


De eerste iOS-job kreeg volgens GitHub na meerdere pogingen geen ARM64-hosted
runner, met expliciete capaciteitsmeldingen. Dezelfde bestaande job gebruikt nu
`macos-26-intel` (officiële runner, dezelfde OS-generatie), zonder nieuwe workflow
of signing/distributieroute. Simulator-/codecresultaten op deze host zijn geen
bewijs van fysieke ARM64-iPhone-audio. De eigenaar blijft daarvoor de bestaande
Mac → Capacitor → Xcode → iPhone-route gebruiken.


Android 11+ krijgt uitsluitend de exacte `android.intent.action.TTS_SERVICE`-
zichtbaarheidsquery, zonder nieuwe permissies of algemene pakketinzage. Een
emulatorproef inventariseert de werkelijk aanwezige lokale stemmen en controleert
dat een ontbrekende/verkeerdtalige stem niet wordt uitgesproken. Geen engine of
stem wordt automatisch geïnstalleerd of gedownload.

Toestelonderbrekingen hebben ook een opdrachtloos epoch-event: headsetverlies of
onderbreking tijdens de eerste autorisatie annuleert de pending start. Een later
metadataantwoord kan niet alsnog audio activeren; de gerichte race-unit slaagt.

Platformtussenstand op `9f08dea6304bfab7fa121377da150540383f9777`: Android-build,
JVM-proeven en echte emulator-decoder/clipproef geslaagd; op macOS zijn Access-
policy en echte AVFoundation-PCM-decodering geslaagd. De Swift-contextfixture
faalde door wisselende JSON-sleutelvolgorde in herhaald geconstrueerde synthetische
JWT's. De fixture gebruikt nu sortedKeys en toetst determinisme; de exacte
productie-tokenbinding is behouden. De nieuwe PR-head moet opnieuw geheel groen
worden. Deze tussenstand geldt niet als iOS-appcompilatie of fysieke acceptatie.


Controle van de echte APK liet Media3's transitieve WAKE_LOCK-permissie zien.
De voorgrondspeler gebruikt geen wakemode; deze permissie wordt expliciet uit
het gemergde manifest verwijderd. Een emulatorproef controleert de werkelijk
geïnstalleerde APK: uitsluitend INTERNET, netwerkstatus, bestaande haptics en de
eigen signature-permissie voor niet-geëxporteerde receivers. Geen wakelock,
microfoon- of algemene pakketinzage. Media3's netwerkstatuspermissie ondersteunt
de bestaande netwerk-/streamingafhandeling; de TTS-query vraagt geen permissie.


## Herstel mini-speler in de native Focus-shell (build 2497)

De eigenaar bevestigde op een fysieke iPhone 17 Pro Max bij 100% tekst dat
Nederlandse toestel-TTS speelt, ook vanuit een versmenu, maar de mini-speler
ontbreekt. Dat bewijst nog geen defect in officiële opgenomen audio. De nieuwe
reparatie zelf is **PENDING PHYSICAL ACCEPTANCE**.

### Aantoonbare compositie- en meetfouten

De volledige `NativeFoundation` rendert één `ReadAloudPlayerProvider` met de
werkelijke `NativeReaderView`, `NativeReadAloudOutput`, router, `AppShellFrame`,
`StickyHeader`, `FocusModeController` en `ShellMetrics`. De mini was gemount,
`source` bleef geldig en TTS gaf afspeelmeldingen terug. Focus verbergt uitsluitend
de globale header; React-status of een ontbrekende provider verklaarde de
reproductie niet.

1. **Veilige bovenrand bij normale tekst.** Native plaatste de mini vóór de
   terugbalk. De veilige bovenrand wordt in Focus op die terugbalk vrijgehouden,
   waardoor de speler zelf op y=0 stond. De falende browserproef op 440×956/100%
   met een gesimuleerde safe-top van 62px mat de gehele mini op y=0–53px. Dat is
   binnen de voor iOS-systeemweergave vrij te houden rand. Dezelfde mini staat nu
   net als op web ná de terugbalk, binnen dezelfde gemeten wrapper. De DOM van de
   fysieke iPhone is niet op afstand uitgelezen; dit is reproduceerbaar
   compositiebewijs en verklaart het gemelde ontbreken zonder TTS uit te schakelen.
2. **Afzonderlijk grote-tekstgeval.** Op 320×844/200% werd de 429px hoge balk
   volgens de gewone 34%-regel scrollend. Na starten lager op de pagina stond
   de mini op y=-577–-312px. Alleen actieve native bediening markeert nu dat zij
   bereikbaar moet blijven; `ShellMetrics` blijft de enige meetplek. Vastzetten
   gebeurt uitsluitend zolang minstens 20% van de viewport buiten de balk blijft.
   Voor een uitzonderlijk hogere balk blijft de bestaande scrollende fallback
   gelden. Web zet deze native marker niet en behoudt zijn bestaande beleid.

Voorbereiding toont de bestaande vertaalde laadtekst in dezelfde titelregel,
met `role=status` en uitgeschakelde afspeelknoppen; stoppen blijft mogelijk.
Een extra laadregel maakte een kort scherm bij 200% opnieuw te hoog. De
onafhankelijke reviewer vond dat geval; de compacte rij en een aanvullende
320×568/200%-proef voorkomen die regressie. Geen tweede speler, provider of
positioneringsmodel; geen wijziging van sessies, transport, lifecycle, rechten,
annotaties, leespositie, READ, XP of afronding.

### Waarom het eerdere browserbewijs onvoldoende was

`player-client.tsx` had een eigen header zonder Focus-shell of safe-area-meting.
Het bewees de gedeelde speler en adapter, maar niet de echte appcompositie. Die
oorspronkelijke proeven blijven staan. Hun bestaande runner importeert nu
aanvullend `native-audio-shell.browser.mjs`; geen extra workflow of CI-build.
HTTP-contractantwoorden en OS-uitvoer zijn synthetisch. De echte React-componenten,
router, client, sessiepoort, LiveDataStore en native uitvoeradapter worden gebruikt.
De proef controleert DOM-stijlen, volledige knoprechthoeken, hit-tests, safe areas,
headerhoogte en vrijgehouden hoofdruimte; alleen `isVisible()` is onvoldoende.

De matrix omvat 320/375/390/440/768/1024px, 100/200% tekst, licht/donker,
iPhone- en Android-achtige veilige randen en een korte 568px viewport.
Opname en TTS starten zowel via de grote knop als het versmenu. Pauze/hervatten,
vorig/volgend vers, vijf snelheden, voorbereiding/annuleren, vijf talen,
eindstatus, geldige late callbacks en stoppen bij route-/account-/bronwisseling
en achtergrond worden afzonderlijk gecontroleerd. Alle POST-aanvragen blijven
beperkt tot synthetische login/refresh/logout; audio start geen voortgangswrite.
De bestaande native transport-/authenticatieproeven blijven verplicht.

Voorbeelden van de **browserweergave**, geen fysieke screenshots:

- [Standaard iPhone-breedte, 100%, TTS](screenshots/native-audio/focus-440-100-tts.png).
- [Korte telefoon, 320×568, 200%, TTS](screenshots/native-audio/focus-320-200-tts.png).

De werkelijk uitgevoerde lokale tests, onafhankelijke eindreview en CI op de
definitieve commit worden in de PR vastgelegd. Toegepaste productiemigraties,
backendconfiguratie, audioregistratie en publicaties vallen buiten deze reparatie.

### Hertest op de iPhone — PENDING PHYSICAL ACCEPTANCE

Bouw na afzonderlijke mergegoedkeuring via de bestaande Mac → develop → native
bundel → Capacitor-sync → Xcode → iPhone-route. Een eerdere installatie krijgt
de gewijzigde lokale React-bundel niet automatisch.

1. Open een schriftlezer bij 100% tekst. Start Nederlandse TTS via Voorlezen en
   vervolgens vanuit een versmenu. Verwacht direct bediening onder de terugbalk,
   geheel onder de statusbalk/Dynamic Island, ook als je al verder hebt gescrold.
2. Pauzeer, hervat, wissel vers en snelheid en stop. Verwacht het juiste vers,
   hoorbare reactie en verdwijnen na stoppen; geen dubbele afspeelbron.
3. Herhaal met grote tekst en licht/donker; alle knoppen blijven bereikbaar,
   zonder horizontaal schuiven of overlappende navigatie.
4. Verlaat de lezer, wissel bron/account en onderbreek de app. Verwacht onmiddellijke
   stop, geen oude titel en geen automatische herstart bij terugkeer.
5. Officiële opgenomen audio afzonderlijk testen als een toegestane opname
   beschikbaar is. De eerdere fysieke TTS-proef bewijst die opname niet.

Android en iPad vereisen eveneens afzonderlijke fysieke acceptatie. Geslaagde
browser-, simulator- of compilatieproeven vervangen die controles niet.

## Directe store-test-API (voorbereid, nog geen uitrol)

Voor de voorgestelde `https://api-test.versado.app` hergebruikt `local-store-test`
de bestaande native JSON-, sessieobservatie-, audiocapsule- en Range-laag. iOS
accepteert alleen kanaal `testflight`, Android alleen `play-test`; appidentiteit,
origin, distributiemetadata, geen compileproef en `releaseApproved=false` zijn
native voorwaarden. De interne Access-vlag en `internal-access.json` moeten afwezig
zijn. Geen nieuwe URL- of credentialsetter vanuit JavaScript.

Dezelfde legacy genaamde `accessRequest`-pluginmethode handelt beide modi af.
In de directe modus zijn de CF-credentials afwezig, wordt nooit Keychain/Keystore
voor Service Auth gelezen en gebruikt de native code uitsluitend de vaste
voorgestelde API-origin. Alleen dan is de bestaande route voor eenmalige
realtimetickets beschikbaar. Alle streambytes blijven buiten de JS-JSON-brug;
bronrechten, Bearer, sessie-/contextbinding, deadline, Range en intrekking blijven
dezelfde controles gebruiken. `local-internal` en zijn enrollment blijven intact.
Productie/release wordt niet geactiveerd.

De `store-test`-allowlist blijft leeg. Eerst review van de native implementatie
en [proxyvoorbereiding #267](https://github.com/rjgout/Versado.app/pull/267),
uitroltoestemming en volledige backendcheck (inclusief WP4) vóór allowlistvrijgave;
de eerste fysieke iPhone-acceptatie volgt na de afzonderlijk toegestane eerste
TestFlight-upload en installatie.
Dit codepad is geen bewijs voor een uitgerolde Cloudflare/NAS-keten of een werkende
fysieke iPhone. Beide platformcompilaties en native regressies blijven vereist.
