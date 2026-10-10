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

E2E zodra Playwright is afgesproken: muis, toetsenbord, touch/pinch, wheel/trackpad, pan/zoom/reset, scroll, focus, 320/390/768/1200, 200% tekst, nl/de, dark/reduced motion. Draai ook `test:focus`, `test:learning`, `test:live-data`, `test:kompas` en bestaande jigsawtests.

Handmatig op iOS Safari/Capacitor en Android WebView: pinch-vs-drag, notch/keyboard, background/resume, VoiceOver/TalkBack, latency en 96/150/300-stuksprofielen. Meet FPS, geheugen, commitlatency/payload en databasegroei vóór definitieve limieten.
