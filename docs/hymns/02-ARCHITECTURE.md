# Lofzangen: architectuur

Ontwerp van de technische proef "Lofzangen" (live meezingen) en de weg naar een echte functie. De
proef staat in `src/lib/hymns/` (engine en gegevens), `src/components/hymns-poc/` (interface) en
`src/app/dev/lofzangen/` (ontwikkelroute). Termen BEWEZEN, AANNEMELIJK en ONBEKEND: zie
`01-SOURCE-AUDIT.md`.

## 1. Eisen en hoe de proef ze invult

| Eis | Invulling | Status |
|---|---|---|
| Alle realtime analyse lokaal | FFT, toonklassen, deeltjesfilter en herkenner draaien in de browser; er is geen server-, netwerk- of opslagcode in de engine. | **BEWEZEN**: statische tests (`tests/hymns-privacy.test.ts`), een sessie met `fetch`/`WebSocket` uitgeschakeld, en een browsertest met nep-microfoon waarin tijdens het luisteren geen enkel verzoek met inhoud is verzonden. |
| Geen microfoongeluid naar de server, database, analytics, bestand | Samples gaan van de microfoon naar de extractor en worden weggegooid; de extractor houdt één venster vast (< 400 kB). | **BEWEZEN** (dezelfde tests). |
| Expliciete toestemming, zichtbaar wanneer de microfoon actief is | De microfoon start alleen na een tik op "Start luisteren"; de interface toont "Microfoon is actief" met een rode stip. | **BEWEZEN** (browsertest). |
| Stoppen bij handmatig stoppen, pagina verlaten, naar de achtergrond, systeem stopt de track | `MicListener` ruimt tracks, nodes, context en worklet-url op. | **BEWEZEN** met nepomgeving voor `getUserMedia` en Web Audio; in Chromium met een nep-microfoon voor stoppen en wegnavigeren. Niet getest op iOS of Android. |
| Zonder voortdurende serververbinding | De engine en de gegevens zijn statisch; de server is alleen nodig om de bibliotheek te leveren. | **BEWEZEN** voor de engine (zie boven). Offline leveren van de bibliotheek is een voorstel (5). |
| Serverbelasting minimaal | Nul verzoeken tijdens het luisteren; de bibliotheek is één klein bestand (38 kB voor drie lofzangen). | **BEWEZEN** (browsertest); 38 kB gemeten. |
| Geen bestaand gedrag veranderen | Geen wijziging aan XP, reeks, competitie, navigatie, authenticatie, serviceworker, database of bestaande tests. | **BEWEZEN**: `git status` toont alleen nieuwe bestanden, plus `package.json` (twee scripts) en `.gitignore`. |

## 2. Onderzoek van de bestaande code (fase A)

- **Audio**: bestaande audio is `<audio>` (podcastspeler, `podcastPlayerContext.tsx`), het
  voorlezen met Web Speech met een iOS-audiosessie (`src/lib/speechAudioSession.ts`) en het
  spiegelen van kerkaudio (`src/lib/audioMirror.ts`, server). Er is **geen** `getUserMedia`,
  `AudioContext`, `AudioWorklet`, MIDI of muziekbibliotheek in de repository. De proef voegt daarom
  eigen kleine modules toe en **geen nieuwe afhankelijkheid** (`package.json` heeft er geen nodig).
- **Serviceworker** (`public/sw.js`): kale doorgeefluik voor installeerbaarheid en webpush, bewust
  zonder cache. Niet gewijzigd. Een offline bibliotheek mag dat niet doorbreken (zie 5).
- **Capacitor** (`capacitor.config.ts`): alleen profiel `remote-preview`, met `server.url`; het
  productieprofiel is geweigerd tot de client/API/auth-migratie klaar is. `docs/PLATFORMEN.md`
  zegt dat native permissies pas bij een feature worden toegevoegd. De proef voegt **geen**
  microfoonpermissie toe aan iOS/Android; zie 6.
- **Content en talen**: `ContentCollection` heeft `work`, `editionKey` en `language` als losse
  identiteiten, `Book.key` is taalonafhankelijk. Lofzangen volgen dezelfde scheiding (3).
- **Navigatie en focusmodus**: de proef staat buiten de hoofdnavigatie. Een echte functie hoort in
  `Leren` of `Spelen` en gebruikt dan `focusMode.ts` en de shell-regels uit `docs/LAYOUT.md`.
- **Design**: de interface gebruikt alleen `vs`-tokens, `lucide-react`, `styles.ts` en `vs-wrap`.
  Geen emoji, geen mascotte, geen nieuwe CSS-laag.
- **Tests**: node:test via `tsx --test`, zonder frameworkafhankelijkheid. De nieuwe tests volgen dat;
  `npm run test:hymns` draait ze.

## 3. Datamodel: vijf gescheiden lagen

`src/lib/hymns/types.ts`. Een compositie en een tekst delen nooit een id.

| Laag | Type | Voorbeeld-id | Taalafhankelijk? |
|---|---|---|---|
| 1. Muzikale compositie | `HymnComposition` | `comp:praise-to-the-man` | nee |
| 2. Tekst (+ tekst-naar-nootkoppeling) | `HymnText` | `nld:praise-to-the-man` | ja |
| 3. Zangboekuitgave | `HymnbookEdition` | `nld-lofzangen` | ja |
| 4. Lofzangnummer in die uitgave | `HymnbookEntry` | nummer `24` | per uitgave |
| 5. Herkenningsgegevens | `Reference` (afgeleid) | niet opgeslagen | nee |

Waarom zo: dezelfde melodie komt onder een ander nummer of in een andere taal terug, en een nieuw
zangboek hergebruikt vaak melodie of tekst met een ander nummer. Daarom staat het nummer **niet** in
compositie of tekst, en de tekst-naar-nootkoppeling in de tekst (die hangt van de taal af) en niet in
de compositie.

De compositie bevat: noten `[beat, duur, midi, balk]`, maatbegin per maat, secties (`verse`,
`chorus`) en fermates, allemaal in **kwartnoten**, nooit in seconden. Dat maakt de tijdas de
partituur zelf.

Tekst: coupletten met regels en woorden; een woord heeft een `b` (beat) en eventueel lettergrepen.
`linking` is `word` als de lettergrepen aan noten zijn gekoppeld en `line` als alleen de regels
(frasering van couplet 1) bekend zijn. De interface gebruikt woordmarkering alleen bij `word`.

Sinds fase 4 zijn dit statische JSON-bestanden per lofzang (`src/lib/hymns/library/data/`, zie `09-NEDERLANDSE-BIBLIOTHEEK.md`) met vaste
veldnamen (geen woorden als sleutels, zie CLAUDE.md), geladen via een admin-only API. Er is **geen databasemigratie**.

### Later in de database (voorstel, niet gebouwd)

Vier tabellen met dezelfde grenzen: `HymnComposition(id, officialSlug, tuneName, meter, tempo,
sections, notes Json)`, `HymnText(id, compositionId, language, title, stanzas Json)`,
`HymnbookEdition(id, language, editionKey, source/license)` en `HymnbookEntry(editionId, number,
textId)`. Aansluiten op `ContentCollection.work/editionKey/language` voor uitgaven en
bronmetadata. Een migratie volgt het beleid uit CLAUDE.md (nieuwe tabellen, geen terugwerkende
kracht).

## 4. Engine in blokken

```
microfoon / testbestand
   │ Float32 samples
   ▼
ChromaExtractor  (audio/features.ts)   FFT 186 ms, hop 46 ms, 2 x 12 toonklassen, niveau, onset, stilte
   │ FeatureFrame
   ▼
ScoreTracker     (follow/tracker.ts)   deeltjesfilter over (positie, tempo) tegen Reference
   │ positie, tempo, concentratie, bewijs
   ▼
HymnFollowSession (follow/session.ts)  betrouwbaarheid, status, couplet, markering
   ├─ SingingPhase (follow/phase.ts)   voorspel of zang, rondes met dekking, tussenspel (07-...)
   ├─ StanzaPlan   (follow/stanzas.ts) welk couplet; handmatige keuze heeft voorrang
   └─ StableCursor (follow/display.ts) regel/woord; springt niet heen en weer

HymnRecognizer   (recognize/recognizer.ts)  voorfilter (prefilter.ts) + tracker voor de beste kandidaten, z-genormaliseerd bewijs (12-...)

HymnLiveEngine   (live.ts)  ÉÉN luistersessie: één extractor, een kenmerkgeheugen, herkenner -> volger
```

`HymnLiveEngine` is wat de pagina gebruikt. Herkennen en volgen zijn twee fasen van dezelfde stroom
kenmerkframes; de overgang start geen nieuwe microfoon of AudioContext (zie
`07-VOORSPEL-EN-ZANGBEGIN.md`, 5).

Details en afwegingen: `03-SCORE-FOLLOWING-POC.md` en `04-RECOGNITION-POC.md`.

Belangrijke ontwerpkeuzes:

- **Positie en couplet zijn twee toestanden.** De engine kent alleen "positie in de cyclus" en "er
  begon een nieuwe ronde". `StanzaPlan` bepaalt het couplet. Een handmatige keuze verandert de
  muziekvolging niet (test: de posities zijn bit voor bit gelijk met en zonder keuze).
- **Cyclus.** Couplet en refrein samen vormen één cyclus; een nieuwe ronde = een nieuw couplet.
  Daardoor hoeft niets te "weten" welk couplet de gemeente zingt: de ronde telt, de gebruiker kan
  corrigeren.
- **Voorspel.** (Bijgewerkt in fase 2.) Een voorspel is geen couplet: de markering begint pas als
  `SingingPhase` het zangbegin heeft vastgesteld uit structuur (rondegrens, waar de muziek begon,
  pauze) of de gebruiker "Zang begint" tikt. Zonder bewijs wacht de engine; er wordt niet gegokt.
  Het oude `preludeLaps` bestaat niet meer. Details: `07-VOORSPEL-EN-ZANGBEGIN.md`.
- **Verlies.** Mogelijk gemiste rondes worden gemeld (`lapUncertain`) in plaats van stil aangenomen.

## 5. Offline muziekbibliotheek (voorstel)

Doel: de bibliotheek werkt zonder verbinding, zonder de bestaande serviceworker, authenticatie of
privacy te raken.

1. **Eén eindpunt** `GET /api/hymns/library?edition=nld-lofzangen` dat alleen content levert (geen
   gebruikersgegevens), met `ETag` en een `version`. Achter de bestaande sessiecookie, net als
   `Chapter.audioUrl` (auteursrechtelijk materiaal).
2. **IndexedDB-database `versado-hymns`** met stores `editions`, `compositions`, `texts` en
   `reference` (afgeleide kenmerken, herbouwbaar). Sleutels = de stabiele id's uit 3. Elke store
   draagt `version` en een inhoudshash; bij een nieuwe versie vervangt de client alleen wat
   veranderd is.
3. **Geen persoonsgegevens in die database.** Voorkeuren (laatste lofzang, coupletvolgorde) blijven
   losse, per toestel opgeslagen instellingen of een gewone live-data-query; nooit in dezelfde store.
4. **Serviceworker ongewijzigd.** IndexedDB wordt door de pagina zelf gevuld; de worker blijft een
   doorgeefluik. Alleen als later pagina's offline moeten starten, is een apart, expliciet besluit
   over de worker nodig, met eigen cachenaam, en nooit voor gebruikersdata.
5. **Remote-preview (Capacitor)** laadt de web-app van de server; IndexedDB werkt daar ook. In de
   latere lokale client kan dezelfde bibliotheek als gebundeld bestand meegeleverd worden en de
   IndexedDB alleen als updatelaag dienen.
6. **Grootte.** Drie lofzangen met woordkoppeling zijn 38 kB; het hele zangboek is
   **AANNEMELIJK** onder de ~2 MB (ruwweg 205 x 10 kB). De referentiekenmerken worden bij het laden
   in milliseconden afgeleid (**BEWEZEN**: 0,7 tot 3 ms per lofzang in Node op een desktop) en dus niet opgeslagen.

Status: **AANNEMELIJK**, niet gebouwd. De proef bundelt de bibliotheek met de pagina.

## 6. Platformen

- **Web/PWA**: `getUserMedia` en `AudioWorklet` zijn nodig. In Chromium bewezen. In Safari/iOS en
  Firefox **ONBEKEND**; `AudioWorklet` bestaat in iOS Safari sinds 14.5 (**AANNEMELIJK**).
  De extractor werkt op 22,05, 44,1 en 48 kHz (**BEWEZEN** met synthetische opnamen en in Chromium
  op 48 kHz).
- **iOS (WKWebView) en Android (WebView)**: microfoontoegang in een webview vraagt native
  permissies en een bevestiging van de webview (`NSMicrophoneUsageDescription` op iOS,
  `RECORD_AUDIO` en toestemming via de WebChromeClient op Android). Die staan **niet** in de
  projecten en zijn niet toegevoegd (afspraak: pas bij de feature). **ONBEKEND** of het in
  `remote-preview` zonder aanpassingen werkt.
- **Achtergrond**: de proef stopt bij verborgen pagina. Een webview mag in de achtergrond sowieso
  niet blijven luisteren; dat is een bewuste privacykeuze (geen verborgen opname).
- **Audiosessie op iOS**: `speechAudioSession.ts` zet de pagina in een afspeelsessie voor Web Speech.
  Een luistersessie hoort daar niet bij; het combineren van voorlezen en luisteren is **ONBEKEND**.
- **Echo-onderdrukking uit**: `getUserMedia` wordt met `echoCancellation`, `noiseSuppression` en
  `autoGainControl` uit gevraagd. Browsers mogen dat negeren (**ONBEKEND** hoe iOS zich gedraagt).

## 7. Toegang (productie, uitsluitend beheerders)

Stand na de publicatie naar main: **Lofzangen is beschikbaar voor beheerders op de live omgeving**, die
daarmee ook als testomgeving voor de muziekherkenning met echte instrumenten dient (er is geen
afzonderlijke testomgeving). Gewone gebruikers hebben geen toegang en zien niets.

- Route: `/dev/lofzangen` (technische route, zichtbare naam "Lofzangen"). Ingang: de contentkiezer
  `/content`, sectie "Voor beheerders", uitsluitend voor ingelogde beheerders. De kaart is een gewone
  link: er wordt **geen** contentcollectie, contenttaal of studievoortgang gewijzigd en er is geen
  databasewijziging.
- Beveiliging staat server-side in `src/lib/hymns/access.ts` en wordt zowel door `/content` (zichtbaarheid)
  als door de route zelf (toegang) gebruikt, met de bestaande `User.isAdmin`:
  beheerder = toegang; gewone gebruiker = 404; niet ingelogd = redirect naar `/login`.
- Er is **geen** verplichte omgevingsvariabele. `HYMNS_POC=0` is een optionele noodstop die de route en de
  kaart ook voor beheerders verbergt.
- De route staat niet in navigatie of sitemap, `robots: noindex`.
- Getest in `tests/hymns-privacy.test.ts`, `tests/content-picker.browser.mjs` en met een productieserver
  (zie `05-TEST-RESULTS.md`, 9). De eerdere gatingresultaten in 7 van dat document beschrijven de
  oorspronkelijke stand met `HYMNS_POC=1`.
- Microfoon in de browser: `getUserMedia` vereist HTTPS (de live site heeft dat). Mobiele Safari en Chrome zijn
  **niet** getest; in de Capacitor-apps (remote-preview) zijn extra native permissies nodig
  (`NSMicrophoneUsageDescription` op iOS, `RECORD_AUDIO` en een toestemmingsafhandeling van de WebView op
  Android). Die zijn bewust niet toegevoegd; gebruik in de app is dus **ONBEKEND** tot dat gebeurt.
- Teksten van de proef staan bewust nog buiten het i18n-systeem (`components/hymns-poc/copy.ts`);
  dat is toelaatbaar omdat de pagina niet publiek is en moet bij een echte functie alsnog via
  `src/lib/i18n/messages`.
- Kompas: een echte functie krijgt een uitlegonderwerp in het register (zie `docs/KOMPAS.md`). Niet
  nodig voor een niet-publieke proef.

## 8. Nieuw zangboek en andere talen

- **Nieuw wereldwijd zangboek**: een nieuwe `HymnbookEdition` met eigen `HymnbookEntry`'s. Elke
  lofzang die muzikaal gelijk is aan een bestaande wijst naar dezelfde `HymnComposition`; een
  nieuw arrangement krijgt een nieuwe compositie met een verwijzing naar de oorspronkelijke
  (zelfde melodie, andere noten). Vaststellen of melodieën gelijk zijn gebeurt met melodienaam
  (`tunes`) plus een vergelijking van intervalreeksen, nooit met alleen het nummer.
- **Andere talen**: nieuwe `HymnText`-rijen per taal bij dezelfde compositie. De tekst-naar-
  nootkoppeling wordt per taal opnieuw gemaakt (zelfde script, andere bladmuziek-PDF). Als de
  melodie voor een taal ritmisch afwijkt (zoals het refrein van lofzang 24 lijkt te doen), krijgt
  die taal een eigen compositie.
- **Herkenning over talen**: de herkenner werkt op noten, dus op composities, niet op teksten. Een
  lofzang in een andere taal met dezelfde compositie wordt vanzelf herkend; de tekst volgt uit de
  uitgave van de gebruiker (`User.contentLanguage`).
- **Contentwissel**: een nieuwe `ContentRoute` voor lofzangen in `contentRouting.ts` en een tak in
  `contentSwitch.ts`, met een test (CLAUDE.md, "Content- en taalwissel").
