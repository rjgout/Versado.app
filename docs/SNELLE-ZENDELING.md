# Vliegende Novi, Varo of Vera

Het solo-arcadespel houdt technisch de id `quick-missionary`, de bestaande
database en de routes `/snelle-zendeling` en
`/snelle-zendeling/run/[runId]`. De zichtbare identiteit is persoonlijk:
`Vliegende Novi`, `Vliegende Varo` of `Vliegende Vera`, in andere UI-talen
via een eigen natuurlijk vertaalpatroon. `User.companion` wordt uitsluitend
via het centrale companionsysteem vertaald naar naam, glide-/boostsprite en
cover. Wisselen van gids verandert geen run, score of klassement.

De startpagina blijft in Normal Mode. Een concrete run gebruikt de centrale
Immersive Mode uit `src/lib/focusMode.ts` en `ImmersiveLayout`: globale header,
bottomnavigatie en `SubpageBackBar` zijn afwezig. Op telefoon vult de game-area
`100dvh`, inclusief de bestaande safe-area-variabelen voor web, PWA en
Capacitor. Tablet en desktop houden een begrensd portraitveld. De native
statusbar wordt niet apart verborgen: de benodigde Capacitor StatusBar-plugin
is niet aanwezig en routegebonden herstel kan daarom nog niet betrouwbaar
worden gegarandeerd.

## Assets en mascotte

De bronbibliotheek staat in `snelle-zendeling-assets/`. De runtimekopieën staan
onder `public/games/snelle-zendeling/`. `manifest.json` is de bron voor de
1254×1254 canvasmaat, de gelijke pivots, Novi’s kleinere paar-schaal en de
parallaxsuggesties. De productie-assets zijn geen nieuwe algemene
`MascotState`. De centrale companionkeuze bepaalt de gameplaysprite. Glide en
boost hebben hetzelfde canvas en dezelfde rendermaat.

Spelcovers lopen generiek via de mascottevariant in `src/lib/artwork.ts`:

- Novi: `public/images/games/snelle-zendeling.png`;
- Varo: `public/images/games/vliegende-varo.png`;
- Vera: `public/images/games/vliegende-vera.png`.

`GAME_MASCOT_COVERS` koppelt deze drie covers centraal aan de companion. De
kaartcomponenten kennen geen bestandspaden of spelvarianten: de covers delen
dezelfde `quick-missionary`-identiteit en dus dezelfde scores en klassementen.

## Vaste spelregels

De logische wereld is 360×640 en wordt responsive in een begrensd portrait
canvas getoond. Physics is frame-rate-onafhankelijk:

| Constante | Waarde |
|---|---:|
| `GRAVITY` | 820 |
| `BOOST_VELOCITY` | -285 |
| `HORIZONTAL_SPEED` | 150 |
| `MAX_FALL_SPEED` | 430 |
| `OBSTACLE_WIDTH` | 58 |
| `GAP_HEIGHT` | 182 |
| `PAIR_SPACING` | 220 |

Deze waarden staan centraal in `src/lib/snelleZendeling/gameplay.ts`. Ieder
paar gebruikt exact dezelfde breedte, gaphoogte en horizontale afstand. Alleen
`gapY` wordt gekozen; de veilige grenzen zijn vast en opeenvolgende gaps mogen
maximaal 105 logische pixels verschillen. De runtime gebruikt
`obstacle-wall-long.png` en `obstacle-rock-long.png` (beide 384×16384
bronpixels). Ze worden uitsluitend uniform geschaald met
`OBSTACLE_WIDTH / 384`: de hoogte volgt dus altijd uit die breedteschaal en
wordt nooit naar de opening uitgerekt. De bovenkant van de muur wordt exact op
`gapBottom` geplaatst en loopt onder het canvas door; de onderkant van de rots
wordt exact op `gapTop` geplaatst en loopt boven het canvas door. Het canvas
clipt alleen het overtollige lichaam. Daardoor is er bij iedere geldige gapY
geen lucht tussen een obstacle en de bijbehorende viewport-rand.

`obstacle-wall-stem.png` (384×960) en `obstacle-rock-stem.png` (384×912)
blijven als tileable productiereserve bewaard. De vaste wereld van 360×640
valt ruim binnen de lange assets, zodat een losse cap/stem-compositor — die
volgens de assetdocumentatie zorgvuldig op de capfase moet aansluiten — nu
niet nodig is. De lange offscreen-bitmapdelen veranderen de abstracte
collisionrechthoeken niet.

### Hitbox

De mascotte wordt op 74×74 wereldpixels getekend (`MASCOT_RENDER_SIZE`). De
botsing gebruikt één vaste ellips van 32×24 met de linkerbovenhoek van haar
omsluitende rechthoek op (26, 26) binnen die sprite (`MASCOT_HITBOX_*` in
`gameplay.ts`). Ellips tegen asgelijnde rechthoek is exact te toetsen door x
en y door de stralen te delen; alleen raken telt niet. `mascotHitbox()` geeft
de omsluitende rechthoek, onder meer voor de speelzone.

Waarom deze maat: de vorige box (42×42 op 5,5) hing 24–28 px los van het dier,
10–14 px boven de oren en 11–14 px achter de neus, dus de gids stierf in de
lucht en de kop mocht ruim in een obstakel. De nieuwe maat is gemeten aan de
zes echte sprites (drie gidsen, glide en boost): de rand ligt overal hooguit
4–6 px van zichtbaar lichaam; oorpunten en haartoefjes (7–10 px boven de
ellips), staart en de transparante rand tellen niet mee; onder en voor wijkt
de ellips 0–4,5 px af van het silhouet. De tests lezen de PNG's zelf, zodat een
vervangen sprite of een verschoven box direct opvalt.

Novi, Varo en Vera, en glide en boost, hebben exact dezelfde hitbox: de
functies kennen geen gids of pose, de pose kiest alleen de afbeelding. Obstakels,
gap, afstanden en physics zijn bij deze aanpassing niet veranderd.

Ontwikkelen: `?debugHitbox=1` tekent de werkelijke geometrie over het spel
(rood = hitbox, wit = spritegrenzen, geel = botsrechthoeken van de obstakels,
groen = de opening). De code staat achter `process.env.NODE_ENV` en wordt in
een productiebuild niet meegebouwd.

De lage voorgrond wordt vóór de obstakels getekend en blijft maximaal 8% van
de wereldhoogte zichtbaar.

## Run, Genees en vragen

De server maakt eerst een `QuickMissionaryRun` aan. De client meldt alleen de
score bij een botsing of einde; de server controleert run-eigenaarschap,
status, monotone score, maximale score en het hoogst mogelijke tempo op basis
van de servertijd. Een run kan maar één keer Genezen; intern blijven de
stabiele `revive*`-namen bestaan. Na een goede vraag gaat
de status naar `REVIVE_READY`; de wereld blijft gepauzeerd totdat de gebruiker
tikt, waarna drie seconden veilige collisionbescherming actief zijn. Een fout
antwoord of weigeren beëindigt de run.

### Genees-vragen

Elke Genees-poging krijgt een nieuwe vraag, ook na een fout antwoord. De vragen
staan in een eigen, gecureerde bank (`QuickMissionaryReviveQuestion` met
`QuickMissionaryReviveOption`), los van de oefeningen van de cursussen: een
vraag hoort bij één hoofdstuk, heeft precies drie antwoorden (één goed, geen
lengtehint) en wordt nooit tijdens het spelen bedacht. Een bestaande
`Exercise` wordt dus niet meer gebruikt; de enige oude vraag (1 Nephi 1) is in
de migratie overgenomen als `legacy:`-vraag.

**Volgorde.** Hoofdstukken worden doorlopen in de echte volgorde van de
actieve uitgave: `(Book.order, Chapter.order)`, zonder vaste lijst. De plek
van de speler staat per gebruiker en per contentcollectie in
`QuickMissionaryReviveProgress` (`cursorBookOrder`/`cursorChapterOrder`,
`cycle`) en is dus server-side en gelijk op elk toestel en in elke run.

**Wat gebeurt er na een antwoord** (`reviveSelection.ts`):

- Goed: de plek gaat naar het volgende hoofdstuk, daar wordt de volgende
  Genees gesteld.
- Fout: de run eindigt zoals altijd en de plek blijft staan. De volgende Genees
  blijft bij hetzelfde hoofdstuk met een andere, nog niet geziene variant;
  heeft dat hoofdstuk er geen meer, dan gaat het naar het volgende hoofdstuk.
- Maximaal één Genees per run blijft ongewijzigd.

**Geen herhaling.** Een vraag wordt vastgelegd in `QuickMissionaryReviveSeen`
op het moment dat hij wordt uitgegeven (status `SHOWN`, daarna `CORRECT` of
`WRONG`), per cyclus en onder een per-gebruiker-lock met een unieke sleutel op
`(userId, questionId, cycle)`. Verlaten, verversen of een ander toestel levert
daardoor dezelfde vraag niet opnieuw op als een nog niet geziene beschikbaar is.

**Na het laatste hoofdstuk** zoekt de selectie opnieuw vanaf het begin, eerst
naar ongeziene varianten. Zijn alle vragen van de uitgave gezien, dan volgt een
gecontroleerde reset: `cycle` loopt op, het geheugen is weer leeg en het eerste
hoofdstuk komt weer aan de beurt (zonder de laatst geziene vraag als er een
alternatief is). Heeft een uitgave helemaal geen vragen, dan is
`reviveAvailable` onwaar en eindigt de run direct, zonder een andere regel te
verzinnen.

**Feedback.** De client ontvangt nooit een correctheidsvlag en bij een fout
antwoord ook niet het goede antwoord. Het scherm toont "Niet helemaal." met
"Lees {hoofdstuk} om het antwoord te ontdekken." en, als de leesroute bekend
is, een knop daarheen (`chapterReadHref`). Boven de vraag staat altijd het
hoofdstuk (`data-revive-chapter`). Dit pad schrijft geen oefenpoging en geeft
geen XP, reeks of competitie-XP.

**Vragenbank.** De Nederlandse bank voor het Boek van Mormon staat in
`prisma/genees/bofm-nl/` (één bestand per groep boeken, formaat en regels in
`src/lib/snelleZendeling/reviveBank.ts`): drie varianten voor ieder van de 239
hoofdstukken. Elke vraag noemt de verzen waar het antwoord staat en
controlewoorden (`check`) die letterlijk in die verzen en in het goede antwoord
moeten voorkomen. `npm run genees:check` valideert dit (drie antwoorden,
lengtehint, te veel op elkaar lijkende vragen, ontbrekende bronwoorden) en
rapporteert per boek de dekking en de hoofdstukken onder het doel van
`TARGET_VARIANTS` (3). De seed (`importGeneesBank`) laadt de bank idempotent op
`contentKey`; een admin-reseed van de content is dus nodig na de uitrol, de
migratie zelf draait bij het starten van de container. De Engelse, Duitse,
Franse en Spaanse uitgaven hebben nog geen Genees-vragen: daar eindigt de run
direct. Een nieuwe taal of werk krijgt een eigen bankbestand in
`prisma/genees/index.ts`.

## Immersive UX en exit

De logische wereld en physics blijven gelijk; alleen de presentatie vult op
telefoon de viewport. Score, startinstructie, frozen death-state, Genees-vraag,
feedback en game-over liggen binnen dezelfde stage. De Genees-overlay gebruikt
een rustige scrim. Bij lange inhoud scrolt alleen de overlay; antwoorden houden
hun volledige tekst en natuurlijke hoogte.

Na definitief game-over zijn Opnieuw, Ranglijst en Terug naar Spelen zichtbaar.
De startpagina wordt bij het openen van een run vervangen door de runroute; een
beëindigde run wordt bij Ranglijst op dezelfde manier vervangen door
`/snelle-zendeling?view=leaderboard#quick-missionary-leaderboard`. Daardoor blijft
de afgesloten immersive run niet als back-bestemming bestaan en is de stack
normaal `Spelen → run → ranking`. De leaderboardweergave heeft `/live` als
expliciete semantische parent: de centrale `SubpageBackBar` gebruikt daar een
replace naar Spelen, ook als toevallige history beschikbaar is. Browserback en
native systeem-back gaan na game-over → ranking door de opgeschoonde stack naar
Spelen. De run-cleanup blijft een idempotente keepalive-finish sturen bij andere
verlatingen; de server blijft beslissen of score en status geldig zijn, zodat
geen herbruikbare halfopen run ontstaat.

## Ranking en tijd

Er zijn twee tabbladen: Vandaag en All-time. Een voltooide run telt voor de
dag die server-side bij het starten is berekend met `User.timeZone` en
`dayKeyInZone`. Een run die over middernacht loopt blijft daardoor bij zijn
startdag; hij kan niet door een toestelklok naar een andere dag worden
verplaatst. Dit is een persoonlijke lokale-dag-ranking: twee gebruikers
kunnen op hetzelfde UTC-moment een verschillende “Vandaag” hebben.

Per gebruiker telt alleen de hoogste geldige score. Bij gelijke scores wint de
run die die score het eerst server-side bereikte; daarna is `userId` een vaste
laatste tie-breaker. De eigen positie wordt ook buiten de eerste 50 resultaten
getoond. Genezen runs blijven gewone geldige runs en vormen geen apart
klassement. Arcade-score geeft geen XP, reeks of competitie-XP.

Novi, Varo en Vera delen exact deze ene Vandaag- en All-time-ranking. Naam,
sprite en cover zijn presentatielaag en worden niet als rankingcategorie
opgeslagen.

## Database en beheer

`GameSettings.quickMissionaryEnabled` is standaard uit. De migratie maakt ook
scopes voor bestaande schriftuitgaven aan; een beheerder kan de globale toggle
en content-scopes beheren via de bestaande admincomponent. Het runmodel heeft
indexen op gebruiker/status, gebruiker/score en day/status/score. De gerichte
datamigratie `20261014100000_balance_quick_missionary_answers` maakt alleen de
drie afleiders van de bestaande Nederlandse vraag bij 1 Nephi 1 inhoudelijk
vergelijkbaarder; schema en correct antwoord veranderen niet. De migratie
`20261016100000_quick_missionary_revive_bank` voegt de Genees-tabellen toe en
neemt die ene vraag over; bestaande spelers beginnen bij het eerste hoofdstuk.

## Platform en toegankelijkheid

Het spel gebruikt één canvas met een vaste logische wereld, waardoor fysieke
schermbreedte en refresh rate de gameplay niet wijzigen. Touch, pointer,
muisklik en Space/ArrowUp werken. `touch-action` wordt alleen op het
gamecanvas toegepast; safe areas en PWA/Capacitor lopen via de centrale
immersive shell. De renderer maakt geen React state-update per frame. Bij reduced motion
worden decoratieve bewegingen beperkt door de bestaande Versado-motionregels;
de noodzakelijke physics blijven actief.

## Tests

`tests/snelle-zendeling.test.ts` dekt vaste maten, bronafmetingen en uniforme
obstacleschaal, gap-ankers en dekking van beide wereldranden, gapgrenzen,
score-eenmalig, collision, gelijke hitboxen, Genees-opties/-status, vraagcontext,
antwoordbalans, dynamische identiteit, immersive overlays, ranking-ties en
server-side scoretempo. `tests/snelle-zendeling-genees.test.ts` dekt de
selectieregels, het hoofdstuk boven de vraag, het foutscherm zonder goed
antwoord en de bankvalidatie; `tests/snelle-zendeling-genees.integration.test.ts`
(15 databasetests, via `LEARNING_TEST_DATABASE_URL`) dekt de voortgang per
gebruiker, geen herhaling, de cyclusreset en de lege bank. De hitbox heeft
`tests/snelle-zendeling-hitbox.test.ts`. Alles samen: `npm run
test:snelle-zendeling`. Shellmodi staan in `tests/focus-mode.test.ts` en de
coverresolver in `tests/artwork.test.ts`.
