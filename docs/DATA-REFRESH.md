# Live data: pagina's houden zichzelf actueel

Doel: de gebruiker hoeft nooit handmatig te verversen om voortgang, scores, Vandaag,
XP, reeks, klassementen, meldingen of de gekozen content correct te zien, zonder dat
de NAS door agressief pollen belast wordt. De regel:

> **ophalen bij openen + opnieuw bij focus/terugkeer + opnieuw na eigen mutations + gerichte realtime-signalen**

Alles zit in `src/lib/data/` en twee componenten. Er is bewust geen extern pakket
(React Query/SWR bestonden niet in het project); de laag is klein, in het project
getest (`npm run test:live-data`) en past bij de bestaande Socket.io-infrastructuur.

## Onderdelen

| Onderdeel | Waarvoor |
|---|---|
| `scopes.ts` | Woordenlijst: datasets (scopes), gebeurtenissen (events) en realtime-onderwerpen (topics). Puur; ook door de server gebruikt. |
| `store.ts` | De kern: dedupe, staleTime, invalidatie, revalidatie, polling-klokslag, serverpagina's. Puur, getest met een nepomgeving. |
| `client.ts` | De ene store van de browser en de globale luisteraars (focus, zichtbaarheid, online, bfcache, app hervat, Socket.io). |
| `hooks.ts` | `useLiveQuery` (client-pagina's), `useLiveTopic` (realtime volgen), `useContentScope`. |
| `mutation.ts` | `liveMutation`/`jsonMutation`: elke schrijfactie legt vast wat ze ongeldig maakt. |
| `LiveRefresh` (component) | Voor server-gerenderde pagina's (Vandaag): ververst via `router.refresh()`. |
| `LiveDataProvider` (component) | Eén keer in de layout: start de luisteraars, geeft content + taal door, ruimt alles op bij uitloggen. |

## Wanneer wordt data opgehaald, en wanneer is hij verouderd?

- **Bij openen** (mount): altijd, tenzij dezelfde key al vers in het geheugen staat (staleTime, standaard 30 s). Meerdere componenten met dezelfde key delen één aanvraag.
- **Verouderd** is data na `staleTime`, of zodra een gebeurtenis hem ongeldig verklaart, of na zijn `validUntil` (bv. het nieuwe woord om 18:00).
- **Bij focus / tab zichtbaar**: alleen wat in beeld en verouderd is wordt opnieuw gecontroleerd. Verse data blijft staan.
- **Bij terug online, herverbinden van de socket, hervatten van de (native) app en bfcache-herstel**: alles wat in beeld is wordt gecontroleerd, ook verse data: er kan van alles gemist zijn.
- **Verborgen tab of offline**: geen enkele aanvraag, geen polling; bij terugkeer volgt precies wat nodig is.
- **Fout of geen verbinding**: eerder geldige data blijft staan (geen leeg scherm of flikkering); de volgende trigger probeert het opnieuw, nooit in een lus.
- **Terugnavigeren** (browser-terug): client-pagina's halen bij mount vers op als hun data verouderd is. Server-pagina's met `LiveRefresh` herkennen een pagina uit de routercache (dezelfde `token`) en ververst als er sindsdien iets ongeldig is verklaard of de pagina te oud is.
- Ongebruikte data wordt na 5 minuten uit het geheugen gehaald.

## Mutations en invalidatie

Een gebeurtenis maakt alleen de gekoppelde datasets ongeldig, en alleen wat nu in beeld
is wordt meteen opnieuw opgehaald (de rest wordt alleen als verouderd gemarkeerd).

Datasets (scopes): `today`, `progress`, `courses`, `xp`, `streak`, `profile`,
`competition`, `wordGame`, `wordGameRanking`, `friends`, `activity`, `groups`,
`notifications`, `content`, `games`.

| Gebeurtenis | Wanneer | Maakt ongeldig |
|---|---|---|
| `activityCompleted` | les/oefening/spel afgerond, ook vanaf een ander apparaat (Socket.io `streak_changed`) | today, progress, courses, xp, streak, profile, competition, activity |
| `xpChanged` | `announceXpChanged()` na XP verdiend of uitgegeven | xp, streak, today, progress, courses, profile, competition |
| `contentChanged` | de set beschikbare content verandert (de gekozen content/taal zit al in de key) | content, today, courses, progress, wordGame, games |
| `wordGameScored` | iemand plaatst of sluit een score (realtime-onderwerp `word-game-ranking`) | wordGameRanking |
| `friendsChanged` | vriendschap of verzoek gewijzigd (`friends_changed`) | friends, today, activity, notifications |
| `groupsChanged` | groep of lidmaatschap gewijzigd | groups, today, activity |
| `notificationsChanged` | nieuwe of gewiste melding (`notifications_changed`, `game_invite`, `scrabble_updated`) | notifications, today |
| `gamesChanged` | uitdaging/woordspel/live spel gestart, geannuleerd of verlaten, uitnodiging ingetrokken (`game_invite`, `scrabble_updated`, `game_invite_revoked`, `game_cancelled`, `game_left`) | games, today |
| `coursesChanged` | cursus toegevoegd of verborgen | courses, today |
| `settingsChanged` | profiel- of accountinstelling gewijzigd | profile, today |

`announceXpChanged()` (`src/lib/xpBroadcast.ts`) is het centrale moment voor alles wat XP
oplevert: een nieuwe activiteit die XP geeft, hoeft daarom niets extra's te doen om Vandaag,
voortgang, de header-badges en de competitie actueel te houden.

## Realtime: alleen waar het functioneel nodig is

Eerst beoordelen of **ophalen bij openen + focus + invalidatie na eigen mutation** volstaat.
Dat is zo voor profielinstellingen, cursusinhoud, leescontent, je eigen voortgang. Realtime is
alleen voor gegevens die buiten jou om kunnen veranderen terwijl je kijkt:

- **Per gebruiker** (bestaand, `emitToUser`): reeks/voortgang van een ander apparaat, meldingen, vrienden.
- **Per onderwerp** (`LIVE_TOPICS` in `scopes.ts`): een client meldt zich alleen aan zolang de gegevens in beeld zijn (`useLiveTopic`), de server stuurt alleen de *naam* van de gebeurtenis (`data_event`), nooit gegevens, en voegt meldingen kort na elkaar samen (`emitTopicEvent`, 1 s). De client haalt daarna met spreiding (tot 1,5 s) de lichte dataset opnieuw op. Zo blijft de belasting begrensd, ook als het klassement veel kijkers heeft.
- Een nieuw onderwerp: voeg het toe aan `LIVE_TOPICS`, laat de server `emitTopicEvent(...)` aanroepen op de ene plek waar de data verandert, volg het in de component met `useLiveTopic`. De server accepteert nooit een onbekend onderwerp.

## Polling: standaard nee

- Geen polling voor data waar een gebeurtenis of een onderwerp voor bestaat.
- Alleen als er geen signaal is: `pollMs` op `useLiveQuery`, minimaal in de orde van een minuut. De centrale klok (15 s) loopt alleen terwijl de tab zichtbaar is en haalt alleen op wat daaraan toe is; dubbele componenten delen één aanvraag.
- Geen eigen `setInterval` + `fetch` in componenten; de architectuurtest laat dat falen.

## Content en taal

Alles wat van de gekozen content of contenttaal afhangt gebruikt `useLiveQuery(..., { contentScoped: true })`:
de key krijgt dan automatisch `{ content, taal }` mee, naast de sectie die je zelf in de key zet
(bv. `["courses", "list"]`). Een wissel is dus een andere key: data van de vorige keuze verschijnt
nooit, ook niet kortstondig. Gebruik `keepPreviousData` nooit voor contentgebonden data.
De layout geeft bovendien een key `actieve collectie:contenttaal` aan de pagina-inhoud (zie
CLAUDE.md, "Content- en taalwissel"), dus een wissel bouwt de client-pagina's opnieuw op.

## Ontwikkelregels voor nieuwe features

1. Elke pagina of feature met dynamische data gebruikt deze laag: `useLiveQuery` (client-pagina), `LiveRefresh` (server-pagina, met `token={String(Date.now())}`), `liveMutation` voor schrijfacties.
2. Geen eigen polling-, focus-, reconnect- of invalidatielogica in componenten waar een centrale hook bestaat.
3. Een nieuwe mutation legt vast wat ze ongeldig maakt (`invalidates` is verplicht in `liveMutation`/`jsonMutation`). Hoort ze bij een bestaande gebeurtenis, gebruik die; anders voeg je een gebeurtenis toe aan `DATA_EVENTS` en beschrijf je hem in de tabel hierboven (de test controleert dat).
4. Nieuwe datasets krijgen een scope in `DATA_SCOPES`; een query zet haar scopes expliciet in `useLiveQuery`.
5. Realtime pas toevoegen na beoordeling dat focus + invalidatie niet volstaat (zie boven); dan per onderwerp, nooit globaal.
6. Server-pagina's: zet `<LiveRefresh scopes={[...]} token={String(Date.now())} />` bovenaan; voor een bekend verloopmoment `expiresAt` + `serverNow` (rekent met verstreken tijd, niet met de toestelklok).
7. Mutaties op de server die iets voor anderen veranderen, sturen een `emitToUser`/`emitTopicEvent` zodat andere kijkers vanzelf verversen.

### Acceptatiecriterium

Een nieuw dynamisch onderdeel blijft correct bij: openen, terugnavigeren, tab-/app-focus,
reconnect, eigen mutations en (waar relevant) wijzigingen van andere gebruikers, zonder dat
daarvoor opnieuw een losse refresh-oplossing is gebouwd. Controleer dat met de bestaande
tests in `tests/live-data.test.ts` als sjabloon.

### Afgedwongen door tests (`npm run test:live-data`)

- Geen nieuw bestand met een eigen verversingstrigger (focus/zichtbaarheid/online/interval) naast `fetch` of `router.refresh()`; de lijst met oudere uitzonderingen (`LEGACY`) mag alleen kleiner worden.
- Alleen de centrale bestanden praten rechtstreeks met de store.
- Contentgebonden queries zijn `contentScoped`.
- Elke dataset en gebeurtenis staat in dit document.

## Bekende uitzonderingen (nog niet gemigreerd)

Oudere componenten met eigen triggers staan in `LEGACY` (zie de test). Dat zijn bewust speciale
onderdelen: de vier spelsessies (`GameRoom`, `ChapterGuessGameRoom`, `ScrabbleBoardClient`,
`StudyRoom`; socket-gedreven met eigen timers), de twee beheerschermen met voortgang van een taak
(`AdminDeployClient`, `ReseedClient`), `StreakContinuation` (claimt met een POST), `TimeZoneSync` en de
podcastspeler. `ActiveGamesBanner`, `FriendsClient`, `GroupDetailClient` en `ProfileClient` zijn
gemigreerd (keys `["games","activity"]`, `["friends","list"]`, `["friends","streaks"]`,
`["groups","detail",id]`, `["profile","me"]`). Raak je een legacy-bestand aan, beoordeel dan eerst
of de centrale laag het kan overnemen en haal het bestand uit `LEGACY` als het gemigreerd is; migreer
nooit alleen om de lijst te verkleinen.

Een UI-timer zonder dataverversing (bv. een seconden-aftelling) hoort niet in een component met
data-fetching: zet hem in een eigen bestand zoals `src/lib/countdown.ts`.
