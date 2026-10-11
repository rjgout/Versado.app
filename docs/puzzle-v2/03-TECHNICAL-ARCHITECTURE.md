# Legpuzzel 2.0 — technische architectuur

## Voorkeur

**VOORGESTELD: Canvas 2D world-renderer; DOM/React voor shell, HUD en
toegankelijke bediening; SVG-paddata als geometry-formaat.** Canvas houdt 96
solo/300 samenstukken bij pan/zoom in één compositor. De werktafel is eindig:
de definitie berekent een centrale puzzelzone, niet-overlappende parkeerposities
en wereldgrenzen. SVG blijft bruikbaar voor preview/debug, maar honderden losse
SVG/clipPaths maken React/layout/hittest te duur. Puur HTML kan geen nette
uitsneden; WebGL en een nieuwe library zijn onnodig. `@dnd-kit` bestaat, maar
is voor sorteerkaarten, niet voor vrije world-coördinaten/groepen/pinch/serverlocks.
Canvas 2D werkt in moderne browsers en Capacitor WebViews.

Gebruik DPR-begrensde backingstore, `ImageBitmap` waar beschikbaar, `Path2D`-cache, requestAnimationFrame en zichtbare-bounds culling. De keyboardmodus roept dezelfde engineacties aan; canvas is dus geen ontoegankelijke black box.

## Lagen

1. Definition: content-id, afbeelding, verhaal, aspect, vraagbron.
2. Geometry: generatorversie, seed, rastertopologie, canonieke edge-descriptors.
3. Pure engine: werktafel, transform, rotatie, group merge met stabiel anker,
   snap, completion, snapshot.
4. Session service: auth, transacties, actionlog/snapshot, vraag/reeks.
5. Renderer/input: lokale viewport, pointer-world mapping, keyboardalternatief.
6. Sync: Socket.IO-events, REST start/snapshot/reconnect.

Iedere gedeelde rand bestaat eenmaal en wordt door beide buren met inverse oriëntatie gelezen. Een descriptor bevat vormfamilie, positie, breedte, diepte, asymmetrie en tab/slot; buitenranden zijn vlak. Een seeded PRNG met vaste integer/fixed-point parameters maakt output reproduceerbaar. Nieuwe generator = nieuwe `geometryVersion`; oude definitie+seed blijft onveranderd. Geometry v2 bewaart per gedeelde rand naast positie/breedte/diepte een hals- en rondheidsparameter en tekent vier Bézier-segmenten (hals → ronde kop → hals). Beide kanten lezen één descriptor met omgekeerde looprichting. Validatie test complementen, rand/hoek, minimumafstand tot hoeken, self-intersection en grenzen.

## Geïmplementeerd: Solo, spelregelversie 2

`puzzlePolicy(difficulty, rulesVersion)` bewaart oude ondersteuning en geeft
nieuwe niveaus een gelijke wereldtolerantie. `connect` en `anchor` zijn aparte
acties. `anchorGroup` leidt de positie af uit definitie/werktafel en het stabiele
groepsanker, valideert tolerantie, rotatie en unieke volledige stukdekking.
Elke groep heeft aantoonbare boomverbindingen; cycli, dubbele leden of
niet-aangrenzende edges zijn ongeldig. Bordankers staan exact canoniek en zijn
immobiel. Merge behoudt een bestaand bordanker, ook bij omgekeerde inputs.
Aangrenzende verankerde groepen groeien deterministisch met een geldige edge.

`isPuzzleComplete` bewijst structuur en oriëntatie; één volledige vrije groep
of volledige geldige verankering kan voltooien. Dezelfde validator bewaakt
hervatten, statusherstel en antwoorden; een timestamp/statusclaim is onvoldoende.
De sessieservice lockt een eigen SOLO-sessie met `FOR UPDATE`, controleert
versie/actionId en schrijft actie + snapshot atomisch. Er zijn geen client-
aangeleverde transforms of leden in een anchoractie. De drop behoudt bestaande
stuk-/groep-snaps en probeert daarna bordplaatsing van het nieuwe geheel.

Hints zijn serverberekende, tijdelijke targets in `snapshot.hints`, met
`actionId`, `at`, `expiresAt`, `extra`, `source` (INCLUDED/PERSONAL) en type. Locatie geldt voor alle
selectieleden; verbinding kiest een echte externe buur. Filtering dimt alleen
weergave, inclusief niet-geselecteerde soorten binnen verbonden groepen.
Het permanente snapshot-filter blijft onaangeraakt. Een lopende hint en de
sessielock voorkomen snel dubbel afschrijven; retries met dezelfde actionId
geven de huidige autoritatieve snapshot. Targetvalidatie gebeurt vóór betaling.
Na het inbegrepen budget is `confirmPersonal: true` nodig. Dezelfde transactie
lockt sessie → gebruiker (conditionele update met `hintBalance > 0`), schrijft
hintlog/snapshot/versie en geeft het actuele hintsaldo terug. Fouten rollen alles
terug; nooit negatieve voorraad. Een bestaande actionId wordt vóór status en
versie gecontroleerd en kost niets opnieuw. Ontbrekende `source` is historische
registratie en wordt niet terugwerkend betaald. Spelregel- en geometrieversies
blijven intact; alleen nieuwe hintaanvragen volgen de afschrijving.
`useHintInventory` gebruikt `/api/hints` via de centrale live-data-laag met
focus-/reconnect-verversing. De sheet vraagt bij openen opnieuw voorraad op;
acties gebruiken `liveMutation`/`hintsChanged`, de server meldt `hints_changed`
pas na commit. Winkel, Woordspel en Raad het hoofdstuk lezen dezelfde voorraad.
Nooit een hintspecifieke reeksactie of XP-award.

## Toekomstig, buiten fase 2: server-authoritative multiplayer

Nieuwe handler onder `src/server/`, geregistreerd in `gameServer.ts` analoog aan study/quickMissionary, maar database is bron van waarheid. Room `puzzle:<sessionId>`; events `join`, `sync`, `lock`, throttled ephemeral `move`, `commit`, `unlock`, `completed`.

Commit bevat `actionId`, verwachte versie, groep en eindtransform. Server lockt sessie/relevante groepen in vaste id-volgorde, valideert lock/snap/lidmaatschap, schrijft actie/snapshot, verhoogt versie en broadcast canonical patch. Zelfde actionId geeft zelfde uitkomst. Locks hebben eigenaar/TTL/heartbeat; disconnect verloopt. Optimistische UI corrigeert op patch. Pixelbewegingen gaan nooit persistent; commits, hints, status en periodieke snapshots wel. Reconnect geeft patches sinds versie of volledige snapshot.

Dit is veilig bij meerdere instances: Redis-adapter is alleen transport; database state is autoritatief. Serverklok bepaalt start/einde/locks. Friendship, `LiveGameInvite`-notificatiepatroon en `emitToUser` zijn herbruikbaar. Cliënt krijgt nooit juist antwoord of scoreclaim; server verwerpt niet-leden, oude versies en onmogelijke overgangen.
