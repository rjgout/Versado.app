# Legpuzzel 2.0 — data- en migratieplan

Geen migratie is uitgevoerd in fase 1.

**VOORGESTELD:** `PuzzleDefinition` (bestaande contentkey/url/story/aspect, geometryVersion, seed, config JSON, hash); `PuzzleVariant` (definition, pieceCount, difficulty, rulesVersion, unieke combinatie); `PuzzleSession` (variant, SOLO/COOP, status, snapshot JSON, version, eigenaar, timestamps); `PuzzleSessionParticipant`; `PuzzleInvite`; append-only `PuzzleAction`; TTL `PuzzleLock`; `PuzzleMatch` + `PuzzleMatchParticipant`; `PuzzlePersonalRecord`.

Geometrie/stukken/viewport zijn afleidbaar en niet per rij opgeslagen. Snapshot wordt bij commit en periodiek geschreven; actionlog is audit/recovery. Nodige indices: actieve sessie per deelnemer/status, invite per ontvanger/status, action `(session,version)`, record `(variant,time)`, matchdeelnemer/status. Ranglijst is query op records plus geaccepteerde `Friendship`, geen duplicatietabel.

De 216 bestaande urls krijgen deterministische definition-keys (url+story), zonder manifest, beelden, vragen of vertalingen te wijzigen. Bewaar url én hash. Oude JWT's zijn niet te converteren naar durable state; ze bevatten alleen indices en verlopen na 24 uur. Houd fase-2 legacy `resume/answer` gedurende TTL beschikbaar; nieuwe starts gaan naar v2. Historische `StreakActivity` met `jigsaw:*` blijft onaangeraakt/geldig.

Volgorde: additive schema + definition/variant-backfill; `prisma validate`, generate, tsc; contentpariteit dark-read; adminfeatureflag; gefaseerde activering; pas na token-TTL de oude startflow in afzonderlijke release verwijderen. Verplichte velden krijgen dezelfde-migratie-backfill zonder oud gedrag te triggeren. Rollback: flag terug, v2-data read-only bewaren, geen content/streaks verwijderen. **RISICO:** er bestaat nu geen server-side gedeeltelijke voortgang buiten een live sessionStorage-token.
