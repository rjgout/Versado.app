# Jehova

Een algemene, interactieve leeromgeving voor schriftstudie — op een speelse,
motiverende manier. Momenteel bevat de app één cursus/contentcollectie: het
Boek van Mormon (in het Nederlands). Het datamodel (boeken, hoofdstukken,
verzen, cursussen) is bewust niet aan dat ene schriftwerk gebonden, zodat
er later andere collecties bij kunnen (bv. de Leer en Verbonden of de Parel
van Grote Waarde) zonder herbouw. "Geloof je dat ook?" is de naam van de
meegeleverde podcastcursus, een aparte contentbron binnen de app — niet de
naam van de app zelf.

Gebouwd om **zelf gehost** te worden: een self-contained Docker-opzet met
een echte PostgreSQL-database en persistente volumes, zonder afhankelijkheid
van een specifieke cloud-hostingprovider.

## Functionaliteit

- **Accounts & sessies**: registreren/inloggen/account verwijderen (AVG) via
  een httpOnly session-cookie. Zelf je wachtwoord resetten via "Wachtwoord
  vergeten?" op de inlogpagina (mailt een resetlink) en accountbevestiging
  per e-mail bij registratie: het account wordt pas aangemaakt (en je bent
  meteen ingelogd) als je op de link in de mail klikt; tot dan is het alleen
  een aanmelding. Onbevestigde accounts van vóór die stap worden na 30 dagen
  zonder activiteit opgeruimd. Beide werken pas zodra een admin e-mail heeft
  geconfigureerd (zie **Adminbeheer** hieronder); zonder die configuratie
  maakt registreren direct een account en werkt de app gewoon door zonder
  ergens op te blokkeren.
- **Privacyvriendelijke gebruikersnaam**: je gebruikersnaam wordt bij registratie
  automatisch aangevuld met een uniek nummer (bv. `Jan#83173`), zodat
  iedereen dezelfde naam kan kiezen en je nooit je e-mailadres hoeft te
  delen om door vrienden gevonden te worden. Vindbaar via e-mailadres is een
  losse instelling op je profiel, standaard uit.
- **Reader**: hoofdstukken lezen met een duidelijk kruimelpad (Boek → Hoofdstuk),
  instelbare lettergrootte, donkere modus, bladwijzers, highlights, eigen
  notities per vers, en een zoekfunctie over de hele tekst.
- **Oefeningen**: ontbrekend woord kiezen uit meerkeuze-opties, woorden in de
  juiste volgorde aantikken, en waar/niet-waar — bewust **nooit typen**, zodat
  spelling nooit in de weg zit. Je ziet direct per vraag of het goed was
  (met het juiste antwoord erbij) vóórdat je doorgaat, en aan het einde van
  de les een "Leermomenten"-scherm om gemiste vragen nog eens te proberen
  (of over te slaan). Elke oefening is gekoppeld aan een concreet vers
  (`sourceVerseId`) en heeft een content-status (`APPROVED`/`DRAFT`/...) als
  fundament voor een latere handmatige-of-AI-controleworkflow.
- **XP**: elke mutatie is een auditbare `XPTransaction` (niet zomaar een
  teller) — reden, bedrag en tijdstip zijn altijd te herleiden.
- **Dagelijkse reeks & reeksbevriezingen**: je verdient reeksbevriezingen met
  mijlpalen (een reeks van 7 dagen, of elke 10 voltooide hoofdstukken), ze
  beschermen automatisch je reeks als je een dag mist, en je kunt ze
  weggeven aan vrienden.
- **Vrienden**: verzoeken sturen/accepteren, elkaars reeks en XP zien. Wie
  zijn online-status deelt, krijgt een melding bovenin als een vriend (die dat
  ook deelt) online komt, zolang de app open staat; geen pushmelding. Uit te
  zetten bij de meldingen op het profiel.
- **Meldingencentrum**: een bel in de header met alle uitnodigingen, beurten,
  verzoeken en uitslagen, per groep en uitklapbaar. Tikken opent de melding
  en haalt hem weg; vegen of ✕ wist hem. Push en e-mail gaan alleen als de
  app nergens open staat; het getal op het app-icoon is het aantal meldingen
  in de bel.
- **Wekelijkse competitie met divisies**: acht divisies, van Zaad tot
  Eeuwigheid, in groepen van maximaal 30 spelers. De bovenste 75% van een
  groep promoveert (naar beneden afgerond, altijd minstens één; instelbaar
  per groep die daarna ontstaat) en de onderste 10% degradeert (3 van een
  volle groep van 30, een kleinere groep naar verhouding). Alleen wie die
  week XP verdient doet mee; een week niet oefenen laat je divisie staan.
  Berekend zodra je voor het eerst die week actief wordt — geen aparte
  cron-taak nodig. Het klassement toont hoe lang de week nog loopt
  (eindigt maandag 00:00 UTC), de promotie- en degradatiezone en
  medailles voor plek 1-3; je profiel telt hoeveel gouden, zilveren en
  bronzen medailles je verdiende (afgeleid uit eerdere weken, alleen als
  er iemand onder je eindigde).
- **Achievements**: badges voor mijlpalen (eerste reeks van een week, eerste
  hoofdstuk, 1000 XP, eerste reeksbevriezing verdiend/weggegeven, eerste vriend,
  eerste gewonnen duel), zichtbaar op je profiel.
- **Live multiplayer-quiz**: maak een spel aan voor een hoofdstuk, nodig
  vrienden uit (real-time pop-up als ze de site open hebben, of deel de
  code), en speel gelijktijdig dezelfde invuloefeningen met een live
  scorebord (via Socket.io, met Redis als adapter).
- **Legpuzzel** (`/jigsaw`, onder Spelen): hergebruikt de 216 illustraties uit
  de kinderverhalen van het Boek van Mormon, met 6, 12, 24 of 48 stukjes.
  Gericht op touch: slepen of een stukje en zijn plek aantikken, met grote
  bladerknoppen voor de losse stukjes, een voorbeeld en een hulpafbeelding.
  Beschikbaar bij alle bestaande taaluitgaven van het Boek van Mormon;
  de bediening is vertaald in Nederlands, Engels, Duits en Frans.
  Na de migratie zet een beheerder **Legpuzzel** aan bij de spelinstellingen
  in `/adminbackend`. De koppelingen per content-uitgave staan daar ook.
  Geen XP of tijdslimiet; de server controleert plaatsingen. Voortgang geldt
  alleen zolang de puzzel open blijft (maximaal 24 uur).
- **Privacy**: alleen functioneel noodzakelijke cookies (geen tracking, dus
  geen cookiebanner nodig), een privacy- en cookiebeleid, en zelf je account
  + alle gegevens kunnen verwijderen.
- **Adminbeheer** (`/adminbackend`): de allereerste registratie op een
  verse installatie wordt automatisch admin (geen aparte setup-stap nodig);
  die admin ziet
  een overzicht met statistieken (gebruikers/boeken/hoofdstukken/oefeningen),
  kan andere gebruikers admin maken, kan zelf een wachtwoordreset voor een
  gebruiker initiëren (toont eenmalig een tijdelijk wachtwoord om zelf door
  te geven; de gebruiker moet er bij de eerstvolgende login direct een eigen
  wachtwoord voor kiezen), en beheert daar ook de **e-mailinstellingen**:
  een generieke SMTP-configuratie (host/poort/gebruiker/wachtwoord/afzender)
  die met elke dienst werkt — een Microsoft 365-mailbox, Gmail met een
  app-wachtwoord, of een eigen mailserver — gebruikt voor accountbevestiging
  en de "wachtwoord vergeten"-mail. Het wachtwoord wordt versleuteld
  opgeslagen (afgeleid van `SESSION_SECRET`), er is een "testmail versturen"-
  knop, en zonder (werkende) configuratie wordt nergens op e-mailbevestiging
  geblokkeerd.

## Snel starten met Docker (aanbevolen)

Eén commando start de hele stack: de app, PostgreSQL (met een persistent
volume) en Redis.

```bash
cp .env.example .env
# open .env en vul POSTGRES_PASSWORD, REDIS_PASSWORD en SESSION_SECRET in
docker compose up -d --build
```

De app draait daarna op `http://localhost:3000`. Zet zelf een reverse proxy
(Cloudflare Tunnel, Nginx, Caddy, Traefik, ...) ervoor als je 'm publiek
bereikbaar wil maken onder je eigen domein — zie
[`docs/DEPLOY-SYNOLOGY.md`](docs/DEPLOY-SYNOLOGY.md) voor een volledig
uitgewerkt voorbeeld met een Synology NAS + Cloudflare Tunnel, inclusief
automatische updates.

Content laden (eenmalig, en telkens wanneer je content toevoegt/wijzigt):

```bash
docker exec jehova-app npm run db:seed
```

Dit kan ook zonder terminal: een admin-account heeft op `/adminbackend` een
knop "Content opnieuw laden" die precies hetzelfde doet. Herhaald laden is veilig:
ongewijzigde content wordt overgeslagen (oefen-id's, antwoordgeschiedenis, XP, lessen en
beheerinstellingen blijven), er loopt nooit meer dan één import tegelijk en een gewijzigde
vraag wordt geversioneerd in plaats van vervangen. Zie `docs/CONTENTBEHEER.md`.

Zie **Architectuur** hieronder voor wat elke container doet, en **Back-ups**
voor hoe je de database veiligstelt.

## Auteursrecht van de brontekst

De tekst van het Boek van Mormon is auteursrechtelijk beschermd door De Kerk
van Jezus Christus van de Heiligen der Laatste Dagen. De verzen in
`prisma/bomContent.json` zijn de officiële Nederlandse tekst en worden met
toestemming gebruikt; `npm run db:seed` laadt ze. Deel dit bestand niet los
met een instantie die die toestemming niet zelf heeft geregeld.

Een andere (toegestane) bron laden kan via:

```bash
docker exec jehova-app npm run db:import -- /pad/naar/bestand.json
```

(kopieer het bestand eerst de container in met `docker cp`). Zie de
comments in `prisma/import.ts` voor het verwachte JSON-formaat.

De voorgelezen hoofdstukken zijn audio van de kerk. De seed spiegelt ze naar
de eigen server (`AUDIO_DIR`, zie `src/lib/audioMirror.ts`) en de app biedt
ze alleen aan ingelogde gebruikers aan, niet als openbare download.

De tekst en illustraties van de kindercursus komen uit **"Verhalen uit het
Boek van Mormon"** (© 1980, 1988, 1999 De Kerk van Jezus Christus van de
Heiligen der Laatste Dagen; illustraties: Jerry Thompson en Robert T.
Barrett) — met toestemming gebruikt, in tegenstelling tot de hoofdtekst van
het Boek van Mormon zelf. Deel dit dus niet zomaar verder met een instantie
die deze toestemming niet apart geregeld heeft.

## Architectuur

| Container      | Rol                                                                 | Persistent? |
|----------------|----------------------------------------------------------------------|-------------|
| `jehova-app`   | Next.js-app + API-routes + de live-quiz Socket.io-server            | Nee — stateless, vervangbaar zonder dataverlies |
| `jehova-db`    | PostgreSQL — alle gebruikers, voortgang, XP, reeksen, reeksbevriezingen, vrienden, competitie, quizresultaten en content | Ja — Docker-volume `jehova_db_data` |
| `jehova-redis` | Redis, actief gebruikt als Socket.io-adapter voor de live multiplayer-quiz | Nee — tijdelijke, vervangbare realtime-state |

`jehova-app` is bewust stateless: hij is op elk moment te verwijderen en
opnieuw te starten (bv. bij een update) zonder dataverlies, omdat alle
persistente data in `jehova-db` staat. Redis wordt écht gebruikt (niet als
ongebruikte infrastructuur): elke room-broadcast van de live-quiz loopt via
de Socket.io-Redis-adapter, wat het ook mogelijk maakt om later — zonder de
multiplayer-architectuur te herbouwen — meerdere `jehova-app`-instanties
tegelijk te draaien.

## Lokaal ontwikkelen zonder Docker

Zet voor productie altijd `APP_URL=https://jouw-domein.nl` (alleen de oorsprong,
zonder pad). Host- en forwarded-headers bepalen geen e-maillinks meer. Voor een
lokale productiebuild mag bijvoorbeeld `APP_URL=http://localhost:3000`.
Met `FEEDBACK_RECIPIENT_EMAIL` kies je expliciet de feedbackontvanger; zonder
deze instelling blijven meldingen in `/adminbackend` en worden ze niet gemaild.
De ingestelde ontvanger wordt op de feedbackpagina aan de indiener getoond.
Bij de beveiligingsupdate vervallen eerder uitgegeven feedbackbeheerlinks;
meldingen blijven beschikbaar in het ingelogde beheer. Uitloggen trekt alle
sessies en open socketverbindingen van het account in.

```bash
npm install
npm run db:generate   # Prisma-client in src/generated/prisma (staat niet in git)
# start zelf een lokale PostgreSQL en Redis, en zet DATABASE_URL/REDIS_URL
# in .env (zie de voorbeelden onderaan .env.example)
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Tijdens actieve ontwikkeling van het schema kan `npm run db:push` (zonder
migratiebestanden aan te maken) handiger zijn; gebruik `npm run
db:migrate:dev -- --name <omschrijving>` om een nieuwe migratie vast te
leggen zodra een schemawijziging klaar is voor productie/commit.

## Techstack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma (migrations in `prisma/migrations/`)
- Redis + `@socket.io/redis-adapter` voor de live multiplayer-quiz (via een
  custom server, zie `server.ts` / `src/server/gameServer.ts`)
- Docker Compose met healthchecks, `depends_on: condition: service_healthy`
  en herstart-policies voor alle services

## Back-ups

```bash
./scripts/backup.sh            # -> backups/bom-<tijdstip>.dump
./scripts/restore.sh backups/bom-20260101T000000Z.dump
```

De database staat volledig in het Docker-volume `jehova_db_data`. Een
container verwijderen en opnieuw starten laat de data intact; alleen het
expliciet verwijderen van dat volume (`docker volume rm ...`) is destructief.

## Beperkingen van deze versie / bewuste scope voor latere fasen

- Live-spel-uitnodigingen komen alleen real-time binnen bij vrienden die op
  dat moment de site open hebben; anders deel je de speelcode handmatig.
- Er draait momenteel één `jehova-app`-instantie: de Redis-adapter zorgt dat
  Socket.io-broadcasts er al klaar voor zijn, maar het live-spel-geheugen
  zelf (spelersscores tijdens een actief spel) leeft nog in het geheugen van
  die ene instantie — voor meerdere instanties tegelijk zou dat ook naar
  Redis moeten verhuizen.
- Het datamodel heeft al `Person`/`Place`/`Topic` (en de koppeltabellen naar
  verzen) als fundament, maar er zijn nog geen profielpagina's of
  thema-filters gebouwd.
- **Cursussen**: naast de drie manieren om door de boekcontent te gaan — van
  voor naar achter (één vaste volgorde door alles), vrije keuze, en per boek —
  staat er nu ook een **podcastcursus** (`Geloof je dat ook? podcast`). Elke
  aflevering krijgt twee losse oefenrondes: "Inhoud van de aflevering" en
  "Verband met het Boek van Mormon" (de laatste koppelt de aflevering aan een
  passend hoofdstuk — voor aflevering 127 is dat de bestaande Alma 5-content).
  Je kan op `/courses` wisselen zonder je voortgang te verliezen; een cursus
  wisselen verandert alleen welk hoofdstuk het dashboard als "Vandaag"
  voorstelt, of stuurt je (bij de podcastcursus) naar de afleveringenlijst.
  De vrije boek/hoofdstuk-lijst daaronder blijft altijd bereikbaar.

  Elke keer dat content opnieuw geladen wordt (`npm run db:seed`, of de
  "Content opnieuw laden"-knop op `/adminbackend`) wordt ook de podcastfeed
  (`https://geloofjedatook.nl/@geloofjedatook/feed.xml`, overschrijfbaar via
  de env var `PODCAST_FEED_URL`) opgehaald: nieuwe afleveringen verschijnen
  daardoor vanzelf met de juiste titel/omschrijving/link, en bestaande
  afleveringen krijgen die gegevens bijgewerkt als ze in de feed veranderen.
  Dit raakt nooit de oefeningen zelf — die blijven handwerk (zie
  `prisma/podcastContent.ts`) — dus een nieuwe aflevering staat er met
  "oefeningen volgen nog" totdat daar begrijpend-lezen-vragen voor zijn
  geschreven. Is de feed niet bereikbaar, dan wordt dat alleen gelogd; de rest
  van `db:seed` gaat gewoon door.

  Er is ook een **kindercursus** ("Verhalen uit het Boek van Mormon"),
  gebaseerd op het gelijknamige officiële, geïllustreerde kinderboek van de
  kerk (met toestemming gebruikt — zie **Auteursrecht** hieronder). Alle 54
  verhalen staan erin, elk met een paar automatisch gegenereerde
  FILL_BLANK/WORD_BANK/TRUE_FALSE-vraagjes uit de verhaaltekst zelf, plus één
  plaatjesspel per verhaal (`IMAGE_CHOICE`): welke van vier afbeeldingen
  (één van dit verhaal, drie afleiders van andere verhalen) hoort hierbij?
  De content staat in `prisma/kidsManifest.json` (tekst + afbeeldingspaden,
  geëxtraheerd uit de PDF) en wordt geïmporteerd door `prisma/importKids.ts`.

  Thema- en personencursussen (op basis van het al aanwezige `Topic`/`Person`-
  datamodel), een leesplan-met-einddatum, een herhalingscursus en een
  bladwijzers-cursus staan gepland maar zijn nog niet gebouwd.
- **Snelle ronde** (`/practice`): een korte, hoofdstukloze oefensessie uit al
  voltooide hoofdstukken — beschermt je dagelijkse reeks (met minder XP dan een volledige
  les) zonder een cursus vooruit te helpen, zodat een gemiste dag in je
  van-voor-naar-achter-cursus nooit je reeks hoeft te kosten.
- **Begrijpend lezen**: naast de drie automatisch gegenereerde oefeningtypes
  zijn er nu ook `MULTIPLE_CHOICE` (vrije vraag + N opties — kernboodschap,
  motivatie, wie-zei-dit) en `SEQUENCE` (gebeurtenissen in de juiste volgorde
  zetten). Deze worden bewust **niet** automatisch gegenereerd — zie
  `ComprehensionExercise` in `prisma/content.ts` voor het handmatige formaat.
- Geen AI-contentworkflow (het `status`-veld op `Exercise` staat er wel klaar
  voor), en nog geen extra spelmodi naast het Schriftduel (verspuzzel/blitz/
  streak battle e.d.).

## Zelf hosten op een Synology NAS (Docker + Cloudflare Tunnel)

Zie [`docs/DEPLOY-SYNOLOGY.md`](docs/DEPLOY-SYNOLOGY.md) voor een volledig
uitgewerkt voorbeeld: Docker-images die via GitHub Actions automatisch
gebouwd en gepubliceerd worden zodra je naar `main` pusht, hoe je 'm onder
je eigen domein achter een Cloudflare Tunnel zet, en een "Deployen &
onderhoudsmodus"-paneel in `/adminbackend` waarmee je met één klik update:
bezoekers zien tijdens het updaten een nette onderhoudspagina in plaats van
een foutmelding, en een nieuwe versie die de gezondheidscontrole niet haalt
wordt automatisch teruggedraaid naar de vorige, werkende versie. Dezelfde
aanpak werkt met kleine aanpassingen op elke andere Docker-host.
