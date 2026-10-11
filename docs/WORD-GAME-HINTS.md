# Woord van de Dag — betaald afvallend woordenboek

Werkbranch: `feature/word-game-paid-hints`, gestart vanaf main `042ae33`.
Dit is een uitbreiding van het bestaande spel, zonder wijziging van de zes
pogingen, feedback, FocusLayout, resultaten, XP, reeks of rangbonus.

## Regels en opslag

Iedere bevestigde hint kost exact één bestaande `User.hintBalance`. Er zijn
geen inbegrepen hints. Niveau 0 toont geen woorden. De huidige 716 unieke
vijfletterwoorden uit `prisma/bomWords.json` worden achtereenvolgens 716,
180, 50, 15 en 5 kandidaten. Opnieuw bekijken en zoeken kosten niets.

De eerste betaling maakt server-side een willekeurige keten van vijf lijsten.
Elke verkleining kiest echte kandidaten uit de vorige lijst en behoudt het
doelwoord. Alle lijsten staan alfabetisch; het doelwoord krijgt dezelfde
stringweergave, knopstijl en alfabetische positie als ieder ander woord.
Er wordt geen publiek voorspelbare seed gebruikt.

`WordGame.hintPools` bewaart de hele keten, een versie en de SHA-256 van de
oorspronkelijke lijst. `hintLevel` bepaalt wat betaald en zichtbaar is.
`hintPurchases` bevat maximaal vijf actionIds, niveaus en UTC-tijdstippen.
De API geeft alleen de huidige betaalde lijst terug, geen toekomstige subsets,
hash, aankooplog of doelwoord. Het bestaande `word`-veld blijft null tot afloop.

Een aangepaste bronlijst verandert betaalde lijsten niet. Hun oorspronkelijke
woorden blijven geldige guesses voor dat potje. Nieuwe onbetaalde potjes
gebruiken de actuele bron. Bij een toekomstige kleinere bron worden de
aantallen begrensd tot echte verkleiningen; zodra één kandidaat overblijft
stopt de hintprogressie. De gewone woordkeuze blijft ongewijzigd.

De additieve migratie `20261011130000_word_game_paid_hints` voegt alleen drie
WordGame-velden en `User.wordGameLastHintAt` toe. Historische potjes beginnen
met niveau 0; er is geen achterafbetaling of wijziging van oude resultaten.
De migratie moet vóór het starten van de nieuwe appversie worden toegepast.

## Betaling, concurrency en wachttijd

`POST /api/word-game/hint` vereist authenticatie en een strikt verzoek met
gameId, UUID-actionId en expectedLevel. Tijd, saldo en kandidaatclaims van de
client zijn niet toegestaan.

Eén Prisma-transactie lockt het eigen WordGame-record en daarna User. Dat past
bij de bestaande sessie → gebruiker-volgorde; er wordt geen inverse lock
geïntroduceerd. De server controleert eigendom, voortgang/log/selectie,
accounttijdzone en actuele woorddag, IN_PROGRESS, maximum, verwachte voortgang
en de accountbrede wachttijd. Een conditionele voorraadupdate (`hintBalance > 0`)
schrijft één hint af en registreert het tijdstip. Kandidaten, niveau en
aankooplog worden in dezelfde transactie opgeslagen. Een databasefout rolt
dit alles terug.

Een reeds opgeslagen actionId wordt vóór cooldown/status/dagwissel herkend.
Dezelfde aankoop herhalen kost niets; een gewijzigde expectedLevel bij die id
wordt afgewezen. Na een dagwissel herstelt een oude retry de huidige gameview,
zonder een nieuwe aankoop. Gelijktijdige verschillende verzoeken worden door
de locks en expectedLevel geserialiseerd. De client bewaart een onverwerkte
actionId in geheugen en waar mogelijk sessionStorage, ook bij netwerkfouten.

Het betaalmoment wordt na eventuele lockwachttijd bepaald. De volgende aankoop
kan vanaf precies `wordGameLastHintAt + 60 minuten`, zonder afronding naar
klokuren. Om 18:00 begint een nieuw potje met niveau 0, terwijl deze accountbrede
wachttijd blijft lopen. Raden en betaald woordenboek bekijken blijven mogelijk.

Alleen na commit zendt de server het bestaande `hints_changed`-signaal.
`hintsChanged` invalideert games én wordGame. `useHintInventory` en
`jsonMutation` tonen de servervoorraad direct en verversen via de bestaande
live-data-laag bij mutations, focus, hervatten en reconnect. Er is geen tweede
saldo, extra XP-aftrek of hintwinkel; de bestaande shop blijft de aankoopplek.

## Interface en uitleg

Een compacte kaart onder het bestaande raadveld bevat voorraad, hintactie en
gratis toegang tot het woordenboek. Een woord kiezen vult alleen het raadveld;
insturen blijft een aparte actie. Zoeken filtert uitsluitend de vrijgegeven
kandidaten. De lijst heeft een eigen begrensde scrollruimte.

De native bevestigingsmodal hergebruikt het bodyportal-, sheet-, safe-area- en
focusherstelpatroon van PuzzleHintPanel. De bestaande vs-tokens,
btn-primary/btn-secondary, input/card en Lucide-iconen worden gebruikt. De
browser-toplaag blokkeert achtergrondinteractie. Annuleren, Escape en sluiten
kosten niets; de bevestiging toont de juiste nieuwe lijstgrootte en voorraad.
Dubbelklikken wordt direct met een ref geblokkeerd. De hintknop blijft tijdens
cooldown aanspreekbaar en legt de resterende minuten/seconden uit.

De vijf UI-talen bevatten alle nieuwe teksten en `gamesHub.wordGame.rule4`.
Speluitleg en Kompas lezen deze vierde regel; alleen het Woord-van-de-Dag-
Kompas-onderwerp gaat naar uitlegversie 2.

Bij 320 px met 200% tekst maakte de bestaande niet-afbrekende leaderboardrij
de hele pagina te breed. Alleen die rij mag nu wrappen; de ranking blijft
ongewijzigd. Hintacties schuiven eveneens naar een eigen regel wanneer nodig.
De modal breekt op woordgrenzen en behoudt bereikbare, intern scrollbare
knoppen; zijn bodyportal volgt ook de bestaande `vs-motion`-regel.

## Aangepaste onderdelen

- Opslag: `prisma/schema.prisma` en migratie `20261011130000_word_game_paid_hints`.
- Server: `src/lib/wordGame.ts`, `wordGameHintRules.ts`, `wordGameHints.ts` en
  `src/app/api/word-game/hint/route.ts`.
- Interface/live data: `WordGameClient.tsx`, `WordGameHintPanel.tsx`,
  `useServerCountdown.ts` en `src/lib/data/scopes.ts`.
- Uitleg: de vijf i18n-bestanden, `LiveLobbyForm.tsx` en Kompas registry/resolve.
- Tests: de drie `tests/word-game-hints.*`-bestanden, de lokale Docker-runner,
  twee npm-scripts en `.github/workflows/word-game-hints.yml`.
- Documentatie: dit rapport, `DATA-REFRESH.md`, `LAYOUT.md`, `TIJD.md` en
  `docs/evidence/word-game-hints/`.

## Controle en resterende grenzen

`npm run test:word-game-hints:integration -- --browser` maakt een eigen lokale
PostgreSQL 16-container, past alle migraties toe, draait de nieuwe unit/DB-tests
en de bestaande `test:time`, en test daarna de echte productie-app/API. Nooit
productie of een gedeelde database. Voor de browsertest eerst een productiebuild
en Playwright via `PLAYWRIGHT_MODULE`; lokaal kan `CHROMIUM_PATH` worden gezet.
De GitHub Actions-workflow bewaart browserbeelden en meetgegevens.

De databasecontrole dekt vijf niveaus, kosten, stabiele subsets, exact 60 minuten,
raadpogingen tijdens cooldown, lege voorraad, eigendom/payload/versie, parallelle
verzoeken, retries, 18:00, echte transactionele rollback, winst/verlies, ongewijzigde
XP/reeks en de bestaande winkelvoorraad. De bestaande tijdtests controleren
ook tijdzones, zomertijd, het klassement en eenmalige rangbonus.

De browsercontrole dekt 320/375/390/430/768/1280 px en 844×390 landscape,
licht/donker, 100/200% tekst, andere talen, focus/annuleren, dubbelklik,
verloren betaalresponse, cooldown, kiezen versus raden, hervatten/inloggen,
winkel, afronden en realtime tussen twee apparaten. Native iOS/Android en
Safari zijn hiermee niet fysiek getest; dit is Chromium met touch-emulatie.

Uitgevoerd op 11 oktober 2026, met nul overgeslagen databasecontroles:

| Controle | Resultaat |
| --- | --- |
| Nieuwe unit- en PostgreSQL-integratietests | 14 geslaagd |
| `npm run test:time`, inclusief bestaande DB-tests | 29 geslaagd |
| Bestaande geïsoleerde puzzel-/hintvoorraad-/winkeleconomietests | 40 geslaagd |
| `npm run test:live-data` | 51 geslaagd |
| `npm run test:focus` | 23 geslaagd |
| Kompas unit/layout | 60 geslaagd |
| Productie-browser | 28 viewport/thema/tekstcombinaties, vier aanvullende talen en volledige betaalflow geslaagd |
| TypeScript, Prisma-validatie, schone productiebuild | geslaagd |
| ESLint | nul fouten; 132 bestaande waarschuwingen, geen nieuwe in gewijzigde hintcode |
| i18n | geslaagd; alle nieuwe teksten vertaald, bestaande 423 ontbrekende vertalingen per andere taal ongewijzigd |

De browser test ook de daadwerkelijke tekstregels, modalpositie, focus,
begrensde woordenlijst en reduced motion; niet alleen CSS-klassen.
Visueel gecontroleerde beelden staan in [evidence/word-game-hints](evidence/word-game-hints/):
`dictionary-390.png`, `confirmation-390-100-light.png`,
`confirmation-320-200-light.png` en `confirmation-1280-100-dark.png`.
GitHub Actions herhaalt de productiebuild en de nieuwe integratie/browsercontrole
op de gepushte commit. Geen merge naar main zonder afzonderlijke instructie.
