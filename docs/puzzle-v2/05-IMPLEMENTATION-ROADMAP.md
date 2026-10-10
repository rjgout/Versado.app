# Legpuzzel 2.0 — roadmap

## Fase 2 — solo

1. Pure geometry/engine, generatorversie en tests.
2. Additief schema, contentimport, v2 session-API, legacy-tokencompatibiliteit.
3. Canvas world met begrensde werktafel, DOM-HUD, keyboard, touch/muis/zoom/pan.
4. Difficulty-policy, hints, autosave, huidige vraag en `completeJigsaw`.
5. Kompas/i18n/focus/safe-area/layoutaudit.

Go/no-go: 96 stukken op referentietelefoon, 48 desktop, huidige vraag/reeks groen, 320px/200%-tekst en screenreaderpad goed. Fase 2 heeft al version/action/participant interfaces, maar geen multiplayer-UI.

## Fase 3 — multiplayer

1. Leden/vriendenuitnodigingen/open acties, max. vier.
2. Server-authoritative commits, locks, snapshots/reconnect en Socket-handler; test twee instances+Redis.
3. Samen-scherm met persoonlijke bak/hints/viewport en bijdrage-adapter naar centrale reeks.
4. Matchdomain op dezelfde variant/session engine; live/async verschillen alleen in regels.

Go/no-go: lock/race/reconnect groen, geen passieve reeksactiviteit, serverherstart verliest geen commit.

## Fase 4 — afronding

Records/vriendenranglijst/privacyfilter; competitie-audit; migratie/dark-read; 300-stuksprofielen; accessibility/reduced-motion/sound/Kompas; monitoring en featureflag-rollbacks. Productie pas bij schema/migratie/client-sync, volledige matrix en geoefende rollback.
