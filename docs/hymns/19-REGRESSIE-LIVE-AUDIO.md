# 19 · Regressie live audio (15 oktober 2026)

Melding van de eigenaar: op de avond van 14 oktober werkten herkenning en live meezingen nog; na de bibliotheekupdate van 15 oktober gaat de
microfoon aan maar wordt niets herkend, ook een handmatig gekozen lofzang wordt niet gevolgd, en de microfoon stopt soms vanzelf.

**Let op wat dit onderzoek wel en niet kan bewijzen.** Alles hieronder is gemeten met Node en Chromium met een nep-microfoon (bestand), niet op
een echte iPhone. De fout die is gevonden en hersteld is reproduceerbaar en verklaart de gemelde verschijnselen; of dit ook de enige oorzaak op het
toestel van de eigenaar was, kan pas een praktijktest met de nieuwe diagnostiek bevestigen (zie "Nog te bevestigen op een echte iPhone").

## Tijdlijn (commits op `main`)

| Moment (CEST) | Commit | Wat |
|---|---|---|
| 14 okt 21:56 | `e54700ec` / `23c70c36` (#112) | Rustige mobiele meezingervaring. **Laatste vermoedelijk werkende versie.** Drie proeflofzangen als statisch JSON in de bundel; geen netwerk of opslag tussen microfoon en herkenning. |
| 15 okt 00:31 | `5884de01` (#113) | Alleen Dockerfile/OTB-diagnose; raakt Lofzangen niet. |
| 15 okt 07:22 | `8d32d962` (#114) | **Eerste defecte commit.** Volledige bibliotheek (205); herkenning haalt `/api/hymns/recognition` op, lofzangen komen via `/api/hymns/<n>`, met IndexedDB. Hier ontstaat het foutpad (zie hieronder). |
| 15 okt 09:12 | `87d2d605` (#115) | Lezen eerst; ongewijzigd t.o.v. het foutpad. |
| 15 okt 11:42–15:29 | #116, #117, #118 | OTB-verwijzingen en Legpuzzel; raken de audioketen niet (shell-modus: geen unmount van Lofzangen). |

De deployment van `main` volgt de merges; er is geen aanwijzing voor een verschil tussen `main` en de gedeployde image behalve dat de proeflofzangen niet meer
uit de bundel komen maar uit de API (die zit wel in de Docker-image: `COPY src`, `.dockerignore` sluit `src/lib/hymns/library/data` niet uit).

## Wat NIET de oorzaak is (gemeten)

Dezelfde officiële begeleiding van lofzang 82 (`come_follow_me_accompaniment_eng.mp3`, 252 s, mono 48 kHz, buiten git) door oude (`23c70c36`) en huidige code,
met dezelfde 2048-samplebuffers en hetzelfde tijdsbudget als de client (`scripts/hymns/repro-live-audio.ts`):

| Meting | Oud (`23c70c36`) | Nieuw (`main`) |
|---|---|---|
| A. Direct volgen van 82: eindstatus / ronde / positie | locked / 4 / 0,4 | locked / 4 / 0,4 (identieke posities op elk meetpunt) |
| B. Herkennen: eerste voorstel | 68,6 s | **34,0 s** |
| B. Overgang naar automatisch volgen | 70,6 s | **36,0 s** |
| CPU per seconde audio (volgen / herkennen, desktop) | 24 / 27 ms | 22 / 41 ms |
| Compositie 82 (`notes`, maten, secties, tempo) | = | identiek (JSON-gelijk) |

Verzwaarde opnames (zelfde bestand): −24 dB, plus roze ruis, en galm met telefoonspeaker-bandfilter. Oud en nieuw volgen identiek (de volger is niet gewijzigd); bij ruis en galm
verliest **zowel de oude als de nieuwe** volger de lock (`lost`) — dat is dus geen regressie maar een bekende beperking. De nieuwe herkenner presteert hier beter dan de oude
(galm: oud "onbekend", nieuw herkend na 39 s).

In Chromium (echt bestand als nep-microfoon, productiebuild, volledige keten tot UI) werken herkennen en direct volgen met zowel de oude als de huidige UI.
`audio/micListener.ts` en `audio/features.ts` zijn sinds `23c70c36` niet gewijzigd; `follow/` evenmin.

## De gevonden fout (reproduceerbaar)

Sinds #114 staan er twee nieuwe afhankelijkheden op het kritieke pad van "luisteren": het ophalen van de herkenningsbundel en van de lofzang via de API, met IndexedDB
ervoor. De foutafhandeling was onjuist:

1. Mislukt `/api/hymns/recognition`, dan riep de client `micRef.current?.stop()` en `engine.restart()`. De stop kwam te vroeg (de microfoon was nog "aan het aanvragen"
   en `MicListener.stop()` annuleerde die lopende start niet), dus de microfoon ging daarna **alsnog aan**, terwijl de engine op `idle` stond en elke audiobuffer negeerde.
2. De foutmelding werd direct weggewist door de overgang naar `listening`, en de pagina toonde alleen de titel **"undefined."**, een Stop-knop en geen lijst om zelf een lofzang te kiezen.
   Dat is precies "de microfoon gaat aan, er wordt niets herkend".
3. Kiezen van een lofzang volgde alleen als `engine.currentStage !== "idle"`; na de mislukte herkenning stond de engine op `idle`, dus **ook een handmatig gekozen lofzang werd
   niet gevolgd**. Dat is de gedeelde oorzaak van beide verschijnselen.
4. `indexedDB.open()` krijgt, zonder tijdslimiet, op sommige iOS-Safari-situaties nooit antwoord; `loadHymn` en `loadRecognitionBundle` wachtten daar eindeloos op voordat ze het netwerk probeerden.
5. Een zichtbare melding bij "geen audio ontvangen" bestond niet: een onderbroken AudioContext of niet-leverende worklet bleef er als "luisteren" uitzien.

Waarom het gisteravond nog werkte: er was geen netwerk- of opslagafhankelijkheid. Waarom het na de update niet meer werkte: zodra de bundel of de opslag in de omgeving van de eigenaar
vertraagt of faalt (trage NAS-proxy, time-out, vergrendelde opslag), eindigt de sessie in bovenstaande dode toestand. **Waaróm de bundel bij de eigenaar mislukte is nog niet vastgesteld**
(proxy, sessie, opslag of iets op het toestel); daarom meldt de diagnostiek nu de reden.

## Reparatie (gericht; geen drempels aangepast, engine niet vervangen)

- Een mislukte herkenningsbundel stopt de microfoon **niet** en wist de engine niet. De engine blijft luisteren (het geheugen van 90 s blijft bewaard) en loopt het na een geslaagde nieuwe poging
  alsnog door. De fout staat zichtbaar in beeld met "Opnieuw proberen" en de lijst om zelf een lofzang te kiezen.
- Een gekozen lofzang wordt gevolgd zodra de microfoon luistert (ook als de engine nog op `idle` stond).
- `MicListener.stop()` tijdens het aanvragen annuleert de start nu; elke stop heeft een reden (gebruiker, achtergrond, pagina verlaten, systeem, fout).
- IndexedDB-bewerkingen hebben een limiet van 1,5 s; netwerkverzoeken 20 s met één nieuwe poging bij netwerk-/5xx-fouten (niet bij 4xx).
- Titel toont nooit meer "undefined.".
- Een onbekende melodie laat de microfoon actief (getest, > 2 minuten).

## Beheerdersdiagnostiek (technisch paneel, privacyvriendelijk)

Microfoonstatus, AudioContext-status, microfoonspoor, ontvangen audiobuffers (+ samplefrequentie), tijd sinds de laatste buffer, geproduceerde muziekframes, laatste frame (stilte of hoorbare muziek + dB),
status van de herkenningsbibliotheek (geladen/laden/FOUT + bron + aantal), aantal actieve kandidaten, verwerkingsachterstand, score-following-status en de laatste microfoonstopreden.
Alleen tellers en niveaus; geen audio, niets wordt verzonden of bewaard. Buiten het paneel toont de pagina na 3 s zonder audiobuffers de melding "Er komt geen geluid binnen".

## Vóór en na (browser, Chromium, nep-microfoon met het echte 82-bestand, `scripts/hymns/e2e-live-failures.mjs` en `e2e-live-audio.mjs`)

| Scenario | Vóór (`main`) | Na (reparatie) |
|---|---|---|
| Normaal herkennen | herkend na 38 s, volgt | herkend na 37 s, volgt |
| Normaal direct volgen | locked na 20 s | locked na 20 s |
| Bundel geeft 500 | **kapotte pagina ("undefined."), geen melding, geen lijst**, microfoon aan, engine idle | melding + opnieuw proberen + lijst, microfoon aan |
| Bundel faalt, daarna zelf lofzang 82 kiezen | niet mogelijk (geen lijst) | volgt direct (locked na 19 s) |
| Bundel faalt, daarna "Opnieuw proberen" | niet mogelijk | herkend na 37 s |
| Bundel pas na 12 s | herkend na 37 s | herkend na 37 s (het geheugen wordt doorlopen; herhaald gemeten) |
| `indexedDB` antwoordt nooit | **niets herkend in 70 s** ("Luistert naar muziek") | herkend na 36 s |
| Worklet levert geen audio | **geen melding**, diagnostiek ontbreekt | melding zichtbaar, diagnostiek toont 0 buffers |
| Onbekende melodie, 160 s | — | microfoon blijft actief, "Geen van de beschikbare lofzangen herkend" |

Engine- en integratietests (`tests/hymns-live-regression.test.ts`, onderdeel van `npm run test:hymns`): drie proeflofzangen volgen; bundel laadt (171 composities, kalibratie aanwezig); volledige bibliotheek herkent 82 en
neemt automatisch over (needHymn → registerHymn → volgen); herkenning wacht op gegevens terwijl audio binnenkomt; duurtest > 130 s; onbekende melodie; hangende opslag; retry-gedrag; afwezigheid van `stop()`/`restart()` in het bundel-foutpad;
cancel-bij-aanvragen en stopredenen. Met `HYMNS_REAL_AUDIO_82=<wav>` draaien twee tests met het officiële bestand mee (zonder bestand worden ze overgeslagen; het bestand staat nooit in git).

## Nog te bevestigen op een echte iPhone

- of `/api/hymns/recognition` en `/api/hymns/<n>` daar slagen (de diagnostiek toont bron, fout en status);
- of de AudioContext `running` blijft (onderbreking door beller, Siri, vergrendelscherm), en na hoeveel seconden audiobuffers binnenkomen;
- of het scherm dimmen/vergrendelen de microfoon stopt (`visibilitychange` → reden "achtergrond", bewust gedrag);
- of de herkenning met echte kerkgeluiden en een telefoonmicrofoon slaagt (de volger verliest in mijn ruis-/galmtest de lock, in oud én nieuw);
- of de reverse proxy/NAS naast de aangepaste `Permissions-Policy` nog iets aan de headers of compressie verandert (zie hieronder: de publieke route is gemeten).

## Tweede, bevestigde oorzaak: de productieproxy blokkeerde de microfoon (Permissions-Policy)

Gemeten op de echte publieke route (`curl -I https://versado.app/...` op 15 oktober 2026, 16:24 UTC):

```
/dev/lofzangen (307 naar /login)   permissions-policy: camera=(), microphone=(), geolocation=()
/login                             permissions-policy: camera=(), microphone=(), geolocation=()
/api/health                        permissions-policy: camera=(), microphone=(), geolocation=()
```

`deploy/nginx/nginx.conf` (sinds commit `7d2ee15b`, 7 oktober) zet die header op ELKE response (de app zelf zet hem niet). Een browser die `microphone=()` ziet, weigert
`getUserMedia` volledig, ook als de gebruiker toestemming geeft. Gemeten in Chromium met precies deze header: de microfoon wordt nooit geopend, de app meldt de oorzaak.

**Wat ik wel en niet kan vaststellen.** Dat de header nu in productie staat is gemeten. *Sinds wanneer* de proxy-container hem stuurt weet ik niet: de proxy is bewust een altijd-actieve container
die bij app-updates blijft draaien. Een oudere proxy-image (van vóór 7 oktober) zou verklaren waarom het op 14 oktober nog werkte en na het opnieuw aanmaken van de proxy niet meer; dat is een
aannemelijke, niet bewezen verklaring. Let op: bij deze oorzaak meldt de app "geen toestemming" en gaat de microfoon niet aan; de eigenaar beschreef "de microfoon gaat aan". Dat past bij de eerste
oorzaak (bundelfout). Beide kunnen dus tegelijk bestaan of op verschillende toestellen/tijdstippen zijn opgetreden.

**Reparatie (afgebakend):** `Permissions-Policy: camera=(), microphone=(self), geolocation=()`. De microfoon is alleen toegestaan voor de eigen oorsprong (geen iframes of andere oorsprongen; `X-Frame-Options: DENY` staat er
bovendien), camera en locatie blijven voor iedereen gesloten. Daarnaast herkent de app nu een blokkerende policy (`document.permissionsPolicy.allowsFeature("microphone")`), meldt die als eigen oorzaak en toont hem in de diagnostiek.

**Regressietest:** `tests/proxy-headers.test.ts` (draait mee in CI via `content-access.yml` en in `npm run test:hymns`/`test:proxy`): de microfoon moet `(self)` zijn, nooit `*` of een andere oorsprong, camera en locatie `()`, de
beveiligingsheaders mogen niet door een `add_header` in `location /` verdwijnen, en geen enkel ander bronbestand mag `microphone=()` zetten. Bewezen: met de oude `nginx.conf` falen 2 van de 5 tests. Browserbewijs (`e2e-live-failures.mjs`, scenario's
`policyblock` en `policyself`): met de oude header geen microfoon en een zichtbare oorzaak, met `(self)` wordt lofzang 82 herkend na 40 s.

**Voor het effect in productie moet de `jehova-proxy`-image opnieuw worden gebouwd én die container opnieuw worden aangemaakt** (een app-update alleen volstaat niet; de proxy blijft bewust draaien). Dat gebeurt pas na jouw toestemming.
