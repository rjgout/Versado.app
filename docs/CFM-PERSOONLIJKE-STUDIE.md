# CFM Persoonlijke Studie 2.0

Persoonlijke studie van "Kom dan en volg Mij" (CFM) in twee leeswijzen: **Vrije studie** (de persoonlijke studie van de
week als één compacte, doorlopende tekst) en **Stap voor stap** (precies zeven stappen per week, "Stap 1" t/m "Stap 7",
nooit dagnamen). Dit document is de Fase 0-audit, het ontwerp en de beslislijst. Het beschrijft ook wat bewust niet is
gedaan.

> **Kernregel.** De officiële brontekst, blokken, volgorde, ankers (`block.id`/`section.id`) en publicatierevisies
> veranderen nooit. Alles hieronder is presentatie en studievoortgang bovenop de gepubliceerde revisie. Er is geen
> contentreload, geen nieuwe publicatie en geen wijziging in bestaande studiegegevens nodig.

## 1. Fase 0 — audit: wat is er, en wat is geverifieerd

Geverifieerd tegen de actuele `main` (`4fc35027`), niet tegen aannames.

### 1.1 Brondata (alle 52 lessen offline gelezen via `loadCfmLesson`)

* Elke les is **één platte sectie** (`sections.length === 1`) met een vaste opbouw van precies **drie h2-koppen**: lestitel
  (bv. "Genesis 24–33"), "Studietips voor thuis en in de kerk" (persoonlijk) en "Ideeën voor onderwijs aan kinderen"
  (kinderen), gevolgd door bijlagen (handouts, PDF-links, promotie, video's van de kinderregio). Dat geldt voor 52 van 52
  lessen (`scripts/study-content/cfm-structure-audit.ts`). De scheiding persoonlijk/kinderen kan dus op **structuur**
  gebeuren; er is geen trefwoordfilter.
* Persoonlijke regio per les: 3 tot 7 onderwerpen (h3), 10 tot 20 inhoudseenheden, 2.663 tot 5.975 tekens.
* Bronblokken die bij de brontitel horen (`b-reference*`, `b-short_reference*`, `b-title_number*`) zijn metadata die al in
  de leskop staan.
* Een bronbijschrift is een losse alinea direct na een afbeelding zonder eigen `caption`; een **kader** (tip of
  verwijzing, `b-figureN_pN` zonder voorafgaande afbeelding) is een twijfelgeval: 73 in persoonlijke regio's.
* Afbeeldingen komen met vaste pixelbreedtes (`!320,`, `!500,`) en hebben altijd `width`/`height`; `alt` is altijd
  gevuld. Het type volgt dus niet uit afmetingen alleen (zie §6).

### 1.2 Systemen die hergebruikt worden (geen tweede systeem)

| Onderdeel | Bevinding | Gevolg |
|---|---|---|
| Annotaties | Eén systeem (`StudyAnnotations`, `AnnotationActions`, doeltype `lesson` met `PassageSelector`, vijf kleuren, drie tabellen). Selectors rekenen met het **volledige** document en blok-id's. | Geen tweede annotatiesysteem. De lezer geeft `StudyAnnotations` altijd het volledige document; alleen de weergave filtert. |
| Leespositie | `ReadingPosition` per gebruiker + editie, blokankers, optimistische versies. De controller leest alleen DOM-blokken. | Eén gedeelde leespositie voor Vrije studie, een stap en de volledige les; geen nieuwe tabel. |
| Hele les gelezen | `markStudyLessonRead` (READ-actie, `StreakActivity`, idempotent). | Onveranderd; "Stap afronden" raakt dit **nooit** (test bewaakt dit). |
| Kalender | `getStudyCatalogue` bepaalt `currentLessonKey` uit `startsOn/endsOnExclusive` in de tijdzone van de gebruiker (`userDayKey`). | Hergebruikt voor "Stap voor stap → huidige week"; geen eigen weekrekensom, geen hardgecodeerde weeknummers. |
| Shell | `focusMode.ts`, `SubpageBackBar`, `FocusLayout`. | Dezelfde Focusroute voor de nieuwe paden; geen nieuwe shellmodus, geen eigen sticky/fixed. |
| Afbeeldingsviewer | **Bestond niet.** | Eén kleine `ImageViewer` (native `<dialog>`), zie §6. |

### 1.3 Risico's en hoe ze zijn afgedekt

1. **Selectors bij gedeeltelijke weergave.** Afgedekt: volledige `document` naar `StudyAnnotations`, gefilterd document naar
   `RichContentBlocks` en de leespositiecontroller.
2. **Annotaties op onderdelen buiten de route.** Een annotatie-deeplink (Mijn studiemap) buiten de persoonlijke blokken, of een
   herstelvoorstel, opent automatisch de **volledige les** met een melding. De bestaande lijst "Annotaties bij deze les" toont
   altijd alle annotaties.
3. **Stapnummer als sleutel is onveilig** bij een nieuwe revisie. Voortgang hangt aan een inhoudsvingerafdruk (§5).
4. **READ/reeks/XP.** Aparte tabel en service; geen imports uit streak/XP/leesstatus (test).
5. **Overige programma's.** `isPersonalStudyWork` is alleen waar voor `cfm-*`; FSY en andere programma's behouden de bestaande lezer,
   het bestaande (zichtbare) annotatieknopje en de oude typografie (`compact`-vlag).
6. **Productie.** Niets is uitgerold of herladen. De migratie is additief; de eigenaar past die toe.

## 2. Architectuurkeuzes

* **Presentatielaag, geen nieuw inhoudsmodel.** `src/lib/studyContent/personalStudy.ts` is puur en deterministisch en
  draait bij elk verzoek op de gepubliceerde revisie (goedkoop: ≤ ~200 blokken). Er is dus niets opgeslagen om te
  beheren of te laten verouderen.
* **Eén bron van waarheid per verzoek.** `loadPersonalStudyPage` levert voor Vrije studie, het overzicht en een stap
  hetzelfde plan, dezelfde revisie en dezelfde voortgang.
* **Routes** (onder de bestaande lesroute, deeplinks blijven werken):
  `/study-lesson/[les]/[collectie]` (Vrije studie; `?weergave=volledig` = volledige officiële les),
  `…/stappen` (weekoverzicht met zeven kaarten) en `…/stappen/[1-7]`.
* **Leeswijze wisselen** zijn gewone links. Van Vrije studie naar Stap voor stap gaat de lezer naar de stap die de laatst
  opgeslagen alinea bevat; van een stap terug opent de gedeelde leespositie dezelfde alinea. Geen redirects of lussen.

## 3. Indelingsmodel (Fase 1)

Rollen per bronblok (`PersonalRole`): `META`, `INTRO`, `SECTION_HEADING`, `READING_LABEL`, `TOPIC_HEADING`, `CONTENT`,
`FIGURE`, `CAPTION`, `SIDEBAR` (twijfelgeval), `TEACHING`, `OVERRIDE_HIDDEN`. Elk blok krijgt `personal` + een reden in
gewone taal; niets verdwijnt zonder reden (test).

* **Standaard zichtbaar:** inleiding, persoonlijke studieonderwerpen, schriftgedeelten, vragen, citaten, afbeeldingen,
  bijschriften, video-verwijzingen uit de persoonlijke regio.
* **Standaard verborgen (altijd bereikbaar via "Volledige les"):** metadata (staat in de leskop), alles vanaf "Ideeën voor
  onderwijs aan kinderen" (kinderen, handouts, promotie, bijlagen) en door een override verborgen kaders.
* **Zeven stappen:** atomen (koppen en schriftlabels blijven bij het blok erna, een bijschrift bij zijn afbeelding; een alinea
  wordt nooit gesplitst) worden met dynamisch programmeren in zeven aaneengesloten delen verdeeld: kwadratische afwijking
  van de leeslast (tekens, beeld telt als 200), straf voor een grens binnen een onderwerp en voor een stap die met een
  korte alinea of bijna alleen beeld begint. Gelijke uitkomst bij gelijke invoer; vroegste grens wint bij een gelijkspel.
* **Staptitel:** de h3 van het onderwerp dat in de stap begint, anders van het onderwerp waarin de stap doorloopt
  ("Vervolg"), anders het schriftgedeelte uit de lestitel.
* **Overrides** (`data/study-content/cfm-2026-nl/personal-study-overrides.json`, per programma en les): `hide` (met
  `text8`, een hash van de brontekst; bij een gewijzigde tekst vervalt de override vanzelf en wordt dat gemeld) en `cuts`
  (6 blok-id's; ongeldig = terugval op automatisch). De brontekst wordt nooit aangeraakt.
* **Niet verdeelbaar** (geen drie h2-koppen, minder dan zeven atomen): `supported: false`; de lezer toont dan de volledige
  les en er wordt niets verzonnen.

### Validatie (alle 52 lessen, offline)

`npx tsx scripts/study-content/cfm-personal-study-report.ts [--steps] [--doubtful]`

* 52/52 lessen ondersteund, **precies 7 niet-lege stappen**, 0 problemen; elk bronblok staat precies één keer en in
  bronvolgorde in het plan; de stappen bevatten exact de persoonlijke blokken; het brondocument blijft byte-identiek.
* 1.714 blokken persoonlijk, 1.316 daarbuiten (allemaal met reden). Stapgrootte 247 tot 1.451 tekens (gemiddeld 772).
* Twijfelgevallen: 73 kaders. **51 verborgen door expliciete override** (42 verwijzingen naar externe tijdschriftactiviteiten en
  9 duidelijke leerkrachttips), **22 blijven zichtbaar** (algemene studietips). Dit is een inhoudelijke keuze van de eigenaar;
  zie §8.
* Alle 52 lessen zijn aangetoond verdeelbaar zonder opvulling of verzonnen inhoud; er zijn geen lessen die als
  contentcontrolepunt gemeld moeten worden.

## 4. Annotaties zoals bij de Schriften (Fase 3)

* Een tik op tekst opent het bestaande paneel met de hele alinea als doel; bladwijzer, vijf kleuren, privénotitie
  (toevoegen/bewerken/verwijderen) en terugvinden zijn ongewijzigd en gebruiken dezelfde API en tabellen.
* **Geen driepuntjes meer** in de compacte weergave. Voor toetsenbord en schermlezer heeft elk tekstblok een echte, onzichtbare
  knop (`data-annotation-for`) die bij focus zichtbaar wordt; na sluiten keert de focus er terug. Geen geneste
  interactieve elementen: een tik op een verwijzing, link, knop of afbeeldingsvergroting houdt zijn eigen actie.
* Een scrollgebaar (verplaatsing > 8 px) opent niets; selecteren door te slepen opent niets. Een tweede tik op geselecteerde
  tekst of de bestaande "Geselecteerde tekst annoteren" opent het fragmentdoel.
* Een blok met annotaties krijgt een subtiele balk links plus een bladwijzer- of notitie-icoon; markeringen blijven
  zichtbaar via de CSS Highlight API.
* `block.id`/`section.id` zijn onveranderd; een annotatie hoort bij hetzelfde bronblok in Vrije studie, Stap voor stap en de
  volledige les.

## 5. Voortgang, leespositie en reeks (Fase 5)

* **Tabel `StudyStepProgress`** (migratie `20261121120000_study_step_progress`, additief): sleutel
  `(userId, lessonEditionId, stepFingerprint)`; status `IN_PROGRESS`/`COMPLETED`; `CHECK` dat afgerond ⇔ tijdstip; stapnummer 1–7.
* **Vingerafdruk per stap** = hash van plan-versie, blok-id's en brontekst van de stap. Bij een nieuwe revisie met andere stapgrenzen
  of tekst is de vingerafdruk anders, dus een oude afronding wordt nooit stil een inhoudelijk andere stap. Onveranderde stappen
  behouden hun afronding. Wijzigt de regelversie (`PERSONAL_STUDY_VERSION`), dan start voortgang bewust opnieuw.
* **Service** `recordStepProgress`: server herberekent het plan uit de gepubliceerde revisie en valideert revisie én vingerafdruk;
  advisory lock per gebruiker+editie; **monotoon** (afgerond blijft afgerond; heropenen werkt alleen "laatst geopend" bij);
  herhaalde of gelijktijdige verzoeken geven één rij en één echte wijziging.
* **Strikt gescheiden van de hele les:** stap openen/afronden roept nooit `markStudyLessonRead`, reeks, XP of celebration aan.
  Na zeven afgeronde stappen nodigt de interface uit, de gebruiker markeert de les zelf (bestaande actie, ongewijzigd).
* **Live data:** scope `studySteps`, gebeurtenis `studyStepsChanged` (docs/DATA-REFRESH.md). Geen eigen polling.
* **Leespositie:** gedeelde `ReadingPosition`; alleen bewuste scroll-interactie schrijft (bestaand gedrag); het openen van een
  annotatiepaneel verandert de positie niet. Zonder opgeslagen positie in het zichtbare deel begint de weergave bovenaan.
* Weekkaarten tellen afgeronde stappen van de **nu gepubliceerde revisie** (`completedStepCounts`); de lesweergave zelf vergelijkt exact op vingerafdruk.

## 6. Compacte vormgeving en afbeeldingen (Fase 4)

* Compacte kop (lestitel, schriftgedeelten, leeswijzeschakelaar, subtiele voortgangsbalk, secundaire acties in een menu);
  geen grote kaart om de tekst; "Markeren als gelezen" onderaan; "Opnieuw bovenaan beginnen" in het menu; vragen en citaten zijn
  een lichte inspringing/tint, geen kaarten. Lettergrootte blijft `text-base` (rem), `leading-7`.
* **Afbeeldingsklassen** (`figureDisplay.ts`, expliciet en overschrijfbaar via `FIGURE_KIND_OVERRIDES`): `NARRATIVE` (schilderingen: max 36 rem en
  60 svh, verhouding behouden, vergrotbaar), `SMALL`, `ICON` (≤ 4,5 rem, nooit vergroot), `POSTER`. Het type volgt uit de plaats in de bron en pas
  daarna uit de afmetingen. Het vak heeft de juiste `aspect-ratio`, dus geen layoutverschuiving; een niet-ladend beeld toont een melding.
* **Viewer:** Versado had geen afbeeldingsviewer; `ImageViewer` is een native modaal `<dialog>` (Escape, focusval, geen scroll- of positieverandering).

## 7. Tests

* `npm run test:cfm-personal` — 52 lessen, determinisme, volledigheid, overrides, vingerafdrukken, afbeeldingsklassen, routes, geen READ/XP-imports.
* `tests/study-steps.integration.test.ts` — migratie, constraints, gelijktijdigheid, monotoon, geen READ/reeks/XP, cascade (eigen
  geïsoleerde database; zelfde guard als de andere integratietests).
* `npx tsx tests/cfm-personal.browser.mjs` — echte browser (mobiel en desktop): tik, vijf kleuren, bladwijzer, notitie, focus, herladen,
  scrollgebaar, toetsenbord, selectie, stappen, wisselen van leeswijze, annotaties buiten de route, afbeeldingen, 320 px, donker, 200% tekst.
  De synthetische fixture `cfm-personal` bestaat alleen in het syntheticprofiel.

## 8. Besluiten die de eigenaar moet bevestigen

Voorlopig gekozen (omkeerbaar):

1. **Kaders ("voor de leraar"/tips) en video's in de persoonlijke regio:** 22 algemene tips blijven zichtbaar, 51 verwijzingen en
   leerkrachttips zijn via een override verborgen; video's blijven zichtbaar. Wijzigen = het overrides-bestand aanpassen.
2. **Staptitels:** de bronkop van het onderwerp, "Vervolg" bij een doorlopend onderwerp.
3. **Stapvoortgang** in een eigen tabel (geen hergebruik van `ReadingPosition`).
4. **Stap afronden telt nooit** voor reeks, XP of leesstatus.
5. **Keuze van leeswijze:** de URL bepaalt de leeswijze; de picker toont beide als kaarten (Vrije studie = actieve les, Stap voor stap = huidige week).
6. **Handmatige correctie:** versioneerd JSON-bestand per programma (`hide`, `cuts`).

## 9. Bekende beperkingen

* Na een Schriftverwijzing keert de lezer terug naar Vrije studie (het retourcontract kent alleen het basispad); de leespositie blijft behouden.
* Het deel van de opdracht na "6.4 … Mogelijke statussen" was bij de laatste oplevering nog niet aangeleverd; alleen wat in de opdracht stond is gebouwd.
* De browsertest draait tegen de eigen wegwerpdatabase; `executeStudyImport` valideert de echte afmetingen van afbeeldingen, daarom genereert de fixture eigen PNG-bestanden.
