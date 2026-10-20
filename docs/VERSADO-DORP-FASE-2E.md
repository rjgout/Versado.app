# Versado Dorp — fase 2E: iPhone-correcties

Basis: `40c56c04` (actuele main na #152). Geen schema- of assetwijziging.

## Correcties

- `ServerDorpClient` gebruikt het bestaande `personal.id` uit `GET /api/dorp`
  om een bestaand dorp automatisch te lezen. Alleen een eerste creatie vraagt
  bewust POST. Herladen gebruikt GET. Ook laad-, eerste-bezoek- en foutschermen
  hebben de centrale terugactie; fallback `/profile`, bij bezoeken het vriendprofiel.
- Dezelfde canonieke groeiformule blijft leidend. Voorheen gebeurde onderhoud bij
  POST-openen. Een GET projecteert de actuele fase zonder databasewrites; een
  expliciete mutatie past het bestaande onderhoud toe na de versiecontrole onder
  dezelfde User → Group → Village-locks. Leesvoortgang wordt nooit gewijzigd.
- De fout-/eerste-bezoekpagina respecteert de centrale safe-area-variabelen.
  De browserproef onderschept een echte leesfout en geeft de herstelresponse
  pas na de retry-actie vrij; de centrale cachelogica blijft behouden.
- De dorpskeuze is één inklapbare touchrij. Reload en uitleg over proefrechten
  staan daarbinnen; bevestigde gewone opslag wordt alleen toegankelijk aangekondigd.
  Laden, fouten en cadeaubevestiging blijven zichtbaar wanneer relevant.
- Geen alternatief gekleurd ruitjesraster meer bij Wereld. Hetzelfde gras-/padasset
  wordt op alle zoomniveaus gerasterd. De decoratieve grasrand loopt tot R+3 uit;
  binnen R+1 is hij volledig dekkend, inclusief alle bouwbare tegelhoeken.
  De echte bouwgrens en collisions blijven R8–R62.
- Bos staat achter gras en objecten. Een naadloze 1536²-texture uit 64 vaste punten
  gebruikt bestaande bosassets; kleinere LOD-textures zijn afgeleiden van exact
  hetzelfde patroon. Zoom verandert geen boomposities of bosraster. Geen extra
  boslaag door plaatsingsvlakken. Wereld past bij de huidige dorpgrootte in plaats
  van ieder R8-dorp als een stip in een R87-wereld te tonen.
- Terreinbuffers zijn begrensd tot de echte grasomgeving (op laagste rasterresolutie
  minder dan 5 miljoen pixels op R62). Bestaande paddingcache, spritecache en
  render-on-demand blijven. Padenindexering is gememoiseerd. Vriendenmarkers blijven
  maximaal acht, op een deterministische niet-geografische ring. Geen automatische
  prefetch van volledige bezoekpagina's; toegang wordt bij bezoeken opnieuw getoetst.
- `registeredSprite` deelt de grondregistratie tussen preview en geplaatst object.
  Familiehuis, schrijvershuis en ontmoetingshuis gebruiken de voorste footprint-
  **hoek**, niet het midden van de laatste tegel (verschil 32 wereldpixels).
  Bank, put en lantaarn gebruiken gemeten grondcontacten van hun bestaande assets,
  niet het totale afbeeldings-boundingboxmiddelpunt. Bewoners behouden hun voetanker.
  WorldSize, footprints, collisionregels, opgeslagen posities, IDs en levels blijven.
  De contactkalibratie is visueel; zij is geen nieuwe automatische herplaatsing.

## Technische verificatie

Geslaagd: TypeScript, Prisma-validatie en schone productiebuild; ESLint zonder
fouten (169 bestaande waarschuwingen, gerichte dorplint zonder waarschuwingen).
i18n-check geslaagd met de bestaande achterstand van 418 sleutels per niet-
Nederlandse taal; bestaande sleutels zijn hergebruikt.

- Dorp/focus/shell: **54**; live-data: **54** tests.
- Eigen PostgreSQL: **18** integratietests, inclusief GET-groei zonder writes,
  bouwen op de berekende grens, concurrency, vertrek, krimp, privacy en cadeaus.
- Regressies: Kompas **69**, sociaal **33**, profiel **13**, divisies **5**,
  Genees/Snelle Zendeling **58**. Geen skips in deze geïsoleerde suites.
- **26** bestaande productiebuild-browserflows geslaagd; aanvullend profiel/
  forward/GET-only, **12** camera-/radiuscombinaties en **7** objectregistraties.
  Ook de leesfout onder 47px safe-area, GET-only herstel en werkelijke
  pinch/pan zijn geslaagd: geen wereldmutatie, maximaal 2 sprite/blitcalls en
  0 idle-renders in het aanvullende gebarenscenario.
- De bestaande migratieproef behoudt **147** oude tabellen, **418** constraints
  en **403** indexen, inclusief geïnjecteerde fout/rollback en herhaald deploy.
  Actuele telling na bestaande migraties: **156** tabellen, **449** constraints,
  **420** indexen. Deze PR voegt geen migratie toe.
- Gemeten hoofdcanvas: maximaal **2–5** sprite-/blitcalls en **0** idle-renders
  in acht frames in de matrix. Dit zijn geen FPS- of GPU-tijdmetingen; het bos
  gebruikt een vooraf opgebouwde patternfill en begrensde LOD-cache.

Het netwerkfoutscenario blokkeert alleen voor voorspelbare Playwright-interceptie
de pass-through serviceworker; de gewone 26 browserflows behouden deze. Geen
wijziging aan de PWA of cache-infrastructuur.

De uitgebreide bestaande runner voert ook `tests/dorp-iphone.browser.mjs` uit; een gerichte rerun
kan met `npm run test:dorp:integration -- --iphone-only`.

Browserbewijs gebruikt uitsluitend synthetische accounts en lokale PostgreSQL.
De matrix omvat Chromium 320×844, 390×844, 844×390 en 1280×900, licht/donker,
320px ook 200% tekst, gesimuleerde landscape-safe-areas, paden, nieuwe en bestaande
objectdrag, collision, serveropslag, groepen, vrienden en privacy-intrekking in
meerdere gelijktijdige sessies. Aanvullend: GET-only refresh, profiel-terug,
browser-forward, vier cameraopties op R8/R35/R62 en zeven geselecteerde objecten.

## Screenshots en beperkingen

Voor: [CI-bewijs van #152](https://github.com/rjgout/Versado.app/actions/runs/39399200432/artifacts/12254302554),
waaronder `world-overview.png`, `world-r35.png`, `world-r62.png`,
`personal-server-320.png`, `drag-building.png` en `drag-resident.png`.
De lokale originele voorbeelden zijn vóór wijzigingen apart bewaard.

Na: het bestaande CI-artifact `versado-dorp-browser` bevat `2e-mobile-hud.png`,
`2e-r{8,35,62}-{detail,normal,map,world}.png`,
`2e-registration-{objectId}.png`, de volledige viewportmatrix en privacybewijs.
Geen grote afbeeldingen in Git.

Geen fysieke iPhone/Android getest. Een aanvullende lokale WebKit-poging kon niet
starten wegens ontbrekende GTK4/Graphene/Harfbuzz-ICU/Manette/Hyphen/GLES-libraries;
geen claim van echte Safari-acceptatie. De eigenaar beoordeelt iOS Safari en de
werkelijke touchervaring na afzonderlijk toegestane uitrol. Het bos is een
herhaalbare bestaande-assettextuur, geen onbeperkt unieke wereld. Zeer kleine
objecten zijn op Wereld vanzelf kleiner; Detail en Normaal blijven beschikbaar.

## Behoud en uitrol

Geen Prisma-migratie, nieuwe rechten, XP-regels, hoofdstukidentiteiten, groepslimieten
of privacydefaults. De bestaande alpha-inventaris blijft proefrecht. Bestaande v2/v3-
werelden worden gelezen met hun oorspronkelijke IDs, posities, levels en paden.
GET creëert geen dorp, inventaris, voortgang of beloningsrecord.

Na review en afzonderlijk mergebesluit rolt de eigenaar de normale appimage uit.
Bestaande volumes en database blijven behouden; publieke toegang blijft standaard
uit en de technische flag blijft leidend. Controleer sluiten, bestaand dorp openen,
paden/slepen en privacy met twee accounts. Approllback: vorige image terugzetten;
geen databaseterugzetting nodig voor deze wijziging. Niet gemerged, niet gedeployed,
geen productie- of NAS-handeling uitgevoerd.

## Reviewcorrectie: terrein-cache bij de bosrand

[Reviewcommentaar](https://github.com/rjgout/Versado.app/pull/154#issuecomment-6293217810).
De buffer met padding kan nog gras raken terwijl de zichtbare uitsnede al leeg
is. De non-null assertion verborg dit voor TypeScript, maar veroorzaakte een
runtimefout op `inner.minX`. `containsTerrainBounds` behandelt een lege vereiste
uitsnede nu als gedekt; de bestaande cache blijft behouden. Bij zichtbaar gras
blijft de volledige dekkingscontrole gelden, inclusief bestaande invalidatie
voor schaal, assets en wereldgegevens.

De nieuwe unit- én productiebuild-browsertest reproduceren de fout op de oude
code (R8, camera x=1350, zoom 1). Na herstel slagen de bovengenoemde suites,
TypeScript, gerichte ESLint (geen fouten/waarschuwingen) en schone productiebuild.
Aanvullende browserregressies doorlopen dorp → rand → bos → dorp op R8/R35/R62,
met zoomwissels en herhaalde kleine panbewegingen: geen pageerrors, geen nieuwe
canvasbuffers bij de herhaalde padding-only bewegingen, nul idle-renders en
exact dezelfde opgeslagen objecten en paden. De screenshots
`2e-terrain-cache-return-r{8,35,62}.png` komen in het bestaande CI-artifact.
Geen schema-, asset-, rechten- of migratiewijziging.
