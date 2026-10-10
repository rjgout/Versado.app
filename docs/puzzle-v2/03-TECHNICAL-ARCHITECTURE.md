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

Gebruik DPR-begrensde backingstore, `ImageBitmap` waar beschikbaar, `Path2D`-cache, requestAnimationFrame en zichtbare-bounds culling. Virtualiseer de bak. De keyboardmodus roept dezelfde engineacties aan; canvas is dus geen ontoegankelijke black box.

## Lagen

1. Definition: content-id, afbeelding, verhaal, aspect, vraagbron.
2. Geometry: generatorversie, seed, rastertopologie, canonieke edge-descriptors.
3. Pure engine: werktafel, transform, rotatie, group merge met stabiel anker,
   snap, completion, snapshot.
4. Session service: auth, transacties, actionlog/snapshot, vraag/reeks.
5. Renderer/input: lokale viewport, pointer-world mapping, keyboardalternatief.
6. Sync: Socket.IO-events, REST start/snapshot/reconnect.

Iedere gedeelde rand bestaat eenmaal en wordt door beide buren met inverse oriëntatie gelezen. Een descriptor bevat vormfamilie, positie, breedte, diepte, asymmetrie en tab/slot; buitenranden zijn vlak. Een seeded PRNG met vaste integer/fixed-point parameters maakt output reproduceerbaar. Nieuwe generator = nieuwe `geometryVersion`; oude definitie+seed blijft onveranderd. Validatie test complementen, rand/hoek, minimumafstand tot hoeken, self-intersection en grenzen.

## Server-authoritative multiplayer

Nieuwe handler onder `src/server/`, geregistreerd in `gameServer.ts` analoog aan study/quickMissionary, maar database is bron van waarheid. Room `puzzle:<sessionId>`; events `join`, `sync`, `lock`, throttled ephemeral `move`, `commit`, `unlock`, `completed`.

Commit bevat `actionId`, verwachte versie, groep en eindtransform. Server lockt sessie/relevante groepen in vaste id-volgorde, valideert lock/snap/lidmaatschap, schrijft actie/snapshot, verhoogt versie en broadcast canonical patch. Zelfde actionId geeft zelfde uitkomst. Locks hebben eigenaar/TTL/heartbeat; disconnect verloopt. Optimistische UI corrigeert op patch. Pixelbewegingen gaan nooit persistent; commits, hints, status en periodieke snapshots wel. Reconnect geeft patches sinds versie of volledige snapshot.

Dit is veilig bij meerdere instances: Redis-adapter is alleen transport; database state is autoritatief. Serverklok bepaalt start/einde/locks. Friendship, `LiveGameInvite`-notificatiepatroon en `emitToUser` zijn herbruikbaar. Cliënt krijgt nooit juist antwoord of scoreclaim; server verwerpt niet-leden, oude versies en onmogelijke overgangen.
