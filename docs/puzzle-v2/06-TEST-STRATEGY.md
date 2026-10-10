# Legpuzzel 2.0 — teststrategie

Automatiseer met bestaande `node:test`: deterministische geometry/seed/version,
complementen, rand/hoek, beginopstelling zonder overlap, eindige werktafel,
camera-fit/clamping, rotatie, group merge met stabiel anker, verplaatsen via
ieder groepslid, verplaatsen na pan/zoom, foute en geldige snap, completion en
snapshot roundtrip. Database-integratie test auth, idempotency,
optimistic-version conflict, autosave, vraag/reeks, persoonlijke tijdzonedag,
records en Friendship-filter.

De fase-2-correctie voegt specifiek toe: v1/v2-geometrycompatibiliteit,
klassieke tab/hals/kop-paden, comfortabele snap met exacte uitlijning,
cataloguspaginering over 216 afbeeldingen, vraag na de afzonderlijke
voltooiingsstap en een herhaalde antwoordclaim die de sessie wel afsluit maar
geen tweede reeksactiviteit schrijft.

Sockettests gebruiken twee clients en twee serverprocessen met Redis: gelijktijdige commits, TTL/disconnect, reconnectsnapshot, async hervatting, limiet vier, uitnodiging, niet-lid en dubbele actionId. Competitietests: gelijke variant/hash, uitsluitend servertijd, achtergrond/verlies, vraag, forfeit en tie-break. Migratietests: bestaand manifest, historische `StreakActivity`, legacy-tokenafronding.

De flowherstelronde gebruikt `npm run test:puzzle:integration`: een eigen
tijdelijke PostgreSQL-container, alle migraties, echte services en opruimen na
afloop. Een ontbrekende V2-tabel laat de test falen. De runner gebruikt geen
externe DATABASE_URL en wijzigt geen productiegegevens.

Met `-- --browser` start de runner daarnaast `server.ts` en Chromium/Playwright:
alle 216 thumbnails over negen pagina's, zoeken met paginering, starten vanuit
zoekresultaten, wisselen/hervatten, de laatste echte muisverbinding, volledige
afbeelding zonder canvas, Verder, herladen in beide voltooiingsstappen,
antwoord/resultaat, verloren responses, historische vraag opnieuw beantwoorden,
nieuwe poging, vervolgnavigatie en bestaande API-toegangsvoorwaarden. Ook
390px/nl en 320px/de met 200% tekst worden gecontroleerd op horizontale overflow.
Playwright wordt extern geïnstalleerd; stel PLAYWRIGHT_MODULE in naar zijn
modulepad en installeer Chromium. De nieuwe GitHub Actions-workflow voert
dezelfde runner uit en bewaart de browserscreenshots.

Voor overige E2E blijven toetsenbord, touch/pinch, wheel/trackpad, pan/zoom/reset,
focus, 768px, dark/reduced motion aanvullende controles. Draai ook `test:focus`,
`test:learning`, `test:live-data`, `test:kompas` en bestaande jigsawtests.

Handmatig op iOS Safari/Capacitor en Android WebView: pinch-vs-drag, notch/keyboard, background/resume, VoiceOver/TalkBack, latency en 96/150/300-stuksprofielen. Meet FPS, geheugen, commitlatency/payload en databasegroei vóór definitieve limieten.
