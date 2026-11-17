# Vrienden als vierde bestemming (Capacitor)

Eerste app-first oplevering ([besluit](ARCHITECTUURBESLUIT-APP-FIRST.md), [plan](APP-FIRST-IMPLEMENTATIEPLAN.md)).
De gedeelde React-interface (`FriendsClient`, `FriendProfileClient`) draait lokaal in de app; er is geen tweede
vriendensysteem, geen nieuwe backendlaag en geen verruiming van autorisatie.

## Wat er is

- **Bestemming**: `friends` in `nativePrimaryNav` (`src/lib/native/shell.ts`), alleen zichtbaar als de backend
  `friends-v1` meldt én `games-v1` en `realtime-ticket-v1` beschikbaar zijn (de vriendenroutes lopen over dezelfde
  spelbrug, identiteit en socket). iOS 26+: de bestaande Liquid Glass-`UITabBar` met nu vier items; oudere iOS en
  Android: de gedeelde `BottomNav`. Oudere backends zonder `friends-v1` tonen de tab niet.
- **Routes**: `/friends` en `/friends/[userId]` (`nativeRoute`, expliciet, geen query's).
- **Scherm**: `NativeFriendsView` levert alleen de native context (content-scope, bevestigingsdialogen); alle
  gegevens lopen via `applicationFetch` → `nativeGameFetch` → `dispatchNativeGame` → de bestaande webhandlers onder
  `withNativeGameIdentity`.
- **Routes in de spelbrug** (`gamesRoutes.ts`, TS-/Swift-/Java-policy gegenereerd met `games-policy.mjs`):
  `friends/request` (POST), `friends/[id]` (DELETE), `friends/profiles/[userId]` (GET), `friend-streaks` (GET, POST),
  `friend-streaks/[id]` (POST), `freezes/gift` (POST); bestaand: `friends`, `friends/[id]/accept|decline`, `nudges`,
  `users/search`, `users/avatars`.
- **Privacy**: onveranderd server-side (`friendProfiles.ts`: alleen ACCEPTED, `shareAchievements`,
  `sharePuzzleRecords`; 404 zonder lek). Bewezen met `tests/native-friends.integration.test.mjs` (geïsoleerde
  database), inclusief niet-deelnemer, derde partij, dubbele/omgekeerde verzoeken, vreemde cookie/origin.
- **Bewust nog niet lokaal** (verborgen of niet-klikbaar in de app): uitnodigingslink (`FriendInviteCard`), groepen
  (`GroupsEntryCard`, groepslinks in het vriendenprofiel), dorpvoorbeeld. Dit zijn fase C-onderdelen
  ([audit](NATIVE-VRIENDEN-AUDIT.md)); `/competition` en `/activity` volgen in fase B. Vriendverzoeken accepteren/afwijzen
  loopt via Vandaag en `/acties`, zoals voorheen.

## De 401 bij accepteren (diagnose)

Het native toegangstoken leeft 300 s (`expiresIn`). `NativeSessionClient` hield het in het geheugen zonder
vervaltijd; alleen een ontbrekend token leidde tot verversen. Een schrijfactie (`actionOnce`, en elke niet-GET via
de spelbrug) wordt na een 401 bewust nooit herhaald. Na meer dan vijf minuten stilte ging een eerste schrijfactie dus
met een verlopen token de deur uit en de server antwoordt voor elke verificatiefout gelijk (`session_expired`). Dit is
gereproduceerd in `tests/native-token-lifetime.test.ts` (faalt zonder fix, slaagt met fix).

Fix (alleen in de client): vóór het verzenden wordt het token ververst als het ≥ 240 s oud is (oudste van muur- en
monotone klok). De schrijfactie zelf wordt nog steeds precies één keer verzonden; een 401 daarop blijft een zichtbare
fout; bij een netwerkfout wordt een nog geldig token gewoon gebruikt. Sessierotatie en single-flight blijven de
bestaande `refresh()`.

## Open / bewust niet in deze PR

- Rate limits op `friends/request` en `users/search`, kruislingse Friendship-race (#287) en `#`/`@` in de testproxy (#288):
  afzonderlijke PR's, niet meegemerged. Tot #288 op de NAS draait kan zoeken op tag/e-mail in de TestFlight-testroute
  falen; de code zelf is correct.
- Prisma-transactietimeout (5 s) bij vrienden-/annotatieschrijfacties: apart punt in het implementatieplan.
- Toestelacceptatie (VoiceOver/TalkBack, 200% tekst op 320 pt, tabbalk met vier items op kleine iPhones, realtime
  aanwezigheid met twee toestellen) is niet uitgevoerd; Chromium en simulator bewijzen geen toestelpariteit.
