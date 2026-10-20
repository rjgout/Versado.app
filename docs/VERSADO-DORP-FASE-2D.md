# Versado Dorp — fase 2D: UX en wereldkaart

Basis: `origin/main` ef8fe005 (PR #151). Geen nieuwe engine, assets, schema of migratie.

## Implementatie

- Profiel → **Mijn dorp**. De ingang gebruikt dezelfde `/api/dorp`-guard als
  pagina en mutaties: technische flag eerst, daarna admin of
  `dorpVisibleToUsers`. Geen tweede instelling. Standaard publiek uit blijft
  ongewijzigd; twee accounts kunnen na expliciet inschakelen samen testen.
- Nieuwe lokale proefwerelden en serverdorpen beginnen zonder geplaatste
  objecten of startpaden. De vaste zand-/proefondergrond is uit de renderer
  verwijderd. Oude v2/v3-ID's, levels, objectposities en paden blijven behouden.
  Oude paden hebben geen herkomstlabel: automatisch wissen zou zelfgetekende
  paden kunnen verwijderen. Daarom blijven ook eventuele oude proefpaden staan;
  de eigenaar kan ze bewust met het bestaande gratis padgereedschap wissen.
- **Paden** is een prominente inventarisknop, met bestaande tik-/sleepborstel,
  wissen en automatische vierzijdige verbindingen. Geen inventarislimiet of XP.
- Tik op inventarisobject: meteen plaatsingspreview, inventaris sluit. Sleep
  vervolgens met één vinger op de kaart, zonder eerst te plaatsen. Pointercapture
  ligt op de blijvende canvas; geldige release plaatst, ongeldige nieuwe plaatsing
  blijft preview, ongeldige bestaande verplaatsing herstelt het oorspronkelijke
  object. Twee vingers blijven camerabediening. Expliciete plaatsknop blijft als
  alternatief. Collisions, footprints, servereigendom en opslag blijven leidend.
- Vier bestaande cameraopties blijven: Detail, Normaal, Mijn kaart, Wereld.
  Mobiel een compact 2×2-raster zonder afgebroken woorden. Wereld past meer bos
  rondom de echte kaart; de lege potentiële R62-ovaal vervalt. De groei blijft
  exact R8–R62 op basis van de bestaande 239 canonieke BOM-identiteiten.
- Een doorlopende bosgrond vult de viewport achter transparante randassets.
  Wereldvaste, schermbegrensde LOD vult het buitenbos met bestaande sprites.
  De rasterstap blijft wereldvast binnen elke LOD-band, met minimaal 76
  schermpixels afstand. Overlappende dichte bosassets gebruiken de bestaande
  spritecache; geen volledige boswereld in geheugen
  of duizenden extra bomen. Bestaande terreinbuffer, randassets, camera,
  frameplanner en actuele paden/objecten worden hergebruikt.

## Vrienden-MVP en privacy

`GET /api/dorp?markers=friends` retourneert maximaal **acht** geaccepteerde,
expliciet delende vrienden met een bestaand persoonlijk dorp. Eén gerichte
relationele query; alleen `ownerId` en publieke vriendnaam, geen inventaris,
groepsgegevens, echte locatie of volledige dorpssnapshots. Deterministische
niet-geografische ring in het bos; selectie op stabiele ID-volgorde, geen
clustering of complete vriendenatlas. Mobiel compacte huisiconen met initialen en
vriendnaam als toegankelijk label; desktop ook de naam. Aanraakdoelen minimaal 44px.

Markers zijn native links naar de bestaande read-only bezoekroute, met dezelfde
zoomopties. Die route controleert opnieuw de actuele vriendschap, privacy en
featuretoegang. Bezoekers krijgen geen vrienden-van-vriendenlaag.

Serverresponses blijven `no-store, private`, `Vary: Cookie`. Markerkeys bevatten
het viewer-ID; `discardOnRevalidate` wist vóór hercontrole en negeert oude
responses. Bestaande privacy-/ontvriend-/beheer-events, offline/disconnect en
centrale zichtbare 15-secondenhercontrole gelden ook voor markers. Geen tweede
globale listener of timer. Bij een gemist signaal blijft intrekking afhankelijk
van netwerk en de volgende hercontrole; dit is hetzelfde contract als #151.

Kompas-profieluitleg is gericht bijgewerkt in alle vijf talen. Geen nieuwe tour.

## Technische verificatie

- TypeScript, Prisma validate/generate en schone productiebuild geslaagd.
- Dorp/focus/shell: **51** tests; live-data: **54** tests geslaagd.
- Echte geïsoleerde PostgreSQL: **17** Dorp-/audit-/markertests geslaagd,
  inclusief 401/404, noodstop, maximaal acht veilige markers, privacy intrekken,
  cadeaus, concurrency, vertrek, krimp en canonieke groei.
- Regressies: sociaal **33**, profiel **13**, divisies **5**, Genees/Snelle
  Zendeling **58** geslaagd. Geen geïsoleerde skips in deze suites.
- Kompas zonder DB: **60** geslaagd, **9** expliciete DB-skips.
  Het bestaande geïsoleerde CI-draaiboek voert nu ook `test:kompas` met een
  eigen database uit, zodat deze negen checks daar daadwerkelijk worden uitgevoerd.
- ESLint: **0 fouten**, **169 bestaande waarschuwingen**; gerichte dorplint
  zonder waarschuwingen. i18n: nieuwe teksten compleet in vijf talen;
  bestaande achterstand blijft 418 sleutels per niet-Nederlandse taal.
- Productiebuild + Chromium: **26 browserflows**. 320×844, 390×844,
  844×390 landscape en 1280×900, licht/donker, 320px ook op 200% tekst.
  Safe-area-insets in landscape; R8, R35 en R62; tekenen/wissen,
  touch-preview vóór plaatsing, bewaren/herladen van een oude proefwereld,
  bestaande objectdrag/collision, profielingang, echte groepsdorpen, bezoek en
  beheerrechten. Wereldmarkers en bezoek worden in gelijktijdige sessies
  ingetrokken, ook bij een vertraagde oude response, ontvrienden en offline.
  Een marker opent met Enter het bestaande read-only dorp, daarna Detail-zoom.
- Extra LOD-verificatie: vaste rasterstappen binnen zoombanden en maximaal
  400 extra bosposities voor de geteste viewports; de browser begrenst de
  werkelijk gemeten hoofdcanvas-sprite/blitcalls tot minder dan 1.000 per frame.
  Geen FPS-garantie voor fysieke toestellen.
- Behoudproef bestaande migratie: 147 oorspronkelijke tabellen, 418 constraints
  en 403 indexen plus oorspronkelijke rijwaarden behouden; foutrollback en
  herhaalde deploy geslaagd. Deze PR voegt zelf **geen migratie** toe.
- Bij 200% tekst vond de browser een te hoog selectiepaneel. Dat is begrensd
  en intern scrollbaar gemaakt; een geometrieassertie bewaakt de viewport.

CI controleert de definitieve gepushte head; de actuele status staat bij de PR.
Screenshots en JSON-bewijs komen uit artifact **versado-dorp-browser** van de
bestaande content-access-workflow, niet uit Git. Onder meer
`inventory-touch-preview.png`, `forest-r35-*`, `forest-r62-*`,
`friend-world-390.png`, `friend-marker-visit-detail.png`, `privacy-revoked.png`
en de bestaande persoonlijke/groeps-/bezoekscreenshots. De hoofdcanvas-tellers
staan per viewport in `results.json`.

## Uitrol en rollback

Alleen ontwikkel-PR; geen productie- of NAS-handeling. De eigenaar kiest later
zelf de image-uitrol. Geen migratie, seed, reset of automatische inschakeling.
Behoud database en volumes; terug naar de vorige image is een approllback,
geen databaseherstel. Nieuwe paden/objecten gebruiken hetzelfde opslagcontract.
De technische flag kan de functie geheel uitschakelen; de bestaande publieke
schakelaar laat beheerders vooraf testen. Proefrechten blijven `ALPHA_PILOT_V1`;
geen definitieve beloningen of economie ingevoerd.

Niet getest op fysieke iOS-/Android-toestellen. De wereldlaag is een begrensde
vriendenselectie, geen geografische kaart. Bestaande ambigue proefpaden worden
bewust niet automatisch gewist. Geen wijziging van groepslimieten, XP-cadeaus,
reeksen, divisies of leesvoortgang.
