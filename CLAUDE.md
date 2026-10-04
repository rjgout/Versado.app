# CLAUDE.md / AGENTS.md

Instructies voor AI-codeassistenten (Claude Code, Codex en vergelijkbare
tools) bij het werken aan dit project. Voor functionaliteit/features: zie
`README.md`. Voor een uitgewerkt deployvoorbeeld: zie
`docs/DEPLOY-SYNOLOGY.md`.

`AGENTS.md` is een symlink naar dit bestand (`CLAUDE.md`): het is één en
hetzelfde bestand onder twee namen, zodat Claude Code en Codex altijd
dezelfde instructies lezen. Pas dus gewoon één van beide aan. Vervang de
symlink nooit door een losse kopie; controleer bij twijfel met
`git ls-files -s AGENTS.md` (modus `120000` = symlink).

## Wat dit is

**Jehova** — een algemene, interactieve leeromgeving voor schriftstudie
(lessen, oefeningen, XP, streaks, competitie, live multiplayer-quiz). Het
datamodel (`Book`/`Chapter`/`Verse`/`Course`, zie Database & migraties
hieronder) is bewust niet aan één specifiek schriftwerk gebonden: het Boek
van Mormon is vandaag de enige/eerste cursus/contentcollectie, maar de
architectuur staat toe dat er later andere collecties bijkomen (bv. de Leer
en Verbonden of de Parel van Grote Waarde) zonder herbouw. "Geloof je dat
ook?" is de naam van de meegeleverde podcastcursus (zie
`prisma/podcastContent.ts`) — een aparte contentbron binnen de app, niet de
naam of technische identiteit van de app zelf (zie `src/lib/brand.ts`).
Bewust gebouwd om **self-hosted** te draaien (geen
cloud-platformafhankelijkheden), taal is overal Nederlands (UI, foutmeldingen,
codecommentaar, commitmessages). De huidige Nederlandstalige wekelijkse
competitie is gekoppeld aan de huidige Nederlandstalige content — zie
`LeagueSettings.localeCode` in `prisma/schema.prisma`, dat een toekomstige
tweede taal/competitie niet blokkeert.

Nieuwe code, teksten of bestandsnamen mogen "Boek van Mormon"/"BOM" dus
alleen gebruiken waar dat feitelijk over de huidige content gaat (bv. een
importscript voor die content, of een featurebeschrijving die vandaag klopt)
— nooit als aanname dat de hele app daarom draait. Zie ook de sectie
"Podcastafleveringen verwerken" hieronder voor hoe dat onderscheid in de
praktijk toegepast wordt.

## Werkwijze

- Bij een vraag om analyse, ontwerp of sparren: wijzig geen code tenzij daar
  expliciet om wordt gevraagd.
- Bij grotere wijzigingen: onderzoek eerst de relevante bestaande
  implementatie en doe een concreet voorstel voordat je code wijzigt.
- Stel alleen verduidelijkende vragen wanneer benodigde informatie niet uit
  het project of de opdracht kan worden afgeleid.
- Maak geen ongevraagde refactors of wijzigingen buiten de scope van de taak.
- Lees aanvullende documentatie alleen wanneer die relevant is voor de
  huidige taak. Scan niet standaard het volledige project of alle bestanden
  onder `docs/`.
- Begin bij de bestanden die direct bij de taak horen en volg
  imports/referenties wanneer meer context nodig is.

## Versado: redesign in voorbereiding

De app heet voortaan **Versado** (technische namen als `jehova`/`bom` blijven
voorlopig staan). Er komt een visueel redesign op basis van Figma en nieuwe
assets (mascottes VARO, VERA en NOVI, illustraties, eventueel Rive). Dat gaat
in fasen: de app-shell en Vandaag zijn gebouwd (semantische `vs`-tokens,
`lucide-react`-iconen, `src/components/versado/`), de rest nog niet. Lees
`docs/VERSADO-DESIGN.md` vóór je iets aan
navigatie, dashboard, lay-out, thema, beeld, onboarding of profiel verandert:
daar staan de Design Constitution, de richting voor de informatiearchitectuur
(Vandaag, Leren, Spelen, Vrienden) en wat wel en niet mag zolang de ontwerpen
er niet zijn. Kort: geen redesign of nieuwe schermen op eigen initiatief, geen
tijdelijke mascottes of vervangende afbeeldingen, geen nieuwe emoji als
structureel icoon, en bestaande functionaliteit en routes blijven werken.
Mascottes alleen via `<MascotSlot character state />`
(`src/components/versado/MascotSlot.tsx`, register in `src/lib/mascots.ts`),
nooit via een direct pad naar `public/mascots/`. Een persoonlijk moment
gebruikt `<PersonalMascot state />`: de gebruiker kiest zijn gids (Novi, Varo
of Vera, `User.companion`, standaard Novi), de feature alleen de state. Zie de
sectie "Mascottes" in `docs/VERSADO-DESIGN.md` voor de character canon.

## Platformfundering: web/PWA, iOS en Android

Versado blijft één Next.js-codebase. iOS/iPadOS en Android gebruiken
Capacitor-shells in `ios/` en `android/` die dezelfde gedeployde SSR-app laden;
bouw geen aparte pagina's, routers of businesslogica per platform. De native
identiteit is `app.versado.app`. De complete werkwijze, beperkingen en
storevoorbereiding staan in `docs/PLATFORMEN.md`.

Nieuwe features worden standaard beoordeeld op web, PWA, iOS, Android,
telefoon, tablet en desktop, inclusief safe areas, touch, toetsenbord, dark
mode, toegankelijkheid, netwerk/resume, browserback, Android systeem-back en
deep links. Native gedrag loopt via `src/lib/platform.ts` en
`src/components/NativeAppBridge.tsx`; verspreide directe Capacitor-checks zijn
niet de standaard. Native permissies worden pas toegevoegd wanneer de feature
ze daadwerkelijk nodig heeft. De bestaande webpush blijft losstaan van
toekomstige APNs/FCM-push.

## Techstack

- Next.js 16 (App Router) + TypeScript (strict) + Tailwind CSS + React 19
- PostgreSQL + Prisma (migrations in `prisma/migrations/`)
- Redis + `@socket.io/redis-adapter` voor de live multiplayer-quiz
- Custom server (`server.ts`, via `tsx`, geen `next start`) omdat er een
  Socket.io-server naast de Next.js-requesthandler moet draaien
- Auth: eigen implementatie — `jose` (JWT) + `bcryptjs`, geen NextAuth/Clerk/etc.
- **Geen testframework aanwezig** (geen jest/vitest/playwright-dependency,
  geen test-CI-stap) — zie de validatiestappen onderaan dit bestand.

## Architectuur (3 containers, zie `docker-compose.yml` / `README.md`)

| Container | Rol | Persistent? |
|---|---|---|
| `jehova-app` | Next.js-app + API + Socket.io-server (`server.ts`) | Nee, stateless |
| `jehova-db` | PostgreSQL — alle gebruikersdata | Ja (`jehova_db_data`) |
| `jehova-redis` | Socket.io-adapter voor live-quiz | Nee, ephemeral |

Containernamen zijn puur infrastructuur, geen productbranding — de
Postgres-gebruiker/database heten bewust nog "bom" (zie `.env.example`),
dat is voor niemand zichtbaar en hoeft niet mee te veranderen.

Build/deploy: GitHub Actions bouwt bij elke push naar `main` een image en
publiceert 'm naar `ghcr.io` (`.github/workflows/docker-publish.yml`); een
zelfgehoste instantie haalt 'm op via Portainer/Docker Compose. Zie
`docs/DEPLOY-SYNOLOGY.md` voor de migratienotitie als je van een oudere
`bom-game`-naamgeving komt.

## ⚠️ Harde regel: `server.ts`'s eager-importketen

`server.ts` importeert `src/server/gameServer.ts` en `src/lib/scheduler.ts`
**bovenaan het bestand, vóór `app.prepare()`** — dus vóórdat Next zelf
geïnitialiseerd is, en dat draait via `tsx` (buiten Next's eigen
module-bundeling om). Elke module die transitief via die twee bestanden
meekomt (o.a. `notify.ts`, `baseUrl.ts`, `streak.ts`, `challenges.ts`,
`scrabbleGame.ts`) mag daarom **nooit** een runtime-import bevatten van een
request-scoped Next-API (`next/headers`, `cookies()`/`headers()` uit
`next/server` als waarde, etc.) — dat crasht het hele productieproces bij
opstarten met `Invariant: AsyncLocalStorage accessed in runtime where it is
not available` (in een crash-lus, dus de container komt nooit gezond op).
Zulke APIs zijn alleen veilig in bestanden die uitsluitend via Next's eigen
bundeling geladen worden: `page.tsx`/`layout.tsx`/`route.ts`-bestanden en
alles wat **alleen** daar vandaan geïmporteerd wordt (bv. `session.ts`,
gebruikt via routes, nooit via `server.ts`'s eigen keten).
Controleer bij twijfel: `grep -rn "next/headers" src/lib src/server server.ts`
— hoort leeg te zijn buiten route/page/layout-bestanden.

## Projectstructuur

- `server.ts` — custom entrypoint (HTTP-server + Next-handler + Socket.io)
- `src/server/gameServer.ts` — Socket.io-logica voor live multiplayer (lobby,
  scores, "Raad het hoofdstuk"); state van een lopend spel leeft in-memory
  in deze ene instantie (zie Beperkingen in `README.md`)
- `src/server/study.ts` + `src/lib/study/` — Samen studeren (LiveGame mode
  STUDY): een cursus met vrienden stap voor stap, iedereen dezelfde vragen in
  eigen tempo, uitslag per stap en een groeiende totaalstand. Wat een "stap"
  per cursustype is en welke vragen erbij horen staat alleen in
  `src/lib/study/units.ts`; de puntentelling in `src/lib/study/scoring.ts`
  (getest met `npm run test:study`)
- `src/app/**` — App Router: pagina's (`page.tsx`) + API-routes (`app/api/**/route.ts`)
- `src/lib/**` — kernlogica, georganiseerd per domein; vermijd onnodige
  versnippering (`streak.ts`, `xp.ts`, `leagues.ts`, `competitionXp.ts`,
  `challenges.ts`, `scrabbleGame.ts`, `chapterGuess.ts`, `wordGame.ts`,
  `notify.ts`, `email.ts`, `auth.ts`, `session.ts`, `baseUrl.ts`, `dates.ts`, ...)
- `src/components/**` — client components (`"use client"`), meestal één
  `<Feature>Client.tsx` per pagina die de eigen data fetcht
- Terug en scrollen zijn centraal geregeld: de kop van een detailpagina
  ("← Titel") komt uit `SubpageBackBar.tsx`, de pijl werkt als browser-terug
  (`useBackNavigation`, `src/lib/navigationHistory.ts`), en
  `shell/NavigationScroll.tsx` zet een nieuwe pagina bovenaan en herstelt
  bij terug/vooruit de oude positie. Geen eigen terugknoppen of
  `window.scrollTo(0, 0)` per pagina, en geen `overflow` op `html` (dan
  scrolt het venster niet meer, zie `globals.css`). Zie
  `docs/VERSADO-DESIGN.md`.
- Leren en Spelen: cursus- en spelkaarten gebruiken `ContentCard` en
  `SortableList` (greep links, afbeelding en titel openen, ⋯ om te verbergen,
  "toevoegen" onderaan). Verbergen verwijdert nooit gegevens, personaliseren
  omzeilt nooit wat beheer uitzet; zie `docs/KAARTEN.md`.
- Profiel: elke profielpagina en instelling gebruikt de shell en bouwstenen
  uit `src/components/profile/` (`ProfilePage`, `SettingsSection`,
  `SettingsToggleRow`, ...). Geen eigen kaart-, rij- of formulierstijl en
  geen dubbele titel; zie `docs/PROFIEL.md`.
- `src/lib/learning/` — leervoortgang per inhoud (lezen, oefenplan, XP-
  begrenzing, reeksregel, leestijd); zie `docs/LEERVOORTGANG.md` en de harde
  regel hieronder. Getest met `npm run test:learning`
- `prisma/schema.prisma` + `prisma/migrations/**` — datamodel en migraties
- `prisma/seed.ts`, `import.ts`, `importKids.ts`, `importPodcast.ts` — content laden
- `deploy/`, `docs/DEPLOY-SYNOLOGY.md` — self-host-referentiedeploy (Synology + Portainer)

## ⚠️ Harde regel: leervoortgang, XP en reeks

Zie `docs/LEERVOORTGANG.md`. De invariant:

> Leesvoortgang hoort bij de inhoud, niet bij de cursus.
> Lezen levert geen XP op en verlengt geen reeks.
> XP en reeks worden verdiend door betekenisvolle afgeronde leeractiviteiten.
> Voor dezelfde onderliggende inhoud zijn oefenbelasting en maximale
> basis-XP route-onafhankelijk gelijkwaardig.
> Routes bepalen hoe de inhoud wordt aangeboden, niet hoeveel de inhoud
> waard is.

In de praktijk:
- Voortgang van inhoud alleen via `src/lib/learning/contentProgress.ts`.
- Oefeningen alleen via een server-uitgedeelde set (`issueExerciseSession`/`submitExerciseSession`).
- De reeks alleen via `recordLearningActivity` (`src/lib/streak.ts`), met de regel in `src/lib/learning/streakRules.ts`.
- Geen eigen vraagaantal of XP-formule per route, geen voortgang aan een cursus-id als de inhoud gedeeld is.
- `ChapterProgress` niet meer gebruiken.

## ⚠️ Harde regel: Samen (vriendenreeksen, groepen, seintjes)

Zie `docs/SAMEN.md`. Sociale reeksen hebben geen eigen activiteitsregels:
iemand draagt bij als hij op zijn eigen kalenderdag een `StreakDay` heeft
(gestudeerd of bevroren). Dus nooit een tweede plek die bepaalt of iemand
vandaag "geldig actief" was, geen XP voor bijdragen, seintjes of geschonken
bevriezingen, en limieten (5 vriendenreeksen, 10 groepen, 500 leden, 7 en 30
dagen wachttijd) alleen via `src/lib/social/rules.ts` en de bestaande
transacties met rijvergrendeling. Ledenlijsten zijn alleen voor leden.
Lid worden gaat altijd via `joinTx` (`src/lib/social/groups.ts`); een
groepslink/QR geeft nooit zelf lidmaatschap, alleen een voorpagina en een
toegangsverzoek dat een bevoegd persoon goedkeurt (`joinLinks.ts`).

## ⚠️ Harde regel: tijd en tijdzones

Zie `docs/TIJD.md`. UTC is de waarheid voor tijdstippen; de IANA-tijdzone
van de gebruiker (`User.timeZone`, standaard `Europe/Amsterdam`) bepaalt
zijn kalenderdag. Persoonlijke dag-logica (reeks, herinneringen, Vandaag)
gebruikt `src/lib/timeZone.ts` en, voor de reeks, `streakDayGap` in
`src/lib/learning/streakRules.ts`. Het woord van de dag wisselt om 18:00 in
de eigen tijdzone (`wordGamePeriod`), met dezelfde woordvolgorde voor
iedereen. Gedeelde dingen (tekst van de dag, weekcompetitie, dagelijkse
Alleskenner, XP-daglimieten) houden hun vaste grens. Nooit de toestelklok vertrouwen voor XP of reeks, nooit losse
UTC-offsets, en geen eigen tijdzonerekensom in componenten.

## Database & migraties

- Prisma 7 met de pg-driver: de client wordt gegenereerd in
  `src/generated/prisma` (niet in git; `npm run db:generate` na
  `npm install` of een schemawijziging) en geïmporteerd uit
  `@/generated/prisma/client`. Eén singleton `prisma` in `src/lib/db.ts`;
  scripts maken hun eigen client met `createPrismaClient()` daaruit, nooit
  met `new PrismaClient()`. De CLI leest de database-URL uit
  `prisma.config.ts`. Client components importeren nooit een waarde uit de
  Prisma-client (die is alleen voor de server): alleen `import type`, of
  enums uit `@/generated/prisma/enums` (zie `src/lib/leagueTiers.ts`).
- **Migratiebeleid (hard, consistent toegepast)**: een nieuwe migratie mag
  bestaand gedrag/data van bestaande gebruikers nooit met terugwerkende
  kracht veranderen. Nieuwe verplichte/gedrag-bepalende kolommen krijgen in
  dezelfde migratie een backfill (raw SQL) die ze zo vult dat bestaande
  gebruikers het nieuwe gedrag NIET automatisch triggeren (bv.
  `onboardingSeenAt = createdAt` zodat bestaande accounts de onboarding-flow
  nooit alsnog te zien krijgen). Patroon: DDL bovenaan `migration.sql`,
  backfill-`UPDATE`/`INSERT...SELECT` eronder, in hetzelfde bestand.
- Instellingen die een admin via `/adminbackend` aanpast staan in eigen
  singleton-modellen (`id String @id @default("singleton")`) — patroon:
  `EmailSettings`, `LeagueSettings`, `BrandingSettings`, `DetectedAppUrl`.
  Geheimen (SMTP-wachtwoord) staan versleuteld (`src/lib/crypto.ts`, sleutel
  afgeleid van `SESSION_SECRET`), nooit als platte tekst.
- In deze devcontainer: Postgres/Redis starten niet vanzelf, en
  `prisma migrate dev` kan hier "non-interactive environment"-fouten geven —
  gebruik dan `--create-only` (schrijft alleen het SQL-bestand) of schrijf
  `migration.sql` handmatig volgens het patroon hierboven, en pas toe met
  `prisma migrate deploy`.

## Prisma schema en migraties — synchroniteit

Bij iedere wijziging aan de database moeten **schema, migratie en gebruikende code als één geheel** worden behandeld:

- `prisma/schema.prisma` is de bron van waarheid voor het actuele Prisma-datamodel.
- Een nieuwe migratie in `prisma/migrations/**` mag alleen worden toegevoegd als dezelfde structurele wijziging ook in `prisma/schema.prisma` staat.
- Omgekeerd: als TypeScript/Prisma-code een nieuw model, veld, enum of relatie gebruikt, controleer dan altijd of dit in `prisma/schema.prisma` bestaat én door een passende migratie in de database terechtkomt.
- Controleer vóór iedere commit met Prisma-wijzigingen expliciet deze drie lagen:
  1. `prisma/schema.prisma`
  2. de bijbehorende `prisma/migrations/**/migration.sql`
  3. alle code die het gewijzigde model of veld gebruikt.
- Na een wijziging aan `schema.prisma` of een Prisma-model zijn minimaal deze controles verplicht: `npx prisma validate`, `npx prisma generate` en daarna `npx tsc --noEmit`.
- `prisma generate` is belangrijk: alleen een migration aanpassen is niet genoeg, omdat de gegenereerde Prisma Client moet overeenkomen met het actuele schema.
- Als een lokale database ontbreekt, gebruik dan niet automatisch `prisma migrate dev`: volg het migratiebeleid hierboven. `prisma validate` en `prisma generate` moeten nog steeds worden uitgevoerd; noteer expliciet wanneer een controle door de omgeving niet mogelijk is.
- Voer bij wijzigingen aan verplichte of gedragsbepalende velden ook de bestaande backfill-regel uit: bestaande gebruikers/data mogen niet onverwacht nieuw gedrag krijgen.
- Commit geen Prisma-wijziging zolang `schema.prisma`, migration en gebruikende code aantoonbaar niet met elkaar in overeenstemming zijn.

## Auth & autorisatie

- Sessie = httpOnly JWT-cookie (`bvm_session`, `jose`, 30 dagen), wachtwoorden
  gehasht met `bcryptjs`. Geen aparte rollen-tabel: alleen `User.isAdmin`.
- **Registreren met e-mail maakt nog geen account**: eerst een
  `PendingRegistration`, pas bij het klikken op de bevestigingslink een `User`
  (`src/lib/registration.ts`; `createAccount` is de enige plek waar een
  account ontstaat, ook zonder e-mailconfiguratie). Een uitnodigingslink
  wordt dus ook pas dan een vriendschap. Opruimen van oude aanmeldingen en
  onbevestigde accounts loopt uurlijks via `scheduler.ts`.
- **De allereerste registratie op een verse installatie wordt automatisch
  admin** (geen setup-stap nodig). Er bestaan geen demo-accounts meer: de
  seed maakt nooit gebruikers aan.
- Elke API-route/server-actie die auth nodig heeft begint met
  `getCurrentUser()` (uit `src/lib/session.ts`) → 401 bij `null` → bij
  admin-routes daarna ook `isAdmin` → 403. Er is geen `middleware.ts`; elke
  route/pagina controleert dit zelf.
- Gebruikersidentiteit is `handle#discriminator` (bv. `Jan#83`, zie
  `src/lib/handle.ts`) — privacyvriendelijk, iedereen kan dezelfde
  weergavenaam kiezen, e-mailadres hoeft nooit gedeeld te worden.
  Vindbaarheid via e-mailadres is een losse, standaard-uit instelling
  (`User.searchableByEmail`).

## API- en servercode-conventies

- Route handlers: `NextRequest`/`NextResponse`, invoer gevalideerd met `zod`,
  fouten als `NextResponse.json({ error: "<Nederlandse boodschap>" }, { status })`.
- **Server is de enige bron van waarheid voor XP/scores/spelstatus** — de
  client stuurt nooit een bedrag of resultaat, de server berekent en
  valideert alles opnieuw (zie elke `complete*`-functie in `streak.ts`,
  `scrabbleGame.ts`, `gameServer.ts`). Zie `src/lib/xp.ts` en
  `src/lib/competitionXp.ts` voor de implementatiedetails (o.a. concurrency-
  veilige tegoeden en anti-farming-regels voor competitie-XP).
- E-maillinks: gebruik `getBaseUrl(req)` (uit een route met een `NextRequest`)
  of `getAppUrl()` (async, overal elders — schedulers, socket-server) uit
  `src/lib/baseUrl.ts`. Beide zijn domeinonafhankelijk (geen hardcoded
  localhost/domein) — zie de harde regel hierboven voor de valkuil daarbij.
- E-mail is optioneel en admin-configureerbaar (`/adminbackend`, generieke
  SMTP); check altijd `isEmailConfigured()` voordat je een flow laat
  blokkeren op e-mail — zonder configuratie moet de app blijven werken.
- **Keuzeopties van oefeningen altijd geschud tonen, nooit de opslagvolgorde
  direct.** Voor automatisch gegenereerde hoofdstukoefeningen
  (`src/lib/exerciseGen.ts`) gebeurt dit al bij het genereren zelf
  (`shuffleWithSeed`). Voor handmatig geschreven content (introcursus,
  kindercursus, podcast, en toekomstige vergelijkbare content) staan
  `options`/`wordBank` in de database in de volgorde waarin ze getypt zijn —
  in de praktijk vaak "het juiste antwoord eerst" of (bij WORD_BANK/SEQUENCE)
  zelfs al helemaal in de juiste volgorde. Haal daarom bij het samenstellen
  van een `Exercise` voor de client altijd `options`/`wordBank` door
  `shuffleForDisplay()` (ook in `src/lib/exerciseGen.ts`) — puur presentatie,
  geen seed nodig, want antwoorden worden op tekst gecontroleerd, nooit op
  positie (zie `isExerciseCorrect`).

## Content-API (`/api/content-api/*`)

Losstaande, sleutel-beveiligde route-namespace zodat Claude Code (of een
ander extern proces) live contentstatus kan uitlezen zonder in te loggen —
bedoeld voor workflows als "check of er nieuwe content klaarstaat om te
verwerken". Fundamenteel anders dan de rest van de API:

- **Auth**: geen cookie-sessie, maar een vaste sleutel in de
  `X-API-Key`-header, gecontroleerd met `verifyContentApiKey()` in
  `src/lib/contentApi.ts` tegen de env var `CONTENT_API_KEY` (constant-time
  vergelijking, zie die functie voor waarom). Geen env var gezet = de hele
  namespace retourneert altijd 401 — nooit "open" bij ontbrekende configuratie.
- **Scope, hard begrensd**: uitsluitend content (`Book`/`Chapter`/`Verse`,
  `Course`, `IntroLesson`, `PodcastEpisode`, `KidsStory`, `Person`/`Place`/
  `Topic`, en vergelijkbare content-modellen uit `prisma/schema.prisma`).
  **Nooit** gebruikers-, activiteit- of persoonsgegevens (dus niets uit
  `User`, `Friendship`, `LiveGame`, `WeeklyScore`, `Feedback`, enz.) — dat
  blijft uitsluitend via de gewone, sessie-beveiligde routes lopen. Twijfel
  je of een veld hieronder valt: dan hoort het er niet in.
  - `GET /api/content-api/status`: eerste endpoint, telt alleen aantallen
    per content-tabel. Dient als sjabloon voor nieuwe, specifiekere routes
    in dezelfde namespace (zelfde `verifyContentApiKey`-check bovenaan,
    zelfde "alleen content"-grens).
- **Alleen lezen vooralsnog.** Nieuwe content plaatsen gebeurt nog steeds
  via de bestaande weg: een TS-object toevoegen aan het relevante
  seed-bestand (bv. `prisma/podcastContent.ts`), `npx tsc --noEmit`, committen
  naar de werkbranch — zie "Podcastafleveringen verwerken" hieronder. Een
  schrijvende content-API-route (bv. om die stap te automatiseren) is een
  bewuste, aparte vervolgstap — niet zomaar aannemen dat die er al is.

## Codestijl

- Commentaar in het Nederlands, en legt **waarom** uit (niet-vanzelfsprekende
  aannames, edge cases, bewuste afwegingen) — nooit **wat** de code doet.
- Commitmessages zijn in het Nederlands en beschrijven duidelijk wat er is
  gewijzigd en waarom wanneer dat relevant is.
- Geen ORM-modelduplicatie in aparte typebestanden: types komen uit
  `@/generated/prisma/client` of worden lokaal in het bestand zelf gedefinieerd.
- **Geen merknamen in zichtbare/leesbare tekst.** Een feature mag intern
  geïnspireerd zijn op een bekend concept (bv. een woordraadspel, een
  asynchroon bordspel), maar de naam van dat bekende merk/product hoort
  nooit in UI-tekst, documentatie of codecommentaar terecht te komen (bv.
  niet "Wordle-stijl" of "net als Wordfeud") — beschrijf het mechanisme zelf
  in plaats daarvan. Interne codenamen (bestandsnamen, functie-/modelnamen)
  zijn hierop de uitzondering: die omdopen is een aparte, grotere refactor
  en levert gebruikers niets op, dus dat gebeurt niet automatisch mee.
- **Een `bg-`/`border-`-kleur overschrijven op een element met `.card`/`.btn`/
  `.btn-primary`/`.btn-secondary`/`.input` (globals.css) moet altijd met een
  `!`-prefix** (bv. `!bg-gold-50 dark:!bg-slate-800 !border-gold-400/30`).
  Die basisklassen staan in de gecompileerde CSS ná Tailwinds eigen
  utility-laag (ze zijn plain CSS, niet via `@layer components`), dus zonder
  `!` wint `.card`'s eigen `bg-white`/`border-slate-100` alsnog ondanks
  gelijke specificiteit — de kleur ziet er in de JSX uit alsof die klopt,
  maar rendert gewoon wit/de standaardkleur. Alleen `bg-gradient-to-br`
  (een ander CSS-veld, `background-image`) en pseudo-class-varianten zoals
  `hover:` (hogere specificiteit) zijn hier vanzelf immuun voor. Controleer
  bij twijfel met `getComputedStyle(el).backgroundColor` in de browser, niet
  alleen visueel — het verschil tussen wit en een lichte tint (bv. gold-50)
  is op een screenshot makkelijk te missen.

## Accountbeveiliging en 2FA

- TOTP is de ingebouwde tweestapsverificatie. Voor gewone gebruikers is dit **optioneel**; voor accounts met isAdmin=true is TOTP **verplicht zodra de beheerder het heeft ingesteld**.
- Een bestaande beheerder mag zonder TOTP inloggen om de eerste configuratie te kunnen uitvoeren. Na het instellen kan een beheerder 2FA niet meer zelf uitschakelen.
- **Vergrendel de laatste beheerder nooit tijdens de uitrol van 2FA.** De eerste admin moet altijd een setup-pad kunnen bereiken voordat TOTP voor dat account wordt afgedwongen.
- TOTP-secrets worden versleuteld opgeslagen met een sleutel die uit SESSION_SECRET wordt afgeleid. Sla TOTP-secrets nooit als leesbare tekst op en log ze nooit.
- Herstelcodes worden alleen als hashes opgeslagen en worden na gebruik ongeldig gemaakt. Toon nieuwe herstelcodes alleen één keer tijdens het instellen.
- Gebruik voor TOTP de standaard 30-secondenperiode en een kleine kloktolerantie. Wijzig dit niet zonder een concrete beveiligingsreden.
- Bij wijzigingen aan de authenticatieflow moet zowel de normale login als de 2FA-login met een authenticator-code én een herstelcode worden gecontroleerd.
- Mislukte pogingen zijn begrensd via `src/lib/rateLimit.ts` (in-memory, per kwartier): inloggen per IP+account en per IP, 2FA-codes en herstelcodes per account. Nieuwe routes die een wachtwoord, TOTP-code of herstelcode controleren, horen dezelfde begrenzing te krijgen.
- "Nieuwe telefoon koppelen" (`/api/account/totp/reset`) zet 2FA nooit uit: een herstelcode koppelt direct een nieuw secret. Alleen `/api/account/totp/disable` schakelt 2FA uit, en die weigert beheerders.
- Een wachtwoordwijziging of -reset verhoogt `sessionVersion`, zodat andere apparaten worden uitgelogd.

## Paginabreedte en layout

- **max-w-5xl (1024px) is de standaard maximale breedte voor desktop-pagina-inhoud.** De globale <main> in src/app/layout.tsx gebruikt deze breedte; nieuwe overzichts-, lijst- en dashboardpagina's horen daarom standaard de beschikbare 5xl-breedte te benutten.
- Gebruik voor brede pagina's de combinatie **max-w-5xl mx-auto** op de hoofdcontainer wanneer de pagina zelf een container nodig heeft. Maak niet zonder reden een nieuwe, smallere pagina-container.
- **Gebruik bewust smallere inner containers** wanneer de inhoud daar beter bij past: formulieren, foutmeldingen, lees-/studietekst, compacte instellingen en andere sterk gefocuste content mogen bijvoorbeeld max-w-md, max-w-xl of max-w-2xl gebruiken. Dit is een inhoudelijke keuze voor de leesbaarheid, geen alternatieve algemene paginastandaard.
- Overzichtskaarten, lijsten en grids zoals **Cursussen, Spellen, Vrienden, Profiel, XP/Reeks en dashboards** mogen op desktop de 5xl-breedte gebruiken. Laat de kaarten zelf vervolgens met grid/flex de ruimte verdelen; beperk de hele pagina niet opnieuw tot 2xl/3xl zonder duidelijke reden.
- **Mobiel blijft volledig responsive**: de globale px-4 uit de layout blijft leidend; de 5xl-grens is vooral een desktoplimiet.
- Nieuwe pagina's moeten bij ontwerp eerst worden ingedeeld als **breed overzicht**, **gefocuste content** of **immersieve spel-/leesweergave**. Alleen de eerste categorie gebruikt standaard 5xl; de andere twee mogen bewust afwijken.
- Bij een bestaande pagina met een smallere max-w-* moet je bij wijzigingen controleren of die beperking nog inhoudelijk gewenst is. Pas niet blind alle pagina's aan: de uitzondering moet bewust en uitlegbaar zijn.
- Houd deze standaard ook aan bij nieuwe client components die de volledige pagina-inhoud renderen. Een server-page die alleen <FeatureClient /> teruggeeft, kan dus alsnog een bredere of smallere container in die client component hebben.

## Content & auteursrecht (relevant bij wijzigingen aan content/seeds)

- De verzen in `prisma/bomContent.json` (geladen via `prisma/content.ts`) zijn
  de officiële Nederlandse tekst, met toestemming gebruikt. Deel die niet als
  losstaand bestand/export met een instantie die die toestemming niet apart
  heeft. Een andere bron laden kan via `npm run db:import`. Er is geen
  demo-inhoud meer.
- De voorgelezen hoofdstukken (audio van de kerk, dezelfde uitgave als de
  tekst) worden gespiegeld naar de eigen server: `Chapter.audioUrl` blijft
  de bron-URL van de kerk, `mirrorChapterAudio` (`src/lib/audioMirror.ts`,
  laatste stap van de seed en `npm run audio:mirror`) haalt elk bestand op
  naar `AUDIO_DIR`, en `playableAudioUrl()` geeft de speler de eigen kopie
  (`/api/audio/<bestand>`, alleen ingelogd) of, zolang die ontbreekt, de
  bron. Geef een audiolink dus nooit rechtstreeks uit `Chapter.audioUrl` aan
  de client, altijd via `playableAudioUrl()`. Elke uitgave met audio in de
  database (elke taal) gaat vanzelf mee. De begintijd per vers en van de
  hoofdstukkop staan in `prisma/bomAudio*.json`, berekend met de scripts in
  `scripts/bom-audio/` (zie de README daar). Verandert de tekst van een
  hoofdstuk, draai die scripts dan opnieuw; `importChapterAudio` slaat een
  hoofdstuk over als het aantal verzen niet meer klopt.
- Leer en Verbonden (`prisma/dcContent.json`) en de Parel van Grote Waarde
  (`prisma/pgpContent.json`) komen op dezelfde manier van de kerkwebsite
  (`scripts/church-text/fetch_dc_pgp.py`, schrijft ook de woordenlijsten voor
  het woordenboek). Elk een eigen contentcollectie (`content_dc`,
  `content_pgp`, standaard verborgen voor gebruikers) met dezelfde cursussen
  als het Boek van Mormon: Vrije keuze, Hoofdstuk voor hoofdstuk (bij de
  Leer en Verbonden "Afdeling voor afdeling") en Stap voor stap, met korte
  lessen die in de app "stap" heten (`syncCourses`; intern heten ze nog
  FRONT_TO_BACK en READING_LESSONS); cursussen per boek bestaan niet meer. Leer en Verbonden
  heeft afdelingen i.p.v. hoofdstukken (`src/lib/chapterTerm.ts`).
  Nederlandse audio is daar (nog) niet voor. Functies die bij het Boek
  van Mormon horen (spellen, tekst van de dag) filteren expliciet
  op `BOM_COLLECTION_ID`: Book/Chapter/Verse bevatten nu meer dan één schrift.
  Personages hebben een eigen `Person.contentCollectionId`; die van de Leer en
  Verbonden staan in `prisma/dcPersons.ts` (slugs met `lv-`), gecontroleerd
  tegen de verzen en opschriften in `prisma/dcContent.json`.
- De kindercursus-tekst/illustraties ("Verhalen uit het Boek van Mormon")
  worden met toestemming gebruikt — deel dit dus niet als losstaand
  bestand/export met een instantie die die toestemming niet apart heeft.

## Talen (Nederlands, Engels, Duits, Frans, Spaans)

Doel: één app in vijf talen, met één gezamenlijke competitie en spellen die
spelers in verschillende talen samen kunnen spelen (bv. De Slimste Heilige, Raad
het hoofdstuk). Het fundament ligt er; zichtbaar is alles nog Nederlands.

- **Twee losse taalkeuzes per gebruiker**: `User.uiLanguage` (menu's,
  knoppen, meldingen, e-mails) en `User.contentLanguage` (welke uitgave je
  leest en speelt). Codes en namen staan in `src/lib/languages.ts`. Kiezen
  gebeurt in het profiel (blok "Taal", `LanguageSettings.tsx`) en in de
  contentkiezer: één regel per werk, met taalknoppen voor de talen van het
  actieve werk (`getContentContext` levert `works`/`activeEditions`;
  `PUT /api/content-context {contentLanguage}` wisselt de taal en neemt het
  actieve werk mee). Een app-taal is pas kiesbaar als `uiReady` in
  `languages.ts` aan staat; beheerders kunnen elke taal kiezen om een
  vertaling te bekijken.
- **Een collectie is één uitgave**: `ContentCollection.work` (bv. `bofm`,
  `dc-testament`, `pgp`) + `language`. Een Engelse uitgave van het Boek van
  Mormon wordt een eigen collectie met hetzelfde `work`. Zoek een uitgave op
  met `resolveEditionId(work, taal)` (`src/lib/contentCollections.ts`); die
  valt terug volgens `fallbackChain` (eigen taal → Engels → Nederlands;
  Nederlands zelf valt nooit terug). Nieuwe code filtert dus op werk + taal, niet
  op een vaste collectie-id als `BOM_COLLECTION_ID`.
- **Dezelfde tekst in elke taal**: `Book.key` is het pad dat de kerk gebruikt
  (`bofm/alma`, zie `prisma/bookKeys.ts`); sleutel + hoofdstuk + vers is in
  elke uitgave hetzelfde. Helpers in `src/lib/scriptureRefs.ts`. Een spel
  tussen talen kiest één verwijzing en laat die elke speler in de eigen
  contenttaal zien; scores tellen op de vraag, niet op de tekst.
- **Uitgaven in andere talen**: `scripts/church-text/fetch_scripture.py <en|de|fr|es>`
  haalt Boek van Mormon, Leer en Verbonden en Parel van Grote Waarde op
  (verzen + opschriften, met `key` per boek; stopt als het aantal verzen
  afwijkt van het Nederlands) en schrijft `prisma/<werk>Content.<taal>.json`
  en `<werk>WordCounts.<taal>.json`. Collecties komen via een migratie
  (Engels: `content_bom_en`, `content_dc_en`, `content_pgp_en`; Spaanse uitgave
  van het Boek van Mormon: `content_bom_es`; Duitse en Franse uitgaven van het
  Boek van Mormon: `content_bom_de`, `content_bom_fr`), de seed importeert ze.
  De woordzoeker is voor deze extra Boek-van-Mormon-uitgaven ingeschakeld;
  andere spellen volgen pas na een afzonderlijke taalcontrole. Oefeningen
  en hints worden gemaakt in de taal van de
  collectie (woordenlijsten per taal in `src/lib/exerciseGen.ts`, hints in
  `src/lib/exerciseHints.ts`); de Nederlandse uitvoer mag daarbij nooit
  veranderen. **Let op:** JSON die `tsx` laadt (alles in de keten van
  `server.ts` en de seed) mag geen objecten met woorden als sleutels
  bevatten: `tsx` maakt van elke sleutel een variabele, en woorden als
  `yield` of `let` laten de app dan bij het opstarten crashen. Woordenlijsten
  in andere talen staan daarom als `[woord, aantal]`-paren.
- **App-teksten**: `src/lib/i18n/messages/nl.ts` is de bron; de taalbestanden
  (`en.ts`, `de.ts`, `fr.ts`, `es.ts`) volgen die structuur;
  een ontbrekende tekst valt terug langs
  `fallbackChain` (Duits/Frans/Spaans → Engels → Nederlands). Sleutels zijn getypt. Server (ook de eager-keten van
  `server.ts`): `getT(user.uiLanguage)`; client: `useT()` uit
  `src/components/I18nProvider.tsx`. Voortgang: `npx tsx scripts/i18n/check.ts`.
  Zet teksten per onderdeel om (niet alles tegelijk) en groepeer sleutels per
  onderdeel van de app. Codecommentaar en commitmessages blijven Nederlands.
- **Vertalingen bij iedere wijziging**: elke nieuwe of gewijzigde zichtbare
  tekst moet via het i18n-systeem lopen en worden meegenomen in alle talen die
  als `uiReady` beschikbaar zijn. Dit geldt ook voor foutmeldingen, API-responsen
  die aan gebruikers worden getoond, e-mails, pushmeldingen, bevestigingsdialogen,
  laad-/lege-/successtatussen en teksten in nieuwe functionaliteit. Voeg eerst
  de sleutel toe aan `nl.ts`, werk de andere taalbestanden bij en voer daarna
  `npx tsx scripts/i18n/check.ts` uit; een ontbrekende vertaling mag niet stil
  blijven staan als Nederlands of Engels in een beschikbare taal.
## Podcastafleveringen verwerken (`prisma/podcastContent.ts`)

De app kent meerdere podcasts (vaste lijst in `src/lib/podcasts.ts`, elk met
een eigen PODCAST-cursus, samen in de eigen contentcollectie "Podcasts"
(`content_podcasts`), los van het Boek van Mormon; die collectie heeft bewust
geen spellen). Afleveringen (titel, omschrijving, audio en, als
de feed die meegeeft, `transcriptUrl` uit `<podcast:transcript>`) komen per
podcast uit de feed via `syncPodcastFeed()`; alleen de oefeningen zijn
handwerk, in één contentbestand per podcast: `prisma/podcastContent.ts`
("Geloof je dat ook?") en `prisma/kastVanMormonContent.ts` ("De Kast van
Mormon"), geïmporteerd in `src/lib/seed.ts` met het podcast-id uit
`src/lib/podcasts.ts`. Afleveringsnummers zijn uniek per podcast.

Wanneer er nieuwe transcripten zijn (door de eigenaar aangeleverd in een
`VTT/`-map, of via `transcriptUrl` uit de feed) om te verwerken tot
leeroefeningen:

- **Structuur per aflevering** (zie bestaande entries in
  `prisma/podcastContent.ts` als voorbeeld): 4-5 `content`-oefeningen
  (MULTIPLE_CHOICE/TRUE_FALSE/SEQUENCE) die gaan over wat er **daadwerkelijk**
  in dat specifieke gesprek besproken wordt — geen generieke vragen — plus
  4 `bomConnection`-oefeningen die het gesprek verbinden aan één concreet,
  geverifieerd hoofdstuk/vers uit het Boek van Mormon. Sluit beide blokken
  af met een SEQUENCE-oefening.
- **`title`/`summary`**: gebruik altijd de placeholders
  `title: "Aflevering N"` en
  `summary: "Wordt bijgewerkt vanuit de podcastfeed."` — `syncPodcastFeed()`
  in `src/lib/podcastFeed.ts` overschrijft deze velden toch bij elke sync
  vanuit de RSS-feed, dus een eigen titel/samenvatting schrijven heeft geen zin.
- **Transcript lezen**: een `.vtt`-bestand bevat WebVTT-timestamps en
  `<v Speaker>`-tags; lees het gesprek inhoudelijk (wie zegt wat) in plaats
  van te parsen op basis van de cue-nummers/tijden.
- **BOM-verbinding kiezen en verifiëren**: zoek een hoofdstuk/passage die
  **inhoudelijk** aansluit bij het onderwerp van het gesprek (niet een
  toevallige losse zin), en haal de **exacte** Nederlandse verstekst op uit
  `prisma/bomContent.json` (bv. via een kort `python3 -c "..."`-scriptje) —
  nooit uit het geheugen citeren, parafrases moeten letterlijk kloppen met
  de brontekst.
- Vermijd bewust gevoelige/uit-context-provocerende passages als
  BOM-connectie (bv. "de grote en gruwelijke kerk" uit 1 Nephi 13) tenzij
  het gesprek daar expliciet over gaat.
- Varieer BOM-hoofdstukken zoveel mogelijk over de afleveringen heen;
  incidenteel hergebruik van eenzelfde hoofdstuk mag, mits met duidelijk
  andere verzen/thema en alleen als dat aantoonbaar de beste match is.
- Werk **per aflevering** dit patroon af: transcript lezen → onderwerpen
  bepalen → BOM-tekst zoeken en verifiëren → TS-object toevoegen aan het
  array → `npx tsc --noEmit`. Commit per 1-3 afleveringen naar de
  werkbranch (nooit rechtstreeks naar `main`).
- **Afsluitende validatie** nadat alle afleveringen zijn toegevoegd:
  `npx tsc --noEmit`, een lokale import-test tegen een Postgres-instantie
  (roep `importPodcastEpisodes()` uit `prisma/importPodcast.ts` rechtstreeks
  aan met het podcast-id en de array van die podcast, niet de volledige
  `runSeed()`, want die roept ook `syncPodcastFeed()` aan die netwerkverzoeken
  naar de echte RSS-feeds doet), controleer dat elke aflevering het verwachte aantal oefeningen
  heeft, ruim de testdata daarna weer op, en tot slot
  `rm -rf .next && npm run build`.

## Lokaal ontwikkelen

```bash
npm install
npm run db:generate         # Prisma-client in src/generated/prisma
npm run db:migrate:deploy   # of db:push tijdens actieve schema-iteratie
npm run db:seed
npm run dev                 # tsx server.ts, vereist een lokale/bereikbare Postgres + Redis
```

Belangrijke env vars (zie `.env.example`): `DATABASE_URL`, `REDIS_URL`,
`SESSION_SECRET`, `ALLOW_INSECURE_COOKIES` (alleen voor http-LAN-testen),
`APP_URL` (optioneel, anders auto-detectie uit het
verzoek), `PODCAST_FEED_URL` (optioneel). SMTP wordt niet via env
geconfigureerd maar via `/adminbackend` in de app zelf.

Vóór een taak als afgerond geldt: voer `npx tsc --noEmit` uit, test relevante
functionaliteit waar mogelijk handmatig via de dev-server/API, en voer
daarna een schone productiebuild uit met `rm -rf .next && npm run build`.


## Versiebeheer

Jehova.app bevindt zich momenteel in een intensieve beta-fase. Er zullen nog veel kleine bugfixes en verbeteringen plaatsvinden. Daarom vertegenwoordigt een versienummer een release en niet iedere individuele wijziging of deployment.

- Gebruik `package.json` als enige bron van waarheid voor de applicatieversie.
- De huidige beta-versie blijft op `0.x.0`-niveau; verhoog het versienummer alleen bewust voor een nieuwe release met relevante gebruikersgerichte wijzigingen.
- Verhoog de versie niet automatisch bij iedere commit, bugfix of deployment.
- Gebruik de Git commit SHA als technische build-identificatie. De combinatie van applicatieversie en korte SHA moet exact aangeven welke code gedeployed is.
- Toon de versie in de profiel-/informatieomgeving als bijvoorbeeld `v0.1.0 · beta · build abc1234`.
- Houd een `CHANGELOG.md` bij voor belangrijke gebruikersgerichte wijzigingen en releases. Registreer niet iedere kleine interne bugfix als aparte release.
- Gebruik `1.0.0` pas voor de eerste stabiele release.
- Houd het systeem eenvoudig zolang Jehova.app beta is; voeg geen complex release-management toe zonder concrete behoefte.


## Verificatie- en wijzigingsdiscipline

Dit project heeft eerder problemen gehad doordat meerdere kleine wijzigingen achter elkaar
werden gemaakt zonder tussentijds de volledige TypeScript/build-status te controleren. Dat
mag niet opnieuw gebeuren.

- **Een wijziging is pas klaar als de code ook aantoonbaar compileert.** Na iedere wijziging
  aan TypeScript/TSX moet minimaal `npx tsc --noEmit` worden uitgevoerd voordat een volgende
  gerelateerde codewijziging wordt gemaakt.
- Na een reeks wijzigingen aan één feature moet altijd een **schone productiebuild** worden
  uitgevoerd: `rm -rf .next && npm run build`. Alleen een groene GitHub Actions-build telt
  als bevestiging dat de gepushte commit daadwerkelijk door de productiebuild komt; als de
  workflow nog niet gestart is, mag niet worden gezegd dat de build geslaagd is.
- **Geen fout-op-fout stapelen.** Als een wijziging een compileerfout veroorzaakt, stop dan
  met nieuwe wijzigingen en los eerst de eerste fout op. Controleer daarna opnieuw met
  `npx tsc --noEmit`. Voeg geen tweede of derde "fix" toe op basis van aannames.
- Controleer na iedere wijziging de volledige gewijzigde functie/imports in de actuele versie
  van het bestand. Let vooral op imports die bij een eerdere wijziging zijn toegevoegd,
  verwijderd of verplaatst. Een ongebruikte import is vervelend, maar een gebruikte functie
  zonder import is een build-blocker.
- **Vertrouw niet op een eerdere claim dat iets werkt.** Controleer de actuele branch, de
  actuele commit en de actuele build-status zelf voordat je een volgende wijziging maakt of
  zegt dat iets klaar is.
- Bij meerdere samenhangende wijzigingen: werk eerst de implementatie uit, voer daarna de
  TypeScript-check uit, en maak pas daarna een volgende wijziging. Houd commits zo klein dat
  een fout direct aan één concrete wijziging te koppelen is.
- Als GitHub Actions meerdere rode commits laat zien, behandel die niet als afzonderlijke
  problemen zonder de logs te bekijken. Zoek eerst de **eerste inhoudelijke fout** en bepaal
  welke latere commits daarvan afhankelijk zijn. Repareer de onderliggende oorzaak in plaats
  van steeds een nieuwe workaround erbovenop te zetten.
- Voor een bugfix geldt: reproduceer of lokaliseer eerst de fout in de actuele code, lees de
  relevante bestaande implementatie en wijzig daarna zo minimaal mogelijk. Niet gokken,
  niet "blind" een import toevoegen of verwijderen omdat een foutmelding dat oppervlakkig
  lijkt te suggereren.
