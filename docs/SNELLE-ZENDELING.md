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

- Novi: `public/images/games/snelle-zendeling.png` (aanwezig);
- Varo: `public/images/games/vliegende-varo.png` (nog aan te leveren);
- Vera: `public/images/games/vliegende-vera.png` (nog aan te leveren).

Zolang Varo/Vera ontbreken toont `MediaArtwork` zijn neutrale gameplaceholder,
niet de Novi-cover onder een verkeerde naam. Na levering hoeft in
`GAME_MASCOT_COVERS` alleen de betreffende `null` door een `ArtworkAsset` met
het genoemde pad te worden vervangen; kaartcomponenten veranderen niet.

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
maximaal 105 logische pixels verschillen. Muur en rots worden proportioneel
geschaald vanuit hun gelijke effectieve bronbreedte van 384 px; hun uiteinden
worden niet uitgerekt.

De collision gebruikt een vaste rechthoekige hitbox van 42×42 rond het lichaam.
De 1254×1254 transparante sprite, staart en losse haren zijn dus geen
collisionzone. Glide en boost, en alle drie gidsen, gebruiken dezelfde hitbox.
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

Genees gebruikt bestaande goedgekeurde `Exercise`-records van type
`MULTIPLE_CHOICE` met `QuestionOption`. Eerst worden vragen geprobeerd die de
gebruiker al eerder heeft beantwoord; anders volgt een vraag uit de actieve
contentcollectie/contenttaal. De server toont echte context uit
`Exercise.chapter.book`, bijvoorbeeld `Alma 32`; zonder betrouwbare metadata
wordt niets verzonnen. Hij kiest exact drie opties met precies één correct
antwoord. Alleen antwoordsets met vergelijkbare woord-/tekenlengte zijn
geschikt; daarna wint de combinatie die qua lengte het dichtst bij het goede
antwoord ligt. De cursusvragenbank wordt niet afgekapt, aangevuld of
herschreven. De client ontvangt geen correctheidsvlag. Dit pad schrijft geen
oefenpoging en geeft geen XP, reeks of competitie-XP.

## Immersive UX en exit

De logische wereld en physics blijven gelijk; alleen de presentatie vult op
telefoon de viewport. Score, startinstructie, frozen death-state, Genees-vraag,
feedback en game-over liggen binnen dezelfde stage. De Genees-overlay gebruikt
een rustige scrim. Bij lange inhoud scrolt alleen de overlay; antwoorden houden
hun volledige tekst en natuurlijke hoogte.

Na definitief game-over zijn Opnieuw, Ranglijst en Terug naar Spelen zichtbaar.
Browserback en native systeem-back sturen een idempotente keepalive-finish naar
de bestaande server-lifecycle. De server blijft beslissen of score en status
geldig zijn, zodat geen herbruikbare halfopen run ontstaat.

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
vergelijkbaarder; schema en correct antwoord veranderen niet.

## Platform en toegankelijkheid

Het spel gebruikt één canvas met een vaste logische wereld, waardoor fysieke
schermbreedte en refresh rate de gameplay niet wijzigen. Touch, pointer,
muisklik en Space/ArrowUp werken. `touch-action` wordt alleen op het
gamecanvas toegepast; safe areas en PWA/Capacitor lopen via de centrale
immersive shell. De renderer maakt geen React state-update per frame. Bij reduced motion
worden decoratieve bewegingen beperkt door de bestaande Versado-motionregels;
de noodzakelijke physics blijven actief.

## Tests

`tests/snelle-zendeling.test.ts` dekt vaste maten, gapgrenzen, score-eenmalig,
collision, gelijke hitboxen, Genees-opties/-status, vraagcontext,
antwoordbalans, dynamische identiteit, immersive overlays, ranking-ties en
server-side scoretempo. Shellmodi staan in `tests/focus-mode.test.ts` en de
coverresolver in `tests/artwork.test.ts`.
