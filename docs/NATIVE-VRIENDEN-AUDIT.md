# Versado Mobile — Vrienden: architectuur- en uitvoeringsaudit

Uitsluitend audit; er is niets geïmplementeerd. Basis: `develop` op `1539e4b5` (na #284 en #285).
Zekerheidslabels: **[B]** bevestigd door broncode (pad genoemd), **[T]** bevestigd door een uitgevoerde test of meting,
**[N]** nog niet geverifieerd, **[A]** aanbevolen ontwerpkeuze.

## 1. Managementsamenvatting

1. **Veel is al native, alleen niet onder een eigen naam.** Het native Spelen-werk (#283) heeft een deel van het sociale
   oppervlak al ontsloten via de `games/`-namespace: vriendenlijst, recente vrienden, verzoek accepteren/afwijzen, seintjes,
   groepsuitnodigingen, uitdagingen, gebruikers zoeken/avatars, open acties en reeksviering/-voortzetting
   (`src/lib/native/gamesRoutes.ts`, `gamesHandlers.server.ts`). Ook staat het vriendenverzoek-antwoord al in Vandaag
   (`today-actions/friend-response`) en bevatten de profielinstellingen de privacyvelden (`profileContract.ts`). **[B]**
2. **Het ontbrekende deel is groot maar regelmatig:** verzoek sturen, vriend verwijderen, vriendenprofiel, uitnodigingslinks,
   vriendenreeksen, groepen (±15 routes), competitie, activiteitenfeed met reacties, notificatie-inbox. Geen enkele van de
   ~20 sociale pagina's heeft een native route (`docs/NATIVE-FEATURE-PARITY.md`: allemaal *ontbreekt*; `nativeRoute()` kent geen
   enkele sociale route). **[B]**
3. **De architectuur hoeft niet nieuw.** De vier bestemmingen staan al in `PRIMARY_NAV`; `friends` ontbreekt alleen in
   `nativePrimaryNav(features)`. De losse UIKit-`UITabBar` ondersteunt vier items (`NativeTabBarPolicy`, symbool `person.2`);
   de CI-simulator toonde al "Vandaag, Leren, Spelen, Vrienden" in Liquid Glass. **[B][T]**
4. **De sociale clients zijn bijna platformneutraal.** Ze gebruiken `useLiveQuery`/`liveMutation` en `getSocket()`, die de
   `ApplicationRuntime` al abstraheert. Aanpassen is mechanisch: 6 bestanden gebruiken `next/link`, 3 `useRouter`, 6 een ruwe
   `fetch(`. **[B]**
5. **Er is een bevestigde beperking in de zojuist gemerge testproxy die Vrienden zou breken:** zoeken op tag (`Jan#83`) en op
   e-mail (`@`) wordt door de test-API geweigerd, omdat `%23` en `%40` niet zijn toegestaan. Dit geldt nu al voor de
   vriendenkiezer in Spelen. Gemeten met de gegenereerde regels. **[T]** Het is een omissie in mijn eigen #285; zie §7.
6. **Belangrijkste risico's:** geen rate limiting op `friends/request` en `users/search` (spam- en enumeratiepad); Friendship-
   unieke sleutel alleen per richting (kruiselings dubbele rij mogelijk); uitnodigingslinks vóór inloggen vragen universal
   links die nog als blokkade open staan; ontbrekende testdekking op de kern van de vriendschapsservices (§9).
7. **Advies:** één voorbereidende PR (0) voor het gedeelde native sociale contract en de proxy, daarna A → B → C. Geen
   tweede vriendensysteem: dezelfde handlers, dezelfde services, dezelfde tabellen.

## 2. Functionaliteitsmatrix (web = referentie)

Legenda mobiele status: **N-klaar** = al via een native route bereikbaar, **deels**, **ontbreekt**.

### Vrienden
| Functie | Web UI | API | Service / rechten | Tests | Mobiel |
| --- | --- | --- | --- | --- | --- |
| Zoeken (tag, e-mail, handle) | `FriendsClient` | `GET /api/users/search?q` | `handle.ts`; e-mail alleen bij `searchableByEmail` | geen routetest | N-klaar via `games/users/search` (maar proxy weigert `#`, `@`) |
| Verzoek sturen | `FriendsClient`, `GroupDetailClient` | `POST /api/friends/request` | direct in route; `notifyFriendRequest`, `friends_changed` | **0** | **ontbreekt** |
| Accepteren / afwijzen | `FriendsClient`, Vandaag | `POST /api/friends/[id]/accept|decline` | `social/friendRequests.ts` | **0** | N-klaar (`games/…` + Vandaag) |
| Annuleren / verwijderen | `FriendsClient` | `DELETE /api/friends/[id]` | route; beëindigt vriendenreeksen | **0** | **ontbreekt** |
| Lijst, inkomend/uitgaand | `FriendsClient` | `GET /api/friends` | `presence.ts`, `social/nudges` | 0 | N-klaar (`games/friends`) |
| Recente vrienden | spelkiezers | `GET /api/friends/recent` | – | – | N-klaar |
| Uitnodigen via link | `FriendsClient`, `/uitnodiging/[code]` | `GET/POST /api/friends/invite`, `GET/POST /api/invite/[code]` (GET zonder inlog) | `friendInvite.ts` | **0** | **ontbreekt** |
| Vriendenprofiel | `FriendProfileClient` | `GET /api/friends/profiles/[userId]` | `friendProfiles.ts`: alleen ACCEPTED, `shareAchievements`, `sharePuzzleRecords` | `friend-profiles.integration` (3) | **ontbreekt** |
| Online/activiteit | `FriendsClient` + Socket.IO `friend_status_update`, `friend_statuses_request` | socket | `presence.ts` (in-memory, `shareOnlineStatus`, `shareCurrentActivity`, incognito) | 0 | deels: Vandaag heeft `social.online` |
| Privacy-instellingen | profiel | `profile` | `User.*` | native-profile tests | N-klaar (`profile-settings-v1`) |

### Sociale interacties
| Functie | API | Service | Tests | Mobiel |
| --- | --- | --- | --- | --- |
| Vriendenreeksen (max 5) | `GET/POST /api/friend-streaks`, `POST /[id]` | `social/friendStreaks.ts`, `rules.ts` | `social.integration` | **ontbreekt** (Vandaag toont alleen tellers) |
| Seintjes (1 per 6 u, geen XP) | `POST /api/nudges` | `social/nudges.ts` | `social.integration` | N-klaar |
| Bevriezers schenken | via groep/vriendenreeks (`groupFreeze`, `FreezeTransaction`) | `social/groupFreeze.ts` | `social.integration` | **ontbreekt** |
| Uitdagingen | `GET/POST /api/challenges`, `…/accept|decline|cancel|forfeit` | route + `challenges.ts` | – | N-klaar (`/challenges` native pagina) |
| Realtime | `friends_changed`, `streak_changed`, `notifications_changed`, `puzzle_invites_changed` → data-events | `realtime.ts`, `scopes.ts` | `live-data*` | N-klaar (zelfde socket) |

### Competitie en activiteit
| Functie | API | Service | Tests | Mobiel |
| --- | --- | --- | --- | --- |
| Divisie/wekelijkse ranglijst | `GET /api/leaderboard?scope=league` | `leagues.ts`, `competitionXp.ts` | `leagues`, `divisions` | **ontbreekt** |
| Vrienden-/nationale ranglijst | `?scope=friends|national` | idem | – | **ontbreekt** |
| Activiteitenfeed | `GET /api/activity-feed` | `activityFeedVisibility.ts` (ACCEPTED of eigen) | **0** op visibility | **ontbreekt** |
| Reacties + tellingen | `POST …/reaction`, `GET …/reactions` | `activityReaction*` | `activity-reactions` (2) | **ontbreekt** |
| Notificatie-inbox | `GET/DELETE /api/notifications` | – | indirect | **ontbreekt** (push is aparte track) |

### Groepen
`GET/POST /api/groups`, `GET/PATCH /api/groups/[id]`, `…/invites`, `…/invites/[id]` (DELETE), `…/members/[id]`, `…/requests/[id]`,
`…/leave`, `…/freeze`, `…/link`, `POST /api/group-links/[token]`, `POST /api/group-invites/[id]` (alleen deze laatste is al native),
`GET /api/groups/leaderboard`. Services in `src/lib/social/` (`groups`, `joinLinks`, `groupViews`, `groupStreak`, `groupFreeze`).
Limieten: 10 groepen per persoon, 500 leden, 7 dagen wachttijd, 5 toegangsverzoeken/uur (`social/rules.ts`). Tests: `social.integration` (18),
`social-links.integration` (11), `social-rules` (5). **[B][T-bestaand]**

Niet in de opdracht genoemd maar aanwezig: Dorp (`/dorp/**`), vriendenreeks-viering, `streak`-kalender, `open-actions`, lijstvolgorde
(`list-order`), e-mailuitschrijving per meldingscategorie. Er is **geen blokkeerfunctie** in schema of API **[B]**: "blokkeerregels"
bestaan dus niet en moeten een expliciet productbesluit worden.

## 3. Verschillen web ↔ native (bevestigd)

- Web praat via cookie-sessie en `/api/*`; native alleen Bearer op `/api/v1/native/*` via de native transportlaag (Swift/Java
  allowlist) **[B]** `src/lib/native/access.ts`, `NativeAccessTransport.swift`.
- `nativeRoute()` weigert `%`, `?` (behalve spel- en profielroutes) en kent geen sociale routes **[B]** `navigation.ts`.
- Sociale clients gebruiken `next/link` (6×), `useRouter` (3×), ruwe `fetch(` (6×) **[B]**; `applicationFetch` en `getSocket()` zijn
  de reeds bestaande platformpoorten **[B]** `data/applicationRuntime.ts`, `socketClient.ts`.
- PATCH/PUT bestaan in de native route-handler alleen voor `games` (`src/app/api/v1/native/[...path]/route.ts`); DELETE is algemeen.

## 4. Architectuuradvies

**4.1 Vierde bestemming.** Voeg `friends` toe in `nativePrimaryNav(features)` (`src/lib/native/shell.ts`) achter één nieuwe capability
(bijv. `social-v1`) plus `realtime-ticket-v1`; `PRIMARY_NAV`, `SOCIAL_TABS`, `activeDestination` en `NativeTabBarSync` blijven ongewijzigd
(de balk accepteert 1–4 items; titels uit `nav.friends`). Geen tweede navigatiebron. **[A]**
**4.2 Hergebruik.** Alle sociale clients (`FriendsClient`, `FriendProfileClient`, `LeaderboardClient`, `ActivityFeedClient`, de zeven
`social/*`-componenten) blijven gedeeld. Aanpassingen: `next/link` → `AppLink`, `useRouter` → `useAppNavigation`, `fetch` → `applicationFetch`;
dit patroon is al toegepast in 37 componenten. **[B]** De pagina's zelf zijn dun (`page.tsx` geeft alleen ids door), dus een
serverprojectie zoals bij Spelen (`GAME_PAGE_LOADERS`) is **niet** nodig: een native view mount direct de gedeelde client. **[A]**
**4.3 Native routes.** Voeg per scherm een patroon toe aan `nativeRoute()` (`/friends`, `/friends/[id]`, `/competition`, `/activity`,
`/groups`, `/groups/new`, `/groups/[id]`, `/groups/[id]/settings`, `/groups/leaderboard`, `/uitnodiging/[code]`, `/uitnodiging/groep/[token]`),
met capability-gating zoals `nativeGameOwnsRoute`. Query's (`/competition?scope=`, `/activity`) vragen dezelfde expliciete, per route
gevalideerde queryafhandeling als `gamePageRoute`; geen algemene versoepeling van de `%?#`-regel. **[A]**
**4.4 Terugnavigatie.** `NativeNavigator` (hashhistorie met index) en `useSetBackTarget` dekken terug; de gedeelde terugbalk volgt de
herkomst. Open punt: in Vrienden bestaan eigen sub-tabs (`SOCIAL_TABS`) — die moeten `replace` gebruiken zoals de CFM-stappen, zodat
terug niet door tabs bladert. **[A][N]**
**4.5 Liquid Glass met vier items.** Gemeten in CI-simulator iOS 26.5: vier items, selectiepil, hoogte 83 pt **[T]**. Kleinere iPhones en
Dynamic Type: `UITabBar` schaalt niet met Dynamic Type; vier titels (max 32 tekens) vragen controle in alle vijf talen op 320 pt **[N]**.
**4.6 iOS 26+ ↔ oudere iOS ↔ Android.** iOS 26+: UIKit-balk, React-balk als onzichtbare ruimtehouder. iOS 15–25 en Android: dezelfde
`BottomNav` met vier items (grid-kolommen zijn al `1…4`) **[B]** `src/components/BottomNav.tsx`. Android-specifiek: Material 3 uit de
designstrategie; er is geen Android-equivalent van de native balk nodig.

## 5. Sociale API's en beveiliging

Alle gecontroleerde sociale routes beginnen met `getCurrentUser()` (401) **[B]**; invoer is meestal met zod gevalideerd
(`friends/request`, `nudges`, `friend-streaks`, `groups/*`), niet bij `activity-feed`, `friends/[id]` (id uit pad).
Rate limiting: **alleen bij toegangsverzoeken** (5/uur, `JOIN_REQUEST_HOURLY_LIMIT`) en in de login-/native-poorten; **niet** bij
`friends/request`, `users/search`, `invite/[code]` (GET zonder inlog), `activity-feed/*/reaction`. **[B]**

**Hergebruik via de bestaande identiteitsbrug.** Native Spelen draait de gewone webhandlers binnen `withNativeGameIdentity`
(`src/lib/games/requestIdentity.server.ts`): `getCurrentUser()` levert dan de Bearer-gebruiker, zonder cookies en met herverificatie
na elk antwoord (`dispatchNativeGame` in `games.server.ts`). Dit is de veilige route voor Vrienden: een statische tabel
(route-id → handler), geen `/api/*`-doorvoer, 16 KB body-limiet, geen redirects, alleen JSON. **[B][A]**

| Direct herbruikbaar (alleen route-id toevoegen) | Vereist een expliciete native adapter |
| --- | --- |
| `friends/request`, `friends/[id]` (DELETE), `friend-streaks`, `groups/*`, `group-links/[token]`, `leaderboard`, `activity-feed`, `…/reaction(s)`, `notifications`, `streak` | `invite/[code]` GET (publiek, zonder sessie: nieuw native contract mét rate limit en zonder gebruikersenumeratie), `friends/invite` (link bouwt met `APP_URL`/`getBaseUrl`, niet uit requestheaders), `friends/profiles/[userId]` (privacy blijft in `friendProfiles.ts`, maar output moet een native contract krijgen), alles waarvan de handler `req.url`/`Origin`/`cookies` leest |

**Beveiligingseisen (checklist voor elke PR).**
1. Bearer + `NativeSession`; geen cookies, geen sessie-emulatie, geen generieke proxy. Nieuwe namespace `social/*` naast `games/*`
   in dezelfde allowlist-lagen (TS, Swift, Java, nginx), niet in de `games/`-namespace blijven bijschrijven. **[A]**
2. Eigenaarschap/relatie in de bestaande services laten (`acceptedFriendship`, `visibleActivityItem`, groepsrol); de adapter voegt
   nooit zelf rechten toe. Nieuwe niet-geaccepteerde vrienden krijgen niets: `friendProfiles` retourneert `null` zonder ACCEPTED. **[B]**
3. Verborgen data lekt niet: `online`, `activity`, `sharesAchievements`, puzzelrecords komen alleen na server-side check
   (`presence.ts`, `friendProfiles.ts`); elk nieuw native contract krijgt een negatieve test per veld. **[A]**
4. Idempotentie: `friends/request` geeft `409` op een bestaande relatie, `nudges` begrenst per 6 u in de service, toetredingen lopen via
   `joinTx` met rijvergrendeling. **Kruislingse race:** `Friendship` is alleen `@@unique([senderId, receiverId])`; `findFirst` + `create`
   is niet atomair, dus A→B en B→A kunnen tegelijk bestaan **[B]** (`prisma/schema.prisma:2100`, `friends/request/route.ts`).
   Oplossing zonder migratie: één transactie met advisory lock op het geordende id-paar. **[A]**
5. Accountwissel en verlopen sessie: de data-laag is per account gescoped (`useNativeLiveQuery`, reset bij uitloggen, native tests
   `native-courses`, `live-data-migration`); elk sociaal onderwerp moet `contentScoped`/account-keyed zijn. **[B][N voor sociaal]**

## 6. Testproxy en distributie

**6.1 Wat Spelen brak (herhaling).** De proxylijst kende geen `games/*`; opgelost in #285 met een lijst afgeleid van de clienttabellen
(`render-test-api-proxy.mjs`). **[T]**
**6.2 Nieuw gevonden beperking in #285.** `QUERY_VALUE` staat alleen `%20`, `%2C` en niet-ASCII-bytes toe. `users/search?q=Jan%2383`
(tag) en `q=jan%40example.nl` (e-mail) worden dus geweigerd **[T]** (uitgevoerd tegen de gegenereerde regels). Voor Vrienden is
dat de hoofdzoekmethode. **Herstel in PR 0:** per parameter een encodingklasse in de routetabel (`q`: `%20 %23 %40 %2B` + niet-ASCII;
`ids`: `%2C`), niet globaal; `%25`, `%2E`, `%00`, `%5C`, `%2F` blijven geweigerd buiten `route=`.
**6.3 Automatische borging (voorstel) [A]:**
- **Eén routetabel per namespace** (`SOCIAL_API_ROUTES`: pad, methoden, queryvelden mét encodingklasse, scope-eigenschappen), zoals
  `GAME_API_ROUTES`. Daaruit worden gegenereerd: TS-allowlist, Swift-/Java-policy (bestaand mechanisme `scripts/native/games-policy.mjs`,
  met `updatePolicy`), nginx-regels en de server-dispatch (`Record<RouteId, Handler>` zodat een ontbrekende handler een compilefout geeft).
- **Drift-tests** (analoog aan `tests/native-test-api-games.test.ts`): elke rij × elke methode → voorbeeldverzoek komt door TS, Swift/Java
  (macOS-CI en JVM-test), nginx (regex + echte nginx in CI) en dispatch.
- **Volledigheidstest:** een statische scan van `/api/...`-literals in de sociale clientbestanden; elke literal moet op een tabelrij passen.
  Een nieuwe `fetch("/api/friends/…")` zonder rij laat CI falen: dit voorkomt een herhaling van Spelen zonder ongecontroleerd routes
  toe te staan.
- **Negatieve gegenereerde tests:** methode omdraaien, extra/dubbele queryparameter, `%25`, `%2E`, traversal, `//`, onbekende encodingklasse,
  verkeerde `Origin`, verkeerde `Host`, ontbrekende `Authorization` (401 vóór mutatie), CORS-preflight per route.
- **Preflight (`check-test-backend`):** per GET-rij een alleen lezende probe zonder sessie (verwacht 401 met JSON). Voor mutaties alleen in CI
  (Docker-integratie), omdat live mutatieprobes zelfs onbevoegd ongewenst zijn. **[N: of auth altijd vóór bodyverwerking komt voor elke route]**
**6.4 Distributie.** TestFlight vraagt na elke proxywijziging een proxy-image-uitrol door de eigenaar (`docs/NATIVE-TEST-API-SPELEN.md`),
maar geen nieuwe appbuild; nieuwe native schermen vragen wel een nieuwe iOS-build (lokale bundel). Universal links voor uitnodigingen:
`ios-entitlements`, `well-known-association` en `android-app-links` staan nog **open** in `native:store-readiness`. **[T]**

## 7. Hergebruik van de interface

| Component | Gedeeld bruikbaar | Aanpassing |
| --- | --- | --- |
| `FriendsClient` (499 r.) | ja | 1 `fetch`, 1 `next/link`; `getSocket()` is al platformneutraal; `document`-luisteraars (mousedown/keydown) voor een menu: toegankelijkheid op touch/TalkBack toetsen |
| `FriendProfileClient` (149) | ja | `next/link` |
| `LeaderboardClient` (315) | ja | geen aanpassing gevonden |
| `ActivityFeedClient` (289) | ja | 1 `fetch`, `document`-luisteraar |
| `social/*` (±1000 r.) | ja | `GroupDetailClient`: 2 `fetch`, `useRouter`, `next/link`; `NewGroupClient`: `useRouter`; `GroupSettingsClient`, `GroupLeaderboardClient`: `fetch` |
| Vandaag-sociaal (`NativeTodayView`) | al native | uitbreiden met doorverwijzing naar `/friends` zodra de route bestaat |

Mobiele bruikbaarheid (kleine iPhone, Dynamic Type, VoiceOver, TalkBack) is **niet geverifieerd [N]**; de layout-harde regels
(`docs/LAYOUT.md`, `scripts/layout-audit`) gelden en moeten per nieuwe native route in de audit worden opgenomen.

## 8. Gefaseerd uitvoeringsplan (afzonderlijk reviewbare PR's)

### PR 0 — Gedeeld sociaal native contract (voorbereiding; aanbevolen als eerste)
- **Scope:** namespace `social/*`, routetabel + generatoren (TS, Swift, Java, nginx, dispatch), PATCH/PUT/DELETE voor `social`, encodingklassen
  (fix voor `#`/`@`), volledigheids- en driftest, `check-test-backend`-probe, capability `social-v1`, route-gating. Geen UI.
- **Hergebruik:** `withNativeGameIdentity`, `games-policy.mjs`-mechanisme, `render-test-api-proxy.mjs`, `gamePageRoute`-stijl validatie.
- **Tests:** alles uit §6.3; Swift-policytest op macOS, Java-test op Linux, nginx-integratie in Docker.
- **Toestel:** geen. **Complexiteit:** M-L. **Risico:** generatoren raken release-gevoelige policybestanden; extra review, geen guard versoepelen.

### Fase A — Vrienden
- **Scope:** vierde tab, vriendenlijst, zoeken, verzoeken (sturen/accepteren/afwijzen/annuleren), verwijderen, privacyveilig profiel,
  deep link `/friends`, `/friends/[id]`.
- **Hergebruik:** `FriendsClient`, `FriendProfileClient`; **nieuwe contracten:** `friends/request`, `friends/[id]` DELETE, `friends/profiles/[id]`,
  ids `friends`, `friends/recent`, `users/search`, `users/avatars` verhuizen naar `social/`.
- **Aanvullende backendfix (apart):** kruislingse race en rate limits op `friends/request`/`users/search` (geen migratie).
- **Tests:** privacy per veld (verborgen online/prestaties/puzzelrecords), niet-vriend → 404/`null`, dubbele verzoeken, verwijderen terwijl profiel open staat,
  accountwissel, 401 tijdens mutatie, tabbalk met vier items (macOS-CI screenshot), `native-shell`-browserproeven.
- **Toestel:** VoiceOver/TalkBack, Dynamic Type 200% op 320 pt, tabbalk iOS 26 vs 15–25, realtime aanwezigheid met twee accounts/twee toestellen.
- **Complexiteit:** M. **Afhankelijkheden:** PR 0, capability, i18n in vijf talen.

### Fase B — Competitie en activiteit
- **Scope:** `/competition` (divisie, vrienden, nationaal), `/activity` met reacties, gedeelde prestaties; `/challenges` hoort al bij Spelen.
- **Contracten:** `leaderboard?scope`, `activity-feed`, `…/reaction(s)`, `groups/leaderboard`. **Tests:** zichtbaarheid per feed-item (`visibleActivityItem`
  heeft 0 tests), nationaal zonder persoonsgegevens buiten handle, promotie/degradatie blijft server-side.
- **Toestel:** lange lijsten (scrolprestaties), realtime verversing. **Complexiteit:** M.

### Fase C — Groepen en sociale interacties
- **Scope:** groepen, uitnodigingen, **uitnodigingslinks (ook vóór inloggen)**, vriendenreeksen, seintjes, bevriezers, notificatie-inbox.
- **Contracten:** `groups/*`, `group-links/[token]`, `friend-streaks`, `invite/[code]` (adapter), `notifications`.
- **Afhankelijkheid:** universal links/App Links (`well-known-association`, `android-app-links`) of handmatige code-invoer als terugval. Invitebewijs alleen in
  werkgeheugen (zoals reset-mails), nooit in hash/history.
- **Tests:** toetreding via `joinTx`, wachttijden, gelijktijdige toetreding, ingetrokken link, rate limit. **Toestel:** echte link vanuit mail/Messages. **Complexiteit:** L.

**Volgorde onderbouwd:** PR 0 vóór alles (proxy/encoding en generatoren zijn de gedeelde blokkade); A vóór B omdat ranglijst-/feedprivacy op ACCEPTED-vriendschap steunt;
C laatst omdat links, groepsrollen en pre-login-gedrag de meeste externe afhankelijkheden hebben.

**In CI testbaar:** routetabel-drift, regex en echte nginx, Swift/Java-policy, privacy- en autorisatietests (geïsoleerde database), browserproeven op het gedeelde
React-scherm, simulator-screenshots van de tabbalk. **Alleen op toestel:** VoiceOver/TalkBack, Dynamic Type op echte hardware, universal links, meerdere apparaten,
echte netwerkwissel en achtergrond/voorgrond.

## 9. Risicoanalyse en testdekking

| Risico | Bevinding | Dekking |
| --- | --- | --- |
| Realtime aanwezigheid en privacy | `presence.ts` is in-memory per app-instantie; native sockets delen dezelfde server; `shareOnlineStatus` + `shareCurrentActivity`, incognito | `presence`: geen directe test **[N]** |
| Uitnodigingslink vóór inloggen | `GET /api/invite/[code]` is publiek zonder rate limit; native heeft geen pre-login-deeplink | 0 tests (`friendInvite`) |
| Sessieverloop tijdens mutaties | bestaand: sessie-herverificatie na handler (`dispatchNativeGame`) | voor sociaal **[N]** |
| Dubbele/vertraagde antwoorden | `409` voor bestaand verzoek, seintjes server-begrensd; kruislingse race mogelijk | race niet getest |
| Vriend verwijderen met open profiel | `friends_changed` ververst lijsten; profiel krijgt `null` → moet "niet meer beschikbaar" tonen | `friend-profiles.integration` dekt privacy, niet dit scherm |
| Accountwissel | data-laag reset; sociaal nieuw | native-tests voor andere schermen |
| Offline/hervatten | geen offline mutaties (server-authoritative); lijsten blijven staan bij tijdelijk netwerkverlies | live-data tests |
| Meerdere apparaten / web-sync | zelfde socketkamers (`user:<id>`) en data-events | `native-socket` tests |
| Vier knoppen op de Liquid Glass-balk | gemeten OK; Dynamic Type/kleine schermen onbekend | simulator **[T]**, toestel **[N]** |
| Spam / enumeratie | geen rate limits op `friends/request`, `users/search` (handle-`contains`, e-mailmail bij verzoek) | geen |
| Blokkeren | bestaat niet | n.v.t. |

**Ontbrekende testdekking (feitelijk, op basis van zoeken in `tests/`):** geen enkele test importeert `social/friendRequests`, `friendInvite`
of `activityFeedVisibility`; geen test raakt `friends/request`, `friends/[id]` DELETE, `friends/invite`, `invite/[code]`, `activity-feed`, `notifications`,
`group-links` op routeniveau; `presence.ts` heeft geen eigen test. Services voor groepen, reeksen en seintjes zijn wel gedekt (`social*.test`, 34 tests).

## 10. Concreet voorstel eerste implementatie-PR

**PR 0: "feat(native): gedeeld sociaal routecontract en testproxy-borging"** — zie §8. Kernbestanden: `src/lib/native/socialRoutes.ts` (tabel),
`socialHandlers.server.ts` (typed dispatch), `scripts/native/social-policy.mjs` (generator naar Swift/Java), `render-test-api-proxy.mjs`
(tabel + encodingklassen), `check-test-backend.mjs` (GET-probes), tests: driftest, volledigheidscan, negatieve nginx-matrix, `nativePrimaryNav` +
`nativeRoute` voor alleen `/friends` (nog achter capability, geen UI-wijziging). Geen databasewijzigingen. Draft-PR, geen merge/uitrol zonder toestemming.

**Vragen voor jullie besluit:** (1) namespace `social/` naast `games/` (advies) of uitbreiden van `games/`; (2) rate limits + kruislingse-racefix als aparte backend-PR vóór of na Fase A;
(3) blokkeren in scope of niet; (4) uitnodigingslinks in C met of zonder universal links als blokkade; (5) welke minimale capability-naam (`social-v1`).
