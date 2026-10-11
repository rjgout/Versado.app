# Fase 2 — hintbudget, modal sheet en primaire CTA's

Branch: `fix/puzzle-v2-hint-budget-ui`, vanaf main `105c66a`.
Ontwerp vóór implementatie: `aeb4862`; server/voorraad: `0b8a874`;
interface en browserbescherming: `e603ed0`. Dit rapport volgt als aparte
opleveringscommit. De PR wordt geopend, niet zelfstandig gemerged.
Fase 3 en ranglijsten blijven buiten scope.

## Hintbronnen en afschrijving

De bestaande `User.hintBalance` blijft de enige persoonlijke voorraad. Winkel,
Woordspel en Raad het hoofdstuk gebruiken hetzelfde veld en dezelfde bestaande
prijs (50 XP per winkelaankoop). Inbegrepen puzzelhints zijn uitsluitend het
sessiebudget uit de bestaande snapshot: Ontdekker onbeperkt, Avonturier 3,
Expert 2, Meester 1. Hervatten/herladen/start van dezelfde open poging reset
niets. Een nieuwe poging na beantwoorden begint met een leeg hintlog.

De server valideert eigendom, ACTIVE-status, regels/structuur, verwachte versie,
actionId, actieve hint en uitvoerbaar geometrisch target vóór iedere betaling.
Zolang inbegrepen budget beschikbaar is, blijft de voorraad ongewijzigd.
Daarna vereist het verzoek `confirmPersonal: true`; bij voldoende voorraad
schrijft de server exact één hint af. Bij leeg saldo geeft de API 402/EMPTY,
zonder bevestiging 409/CONFIRM. Beide maken geen hint of nieuw actionlog.
Ongeldige/onbeschikbare hints en afgeronde sessies kosten niets.

Afschrijving gebruikt dezelfde conditionele update (`hintBalance > 0`) als
bestaande hintactiviteiten, binnen de puzzeltransactie. Lockvolgorde blijft
sessie → gebruiker, zoals de antwoordafhandeling; de startlock is vrij vóór
resume. Afschrijving, log, hinttarget/tijd, snapshot en sessieversie slagen of
rollen samen terug. Verschillende sessies kunnen de laatste hint niet samen
uitgeven. Een bestaande actionId wordt vóór status/versiecontrole herkend,
valideert dezelfde payload en geeft de actuele serverstatus terug zonder nieuwe
afschrijving. De client herhaalt verloren responses met dezelfde requestbody.

Nieuwe hintrecords bewaren type, at, expiresAt, actionId, target en extra, met
expliciete `source: INCLUDED | PERSONAL`. Oudere bronloze records blijven
ongewijzigd, tellen mee voor reeds gebruikt budget en worden nooit achteraf
betaald. Historische `extra` betekent niet automatisch persoonlijk betaald;
latere vergelijkingen kunnen PERSONAL onderscheiden van historische extra's.
Er is geen schema- of datamigratie, nieuw saldo of valuta. Geometry 1/2 en
rulesVersion 1/2 blijven behouden. De economische correctie geldt alleen voor
nieuwe hintaanvragen in nieuwe én hervatte sessies.

## Interface, voorraadverversing en camera

De toegang blijft het ⋯-menu; de 60×60 bordknoppen en fullscreen Canvas blijven.
De sheet volgt de bestaande Versado-stijl van mobiele sheets en de native-modal
architectuur van de contentkiezer, met één rustige lijst van vier hulpmiddelen.
Beide budgetten staan bovenaan. Sorteerhulp opent Hoek/Rand/Midden; alleen de
uiteindelijke keuze maakt een hintactie. Ontbrekende selectie, externe buur of
middenstukken worden begrijpelijk uitgelegd. Extra hints krijgen een aparte
bevestigingsstap met actueel saldo en Annuleren. Een leeg saldo biedt de
bestaande `/shop` aan; de lopende snapshot is al server-side opgeslagen en de
lokale hervatsleutel blijft behouden.

De body-portal/native dialog maakt het bord inert. Tab/Shift+Tab blijven binnen
de sheet, ook na het vervangen van een subkeuze. Escape/sluitknop herstellen
focus naar de vaste menuknop. Alleen de inhoud scrollt; titel/sluitknop blijven
bereikbaar. Safe areas, 320px, landschap en 200% tekst zijn gecontroleerd.

`useHintInventory` is een kleine hook boven de bestaande centrale live-data-laag
voor `/api/hints`, geen nieuw voorraadmodel. Start/resume/act geven actuele
servervoorraad terug. Openen vraagt opnieuw voorraad op; focus, terugkeer en
reconnect lopen via de centrale laag. Hintacties publiceren hun serverantwoord
vóór invalidatie via `liveMutation`/`hintsChanged`. Serververbruik en aankoop
zenden na commit `hints_changed`, zonder saldo in de socketpayload. Winkeldata
valt al onder games; beide bestaande hintspellen lezen dezelfde voorraadquery.
Woordspel neemt ook het actuele saldo uit zijn bestaande spelresponse over,
zodat zelf verdiende hints zichtbaar blijven.

Hints blijven vijf seconden visueel, zonder stukken/verbindingen te veranderen.
Locatie/verbinding behouden zoom en camera wanneer het target zichtbaar is;
anders wordt alleen minimaal naar het target gepand. Alles passend tonen blijft
een uitdrukkelijke menuactie. Geen hintspecifieke XP of reeksactiviteit;
de inhoudelijke vraag en centrale antwoord-/reeksregels blijven intact.

Start, Verder, Antwoord bevestigen, Nog een puzzel en replay zijn lokaal
volle contentbreedte, maximaal 440px, minimaal 48px en consistent gecentreerd.
De startknop blijft tijdens de request staan met disabled/loading in plaats van
het hele keuzescherm te vervangen. Globale knopstijlen zijn niet aangepast.

Kompas-topic `play.jigsaw` is versie 3. Uitleg en alle nieuwe/gewijzigde teksten
zijn expliciet meegenomen in Nederlands, Engels, Duits, Frans en Spaans.

## Uitgevoerde validatie

- Schone Next-productiebuild: geslaagd.
- TypeScript: geslaagd na iedere coherente wijziging en na de productiebuild.
- Prisma validate/generate: geslaagd; alle 132 migraties toegepast op een eigen
  tijdelijke PostgreSQL 16-container, geen productiedatabase gebruikt.
- 40 database-integratietests, 0 skips: 31 puzzel/vraag/voorraad/economie + 9
  Kompas. Inclusief een echte DB-fout na afschrijving met volledige rollback,
  dubbele/verloren requests, concurrentie binnen/tussen sessies, oude records,
  winkelaankopen en hintverbruik in Raad het hoofdstuk en Woordspel.
- 41 pure puzzeltests, 23 focus/layouttests, 60 pure Kompas/layouttests en 51
  live-data-tests: geslaagd. Kompas totaal 69 inclusief de 9 DB-tests hierboven.
- Vijf productie-Chromium-browsersuites: geslaagd, echte API/DB, desktop en
  touch-emulatie. Naast nieuwe hints/voorraad/sheet/CTA's blijft bewijs aanwezig
  voor alle 216 catalogusafbeeldingen, content buiten de eerste twintig,
  vraag/historische antwoorden/replay, dagregels/geen dubbele beloning,
  fullscreen, exacte naadpixels, draglift/groepen, pinch/pan, rotatie en snapping.
- De nieuwe browserflow bewijst persoonlijk verbruik ondanks een verloren
  response met maximaal één afschrijving, vooraf bevestigen/annuleren,
  sorteer-submenu zonder request, live voorraad na winkelaankoop, leegsaldo →
  winkel → dezelfde puzzel hervatten, echte gezoomde cameratransform onveranderd,
  320px/landscape/200%/safe areas/dark/Duits, focus/inert/Escape/scroll en gemeten
  CTA-breedtes plus disabled/loading via uitgestelde echte requests.
- ESLint: 0 fouten, 132 bestaande waarschuwingen (main had 133). Nieuwe
  kernbestanden: 0 waarschuwingen. Geen nieuwe lintwaarschuwingen geïntroduceerd.
- i18n: 3652 Nederlandse sleutels, 3229 expliciet vertaald per overige taal;
  de 423 reeds bestaande ontbrekende sleutels zijn niet vergroot. Alle sleutels
  in deze correctie zijn in alle vijf talen aanwezig; automatische test groen.
- Git diff-check: geslaagd. GitHub Actions valideert dezelfde PR-head;
  actuele build/testlinks en status staan in de PR.

## Browserbewijs

Alle screenshots worden ook bij iedere CI-run als artifact opgeslagen.
Vaste voorbeelden van de echte lokale productie-interface staan in deze PR:

- [Mobiele hintsheet](evidence-hint-budget/hint-stock-mobile.png)
- [Desktop hintsheet](evidence-hint-budget/hint-stock-desktop.png)
- [Persoonlijke bevestiging](evidence-hint-budget/hint-personal-confirm-mobile.png)
- [Brede vervolgstappen](evidence-hint-budget/puzzle-wide-cta-mobile.png)
- [320px, 200% tekst en dark mode](evidence-hint-budget/hint-sheet-mobile-320-200-dark.png)

## Gewijzigde bestanden

Server: `src/lib/puzzle/{solo,types}.ts`, `src/app/api/jigsaw-v2/route.ts`,
`src/lib/{shop,chapterGuess,scrabbleGame}.ts`.
De bestaande targets/budgetlogica in `src/lib/puzzle/hints.ts`, bestaande
`/api/hints`, `/api/shop`, Prisma-schema en hintprijs zijn hergebruikt.

Client: `src/components/{JigsawV2Client,PuzzleHintPanel,ChapterGuessSoloClient,
ScrabbleBoardClient}.tsx`, `src/lib/data/{hints,scopes}.ts`.
Uitleg: vijf `src/lib/i18n/messages/*.ts`, `src/lib/kompas/registry.ts`.
Tests: `tests/puzzle-{copy,solo.integration,hint-inventory.integration}.test.ts`,
`tests/puzzle-{difficulty,hint-inventory}.browser.mjs`, geïsoleerde runner en
`.github/workflows/puzzle-v2.yml`. Documentatie: DATA-REFRESH, puzzelstukken
02/03/06/16/17 en vijf bewijsbeelden.

## Grenzen

Geen fysieke iPhone/Safari/Android-WebView getest; mobiel bewijs gebruikt echte
Chromium-touch-emulatie. De live mobiele gevoelsacceptatie blijft bij de gebruiker.
Geen bekende resterende functionele fout binnen de geteste scope. De bestaande
algemene lintwaarschuwingen en ontbrekende vertalingen buiten deze taak blijven.
Geen productie-deploy of merge, geen visueel redesign van de engine en geen fase 3.
