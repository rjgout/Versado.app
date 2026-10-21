# CFM Persoonlijke Studie 2.0

Persoonlijke studie van "Kom dan en volg Mij" (CFM) in twee leeswijzen: **Vrije studie** (de persoonlijke studie van de
week als één compacte, doorlopende tekst) en **Stap voor stap** (precies zes stappen per week, "Stap 1" t/m "Stap 6",
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
  `…/stappen` (weekoverzicht met zes kaarten) en `…/stappen/[1-6]`.
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
* **Zes stappen:** atomen (koppen en schriftlabels blijven bij het blok erna, een bijschrift bij zijn afbeelding; een alinea
  wordt nooit gesplitst) worden met dynamisch programmeren in zes aaneengesloten delen verdeeld: kwadratische afwijking
  van de leeslast (tekens, beeld telt als 200), straf voor een grens binnen een onderwerp en voor een stap die met een
  korte alinea of bijna alleen beeld begint. Gelijke uitkomst bij gelijke invoer; vroegste grens wint bij een gelijkspel.
* **Staptitel:** de h3 van het onderwerp dat in de stap begint, anders van het onderwerp waarin de stap doorloopt
  ("Vervolg"), anders het schriftgedeelte uit de lestitel.
* **Overrides** (`data/study-content/cfm-2026-nl/personal-study-overrides.json`, per programma en les): `hide` (met
  `text8`, een hash van de brontekst; bij een gewijzigde tekst vervalt de override vanzelf en wordt dat gemeld) en `cuts`
  (6 blok-id's; ongeldig = terugval op automatisch). De brontekst wordt nooit aangeraakt.
* **Niet verdeelbaar** (geen drie h2-koppen, minder dan zes atomen): `supported: false`; de lezer toont dan de volledige
  les en er wordt niets verzonnen.

### Validatie (alle 52 lessen, offline)

`npx tsx scripts/study-content/cfm-personal-study-report.ts [--steps] [--doubtful]`

* 52/52 lessen ondersteund, **precies 6 niet-lege stappen**, 0 problemen; elk bronblok staat precies één keer en in
  bronvolgorde in het plan; de stappen bevatten exact de persoonlijke blokken; het brondocument blijft byte-identiek.
* 1.714 blokken persoonlijk, 1.316 daarbuiten (allemaal met reden). Stapgrootte per les gemeten in het controleverslag.
* Twijfelgevallen: 73 kaders. **51 verborgen door expliciete override** (42 verwijzingen naar externe tijdschriftactiviteiten en
  9 duidelijke leerkrachttips), **22 blijven zichtbaar** (algemene studietips). Dit is een inhoudelijke keuze van de eigenaar;
  zie §8. **Geschiktheid van de 22 zichtbare tips gecontroleerd** (alle 22 gelezen): het zijn zonder uitzondering
  methoden voor eigen schriftstudie ("Let op symbolen", "Leer actief", "Gebruik muziek", "Wees geduldig", "Concentreer je op
  het belangrijkste", "Vergelijk de Schriften met je leven", "Gebruik Schriftstudiewijzers" enz.). De 9 leerkrachttips
  ("Leer je leerlingen kennen", "Geef leerlingen de kans te getuigen" enz.) en alle 42 verwijzingen naar tijdschriftactiviteiten
  zijn verborgen. Geen wijziging nodig; een latere correctie loopt via het overrides-bestand.
* Alle 52 lessen zijn aangetoond verdeelbaar zonder opvulling of verzonnen inhoud; er zijn geen lessen die als
  contentcontrolepunt gemeld moeten worden.

## 4. Annotaties zoals bij de Schriften (Fase 3)

* Een tik op tekst opent het bestaande paneel met de hele alinea als doel; bladwijzer, vijf kleuren, privénotitie
  (toevoegen/bewerken/verwijderen) en terugvinden zijn ongewijzigd en gebruiken dezelfde API en tabellen.
* **Geen driepuntjes meer** in de compacte weergave. Voor toetsenbord en schermlezer heeft elk tekstblok een echte, onzichtbare
  knop (`data-annotation-for`) die bij focus zichtbaar wordt; na sluiten keert de focus er terug. Geen geneste
  interactieve elementen: een tik op een verwijzing, link, knop of afbeeldingsvergroting houdt zijn eigen actie.
* Een scrollgebaar (verplaatsing > 8 px) opent niets; selecteren door te slepen opent niets. Een tweede tik op geselecteerde
  tekst opent het fragmentdoel. De permanente knop "Geselecteerde tekst annoteren" bestaat in de compacte weergave niet meer (alleen tijdens het kiezen van een nieuwe passage bij herstel).
* Een blok met annotaties krijgt een subtiele balk links plus een bladwijzer- of notitie-icoon; markeringen blijven
  zichtbaar via de CSS Highlight API.
* `block.id`/`section.id` zijn onveranderd; een annotatie hoort bij hetzelfde bronblok in Vrije studie, Stap voor stap en de
  volledige les.

## 5. Voortgang, leespositie en reeks (Fase 5)

* **Tabel `StudyStepProgress`** (migratie `20261121120000_study_step_progress`, additief): sleutel
  `(userId, lessonEditionId, stepFingerprint)`; status `IN_PROGRESS`/`COMPLETED`; `CHECK` dat afgerond ⇔ tijdstip; stapnummer 1–7 in de tabel (oude zevenstappenrijen blijven geldig); nieuwe stappen zijn 1–6.
* **Vingerafdruk per stap** = hash van plan-versie, blok-id's en brontekst van de stap. Bij een nieuwe revisie met andere stapgrenzen
  of tekst is de vingerafdruk anders, dus een oude afronding wordt nooit stil een inhoudelijk andere stap. Onveranderde stappen
  behouden hun afronding. Wijzigt de regelversie (`PERSONAL_STUDY_VERSION`), dan start voortgang bewust opnieuw.
* **Service** `recordStepProgress`: server herberekent het plan uit de gepubliceerde revisie en valideert revisie én vingerafdruk;
  advisory lock per gebruiker+editie; **monotoon** (afgerond blijft afgerond; heropenen werkt alleen "laatst geopend" bij);
  herhaalde of gelijktijdige verzoeken geven één rij en één echte wijziging.
* **Strikt gescheiden van de hele les:** stap openen/afronden roept nooit `markStudyLessonRead`, reeks, XP of celebration aan.
  Na zes afgeronde stappen nodigt de interface uit, de gebruiker markeert de les zelf (bestaande actie, ongewijzigd).
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
* De browsertest draait tegen de eigen wegwerpdatabase; `executeStudyImport` valideert de echte afmetingen van afbeeldingen, daarom genereert de fixture eigen PNG-bestanden.

## 10. Weeknavigatie en de huidige week (Fase 6)

* **Huidige week** komt uit `getStudyCatalogue`: de gepubliceerde les waarvan `startsOn <= vandaag < endsOnExclusive`, met "vandaag" in de tijdzone
  van de gebruiker (`userDayKey`). Server en client rekenen dus op dezelfde kalenderdag; er zijn geen hardgecodeerde weeknummers, jaarovergangen
  volgen vanzelf uit de officiële periodes (bv. les 01: 29 dec – 4 jan) en toekomstige jaren werken zodra hun lessen gepubliceerd zijn.
  Bestaat er geen gepubliceerde les voor vandaag, dan toont de kaart een melding en blijft de weeklijst beschikbaar; er wordt niets verzonnen en niet
  stilzwijgend een andere les gekozen.
* "Stap voor stap" op de Leren-kaart opent het **overzicht van de huidige week** (nooit direct een stap); het overzicht markeert de laatst geopende of
  eerstvolgende onafgeronde stap en biedt "Verder studeren". Een rechtstreekse link naar een week of stap wordt gerespecteerd en verandert de gekozen week niet.
* De weeklijst (Leren → programma) toont per week de periode (`Intl`, UTC-kalenderdagen), de lestitel, "Deze week", gelezen of "n van 6 stappen",
  en een eigen link naar Stap voor stap. Er zijn geen vergrendelingen. Vorige/volgende gepubliceerde week staat onder elke weergave en behoudt de leeswijze
  (Vrije studie of `/stappen`). Een notitie gaat bij wisselen nooit verloren: elke annotatie wordt direct door het bestaande paneel opgeslagen.
* Terugnavigatie: browser-terug en de Versado-terugbalk werken via de bestaande Focusroute; stappen en overzicht zijn gewone links (geen redirects, geen lussen).

## 11. Toegankelijkheid en internationalisatie (Fase 7)

* Alle nieuwe teksten staan in `cfmStudy.*` in nl/en/de/fr/es (`npx tsx scripts/i18n/check.ts`); de officiële tekst blijft in de taal van de gepubliceerde editie.
* Kopstructuur: één `h1` per pagina, het overzicht heeft een verborgen `h2` boven de stappenlijst; de stappen zijn een geordende lijst met `aria-current="step"`
  voor de aanbevolen stap. Stapstatus is altijd tekst plus icoon, nooit alleen kleur; de zes voortgangsblokjes hebben een tekstlabel.
* Toetsenbord: onzichtbare annotatieknop per tekstblok die bij focus zichtbaar wordt, het menu sluit met Escape, de afbeeldingsviewer is een native modaal
  dialoog (Escape, focusherstel). Aanraakdoelen zijn ≥ 44 px (`min-h-11/12`), tekst gebruikt rem-maten en `vs-motion` respecteert verminderde beweging.

## 12. Nieuwe revisies, configuratie en toekomstige jaren (Fase 8)

* **Configuratie is revisiegebonden:** `hide` is gebonden aan een hash van de brontekst (`text8`); een nieuwe revisie met gewijzigde tekst laat de
  override vervallen (gemeld als `OVERRIDE_STALE`, het blok blijft dan zichtbaar). Ongeldige handmatige `cuts` vallen terug op de automatische indeling.
* **Veilige terugval:** voldoet een plan niet aan de onveranderlijke regels (dubbele of ontbrekende blokken, lege stap, tekstverlies) of is de les niet
  verdeelbaar, dan toont Versado de volledige, ongewijzigde les, schrijft een duidelijke fout naar het serverlog (`safePersonalPlan`) en staat stapvoortgang uit.
  Er is nooit een lege of gedeeltelijke studie; annotaties en bronidentiteiten blijven ongemoeid. Een nieuwe import overschrijft geen indeling: er wordt niets
  opgeslagen, de indeling volgt altijd de gepubliceerde revisie.
* **Voortgang bij een nieuwe revisie:** onveranderde stappen houden hun afronding (zelfde vingerafdruk); gewijzigde stappen beginnen opnieuw.
* **Toekomstige jaren:** `isPersonalStudyWork` accepteert elke `cfm-*`-werksleutel en de planner is taal- en jaarloos (posities, geen koppentekst);
  overrides staan per werksleutel in een register. Andere programma's worden nooit vanzelf geactiveerd.
* **Validatierapport:** `npx tsx scripts/study-content/cfm-personal-study-report.ts --write-doc` schrijft `docs/CFM-VALIDATIEVERSLAG.md` met per les
  identiteit, bronvingerafdruk, aantallen, verdeling over de stappen, lege stappen, ontbrekende ankers, dubbele toewijzingen, tekstverlies,
  te controleren beelden (video-posters en extreme verhoudingen) en ambigue kaders. Resultaat: 52/52 zonder lege stappen, ontbrekende ankers, dubbelen of tekstverlies.
  De actuele `revisionId` en media-binding bestaan alleen in de database en zijn dus niet offline te controleren.

## 13. Uitgevoerde controles en wat niet is gedaan

* Uitgevoerd: `tsc`, ESLint op alle gewijzigde bestanden, i18n-controle, `test:cfm-personal` (14), `test:annotations`, `test:focus`, `test:content-picker`,
  `test:live-data`, `test:study-reader`, `test:cfm-2026`, `test:kompas`, `test:study-publication`, `test:study-context`, de stapvoortgang-integratietest
  (eigen lokale PostgreSQL) en de browsertest `tests/cfm-personal.browser.mjs` op een schone productiebuild (Chromium via Playwright).
* **Niet uitgevoerd:** fysieke iPhone Safari of echte Android-toestellen (alleen Chromium met mobiele emulatie: 320, 360, 390, 768 en liggend 844×390, donker, 200% tekst,
  verminderde beweging); productie-uitrol; de Docker-gebonden integratieharnassen (`test-access-isolated.mjs`, geen Docker in deze omgeving);
  `tests/study-reader.browser.mjs` faalt in deze omgeving ook op ongewijzigde `main` ("positie bewaard").
* Handmatige controle voor de eigenaar: inhoudelijke keuze van de 73 kaders (zie §3 en het verslag), echte CFM-afbeeldingen in de browser na het laden van de
  gepubliceerde revisies, en de migratie `20261121120000_study_step_progress` bij de eerstvolgende uitrol.

## 14. Voorkeur, weekleerlijn en retour van schriftverwijzingen (PR #150, ronde 3)

* **Ontwerpbesluiten ongewijzigd**: 22 zichtbare tips/51 verborgen, staptitels inclusief "Vervolg", aparte tabel
  `StudyStepProgress`, ongewijzigde reeks-/XP-regels, versioneerde JSON-configuratie.
* **Leeswijzevoorkeur** (`User.personalStudyMode`, nullable enum FREE/STEPS, migratie `20261122120000_user_personal_study_mode`
  zonder backfill: bestaande gebruikers houden `NULL` en dus de standaard Stap voor stap, zie §16). Volgorde: expliciete deeplink
  (cursus-, week- of staproute) > opgeslagen voorkeur > Stap voor stap (`resolvePersonalStudyMode`). De leeswijze kies je via de cursuskaart in Leren (de ModeSwitch in de les is vervallen); die keuze bewaart
  de voorkeur via `PUT /api/study-preference`. De huidige-weekregel van Stap voor stap blijft ongewijzigd.
* **Weekleerlijn** (`CfmWeekPath`): dezelfde bouwstenen als de leescursussen (`ActiveChapterCard`, `ChapterThumb`, `Connector`,
  `CARD`). Afbeelding = de officiële lesafbeelding (eerste figuur ≥ 300 px breed, READY, via `/api/study-media`); er is voor het
  Oude Testament geen boekafbeelding in het artworkregister, dus zonder lesafbeelding blijft de kaart een neutrale Versado-kaart
  (geen verzonnen beeld). Geen sloten; afgeronde weken zijn in- en uitklapbaar.
* **Retourcontract**: het getekende retourbewijs bevat nu een vaste `originHref`-vorm (Vrije studie, volledige les, stappenoverzicht
  of `/stappen/N`), server-side opgebouwd uit `originViewSchema`; de leespositie (sectie/blok) komt uit het bestaande
  positiesysteem. Oude bewijzen blijven geldig (dezelfde basis-href).
* **Open acceptatiepunt**: browsercontrole met de echte geïmporteerde CFM-afbeeldingen is lokaal niet uitgevoerd (de echte import
  vereist de volledige geïsoleerde Docker-omgeving met goedgekeurde snapshot). Afbeeldingsgedrag is gevalideerd met de
  testfixture en de CI-import (`cfm-2026-import`); een volledige afbeeldingsvalidatie met echte bronbestanden wordt dus **niet** geclaimd.

## 15. Van zeven naar zes stappen (maandag t/m zaterdag, zondag rust)

* **Ritme**: zes studiestappen, Stap 1 t/m Stap 6. De zondag blijft vrij voor rust, bezinning en gesprek; dat is een aanbeveling,
  geen dagschema. Er is geen koppeling tussen stapnummer en weekdag, geen slot, en meerdere stappen op één dag mogen. Afgeronde
  stappen zijn altijd opnieuw te openen. Na de zesde afgeronde stap verschijnt de subtiele interfacetekst
  `cfmStudy.sundayRest` ("Neem zondag de tijd om stil te staan bij wat je hebt geleerd."); geen extra voortgang, beloning of activiteit.
* **Indeling**: dezelfde deterministische, revisiegebonden planner met `PERSONAL_STUDY_STEPS = 6` en `PERSONAL_STUDY_VERSION = 2`.
  Bronvolgorde, alinea's (nooit gesplitst), officiële tekst en persoonlijke inhoud blijven ongewijzigd; alleen de stapgrenzen
  verschuiven. Validatie over alle 52 lessen: precies zes niet-lege stappen, elk bronblok precies één keer, geen tekstverlies,
  stabiele bronankers, juiste volgorde (`docs/CFM-VALIDATIEVERSLAG.md`). Handmatige `cuts` zijn nu 5 stuks (stap 2 t/m 6).
* **Bestaande voortgang** (`StudyStepProgress`): de vingerafdruk van een stap bevat de planversie en de brontekst van zijn blokken,
  dus een zevenstappenvingerafdruk (versie 1) kan nooit samenvallen met een stap van de zesstappenindeling. De tabel kreeg
  `planVersion` (migratie `20261123120000_study_step_plan_version`; bestaande rijen = versie 1, onveranderd bewaard).
  * Omzetting: bij het openen van de les/het overzicht wordt een nieuwe stap alleen als afgerond gezet als **elke** oude stap die
    een van zijn blokken bevat afgerond is met een identieke inhoudsvingerafdruk (`coverLegacyProgress`, idempotent, schrijft een
    nieuwe rij met `planVersion = 2`, nooit een bestaande rij overschrijven of verlagen). De afrondingstijd is de laatste van die
    oude stappen.
  * **Wordt niet omgezet**: een nieuwe stap waarvan niet álle onderliggende oude stappen afgerond waren, een "bezig"-status (geen
    betrouwbare dekking), en voortgang bij een gewijzigde brontekst of andere revisie. Die stappen beginnen opnieuw; de oude rijen
    blijven staan. Weekkaarten tellen alleen rijen van de huidige planversie.
  * Annotaties, leesposities (`ReadingPosition`) en "gelezen"-markeringen van de hele les (`READ`) hangen aan het brondocument en
    blijven volledig ongemoeid. Omdat de zevenstappenvoortgang pas met deze pull request is ingevoerd, bestaat er in productie
    nog geen oudere voortgang; de omzetting beschermt testomgevingen en eventuele eerdere previews.
* **Afronding en reeks**: een stap afronden blijft uitsluitend stapvoortgang; alleen de bestaande actie "Markeren als gelezen"
  rondt de les af volgens de bestaande regels. Geen nieuwe reeks- of XP-logica.

## 16. CFM als gewone cursus in Leren (uniform cursussysteem)

* **Geen tweede systeem**: "Kom dan en volg Mij" gebruikt dezelfde cursusarchitectuur als de leescursussen van het Boek van Mormon
  (`Course`, `UserCourseProgress.subscribed`, `UserListOrder`, `ContentCard`, `CardPicker`, `CoursePathHeader`, `MyStepNav`,
  `pathParts`). De leeswijze is een cursus, zoals "Stap voor stap" en "Vrije keuze" bij de leescursussen:
  * `CourseType.STUDY_STEPS` ("Stap voor stap", standaard, eerst in de lijst) en `STUDY_FREE` ("Vrije studie"), één rij per
    cursus in de CFM-collectie (`src/lib/studyContent/cfmCourses.ts`). Migraties `20261124120000_study_course_types` (enumwaarden)
    en `20261124130000_study_courses_backfill` (cursussen voor een reeds geïmporteerde collectie, niemand ingeschreven, niets
    zichtbaar). Een verse import maakt ze via `ensureCfmDraftCollection`; bestaande rijen (ook door de beheerder uitgezet) blijven
    ongemoeid. Zichtbaarheid blijft bij de collectie (beheer → Content); de cursussen publiceren niets.
  * **Cursus toevoegen / verbergen / volgorde**: onveranderd (`/api/courses/*`, `subscribeUserToCourse`). Een toegevoegde cursus staat
    niet meer onder toevoegen. Verbergen zet alleen `subscribed` uit: annotaties, leesposities, stapvoortgang en READ blijven.
  * **Kaart**: (vanaf §18 zonder voortgang in weken) "Ga verder" naar de huidige week (Stap voor
    stap: het stappenoverzicht) en het officiële lesbeeld van die week (`getStudyCourseSummary`, zelfde bron als het weekpad).
  * **Openen**: `/courses/<id>` → `/courses/<id>/pad` (Focusroute) met `CfmCourseView`: dezelfde kop, leerlijn (`CfmWeekPath`) en
    "Naar mijn week"-knop (`MyStepNav kind="week"`); bij een nieuwe binnenkomst scrollt de leerlijn naar de huidige week
    (scrollcoördinatie `NavigationScroll`: terug/vooruit herstelt de oude positie en wie al scrolde wordt nooit overschreven).
    Zes vrij toegankelijke stappen onder de huidige week; geen sloten.
* **Leeswijze en voorkeur**: de cursus bepaalt de leeswijze. Een week of stap openen bewaart die keuze server-side
  (`User.personalStudyMode`, bestaande instelling, geen extra scherm) en maakt de bijbehorende ingeschreven cursus de huidige leerreis
  (`markCfmCourseStarted` → `markCourseStarted`). De standaard is Stap voor stap. De bestaande routes (`/study-lesson/...`, `/stappen`,
  `/stappen/n`, `?weergave=volledig`) en deeplinks blijven werken en gaan altijd voor.
* **Wat CFM-specifiek bleef**: de weekkaarten met lesbeeld en zes stappen (`CfmWeekPath`, gebouwd uit de gedeelde `pathParts`), de
  de cursuskaart naar de hervatweek (`courseSummary.ts`), de enumwaarden en de cursusdefinities (`cfmCourses.ts`). Overige studieprogramma's
  (FSY) behouden hun eigen lijst op Leren; `ProgramLessonPicker` bevat daarom geen CFM-weekpad meer.

## Leestypografie (compacte weergave)

* Eén regelafstand van 1,6 voor alle lopende tekst, ingesteld op de container van `RichContentBlocks` (geen `leading-7` per blok).
* Oorzaak van de ongelijke regelafstand: `ReferenceLink` was een `<button>` met `min-h-12`. Een knop is altijd inline-block, dus de
  minimale hoogte van 48 px rekte elke regel met een schriftverwijzing op. Bij `min-h-0` blijft de regel gelijk; de brontekst zelf
  (witruimte wordt bij de import genormaliseerd) was niet de oorzaak.

## 17. Cursusidentiteit, weekselectie en collectie-isolatie (technische afronding)

Zie `docs/CFM-TECHNICAL-FINALIZATION.md` voor oorzaken, keuzes en de handleiding voor een volgend jaar. Kort:

* **Cursusidentiteit** is (collectie, leeswijze) (`ensureCfmCourses` zoekt op `contentCollectionId` + `type`). De slug is een afgeleid,
  stabiel label (`cfmCourseSlug`): de oorspronkelijke slugs voor CFM 2026, anders `kom-dan-en-volg-mij-<collectieslug>-<soort>`.
* **Eén weekregel** (`weekSelection.ts`, bijgewerkt in §18): kalenderweek → laatst geopende week → laatst bestudeerde week → geen. Vandaag, kaart, API en
  weekleerlijn gebruiken dezelfde resolver; alleen een echte kalenderweek heet "Deze week" / "Naar mijn week".
* **Collectie-isolatie**: `getStudyCatalogue(actor, now, { collectionId })` leest uit de collectie van de cursus (met de bestaande
  `canAccessCollection`/`readingAccessWhere`), nooit stilzwijgend uit de actieve collectie, en wijzigt die niet.

## 18. Deelname in plaats van voltooiing; navigatiecontract; Vandaag-kaart

**Principe.** Kom dan en volg Mij is een doorlopend studieprogramma waaraan je elke week meedoet, geen cursus die je moet afronden.
De interface draait om de studie van deze week, zelf kiezen hoe en wanneer, eenvoudig verdergaan waar je bleef en de zes stappen als
hulpmiddel. Geen druk om weken in te halen en geen jaarlange voltooiingspercentages. Dit geldt alleen voor CFM; de voortgang van
gewone leescursussen (`CoursePathHeader`, `CardProgress`) is ongewijzigd.

**Verwijderd uit de interface** (de gegevens blijven in de database): het totaalpercentage en de voortgangsbalk over alle weken, "x van 52
weken", de voltooiingschip op de cursuskaart, de "alles voltooid"-melding en de voortgangsbalk op de actieve weekkaart. De CFM-kop
(`CfmCourseView`) is nu een lichte titel met Samen studeren. `getStudyCourseSummary` levert geen week-totalen meer; de API geeft voor
CFM `totalChapters: 0`, waardoor de bestaande kaart geen balk of chip toont. Behouden: per week de zes stappen met status (niet begonnen,
bezig, afgerond; `data-step-status` en tekst voor schermlezers), de laatst geopende of eerstvolgende stap gemarkeerd, zes subtiele stippen
in plaats van "x van 6" op een ingeklapte week, een vinkje bij een week die bewust is afgerond of waarvan alle stappen klaar zijn, en
hervatten bij de juiste stap (`/stappen` → `activeStepIndex`). Een week hoeft niet af te zijn om mee te doen.

**Hervatlogica** (`weekSelection.ts`, één bron voor Vandaag, de cursuskaart in Leren, de API, het weekpad en de studieles):
1. de echte kalenderweek (tijdzone van de gebruiker), 2. de week die de gebruiker het laatst bewust opende, 3. de laatste week waarin
daadwerkelijk is gestudeerd (een stap afgerond of de les als gelezen gemarkeerd), 4. anders geen hervatweek: een neutraal overzicht van de
beschikbare weken. Nooit de oudste onafgeronde week. Een hervatweek heet alleen "Deze week" als hij de kalenderweek is.

**Navigatiecontract** (hergebruikt `SubpageBackBar`, `useSetBackTarget` en `useBackNavigation`; geen tweede laag, geen `returnUrl`):

| Ingang | Terugknop van de studieles | Terugknop van het weekpad |
|---|---|---|
| Leren → weekpad → studieles | weekpad | Leren |
| Vandaag → studieles | Vandaag | n.v.t. |
| andere geldige ingang (Mijn studiemap, ...) | die pagina | n.v.t. |
| directe link, nieuwe tab, ontbrekende herkomst | het leerpad van de cursus (`cfmCoursePathTarget`, anders Leren) | Leren |
| Vorige/Volgende stap | blijft de oorspronkelijke ingang | n.v.t. |

Werking: de terugbalk van de studieles is *zacht* (`ReaderBackTarget soft`): browser-terug naar de werkelijke vorige pagina; `href` geldt
alleen als `canGoBackInApp()` onwaar is (Navigation API, met de interne teller als terugval voor Safari-versies zonder die API). Stap-naar-stap
gebruikt `replace`, dus de herkomst is altijd één item terug en er ontstaan geen lussen of dubbele items. Scrollherstel blijft van
`NavigationScroll`. De knop "Terug naar het leerpad" bij stap 6 is een eigen actie (`replace`) en verandert de hoofdterugknop niet.
**Voer nooit opnieuw een vaste (niet-zachte) terugbestemming in voor CFM**: dat dwingt gebruikers die via Vandaag kwamen naar het weekpad.
Beperking: komt de gebruiker vanaf het weekpad en kiest hij bij stap 6 "Terug naar het leerpad", dan staat het weekpad twee keer in de
geschiedenis (geen lus).

**Vandaag-kaart** (`ProgramContextPanel` → `CfmTodayCard`): officiële lesafbeelding (anders de neutrale Versado-kop), "Kom dan en volg
Mij" met de collectienaam, "Deze week" met de officiële periode, de echte lestitel en één uitnodigende zin. Primaire actie "Begin met
studeren" of "Verder met studeren" naar de studieles volgens de gekozen leeswijze (Stap voor stap hervat zelf bij de juiste stap); secundair
"Bekijk de zes stappen" naar het weekpad. Zonder kalenderweek heet de hervatweek "Laatst bestudeerd"; zonder hervatweek is er één neutrale
ingang "Bekijk de studieweken". Geen percentage, geen aantal afgeronde weken, niets hardcoded.
