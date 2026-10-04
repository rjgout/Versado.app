# Snelle Zendeling

Snelle Zendeling is een solo-arcadespel op `/snelle-zendeling`. De startpagina
blijft in Normal Mode; een concrete run staat op
`/snelle-zendeling/run/[runId]` en gebruikt Focus Mode. De globale shell wordt
daarom centraal verborgen via `src/lib/focusMode.ts` en de inhoud gebruikt
`FocusLayout`.

## Assets en mascotte

De bronbibliotheek staat in `snelle-zendeling-assets/`. De runtimekopieën staan
onder `public/games/snelle-zendeling/`. `manifest.json` is de bron voor de
1254×1254 canvasmaat, de gelijke pivots, Novi’s kleinere paar-schaal en de
parallaxsuggesties. De productie-assets zijn geen nieuwe algemene
`MascotState`: de run gebruikt `useCompanion()` en kiest uitsluitend de
gameplaysprite van Novi, Varo of Vera. Glide en boost hebben hetzelfde canvas
en dezelfde rendermaat.

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

## Run, revive en vragen

De server maakt eerst een `QuickMissionaryRun` aan. De client meldt alleen de
score bij een botsing of einde; de server controleert run-eigenaarschap,
status, monotone score, maximale score en het hoogst mogelijke tempo op basis
van de servertijd. Een run kan maar één keer reviven. Na een goede vraag gaat
de status naar `REVIVE_READY`; de wereld blijft gepauzeerd totdat de gebruiker
tikt, waarna drie seconden veilige collisionbescherming actief zijn. Een fout
antwoord of weigeren beëindigt de run.

Revive gebruikt bestaande goedgekeurde `Exercise`-records van type
`MULTIPLE_CHOICE` met `QuestionOption`. Eerst worden vragen geprobeerd die de
gebruiker al eerder heeft beantwoord; anders volgt een vraag uit de actieve
contentcollectie. De server kiest exact drie opties met precies één correct
antwoord en stuurt geen correctheidsvlag naar de client. Dit pad roept geen
XP-, streak- of oefensessieboekhouding aan.

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
getoond. Revived runs blijven gewone geldige runs en vormen geen apart
klassement. Arcade-score geeft geen XP, streak of competitie-XP.

## Database en beheer

`GameSettings.quickMissionaryEnabled` is standaard uit. De migratie maakt ook
scopes voor bestaande schriftuitgaven aan; een beheerder kan de globale toggle
en content-scopes beheren via de bestaande admincomponent. Het runmodel heeft
indexen op gebruiker/status, gebruiker/score en day/status/score.

## Platform en toegankelijkheid

Het spel gebruikt één canvas met een vaste aspect-ratio, waardoor fysieke
schermbreedte en refresh rate de gameplay niet wijzigen. Touch, pointer,
muisklik en Space/ArrowUp werken. `touch-action` wordt alleen op het
gamecanvas toegepast; safe areas en PWA/Capacitor lopen via de bestaande
shell. De renderer maakt geen React state-update per frame. Bij reduced motion
worden decoratieve bewegingen beperkt door de bestaande Versado-motionregels;
de noodzakelijke physics blijven actief.

## Tests

`tests/snelle-zendeling.test.ts` dekt vaste maten, gapgrenzen, score-eenmalig,
collision, gelijke hitboxen, revive-opties/-status, ranking-ties en server-side
scoretempo. Focus Mode wordt getest in `tests/focus-mode.test.ts`.
