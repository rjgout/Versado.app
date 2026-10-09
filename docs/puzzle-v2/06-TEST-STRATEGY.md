# Legpuzzel 2.0 — teststrategie

Automatiseer met bestaande `node:test`: deterministische geometry/seed/version, complementen, rand/hoek, overlap, rotatie, group merge, foute snap, completion en snapshot roundtrip. Database-integratie test auth, idempotency, optimistic-version conflict, autosave, vraag/reeks, persoonlijke tijdzonedag, records en Friendship-filter.

Sockettests gebruiken twee clients en twee serverprocessen met Redis: gelijktijdige commits, TTL/disconnect, reconnectsnapshot, async hervatting, limiet vier, uitnodiging, niet-lid en dubbele actionId. Competitietests: gelijke variant/hash, uitsluitend servertijd, achtergrond/verlies, vraag, forfeit en tie-break. Migratietests: bestaand manifest, historische `StreakActivity`, legacy-tokenafronding.

E2E zodra Playwright is afgesproken: muis, toetsenbord, touch/pinch, wheel/trackpad, pan/zoom/reset, scroll, focus, 320/390/768/1200, 200% tekst, nl/de, dark/reduced motion. Draai ook `test:focus`, `test:learning`, `test:live-data`, `test:kompas` en bestaande jigsawtests.

Handmatig op iOS Safari/Capacitor en Android WebView: pinch-vs-drag, notch/keyboard, background/resume, VoiceOver/TalkBack, latency en 96/150/300-stuksprofielen. Meet FPS, geheugen, commitlatency/payload en databasegroei vóór definitieve limieten.
