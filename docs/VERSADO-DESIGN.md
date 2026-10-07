# Versado: ontwerp- en architectuurrichting

Dit document legt vast waar de app naartoe gaat. Het is bedoeld voor iedereen
die aan de code werkt, mensen en AI-agents. **Lees het vóór je iets aan
navigatie, dashboard, lay-out, beeld of onboarding verandert.**

De app (repository `Jehova.app`, technische namen nog vaak `jehova`/`bom`)
heet voortaan **Versado**. Er komt een omvangrijk visueel redesign op basis
van Figma-ontwerpen en nieuwe beeldassets. Dat redesign gaat in fasen; zie
"Stand van de uitvoering" hieronder voor wat al gebouwd is. Dit document
beschrijft de richting, de huidige stand en de aandachtspunten; het is geen
ontwerp.

Voor alles wat nog niet in een fase is opgepakt, geldt:

- Geen visueel redesign en geen vervanging van bestaande schermen.
- Geen nieuw dashboard, geen nieuwe navigatie en geen tijdelijke visuele stijl
  op eigen initiatief.
- Geen tijdelijke mascottes, AI-afbeeldingen, stockfoto's of emoji-mascottes
  om ontbrekende assets op te vullen. Waar een plek technisch nodig is: een
  neutrale placeholder die later eenvoudig te vervangen is.
- Bestaande werkende functionaliteit gaat altijd voor op cosmetische
  wijzigingen. Niets verwijderen omdat het niet in de nieuwe hoofdnavigatie
  genoemd wordt.

## Stand van de uitvoering

**Fase 1 (app-shell en Vandaag) is gebouwd.** Leren, Spelen, Vrienden,
Competitie, Activiteit en Profiel zijn nog niet herontworpen; daar geldt de
lijst hierboven nog volledig.

- **Semantische tokens**: CSS-variabelen `--vs-*` in `src/app/globals.css`
  (licht op `:root`, donker op `.dark`, gelaagd en niet puur zwart), in
  Tailwind beschikbaar als kleurgroep `vs` (`bg-vs-surface`, `text-vs-fg-3`,
  `border-vs-line`, `text-vs-xp`, ...). Tekstcontrast is gecontroleerd op
  minimaal 4,5:1. Nieuwe schermen gebruiken deze tokens, geen losse
  `slate`/`brand`-kleuren.
- **Beweging**: zet `vs-motion` op een container; onder
  `prefers-reduced-motion` staan transities en animaties daarbinnen dan stil.
  `vs-rise` is een rustige binnenkomst, `vs-scroller` verbergt de scrollbalk
  van een veegrij.
- **Iconen**: `lucide-react`. Geen emoji als structureel icoon. Uitzondering:
  reeks, XP en reeksbevriezing zijn eigen illustraties in `public/icons/`
  (`streak-flame.webp` met `streak-flame-empty.webp` voor "vandaag nog niet
  gestudeerd", `xp.webp`, `freeze.webp`), altijd via `SystemIcon kind="streak"
  | "xp" | "freeze"` (`fill="none"` = de lege vlam), nooit los. Ze nemen geen
  tekstkleur over. In pushmeldingen, e-mails en toasts kan geen afbeelding:
  daar blijft het emoji in de tekst staan.
- **Shell**: vier hoofdbestemmingen in `src/lib/navigation.ts`
  (`PRIMARY_NAV`, met per bestemming de routes die erbij horen);
  `BottomNav.tsx` op telefoon en tablet, `shell/PrimaryNav.tsx` op desktop,
  `shell/SocialTabs.tsx` als tabs tussen `/friends`, `/competition` en
  `/activity`, en `shell/HeaderAvatar.tsx` als ingang naar het profiel. Reeks,
  XP en divisie staan in `NavUserBadges.tsx`. Alle bestaande routes werken
  ongewijzigd.
- **Terug en scrollen**: één centrale laag, geen code per pagina.
  Detailpagina's krijgen hun kop ("← Titel", optioneel een ondertitel) uit
  `SubpageBackBar.tsx` (lijst van pagina's met titel en terugval). De pijl
  werkt als de terugknop van de browser (`useBackNavigation` in
  `src/lib/navigationHistory.ts`); alleen zonder vorige pagina in de app
  (deeplink) gaat hij met replace naar de terugval. `shell/NavigationScroll.tsx`
  zet een nieuwe pagina bovenaan en herstelt bij terug/vooruit de oude
  positie (ook als de pagina zijn inhoud pas na het tonen ophaalt). Het
  venster is de scrollcontainer: zet `overflow` dus niet op `html` (zie
  `globals.css`). Onderdelen van het profiel hebben een eigen adres
  (`/profile?view=...`, `src/lib/profileViews.ts`).
- **Activiteitscontexten**: iedere nieuwe interactieve ervaring kiest bewust één van vier shellvarianten. **Normal** is voor ontdekken, navigeren en kiezen: globale header en bottomnav blijven zichtbaar en kaarten mogen groeperen. **Focus** is voor lezen, leren, oefenen en normale interactieve activiteiten: de globale statusheader en bottomnav verdwijnen, terwijl `SubpageBackBar` als oriëntatiepunt blijft staan; `src/components/versado/FocusLayout.tsx` is het inhoudelijke canvas. **Immersive** is uitsluitend voor ervaringen zoals actieve arcadegameplay waarbij de viewport zelf het speelveld is: ook `SubpageBackBar` verdwijnt, de feature toont geen dubbele titel en beheert binnen de ervaring een duidelijk, veilig exitmoment. `src/components/versado/ImmersiveLayout.tsx` is daarvoor het canvas. **Celebration** is voor tijdelijke betekenisvolle fullscreen prestaties bovenop een flow, zoals `StreakCelebrationFlow`, en is geen navigatiemodus. `src/lib/focusMode.ts` bepaalt centraal per route de shellmodus; gebruik geen losse `hideHeader`/`hideBottomNav`-props per pagina. **Voorrangsregel voor vieringen**: een celebration die het gevolg is van het afronden van een activiteit mag nooit de primaire completion-/resultaatervaring van die activiteit verdringen. De primaire completion-flow heeft voorrang; secundaire celebrations worden pas daarna getoond, zodra de gebruiker de activiteit verlaat (`isActivityRoute` in `src/lib/focusMode.ts`, besluit in `src/lib/celebrationGate.ts`). "Behaald" en "getoond" zijn gescheiden: de beloning wordt direct opgeslagen, alleen de presentatie wacht. Een nieuwe milestone of beloning haakt aan op dezelfde gate in plaats van een eigen timing te bedenken (geen `setTimeout`, geen z-index-wedstrijd).
- **Focus Mode · cursusvragen**: elke cursusvraag gebruikt één gedeelde exercise-ervaring. Boven staat de bestaande context-/terugbalk met daaronder een compacte voortgangsbalk binnen de huidige oefenset of stap (`answered/total`). In het midden staan vraag, denkhint, eventuele persoonlijke mascotte en antwoorden. Onderaan staat de vaste primaire action area: vóór beantwoording `Controleren`, daarna resultaatfeedback met report-vlag en `Doorgaan`. De action area respecteert de veilige onderruimte en blijft bruikbaar bij lange inhoud; reduced motion geldt voor de progressie-animatie. De zes vraagfeedbackcategorieën staan in vaste volgorde en worden als stabiele codes opgeslagen in het bestaande `Feedback`-model. Profiel → Feedback blijft de enige gebruikerslijst voor zowel algemene als vraagfeedback. Deze structuur geldt voor toekomstige cursusvraagtypen; losse spellen nemen haar niet automatisch over.
- **Vandaag**: `src/app/dashboard/page.tsx` met de data uit
  `src/lib/today.ts` (`getTodayData`) en de blokken in
  `src/components/today/`. Gedeelde serverlogica staat in
  `activeGames.ts`, `courseSummaries.ts` en `gameCatalog.ts`, zodat de
  bestaande API-routes en Vandaag dezelfde bron gebruiken.
- **Beeld bij content**: `src/lib/artwork.ts` is de enige plek die weet
  welke afbeelding bij welke content hoort (register plus helpers die per
  cursus, boek, podcast of spel sleutels geven, van specifiek naar
  algemeen). Bestanden staan in `public/images/`, zonder tekst erin;
  `versado/MediaArtwork.tsx` toont ze via `next/image` (WebP per
  schermbreedte, vaste verhouding, gemiddelde kleur tijdens laden, neutrale
  placeholder met icoon als er geen beeld is of het niet laadt). Beeld
  hoort inhoudelijk bij de content: een cursus toont het boek waar je bent
  (of het beginboek als die cursus het boek van voor naar achter volgt:
  1 Nephi, Leer en Verbonden of Mozes), dan beeld voor dat soort cursus
  in dat werk (`course-work:<werk>:<CourseType>`, op werk en niet op slug,
  nu alleen Vrije keuze), en anders de placeholder; er is geen algemeen
  beeld per werk dat elke cursus krijgt. Elk boek van de drie Schriften
  heeft een eigen beeld, net als Ontdek het Boek van Mormon, de
  kindercursus, Voor de kracht van de jeugd, Vrije keuze per werk, Het
  leven van Christus (voor een cursus met slug `life-of-christ`, die er
  nog niet is), podcast (algemeen) en de tekst van de dag;
  `tests/artwork.test.ts` (`npm run test:artwork`) bewaakt dat elk boek
  een bestaand beeld heeft. De cursuspagina (`CoursesClient`) krijgt de
  sleutels van `/api/courses` en toont ze met `MediaArtwork`, net als
  Vandaag. Spelcovers staan per spel-id in
  `GAME_COVERS` en worden overal gebruikt waar een spel als kaart staat
  (Vandaag, Voor jou en de spelkaarten op Spelen in `LiveLobbyForm`).
  `versado/Carousel.tsx` is de veegrij met puntjes en pijlen.
- **Samen** (vriendenreeksen, groepen, seintjes; zie `docs/SAMEN.md`):
  gebouwd met de `vs`-tokens en `lucide-react`. Ingangen: het blok
  Vriendenreeksen en de kaart Groepen op `/friends`, de groepspagina's onder
  `/groups` (bij Vrienden in de navigatie), en een compact "Samen"-blok
  bovenin de sociale kolom op Vandaag (`today/TogetherBlock.tsx`). Gedeelde
  onderdelen staan in `src/components/social/`.
- **Mascottes**: Novi, Varo en Vera hebben elk alle tien states. Elke
  gebruiker kiest één van hen als persoonlijke gids (`User.companion`,
  standaard Novi): bij de onboarding en op het profiel. Persoonlijke momenten
  tonen de gekozen gids via `versado/PersonalMascot.tsx`;
  `family`/`welcome` blijft de introductie op de publieke homepage.
  `versado/MascotSlot.tsx` is de enige renderer; het register in
  `src/lib/mascots.ts` kent de bestanden in `public/mascots/static/`. Zolang
  een asset ontbreekt, rendert een slot niets. Zie "Mascottes" hieronder.

## Wat Versado is

Een leer-, lees- en spelapp rond het Boek van Mormon en aanverwante content
binnen De Kerk van Jezus Christus van de Heiligen der Laatste Dagen: lessen en
cursussen, lezen en voorlezen, XP, reeksen, prestaties, divisies, vrienden,
uitdagingen, multiplayer- en gezinsspellen, podcasts. Self-hosted, in vijf
talen, met afzonderlijke app-taal en contenttaal (zie CLAUDE.md).

## Versado Design Constitution

Uitgangspunt voor alle toekomstige ontwikkeling:

1. Mobile first, maar niet mobile only.
2. Tablet en desktop krijgen een volwaardige interface.
3. Vandaag/dashboard is actiegericht.
4. Openstaande sociale acties krijgen hoge prioriteit.
5. Rust bij lezen/studeren, meer energie bij spellen.
6. De belangrijkste functies liggen maximaal één logisch navigatieniveau diep.
7. Primaire mobiele navigatie wordt voorbereid op Vandaag, Leren, Spelen en Vrienden.
8. Profiel is persoonlijke configuratie en hoeft geen primaire navigatiebestemming te zijn.
9. Vrienden en sociale interactie zijn kernfunctionaliteit.
10. Doorgaan waar je gebleven bent moet zeer eenvoudig zijn.
11. De drie mascottes hebben verschillende rollen maar één gezamenlijke visuele identiteit.
12. De hele familie verschijnt alleen bij betekenisvolle momenten.
13. Mascottes communiceren voornamelijk visueel.
14. Tekst van mascottes moet lokaliseerbaar zijn.
15. Geen emoji als structurele vervanging voor toekomstige Versado-iconografie of mascotte-assets.
16. Light mode en dark mode zijn beide first-class designs.
17. Kindergebruik gebruikt dezelfde interface met een andere standaardvolgorde van content.
18. Gebruikers kunnen hun aanbod/volgorde waar van toepassing zelf aanpassen.
19. UI-taal en contenttaal blijven afzonderlijk.
20. De PWA moet zoveel mogelijk aanvoelen als een native app.
21. Het ontwerp moet professioneel genoeg zijn om niet als hobbyproject over te komen.
22. Toekomstige afbeeldingen, illustraties en animaties moeten eenvoudig toegevoegd/vervangen kunnen worden zonder pagina-architectuur opnieuw te bouwen.
23. Bestaande werkende functionaliteit heeft altijd voorrang boven cosmetische wijzigingen.

Principe 15 betekent voor nieuwe code: geen nieuwe emoji als vast icoon of
illustratie in structurele plekken (navigatie, spel- en cursuskaarten,
lege staten). Bestaande emoji blijven staan tot het redesign ze vervangt; ze
worden niet vooraf omgebouwd. Emoji die inhoud zijn (reacties in de feed,
een door de gebruiker gekozen avatar-emoji, tekst in content) vallen hier
niet onder.

## Informatiearchitectuur (richting)

Menu's mogen niet diep worden. Op mobiel vier primaire bestemmingen:

| Bestemming | Wat erin hoort |
|---|---|
| **Vandaag** | Het centrale, actiegerichte dashboard: jouw beurt in een spel, uitdaging van een vriend, nieuw vriendschapsverzoek, verdergaan waar je was, dagelijkse content, reeks, relevante voortgang. Openstaande acties met vrienden prominent. |
| **Leren** | Cursussen, lessen, lezen, studiecontent, eventueel podcasts en andere educatieve content. |
| **Spelen** | Individuele spellen, multiplayer, actieve en live spellen, spellen op één of meerdere apparaten, gezins- en groepsactiviteiten. |
| **Vrienden** | Vriendenlijst, online vrienden, gedeelde live activiteit, competitie/divisies, sociale activiteit/feed, uitdagingen. Bijvoorbeeld één pagina met tabs Vrienden, Competitie en Activiteit; het principe is maximaal één logisch niveau diep, de vorm volgt uit Figma. |

**Profiel** gaat waarschijnlijk uit de primaire navigatie en wordt bereikbaar
via de gebruikersavatar rechtsboven.

### Huidige routes per toekomstige bestemming

Een indeling om bij het redesign op terug te vallen, geen opdracht om nu te
verplaatsen. Routes blijven bestaan (zie "Deep links").

| Bestemming | Bestaande routes |
|---|---|
| Vandaag | `/dashboard`; delen van `/streak`, tekst van de dag, open acties |
| Leren | `/courses`, `/courses/[courseId]` (+ `/chapter/[chapterId]`), `/lesson/[chapterId]`, `/reading-lesson/[lessonId]`, `/intro/[lessonId]`, `/kids/[storyId]`, `/fsy/[lessonId]`, `/podcast/[episodeId]/[mode]`, `/bookmarks`, `/tools` (`/dictionary`, `/persons`), `/practice` |
| Spelen | `/live` (spellenoverzicht + live duel), `/live/[code]`, `/challenges`, `/scrabble` (+ `[gameId]`), `/word-game`, `/word-search` (+ `[gameId]`), `/jigsaw`, `/alleskenner` (+ `alleen`, `seizoen`), `/chapter-guess` (+ `solo/[gameId]`), `/gezinsavond` |
| Vrienden | `/friends`, `/groups` (+ `new`, `leaderboard`, `[groupId]`, `[groupId]/settings`), `/competition`, `/activity`, `/challenges` (ook sociaal) |
| Profiel (via avatar) | `/profile`, `/xp`, `/streak`, `/shop`, `/feedback`, `/change-password`, `/onboarding` (rondleiding), `/adminbackend` |
| Publiek | `/`, `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/uitnodiging/[code]`, `/privacy`, `/cookies`, `/feedback/respond/[token]` |

`/practice` en `/challenges` passen bij twee bestemmingen; kies dat bij het
ontwerp, niet vooraf.

### Deep links

Routes zijn ook opgeslagen buiten de code: `Notification.url` in de database,
push-payloads (`public/sw.js`), links in e-mails, uitnodigingslinks en
geïnstalleerde PWA's. Een route hernoemen of weghalen breekt die links. Bij
het redesign: bestaande routes laten werken (desnoods als doorverwijzing),
ook als een pagina onder een nieuwe bestemming valt.

## Mascottes

Versado heeft drie mascottes: **VARO**, **VERA** en **NOVI**, elk met
dezelfde tien states als statische afbeelding. Een gebruiker kiest er één
als **persoonlijke gids**; daarnaast is er de familie (`family`) voor
gedeelde momenten.

### Character canon

Gezamenlijk uitgangspunt: **"Ik ontdek dit samen met jou."** De mascottes
zijn geen leraren die boven de gebruiker staan. Ze reageren op wat de
gebruiker doet en ontdekken samen met de gebruiker.

Visuele familie:
- fantasie-vos/lynxachtige Versado-wezens: geen gewone vossen, geen mensen;
- donkere, navyblauwe vacht overheerst, met een crème snuit, borst en buik
  en herkenbare oranje accenten;
- grote puntige oren, expressieve ogen en een pluimstaart;
- dezelfde soort en familie, maar elk personage met een duidelijk eigen
  silhouet.

Rollen:
- **VARO**: nieuwsgierig · energiek · speels.
  - Hoort bij ontdekken, voortgang, competitie en grotere doelen.
- **VERA**: warm · slim · rustig.
  - Hoort bij begrijpen, lezen, verdieping en reflectie.
- **NOVI**: vrolijk · ontdekkend · ondeugend; de kleine avonturier.
  - Karakter: impulsief, enthousiast en wil overal bij zijn.
  - Hoort bij spelen, experimenteren, korte oefeningen, dagelijkse
    motivatie en verrassingen.
  - Bij een fout antwoord nooit boos, verdrietig of teleurgesteld, maar
    nieuwsgierig, positief of aanmoedigend (state `encourage`).

Accessoires zijn niet permanent, maar optioneel en contextueel. Ze komen alleen in beeld als ze
iets toevoegen aan de activiteit of het verhaal van de pose; NOVI kan bv. een
kleine rugzak of speelse ontdekvoorwerpen hebben. Elk personage moet zonder
accessoires direct herkenbaar zijn.

### Consistentie

Ook het zelfstandige onderhoudsscherm van de deployment volgt deze identiteit:
het gebruikt de actuele headerbranding en favicon uit Huisstijl via lokale
laatst bekende proxy-kopieën, de familie-asset `family-support` en dezelfde rustige
licht/donker-richting als de app. De status is indeterminate en geen nep-
percentage; beweging stopt bij `prefers-reduced-motion`. Het scherm mag voor
zijn werking niet afhankelijk zijn van Next.js, externe fonts of een CDN.

De definitieve tekstuele bron staat in
`docs/VERSADO-CHARACTER-CANON.md`. Goedgekeurde sheets in
`public/mascots/references/` vormen de visuele samenvatting; de goedgekeurde
sets in `public/mascots/static/novi/`, `varo/` en `vera/` zijn de concrete
pose-referentie. Een
nieuwe asset mag een personage niet opnieuw interpreteren. Tussen alle
afbeeldingen blijven gelijk:
- lichaamsverhoudingen, grootte en leeftijdsindruk;
- hoofdvorm, snuit, ogen en oren;
- vachtpatroon en de navy/crème/oranje kleurverdeling;
- staart, handen en poten;
- de illustratie- en renderingstijl.

Een state is een functionele toestand in Versado, niet zomaar een emotie.

### Techniek

- **Eén renderer.** `MascotSlot` (`src/components/versado/MascotSlot.tsx`)
  is de enige manier om een mascotte te tonen. Pagina's vragen om een
  personage en een state:
  `<MascotSlot character="family" state="welcome" />`.
- **Persoonlijke gids.** Een persoonlijk moment kiest alleen de state:
  `<PersonalMascot state="success" />` (`versado/PersonalMascot.tsx`). De
  `CompanionProvider` in de layout weet welke gids de gebruiker koos
  (`User.companion`, vertaald door `src/lib/companion.ts`) en geeft die aan
  `MascotSlot`. Geen feature implementeert zelf `user.companion ?? "novi"`.
  Kiezen: onboardingstap "Kies je gids" (overslaan kan pas na een opgeslagen
  keuze) en de sectie "Jouw gids" op het profiel, beide met
  `versado/CompanionPicker.tsx` en `PATCH /api/account { companion }`. Na
  een wijziging wisselt de gids meteen overal (`useCompanion`). Bestaande
  accounts hebben Novi en worden niet opnieuw door de onboarding gestuurd.
- **Geen paden in pagina's.** Directe assetpaden (`/mascots/static/...`)
  vanuit pagina's of andere componenten zijn verboden. Alleen het register
  `src/lib/mascots.ts` kent paden.
- **States.** `idle`, `greeting`, `thinking`, `discovery`, `reading`,
  `playing`, `success`, `encourage`, `celebrate`, `sleep`. Geen synoniemen;
  een nieuwe state is een bewuste ontwerpkeuze.
- **Bestanden.** `public/mascots/static/<personage>/<personage>-<state>.webp`:
  transparante WebP, kleine letters, zonder tekst, tekstballon of
  achtergrond in de afbeelding. Zie `public/mascots/README.md`. Ruwe
  generatie- en werkbestanden horen niet in `public/`; alleen goedgekeurde
  referenties, productie-assets, Figma-kopieën en toekomstige beheerde
  Rive-bronnen volgen daar de vastgelegde hiërarchie.
- **Registreren.** Een asset staat pas in het register als het bestand
  bestaat. Ontbreekt een asset, dan rendert het slot niets: geen emoji, geen
  ander personage, geen placeholder. `npm run test:mascots` bewaakt dat
  register en bestanden overeenkomen.
- **Rive-klaar, nog geen Rive.**
  - De keten is feature → (persoonlijke gids) → `MascotSlot(character,
    state)` → renderer. Nu is de renderer een statische WebP; later kan er
    achter `MascotSlot` een Rive-state machine komen, zonder dat pagina's of
    `<PersonalMascot state />` veranderen.
  - De statische WebP-assets blijven dan in gebruik: als terugval bij
    `prefers-reduced-motion`, tijdens het laden en bij een fout, en op
    plekken waar beweging niets toevoegt.
  - Rive is nu bewust nog geen dependency, en er staan geen
    `.riv`-bestanden in de repository.
- **Beweging.** Mascottes vallen onder `vs-motion`, dus onder
  `prefers-reduced-motion` staat beweging stil. Een toekomstige renderer
  toont dan de statische afbeelding.
- **Bestaande plekken.**
  - Persoonlijke gids (`PersonalMascot`): begroeting, ontdekken en rust op
    Vandaag (`greeting`, `discovery`, `sleep`), oefening (`thinking` →
    `success`/`encourage`) en lesuitslag (`success`/`encourage`/`celebrate`),
    Spelen (`playing`), uitslag van het woord van de dag en van een live
    spel, Stap voor stap lezen (`reading`) en de lege activiteitspagina
    (`idle`). Kaders zijn vierkant (het canvas is 512x512), zodat wisselen
    van state of gids niet verspringt.
  - Publieke homepage, als kennismaking direct ná de kernbelofte en de
    aanmeldknoppen: `family`/`welcome`, met de namen en eigenschappen als gewone tekst
    eronder (het beeld zelf is decoratief, `alt=""`). Heeft `welcome` ooit
    meerdere varianten, dan toont elke lading de volgende (`variant` op
    `MascotSlot`, teller in `src/lib/mascotRotation.ts`, zonder cookie of
    browseropslag); nu is er één.
  - Onboarding, eerste stap ("Welkom!"): `family`/`huddle`, vóór de keuze
    van de eigen gids.
- **Personage-specifieke states.** `family` heeft een eigen lijst
  (`welcome`, `hero`, `huddle`, `celebrate`, `discovery`, `learning`,
  `playing`, `progress`, `support`, `rest`; betekenis en gebruik in
  `public/mascots/README.md`); de persoonlijke states van NOVI, VARO en VERA
  gelden daar niet. Een combinatie als `family` + `greeting` is een typefout
  (`MascotTarget` in `src/lib/mascots.ts`).
- **Maat.** Een slot behoudt altijd de verhouding van de asset
  (`h-auto` + `object-contain`): nooit afsnijden of uitrekken. `size` is een
  breedte in px; een breedte-klasse (bv. `w-full max-w-md`) maakt hem
  vloeiend.

### Afspraken

- De gebruiker heeft een persoonlijke gids (zie "Techniek"). In de gewone
  app-flow staat alleen die gids in beeld, nooit de drie naast elkaar
  (behalve bij de keuze zelf en op familiemomenten). Contextueel beeld van
  één personage met de eigen rol (bv. VERA bij lezen) mag via `MascotSlot`,
  maar alleen als het daar inhoudelijk hoort en niet naast de persoonlijke
  gids op dezelfde plek concurreert.
- **De familie: `family-welcome` en `family-celebrate` zijn verschillend.**
  - `family-welcome` is de algemene introductie van VARO, VERA en NOVI
    samen. Hij hoort op plekken waar de mascottefamilie zelf wordt
    voorgesteld, zoals de publieke homepage.
  - `family-celebrate` is uitsluitend voor betekenisvolle momenten in de
    app: een belangrijke mijlpaal, een afgeronde cursus, een bijzondere
    prestatie, promotie in een divisie, een lange reeks of een belangrijk
    gezamenlijk spelmoment. Zwaarder dan de persoonlijke `celebrate`; er is
    nog geen scherm voor zo'n moment, dus nog niet in gebruik.
  - De familie is nooit de persoonlijke gids: een goed antwoord of de
    begroeting op Vandaag blijft de gekozen gids.
  - Dat `family-welcome` bestaat, betekent niet dat de familie overal als
    decoratie mag verschijnen.
- **Namen en vertalingen.** De namen VARO, VERA en NOVI (in de app: Varo,
  Vera, Novi) worden nooit vertaald. Eigenschappen en omschrijvingen wel, en
  niet letterlijk: kies per taal korte, natuurlijke woorden die dezelfde
  persoonlijkheid en rol overbrengen en in de interface passen. Grammaticaal
  geslacht mag per taal worden toegepast: Varo mannelijk, Vera vrouwelijk,
  NOVI is een jongetje.
- **Betekenis per state** (wanneer `success` en wanneer `celebrate`,
  `encourage` bij fouten, de assets als bibliotheek en niet als decoratie)
  staat in `public/mascots/README.md`. Kort: `success` voor gewone positieve
  feedback, `celebrate` alleen voor duidelijk grotere individuele momenten,
  en Novi reageert op fouten nooit afkeurend.
- Communicatie vooral via houding, animatie en gezichtsuitdrukking.
  Tekstballonnen zijn uitzondering; tekst altijd via het i18n-systeem
  (`src/lib/i18n/messages/*`), nooit vast in een asset of component.
- Geen tijdelijke vervangers (emoji-mascottes, gegenereerde of willekeurige
  afbeeldingen), en geen mascottes op eigen initiatief aan andere pagina's
  toevoegen.

## Kinderen

Er komt **geen** aparte kinderinterface of kinder-app. Kinderen gebruiken
dezelfde Versado-interface; alleen de standaardvolgorde van het aanbod kan
anders zijn (kinderboek, kinderspellen en passende cursussen hoger). De
gebruiker kan die volgorde zelf aanpassen.

Huidige stand: er bestaat een kindercursus (`CourseType.KIDS`, slug
`kinderen`, `KidsStory`/`KidsCourseView`), maar geen kenmerk "kind" op een
gebruiker (geen leeftijd of doelgroep in het datamodel). Een persoonlijke
volgorde bestaat al voor cursussen en spellen (`UserListOrder`,
`/api/list-order`, `SortableList` op `/courses` en `/live`). Een andere
standaardvolgorde voor kinderen hoort daarop aan te sluiten: dezelfde lijsten,
een andere standaard als er geen eigen volgorde is. Bouw geen aparte
"adult"/"kids"-schermen of -routes.

## Onboarding

Bestaat al: `/onboarding` (`OnboardingClient.tsx`), afgerond via
`/api/onboarding/complete` (`User.onboardingSeenAt`; bestaande accounts kregen
bij de invoering een backfill). Stappen nu: kennisniveau
(`User.bomKnowledgeLevel`), persoonlijke gids (`User.companion`), webapp installeren (overgeslagen als de app al
geïnstalleerd draait), uitleg, vrienden zoeken en vindbaarheid, online-status,
notificaties. Opnieuw te openen via Profiel ("rondleiding").

Mag later uitgebreider worden (kennismaken met Versado, persoonlijke
metgezel, uitleg XP/reeks/divisies, contentvoorkeuren). Bouw voort op de
bestaande flow in plaats van een nieuwe ernaast.

## Talen

Twee aparte keuzes, en dat blijft zo: `User.uiLanguage` (app-teksten) en
`User.contentLanguage` (uitgave die je leest en speelt). Niet samenvoegen.
Alle nieuwe UI-tekst via `useT()`/`getT()`, in alle talen met
`uiReady: true` (nu nl, en, de, fr, es; controle `npx tsx
scripts/i18n/check.ts`). Geen vaste Nederlandse UI-tekst. Details in
CLAUDE.md ("Talen").

## Upcoming design assets

De definitieve visuele assets worden **later aangeleverd** en zitten nu niet
in de repository:

- de drie Versado-mascottes (VARO, VERA, NOVI), in verschillende states
  (NOVI eerst, in `public/mascots/static/novi/`, en de familie in
  `public/mascots/static/family/`; zie "Mascottes");
- illustraties;
- mogelijk geanimeerde assets;
- waarschijnlijk Rive-assets met state machines.

Tot ze er zijn: geen tijdelijke vervangers. Ga er bij nieuwe code niet van uit
dat beeld statisch of decoratief is: een asset kan later responsief,
geanimeerd of afhankelijk van context/toestand zijn (bv. een mascotte die
reageert op een goed antwoord). Houd plekken voor beeld daarom los van de
pagina-opbouw, zodat een asset vervangen geen pagina-herbouw vraagt.

Wat al bestaat en blijft: het door de beheerder ingestelde logo, heldenlogo en
favicon (`BrandingSettings`, `/adminbackend`), de illustraties van de
kindercursus (`public/kids`, met toestemming gebruikt, zie CLAUDE.md; ook
gebruikt door de legpuzzel) en de kaartbeelden van de gezinsavond
(`public/gezinsavond`).

## Huidige stand (inventaris)

Gecontroleerd in de code; bestandsnamen om snel terug te vinden.

**Navigatie en lay-out**
- `BottomNav.tsx`: vaste onderbalk met zes bestemmingen, op elk
  schermformaat dezelfde: Cursussen (`/courses`), Vrienden, Competitie, Spelen
  (`/live`), Activiteit, Profiel. Emoji als icoon, geen markering van de
  huidige pagina, het dashboard staat er niet in (bereikbaar via het logo).
- Header in `src/app/layout.tsx` (in `StickyHeader`): logo (voor ingelogde
  gebruikers pas vanaf desktopbreedte `lg`), contentkiezer
  (`ContentSwitcher`), meldingen (`NotificationCenter`), reeks en XP
  (`NavUserBadges`). Geen avatar of profielingang in de header.
- Contentkiezer gesloten: volledige naam, anders de afkorting, anders alleen
  het icoon, gekozen op de gemeten vrije ruimte in de header (niet op een
  breakpoint). Icoon en afkorting per taal staan per contentbron in
  `src/lib/contentMetadata.ts`; de volledige naam is de naam van de uitgave.
  Het geopende menu en het aria-label tonen altijd de volledige naam.
- Daaronder in dezelfde vaste balk: kop van detailpagina's met terugpijl
  (`SubpageBackBar`), podcast- en voorlees-minispeler. `--header-height` wordt gemeten en door `<main>`
  gebruikt.
- Breedte: `max-w-5xl` als standaard (zie CLAUDE.md "Paginabreedte"). De
  lay-out is overwegend één kolom; tablet/desktop krijgen vooral meer breedte,
  geen eigen navigatie (geen zijbalk). Breakpoint-varianten
  (`sm:`/`md:`/`lg:`) komen maar op enkele tientallen plekken voor.

**Vandaag / dashboard** (`src/app/dashboard/page.tsx`)
- Tekst van de dag, leesvoortgang Boek van Mormon (contenttaal), aantal
  vrienden online, en "open acties": vriendschapsverzoeken, ontvangen
  uitdagingen, woordspelbeurten.
- Doorverwijzingen vooraf: wachtwoord wijzigen, e-mail bevestigen, onboarding.
- Al beschikbaar maar niet op het dashboard gebruikt:
  - `/api/activity-status` bundelt uitdagingen, woordspellen, live spellen en
    uitnodigingen (`LiveGameInvite`) en solo Raad het hoofdstuk; nu alleen
    gebruikt door `ActiveGamesBanner` op `/live`.
  - Meldingencentrum (`/api/notifications`, `Notification`).
  - "Verdergaan": `UserCourseProgress` (`currentChapterId`,
    `currentLessonId`, `lastActivityAt`) per cursus en
    `PodcastPlaybackProgress` per aflevering.
  - Dagelijkse spellen: woord van de dag, De Slimste Heilige van de dag.
- Het dashboard doet een deel van dezelfde queries als `/api/activity-status`
  opnieuw. Bij het bouwen van Vandaag één bron kiezen in plaats van een derde
  variant.

**Vrienden en sociaal**
- `/friends` (`FriendsClient`): lijst, verzoeken, zoeken (handle#nummer,
  e-mail alleen als de ander dat toestaat), uitnodigingslink, freeze cadeau
  geven, online-status en huidige activiteit.
- Aanwezigheid: `src/lib/presence.ts`, `ActivityTracker`, Socket.io.
  Privacy standaard uit en server-side afgedwongen: `shareOnlineStatus`,
  `shareCurrentActivity` (alleen met online-status aan), tijdelijk onzichtbaar
  (`invisibleUntil`), vindbaarheid via e-mail (`searchableByEmail`).
- `/activity` (`ActivityFeedClient`, `src/lib/activityFeed.ts`): gebundelde
  XP-activiteit en prestaties van jezelf en vrienden, reacties met emoji
  (niet op eigen activiteit).
- `/challenges`: asynchrone duels per hoofdstuk.

**Competitie, XP, reeks, prestaties**
- `/competition` (`LeaderboardClient`): tabbladen divisie, vrienden,
  nationaal; `DivisionScroller` voor de divisies, met daaronder hoe lang
  de week nog loopt. Lijnen markeren de promotie- en degradatiezone; plek
  1-3 is een medaille (`versado/RankMedal.tsx`, gekleurde munt met cijfer,
  geen emoji), ook bij de medailletelling op het profiel. Weekelijkse
  promotie (`LeagueGroup.promotePercent`, standaard 75%) en degradatie in
  `scheduler.ts`/`leagues.ts` (`movementCounts`, `medalCountsFor`),
  seizoenen; getest met `npm run test:leagues`.
- Divisie-emblemen: acht officiële emblemen in `public/icons/divisions/`
  (`<divisie>.webp`, 384x384, bv. `bronze.webp` voor Zaad), centraal
  gekoppeld in `TIER_EMBLEMS` (`src/lib/leagues.ts`) en getoond via
  `versado/DivisionEmblem.tsx`: in de kopbalk (24 px), de nationale
  ranglijst (28 px, met de divisienaam als toegankelijke naam), de
  divisiescroller (40/64 px, hogere divisies als silhouet), het profiel en de
  competitiedetails (28 tot 80 px) en de seizoenen. Naast een zichtbare
  divisienaam is het embleem decoratief. Geen emoji of eigen pad per
  component.
- XP: `src/lib/xp.ts` (bron van waarheid, `XPTransaction`),
  competitie-XP `competitionXp.ts`, historie `/xp`.
- Reeks: `src/lib/streak.ts`, `/streak`, freezes (ook automatisch ingezet
  door de minuuttick in `scheduler.ts`), winkel `/shop`.
- Prestaties: `src/lib/achievements.ts`, `Achievement` (icoon als emoji in de
  database), getoond op het profiel.

**Leren**
- `/courses` (`CoursesClient`): eigen cursuslijst met sleepvolgorde. Typen
  (`CourseType`): FRONT_TO_BACK en READING_LESSONS (in de app "Hoofdstuk voor
  hoofdstuk" en "Stap voor stap"), FREE_CHOICE, BY_BOOK, PODCAST, KIDS,
  INTRO, FSY.
- Lezen: `ReadingChapterView`, `LessonFlow`, `ReadingLessonFlow`, voorlezen
  met eigen of kerk-audio (`ReadAloudPlayer`, minispeler, `audioMirror.ts`),
  bladwijzers en markeringen.
- Meerdere werken en uitgaven via de contentkiezer (`ContentCollection` met
  `work` + `language`).

**Spelen** (overzicht in `LiveLobbyForm` op `/live`, met sleepvolgorde)
- Legpuzzel, woordzoeker, woord van de dag, woordspel (asynchroon één tegen
  één), De Slimste Heilige (quizavond op eigen telefoons, seizoenen, solo van
  de dag en oefenen), gezinsavond (bordspel: samen aan tafel op één apparaat
  of ieder op eigen telefoon), Raad het hoofdstuk (live en solo), uitdagingen,
  live duel via code. Aan of uit per spel (`gameSettings`) en per
  contentcollectie (`GameContentScope`).
- Live spellen draaien in-memory in `src/server/gameServer.ts` (Socket.io).

**Profiel** (`ProfileClient`)
- Bovenaan wie je bent (avatar, naam, reeks, XP, freezes, hoofdstukken,
  divisie), daaronder de acties Winkel en Feedback (de enige ingang naar de
  winkel), dan competitie en voortgang (prestaties, leesvoortgang),
  Voorkeuren (weergave, taal, voorlezen, meldingen, online en activiteit,
  privacy), Over (wat is nieuw, rondleiding) en Account en beveiliging
  (2FA, wachtwoord, uitloggen). Account verwijderen staat los en klein
  onderaan. Onderdelen openen op een eigen adres (`src/lib/profileViews.ts`).
- Eén standaard voor alle profielpagina's, ook wachtwoord en feedback:
  `ProfilePage` als shell en de bouwstenen in `src/components/profile/`
  (zie `docs/PROFIEL.md`). Uitloggen, resetten en account verwijderen
  bevestigen via `useConfirm` (met `destructive` voor onomkeerbaar).

**PWA en meldingen**
- Dynamisch manifest `/api/branding/manifest` (ook op `/manifest.webmanifest`),
  eigen favicon/apple-touch-icon uit branding, `viewportFit: cover` en
  safe-area-marges, installatiehint (`HeaderInstallHint`, `InstallAppCard`),
  `EdgeSwipeGuard`.
- `public/sw.js`: push, app-badge en doorgeefluik voor fetch. **Geen cache en
  geen offline-modus.**
- Meldingen: `src/lib/notify.ts` (push, e-mail, meldingencentrum per
  categorie).

**Thema**
- Dark mode via de klasse `dark` (`ThemeScript` zet hem vóór het tekenen en
  volgt een wisseling van het systeemthema). Keuze Systeem, Licht of Donker
  onder Voorkeuren in het profiel (`ThemePreference`); geen opgeslagen
  voorkeur in localStorage betekent Systeem.
- Kleuren: Tailwind-palet `brand`/`gold`/`ice` in `tailwind.config.ts`, font
  Nunito, animaties `pop` en `shake`. Kleuren staan als vaste klassen in de
  componenten (ruim 1200 `dark:`-varianten), niet als centrale variabelen.

**Beeld en assets**
- Overal gewone `<img>` (geen `next/image`), assets in `public/` of als
  data-URL in de database (branding).
- Emoji als structureel icoon in de code: onderbalk, spelkaarten
  (`LiveLobbyForm`), actiesoorten (`ActiveGamesBanner`), dashboardacties,
  statistieken in het profiel, header-logo zonder eigen logo.
- Emoji als data in de database: `Achievement.icon`, `ContentCollection.icon`,
  `User.avatarEmoji` (keuze van de gebruiker), en als kopie in
  `ActivityFeedItem.achievementIcon`.
- Divisies hebben officiële emblemen (zie "Competitie, XP, reeks,
  prestaties").
- Geen illustratie- of animatiebibliotheek. Mascottes lopen via
  `MascotSlot` met statische WebP (zie "Mascottes"); beweging valt onder
  `vs-motion` (`prefers-reduced-motion`).

## Wat het redesign straks raakt

Om te weten waar de impact zit. **Niet vooraf aanpassen voor het redesign.**

- **Navigatie**: `BottomNav.tsx` (zes naar vier bestemmingen, actieve
  markering, iconen), header in `layout.tsx` (avatar/profielingang), mogelijk
  een eigen navigatie voor tablet/desktop.
- **Vandaag**: `src/app/dashboard/page.tsx`, met de bestaande bronnen
  hierboven (`/api/activity-status`, meldingen, `UserCourseProgress`,
  podcastposities, dagelijkse content).
- **Vrienden**: `/friends`, `/competition` en `/activity` samen onder één
  bestemming; `FriendsClient`, `LeaderboardClient`, `ActivityFeedClient`,
  `DivisionScroller`, en de Samen-onderdelen (`src/components/social/`,
  `/groups`).
- **Leren/Spelen**: `CoursesClient` en de cursusweergaven (`*CourseView`),
  `LiveLobbyForm` (spellenoverzicht). Cursus- en spelkaarten volgen één
  standaard (`ContentCard`, `SortableList`; zie `docs/KAARTEN.md`).
- **Profiel**: `ProfileClient` waarschijnlijk splitsen in "wie ben ik"
  (statistieken, prestaties) en instellingen.
- **Onboarding**: `OnboardingClient` (metgezel kiezen, meer uitleg).
- **Thema en stijl**: `tailwind.config.ts`, `src/app/globals.css`
  (`.card`, `.btn`, `.input`), kleuren in alle componenten.
- **Beloningsmomenten** voor mascottes/familie: afronden van les en cursus
  (`LessonFlow` en verwanten), prestaties (`achievements.ts`,
  `notifyAchievement`), promotie (`notifyWeeklyResult`), reeksmijlpalen
  (`streak.ts`), einde van gezamenlijke spellen.
- **Publieke startpagina**: `src/app/page.tsx` en `src/components/home/HomeContent.tsx`
  (ook onder de persoonlijke boodschap van `/uitnodiging/[code]`).

## Aandachtspunten voor beeld, mascottes en Rive

Geen van deze punten blokkeert vandaag iets, en dus wordt er nu niets
omgebouwd. Ze zijn bedoeld om bij het redesign de juiste keuze te maken.

1. **Emoji als data.** `Achievement.icon` en `ContentCollection.icon` bevatten
   een emoji; `ActivityFeedItem` kopieert het prestatie-icoon zelfs per regel.
   Nieuwe beelden niet in die velden stoppen, maar per sleutel (slug of id)
   koppelen, zodat oude regels ook het nieuwe beeld tonen. De feed bewaart
   `achievementSlug` al; toon beeld daarop, niet op de gekopieerde emoji.
2. **Geen centrale plek voor iconen en illustraties.** Beeld staat nu verspreid
   in componenten (onderbalk, spelkaarten, actiesoorten, dashboard). Bij het
   redesign één component of register per soort (icoon, illustratie,
   mascotte) dat een sleutel omzet in een asset. Dan is vervangen, of een
   statisch beeld inruilen voor een animatie, één wijziging.
3. **Kleuren zijn niet centraal.** Ruim 1200 `dark:`-varianten met vaste
   Tailwind-kleuren. Een nieuw palet uit Figma raakt dan elk component. Bij het
   redesign kleuren als semantische variabelen (CSS custom properties, via
   `tailwind.config.ts`) met een licht en een donker thema; niet vooraf.
4. **Beweging.** `vs-motion` legt beweging stil onder
   `prefers-reduced-motion`. Animaties en Rive-mascottes moeten die voorkeur
   respecteren (de statische mascotte-WebP als terugval) en mogen informatie
   niet alleen via beweging overbrengen.
5. **Rive.** Rive is nog geen dependency; `MascotSlot` is wel al zo opgezet
   dat een Rive-renderer er later achter kan (zie "Mascottes"). Het runtime draait alleen in de
   browser (component alleen client-side laden). Het gebruikt WebAssembly dat
   standaard van een externe CDN komt; voor deze self-hosted app het
   `.wasm`-bestand zelf meeleveren. Komt er ooit een Content-Security-Policy
   (nu bewust niet, zie `deploy/nginx/nginx.conf`), dan moet die WebAssembly
   toestaan.
6. **Laden en cache.** `public/sw.js` bewaart niets; grote illustraties en
   `.riv`-bestanden worden dus bij elk bezoek opnieuw gecontroleerd. Geef
   assets bij voorkeur een naam met versie of hash, zodat lange cache kan, en
   overweeg bij het redesign een eenvoudige asset-cache in de service worker.
7. **Toegankelijkheid.** Decoratief beeld `alt=""`/`aria-hidden`; beeld dat
   iets betekent (een mascotte die "goed zo" uitdrukt) krijgt een vertaalde
   tekstuele tegenhanger via i18n.

## Openstaande punten, los van het redesign

Gevonden bij dit onderzoek; niet aangepast, want buiten deze opdracht:

- **Privacy van de activiteitenfeed.** `/api/activity-feed` toont XP en
  prestaties van alle vrienden, zonder eigen instelling en zonder rekening te
  houden met `shareOnlineStatus`/`shareCurrentActivity`. De rest van de app
  werkt privacy-by-default (alles standaard uit). Beslissen of hier een eigen
  schakelaar (standaard uit, met backfill volgens het migratiebeleid) hoort.
- **Vaste tekst op het dashboard.** Als de uitgave geen naam heeft, toont het
  dashboard vast "Boek van Mormon" (`dashboard/page.tsx`); hoort via i18n.

## Werkafspraken voor dit traject

- Eerst de bestaande code lezen, niet uitgaan van aannames; veel wat Vandaag
  of Vrienden nodig heeft, bestaat al (zie inventaris).
- Geen database-schema, API-contract of Socket.io-gedrag wijzigen zonder
  duidelijke noodzaak.
- Responsive gedrag, dark mode, toegankelijkheid, i18n, PWA en
  privacy-instellingen blijven werken.
- Geen grote refactor alleen om code mooier te maken, en geen visuele keuzes
  die de Figma-ontwerpen voor de voeten lopen.
- Werk dit document bij als de richting verandert of een deel van het
  redesign is uitgevoerd.
