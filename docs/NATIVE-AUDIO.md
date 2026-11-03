# Native hoofdstukaudio — B3b-2c, transportfundering

## Status en integratievolgorde

Deze eerste, afzonderlijk te beoordelen PR levert een **inactieve transportfundering**.
Er is nog geen native audiocapability, plugincommando, credentialsetter of afspeelknop.
De huidige native lezer, annotaties en webspeler veranderen niet. Audio/TTS-pariteit
blijft ontbreken. Geen import, publicatie, migratie of nieuwe audio-opname.
Basis: develop `09d60ad55efb6e9c52779f6fd482e81d681a22ea` na #260.

De volgende PR moet eerst bestaande sessie-/contextovergangen veilig koppelen aan
native invalidatie en een native verzegelde broncontext. Pas daarna worden de
bestaande `ReadAloudPlayer`, `ReadAloudMiniPlayer` en provider via een engineadapter
aangesloten. Geen tweede speler, cache, sessie of voortgangssysteem. TTS volgt in
die aansluiting met werkelijk aanwezige stemmen in de vijf talen, expliciete
stemkeuze en dezelfde snelheden (0,75×, 1×, 1,25×, 1,5×, 2×).

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
te halen; de latere spelerintegratie moet daarom ook onmiddellijk stoppen en
zijn buffers vrijgeven bij contextintrekking.

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

## Platformbewijs en nog ontbrekende aansluiting

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

Swift/AVFoundation- en Android/JVM-proeven plus echte platformcompilatie worden
in de bestaande GitHub Actions uitgevoerd. Hun actuele resultaat en definitieve
SHA staan op de PR; lokale Linux-tests bewijzen die compilaties niet. De Swiftproef
laadt een echte AVURLAsset uit synthetische MP3; de JVM-proef bewijst het protocol
en MediaDataSource, geen Android-decoder of fysieke audio-uitvoer.

De extra web-audioproeven hergebruiken de bestaande productiebuild. Er is geen
extra workflow of externe audiodownload. NAS-prestaties zijn niet gemeten;
rechtencontrole per chunk moet later op een developmenttoestel worden beoordeeld.

## PENDING PHYSICAL ACCEPTANCE

Deze inactieve fundering heeft nog geen toestelbediening. Na de aparte, beoordeelde
speler-/TTS-aansluiting op iPhone én Android controleren:

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
