# Architectuurproef rijke studielessen (React Native / Expo, zonder WebView)

Status: **proef afgerond, geen migratie, geen merge** (PR #286 blijft draft). Branch `poc/expo-mobile`.
Voorgaand werk: [MOBILE-POC-EXPO.md](MOBILE-POC-EXPO.md) (native runtimebewijs), [MOBILE-POC-LEZER-SPIKE.md](MOBILE-POC-LEZER-SPIKE.md) (schriftlezer).
Afzonderlijk backendpunt: [BACKEND-AANDACHTSPUNT-PRISMA-TRANSACTIE-TIMEOUT.md](BACKEND-AANDACHTSPUNT-PRISMA-TRANSACTIE-TIMEOUT.md).

## 1. Vraag en antwoord in het kort

**Vraag.** Kunnen de bestaande rijke studielessen van Versado met echte React Native-componenten worden weergegeven, mét tekstselectie en
annotaties, zonder WebView en zonder de backend of lesinhoud opnieuw te bouwen?

**Antwoord.** Ja, voor weergave, selectie en annotaties is dat aangetoond op een iOS-simulator én een Android-emulator, met echte lesinhoud uit de
bestaande importketen en de bestaande annotatieservice. Daarbij horen drie harde kanttekeningen:

1. De native API had **geen** lesdocument en geen lesannotaties; die moesten (dun, alleen-lezen/bestaande services) worden toegevoegd.
2. De tekst zit in **één native tekstveld per aaneengesloten tekstgebied**. Dat geeft echte platformselectie, maar kost **toegankelijkheid**
   (koppen en alinea's zijn voor een schermlezer niet apart bereikbaar) en een selectie kan niet over een afbeelding of tabel heen lopen.
3. De studielezer is veel meer dan weergave + annotatie (zie §8). De proef bewijst de moeilijkste technische kern, niet de pariteit.

Het definitieve architectuuradvies staat in §10: **A, doorgaan met de bestaande Capacitor-architectuur volgens het Ringtools-model.**

## 2. Onderzoek: wat de bestaande studielezer is

| Onderdeel | Bron | Omvang |
|---|---|---|
| Rijke inhoud (koppen, alinea's, lijsten, citaat, tabel, figuur, verwijzing, video, vraag) | `src/components/study/RichContentBlocks.tsx` | 336 r |
| Lezer (positie, markeren als gelezen, personal study, stappen, annotatiefocus) | `StudyReader.tsx` + `PersonalStudyParts.tsx`, `CfmWeekPath.tsx`, `CfmTodayCard.tsx` | 667 r + ca. 600 r |
| Annotatie-UI (selectie, kleuren, notitie, herstel, studiemap) | `src/components/annotations/*` | 1 130 r |
| Verwijzingen (voorbeeld, terugkeer, trip) | `ReferencePreview.tsx`, `ReferenceReturn.tsx`, `ReferenceLink.tsx` | 490 r |
| Oefeningen en Samen studeren | `StudyExerciseClient.tsx`, `StudyRoom.tsx` | 990 r |
| Totaal `components/study` + `components/annotations` | | **4 395 r** |

Contracten die de proef **ongewijzigd** hergebruikt: `StudyDocument`/`studyDocumentSchema` (`src/lib/studyContent/schema.ts`), `PassageSelector`,
`validatePassageSelector`, `normalizeAnnotationText`, `passageBlocks`, `annotationPutSchema` (`src/lib/annotations/contract.ts`),
`getPublishedStudyLesson`, `readerAnnotations`, `mutateAnnotation` (incl. plaatsing in de huidige revisie), `nativeStudyImage`
(mediaroute) en de bestaande cursus-/weekroutes. Het offsetmodel is: per blok genormaliseerde NFC-tekst, offsets in codepunten.

Bevindingen uit het onderzoek:

- Het bestaande schema staat **inline links** toe, maar de importketen weigert ze (`unanchoredLinks` → `REFERENCES`). Een "link" in een les is dus altijd
  een **verwijzing** (met bewezen bron-URL), nooit een vrije URL.
- Studieannotaties zijn **selector-gebaseerd** (bereik per blok, exact/prefix/suffix) en worden door de **server** in de huidige revisie geplaatst
  (`placement`: EXACT of niet). De client hoeft geen herplaatsing te kunnen; dat blijft bedrijfslogica op de server.
- Een gewiste annotatie is een tombstone met versie. De lijstroute voor lessen toont ze niet, zodat een client dezelfde selectie na wissen niet kon
  terugzetten (409). Opgelost met een aparte lijst `tombstones` (alleen soort, versie, selector).

## 3. Wat is gebouwd

Backend (buiten `apps/mobile-poc/`, bewust klein; geen databasewijziging, geen nieuw annotatiesysteem):

- `src/lib/native/studyLessonContract.ts` (37 r): zod-envelop rond het bestaande documentschema en de bestaande annotatiecontracten.
- `src/lib/native/studyCourses.server.ts` (+ ca. 45 r): `nativeStudyLesson`, `nativeStudyLessonAnnotations`, `mutateNativeStudyLessonAnnotation`.
  Dezelfde rechten-/publicatiecontrole als de bestaande stappen, `mutateAnnotation` binnen `commitAccountMutation`, selector gecontroleerd tegen het
  gepubliceerde document (vervalsing → 400), revisie moet de gepubliceerde zijn.
- `src/lib/native/api.ts`: drie routes onder `courses/<cursus>/weeks/<editie>/lesson | annotations`, capability `study-lesson-v1`.
- `docs/native-feature-parity.inventory.json` bijgewerkt (verplicht door `native:parity:check`).

App (`apps/mobile-poc/`, ca. 580 r productiecode, 360 r tests):

- `src/study/runModel.ts`: zuiver model (documentvolgorde = `passageBlocks`; runs; selectie ↔ codepunt-offsets; selector; markeringen).
- `SelectableRun.tsx`: één niet-bewerkbare `TextInput` per run (UITextView / EditText) met geneste `<Text>`-stijlen; verwijzingen ook als eigen link-knoppen.
- `LessonView.tsx`: runs, afbeeldingen (mediaroute) met bijschrift, tabellen (elke cel een eigen run), video-verwijzing, streep.
- `les.tsx` + tab "Les": lettergrootte, selectie-info, markeren/wissen/notitie, debug-testknoppen alleen in testbuilds.
- Testprofiel: `seed-study-lesson.ts` maakt de rijke synthetische les via de **echte** importketen (import → publiceren → cursussen); `rijkeles.ts`
  is de gedeelde fixture. De bestaande beveiliging (`STUDY_PUBLICATION_PROFILE=synthetic-test`, database `versado_content_access_test`, eigen
  mediamap met markering) is **vervuld, niet omzeild**; de proef-CI gebruikt daarom die databasenaam.

## 4. Ontwerpbeslissingen

| Vraag | Keuze | Reden |
|---|---|---|
| Hoe krijg ik platformselectie mét offsets? | Niet-bewerkbare multiline `TextInput` + `onSelectionChange` (iOS `editable={false}`; Android bewerkbaar zonder toetsenbord) | Zelfde techniek als de lezer-spike; eenvoudigste die betrouwbaar werkt |
| Eén veld per blok of per gebied? | Eén per **run** van aaneengesloten tekstblokken | Selectie over meerdere alinea's werkt; een figuur/tabel/streep onderbreekt een run |
| Tabel | Elke cel een eigen run | Cel-id's zijn annotatiedoelen in het contract |
| Annotatie over meerdere blokken | Eén annotatie met meerdere bereiken (`selector.ranges`) | Zo is het contract bedoeld (anders dan bij schrift: alleen per vers) |
| Wie plaatst een markering terug? | De server (`placement`) | Geen herplaatsingslogica in de app |
| Verwijzing aantikken | Eigen link-knop onder de run; opent de bewezen bron-URL | In een selecteerbaar veld activeert tikken op tekst geen link |
| Notitie | Bij de hele selectie (niet bij het eerste blok) | Het contract heeft een selector per annotatie |

## 5. Resultaten

Alle flows draaien op de **Release-app** op een Android-emulator (AOSP API 34) en een iOS-simulator (iPhone, iOS 26), aangedreven door Maestro,
met server-effect gecontroleerd door een tweede, onafhankelijke client (`tests/native/peer.ts verify-study`). Eén gecombineerde run bevat de
eerdere lezerflows (01–11, waaronder de eerder niet bevestigde iOS-**flow 10**) en de nieuwe studieflows (12–20).

Zonder toestel (elke run): `jest` 48 tests, `tsc`, Metro-export iOS + Android, `test:study` tegen de echte backend (les, afbeelding, selector,
annotaties, plaatsing, rechten, vervalste selector, verouderde versie, andere revisie, wissen).

| Eis | Android (run 73, alles in één run) | iOS (beste bewijs, zie §5a) |
|---|---|---|
| 12 Les als native onderdelen: koppen, alinea's, opmaak, verwijzing, afbeelding+bijschrift, opsommingen, citaat, tabel | groen | groen (runs 73, 75) |
| 13 Woord selecteren (echt lang indrukken, grepen zichtbaar) | groen | groen (73, 74, 75) |
| 14 Selectie over twee alinea's → één markering + notitie; server bevestigt (peer) | groen | groen (73, 74, 75) |
| 15 Herstart: markering en notitie terug (server plaatst EXACT) | groen | groen (73, 74, 75) |
| 16 Lettergroottes 14/18/24/32, selectie na elke wijziging | groen | groen in run 69; in 73/74/75 telkens een testprobleem (zie §5a) |
| 17 Systeemtekstgrootte (Android 1,6×; iOS accessibility-extra-large) | groen | groen (73, 74, 75) |
| 18 Tabelcel selecteren | groen | groen (73, 74, 75) |
| 19 Markering wissen; server bevestigt (peer) | groen | groen in 73; in 74 en 75 mislukt (testknop getikt vóór het laden van de les; lesverzoek traag) |
| 20 Toegankelijkheidsboom (namen, rollen) | groen | groen (73, 74, 75) |
| Lezerflows 06–11, **waaronder de eerder niet bevestigde iOS-flow 10 (systeemtekst)** | alle groen | alle zes groen in één run (75); flow 10 ook groen in run 74 |
| Basisflows 01–05 (inloggen, vrienden, realtime) | groen | alle vijf groen in 69; in 73 alleen 04 (opwarmgeval) mis; in 74/75 mislukt door een traag startende backend (zie §5a) |

### 5a. iOS: wat er is gemeten en waarom er geen volledig groene iOS-run is

Er zijn vier iOS-runs gedaan (69, 73, 74, 75). **Elke iOS-flow is minstens één keer groen geweest op de huidige app-code, maar niet alle twintig in één run.**
De app-code is sinds run 69 niet meer gewijzigd; wat tussen de runs veranderde, zijn de testflows en de omgeving.

| Run | Groen | Reden van de fouten |
|---|---|---|
| 69 | 13/20 | annotatieschrijfacties 11–22 s en daardoor 500 (transactielimiet 5 s, ook op de bestaande schriftroute); wachtvoorwaarde bij grote tekst |
| 73 | 17/20 | opwarmgeval van "vriend accepteren"; wachtvoorwaarde flow 10; woordselectie flow 16 |
| 74 | 8/20 | traag startende backend (login/Vandaag "Laden mislukt"); regex zonder eindspatie + eenmalig iOS-systeemvenster (Look Up); testknop getikt vóór het laden van de les |
| 75 | 13/20 | alle lezer- en bijna alle studieflows groen; basisflows 01–05 door "Laden mislukt" op Vandaag (backend traag); 16 en 19 door een gemiste tik en een mislukt lesverzoek |

Gemeenschappelijke oorzaak: op de gedeelde macOS-runner delen simulator, Maestro-driver, Postgres en de Next-dev-server de CPU. De backend-latentiemeting
(`backend-probe.log`) toont pieken van 5–20 s, terwijl de clients na 15 s opgeven. De app gedraagt zich dan correct ("Laden mislukt. Tik om opnieuw te
proberen."), maar de flows wisten dat niet te herhalen. In `d7a73983` doen ze dat nu wel (zoals een gebruiker), plus een herhaling van schrijfacties.
**Een laatste iOS-run op die versie (run 76) loopt nog;** de uitkomst staat in §5b.

Dit is **omgevingsbelasting en testgeluk, geen functioneel bewijs tegen de lezer**, maar het betekent wel dat "alles groen in één iOS-run" niet is aangetoond.

### 5b. Uitkomst iOS-run 76 (`d7a73983`)

_Wordt bijgewerkt zodra de run klaar is._

## 6. Toegankelijkheid: wat is gemeten en wat niet

Gemeten (toegankelijkheidsboom van Android via `uiautomator`, iOS via `maestro hierarchy`, in dezelfde run):

- Alle knoppen hebben een naam en rol (`Markeren`, `Markering wissen`, `Notitie`, `Kleinere/Grotere letters`); de afbeelding heeft de alt-tekst
  als label; elke verwijzing is een knop met rol *link* en naam `Verwijzing 1 Nephi 3:7`.
- Aanraakdoelen van de knoppen: 44 dp (Android-richtlijn 48 dp: **net te klein**, iOS 44 pt voldoet).
- **Kernprobleem:** elke run is voor het besturingssysteem **één tekstveld**. Android toont het als *EditText* met de hele run als tekst (`Lestekst`,
  bewerkbaar veld), iOS als tekstveld met label `Lestekst`. Een schermlezer leest dus alles als één blok en kent geen koppen of alinea's om
  tussen te springen; "koppen-navigatie" bestaat niet. De webversie heeft echte `h2/h3/p/ul/blockquote`-semantiek.
- Een run is geen "tekst" maar een bewerkbaar veld (Android) met onderdrukt toetsenbord: dat is een bekende truc die TalkBack verwarrend kan
  aankondigen.

**Niet bewezen:** werkelijke bediening met VoiceOver of TalkBack (geen schermlezer in de CI-simulator/-emulator; de AOSP-image bevat geen TalkBack),
dus óók niet of selectie en annotatie met een schermlezer bruikbaar zijn. Dat vraagt een fysiek toestel of een handmatige test.

Mogelijke oplossing (niet gebouwd): per blok een eigen toegankelijkheidselement boven het tekstveld, of een eigen native module (optie B uit de
lezer-spike) met per-blok semantiek. Dat is echt werk (zie §9).

## 7. Vergelijking met de huidige Capacitor-weergave

De huidige Capacitor-app toont de les via de **webreader** (`StudyReader` in een WKWebView/Android System WebView). Referentiebeelden van dezelfde les
in de echte webreader (Chromium op iPhone-formaat, `deviceScaleFactor 2`, **niet** WKWebView; dus een benadering van de Capacitor-weergave):
`docs/mobile-poc-studielezer/web-*.jpg`. Native: `android-*.jpg` en `ios-*.jpg` in dezelfde map.

| Aspect | Capacitor (webreader) | Native (deze proef) |
|---|---|---|
| Opmaak | volledig (koppen, kaarten, bijschriften, tabel met scrollen, verwijzing met voorbeeld) | koppen, alinea's, opsommingen, citaat, tabel, figuur+bijschrift; geen kaartopmaak, geen verwijzingsvoorbeeld |
| Selectie | browserselectie in de WebView; een eigen "Geselecteerde tekst annoteren"-knop | echte UITextView/EditText-selectie met loupe en grepen; eigen actiebalk bovenaan |
| Selectie over figuur/tabel | mogelijk (DOM-range) | niet mogelijk (aparte runs) |
| Annotatie-UX | volledig (kleuren, notitie bewerken, herstel, studiemap) | markeren (geel), wissen, notitie; geen herstelvoorstellen, kleuren, bewerken |
| Scrollen/toetsenbord | WebView-scroll; geen eigen scrollcontainer-conflict | native ScrollView; fixed bediening die bij grote tekst 65 % van het scherm inneemt |
| Systeemtekstgrootte | via CSS/`rem` | `fontScale` (bewezen op beide platformen); bij zeer grote tekst blijft weinig leesruimte |
| Toegankelijkheid | echte DOM-semantiek | gemeten tekort (§6) |
| Opstarten/geheugen | niet vergeleken | niet vergeleken |

Eerlijk: er is **geen** meting op een fysiek toestel en geen vergelijking met een echte WKWebView. De native selectie ziet er op iOS en Android
vertrouwd uit (grepen, vergroting, systeemmenu); of dat een merkbaar betere ervaring geeft dan WKWebView-selectie is niet gemeten.

## 8. Beperkingen en wat er (nog) niet is

Niet in de proef, wél in de bestaande studielezer: verwijzingsvoorbeeld met terugkeer (trip, `resolveStudyReference`), annotatieherstel
(voorstel/handmatig), bladwijzers en kleuren, notitie bewerken, studiemap, leespositie en "markeren als gelezen" (bewuste afronding), de
persoonlijke studieroute (Vrije studie, Stap voor stap, weeknavigatie, stapvoortgang), oefeningen bij de les, Samen studeren (realtime), video
(HTML5-mp4), vergroting van afbeeldingen, offline/foutstaten, alle vertalingen (de proef-UI is Nederlandstalig hardcoded).

Technische beperkingen van de gekozen aanpak:

- Een selectie kan niet over een figuur, tabel of streep heen lopen.
- Android: het tekstveld moet bewerkbaar blijven (zonder toetsenbord) om selectie-events te krijgen.
- iOS: een programmatische selectie geeft geen `onSelectionChange`; de app zet de staat zelf (alleen testhulp).
- Lange lessen: alle runs staan in één `ScrollView` (geen virtualisatie); prestaties bij echt lange lessen zijn niet gemeten.
- Elke nieuwe functie vraagt eerst een **native API-contract**; de bestaande webroutes zijn niet bruikbaar met een Bearer-sessie.

## 9. Wat een volledige omzetting van de studielezer zou kosten

Grove personeelsschatting, gebaseerd op de omvang van de bestaande code en wat in deze proef daadwerkelijk moest gebeuren; een bandbreedte, geen planning,
voor één ervaren React Native-ontwikkelaar met backendondersteuning:

| Onderdeel | Schatting |
|---|---|
| Weergave + selectie + markeren/notitie (**gedaan als proef**, productiewaardig maken, vertalingen, foutstaten, tests) | 3–4 weken |
| Verwijzingen: voorbeeld, terugkeer, trip, geblokkeerde verwijzingen (nieuw native contract) | 3–4 weken |
| Annotatiepariteit: kleuren, bladwijzer, bewerken, herstelvoorstellen, studiemap, annotatiefocus | 4–6 weken |
| Persoonlijke studie: Vrije studie/Stap voor stap, weekpad, stapvoortgang, Vandaag-kaart | 6–8 weken |
| Leespositie, bewust afronden, reeks/XP-regels (server-authoritative contracten) | 2–3 weken |
| Video, afbeeldingsvergroting | 2 weken |
| Oefeningen bij de les + Samen studeren (realtime) | 4–6 weken |
| Toegankelijkheid op niveau (per-blok-semantiek, mogelijk eigen native module Swift+Kotlin) | 4–6 weken |
| Testen op toestellen, regressies, onderhoudsbasis | 3–4 weken |
| **Totaal studielezer** | **ca. 30–40 weken (7–9 maanden)** |

Dat staat bovenop de eerder geschatte 8–14 maanden voor de hele app (MOBILE-POC-EXPO §7): de studielezer is daarin het grootste lezersdeel, geen
extra. Het blijft ook daarna een **tweede UI-codebase** die bij elke webwijziging in de studielezer mee moet.

## 10. Definitief architectuuradvies

### Keuze: **A. Doorgaan met de bestaande Capacitor-architectuur volgens het Ringtools-model.**

### Vergelijking

| Criterium | A. Capacitor (Ringtools-model) | B. React Native/Expo, volledig native |
|---|---|---|
| Native gebruikerservaring | Goed waar het telt (echte native tabbalk bewezen in PR #284, plugins voor audio, push, aanwezigheid); content in WKWebView met native selectie | Beste feel van scroll, tabs en gebaren; selectie native; maar **toegankelijkheid van lestekst is slechter** dan het web zolang er geen eigen native module is |
| Volledige functiepariteit | Hoog: de volledige webfuncties draaien al; pariteit is vooral native-poorten en toestelacceptatie | Laag: elk scherm en elke regel herschrijven (studielezer alleen al 30–40 wkn) |
| Hergebruik van bestaande code | Maximaal (één React-UI, web/PWA/iOS/Android) | Contracten, zod-schema's, domeinlogica en backend; **niet** de UI (±570 k regels `src`, waarvan de UI het grootste deel) |
| Ontwikkeltijd | Kort tot middellang | 8–14 maanden (hele app) + studielezer; parallel onderhoud van twee UI's |
| Onderhoud en testbaarheid | Eén UI, één testset; WebView-grenzen (selectie, scroll, geheugen) blijven een risico | Twee UI's; wel goede unit-/flowtests op toestel gebleken (Maestro, 20 flows groen); extra keten (Metro, Expo-SDK, pods) |
| Snelheid richting App Store en Google Play | Het bestaande Mobile-1.0-pad (WP's, TestFlight) loopt al; geen herbouw nodig | Nieuwe release-, signing- en reviewketen; pas na (bijna) volledige herbouw store-waardig |

### Waarom A, in drie zinnen

De proef bewijst dat B **technisch kan** voor weergave, selectie en annotatie, maar ook dat elke functie een eigen native contract en een eigen herbouw
vraagt en dat toegankelijkheid van lestekst een achteruitgang is zonder extra eigen native werk. De winst van B (native selectie en scrollen) is voor
de lezer niet aantoonbaar groter dan WKWebView-selectie en weegt niet op tegen 30–40 weken voor alleen de studielezer en een tweede UI-codebase.
De snelste en veiligste weg naar de stores is daarom de bestaande architectuur, aangevuld met native onderdelen waar het meeste kwaliteitsgewin is.

### Wat uit deze proef wél bruikbaar is onder A

- De nieuwe native lesroutes (`study-lesson-v1`) en het tombstone-patroon zijn gewone native API-contracten, óók bruikbaar voor de bestaande
  native views van de Capacitor-app (`NativeLearningView`) als de eigenaar die lezer later native wil aanbieden.
- Het offsetmodel (`runModel.ts`) en de selectortests zijn onafhankelijk van React Native.
- Het backendpunt (annotatieschrijfacties lopen soms voorbij de 5 s-transactielimiet) geldt voor **beide** architecturen en is een
  afzonderlijke beoordeling waard.

### Wanneer B alsnog heroverwegen

Alleen bij een harde, nieuwe eis die een WebView aantoonbaar niet kan halen (bijvoorbeeld bewezen onvoldoende selectie- of schermlezerkwaliteit op
echte toestellen) **en** dan bij voorkeur als gericht, los native onderdeel (bijvoorbeeld de lestekst als eigen native view in de Capacitor-shell),
niet als volledige herbouw.

## 11. Wat niet is bewezen (expliciet)

- Fysiek iPhone- of Android-toestel (alles op simulator/emulator in CI).
- VoiceOver en TalkBack met een echte schermlezer; alleen de toegankelijkheidsboom is gemeten.
- Handvatten-sleepgebaar van de selectie (alleen lange-druk en programmatische selectie).
- Prestaties bij echt lange lessen; geheugen en opstarttijd; landscape, tablet, RTL.
- Een echte WKWebView-weergave van de Capacitor-app naast de native proef (alleen Chromium als benadering).
- Verwijzingsvoorbeeld, herstel van annotaties, personal study en alle andere onderdelen uit §8.
