# Fase 1D — Spelavailability en beheercontent

## Status en grenzen

Werkbranch: `codex/content-architecture-v2-1d`, oorspronkelijk vanaf `ab69c15`
(PR #89), nu samengevoegd met `origin/main` `e817f1d` (PR #91).
Geen eigen Prisma-schemawijziging of migratie ten opzichte van de nieuwe main.
De bestaande multiplayer-migratie uit PR #91 wordt behouden en uitsluitend op
eigen testdatabases toegepast. Geen productiequery, deploy of merge naar main.
Deze PR maakt de onderstaande correcties reviewbaar.

**Fase 1 is nog niet volledig af te sluiten:** Snelle Zendeling bewaart geen
bronidentiteit in `QuickMissionaryRun`. De Genees-vragen gebruiken momenteel
`activeCollectionId(userId)` in `src/lib/snelleZendeling/runs.ts`, ook wanneer
de run vóór een contentwissel begon. Volledig herstel van de oorspronkelijke
bron voor nieuwe Genees-vragen vereist een afzonderlijk goedgekeurde
schema-uitbreiding. Die stap is conform de opdracht gestopt; er is geen veld
misbruikt om de ontbrekende bron stiekem op te slaan.

## Bewezen beginsituatie

- `getContentContext` gaf ruwe GameContentScope-sleutels door. Een scope
  bewees geen beschikbare woorden, hoofdstukken, vragen of afbeeldingen.
- `isGameVisible` liet beheerders uitgeschakelde spellen normaal gebruiken.
  Verschillende start-API's controleerden uitsluitend authenticatie of een
  instelling; directe starts konden het aanbod omzeilen.
- Adminscope-GET beperkte collecties tot bofm/DC/PGP; PUT controleerde alleen
  of het collectie-ID bestond. Ook Woordzoeker ontbrak in de PUT-sleutels.
- Actieve spellen leidden sommige bronlabels uit veranderlijke scopes af;
  die labels konden daardoor een verkeerde bronwissel bij hervatten veroorzaken.
- Woordzoeker las globale plaatsnamen zonder bron-/taalgrens.
- De V1/V2-puzzelroutes toetsten iedere actie aan de actuele bron/scope.
  Woordzoeker deed dat ook bij ophalen en mutaties van bestaande partijen.
  Daardoor blokkeerde een bronwissel bestaande partijen.
- Een niet gevonden BOM-editie werd in `pickRandomChapterIds` een undefined
  filter, waardoor willekeurige andere bronnen in de pool konden komen.
- De compacte `/content` uit PR #89 had het taalblok vóór de brongroepen.
  Er was geen centraal, expliciet beheer-overzicht van verborgen uitgaven.

## Contentkiezer en beheeringang

De volgorde is nu Schriften → Studieprogramma's → contenttaal. Vijf compacte
taalknoppen, directe bron-/taalselectie, editievalidatie en oorspronkelijke
vertrekcontext blijven intact. Geen kaartaccordions, toolbar, overlay,
sticky taalblok of extra taalselectie per kaart.

Een servergeautoriseerde `isAdmin`-prop toont onder het taalblok uitsluitend
een rustige link **Beheercontent bekijken**. De gewone kaarten blijven voor
admins net zo beperkt als voor normale gebruikers. Dezelfde ingang staat
op Adminbackend → Content.

## Afzonderlijke beheercontext

`/adminbackend/content/inspect` begint met `requireAdminPage`. De GET-API
`/api/admin/content-inspection` weigert anonieme gebruikers met 401 en
normale gebruikers met 403 vóór contentqueries; responses hebben no-store.
Er is geen mutatie-API voor deze kiezer.

De service leest werkelijke ContentWorks en ContentCollections: werksoort,
ID, naam, familie, taal, enabled/zichtbaarheid en publicatiestatus. Ook lege
werken blijven in het werkfilter zichtbaar. Er is geen hardcoded lijst met
zeven werken. Native filters voor werk, familie en taal werken over dezelfde
geauthenticeerde metadata. LiveQuery gebruikt de bestaande content-scope en
een sessiegebonden cachekey; fouten verbergen de oude dataset.

Herbruikte bouwstenen: AdminPageHeader, AdminSection, Versado-tokens,
SubpageBackBar, ShellMetrics, NavigationScroll, `useLiveQuery`, i18n en
bestaande normale/expliciete-previewrechten.

### Previewondersteuning

| Content | Uitkomst |
|---|---|
| SCRIPTURE met echte Book/Chapter/Verse-leestekst (inclusief bestaande OTB, BOM, DC en PGP) | Bestaande ReaderView met `preview`, exact collectie-ID; geen nieuwe reader |
| FSY | Link naar het bestaande FSY-beheerblok, geen tweede beheerimplementatie |
| Overige bronnen/families of ontbrekende leestekst | Expliciet preview niet ondersteund; geen gefingeerde reader |

De OTB-preview behoudt haar oude work/language-ingang. De nieuwe ingang
gebruikt `collectionId`, dat server-side op de echte SCRIPTURE-werkrelatie
wordt gecontroleerd. Vorige/volgende hoofdstukken houden hetzelfde ID.
Disabled/DRAFT/verborgen inhoud kan uitsluitend in deze expliciete
beheercontext gelezen worden. De normale hoofdstuk-API blijft dit weigeren,
ook voor admins. De reader heeft geen annotatie-, leesregistratie- of
beloningsbediening. GET/preview schrijft geen voorkeur of voortgang.

## Beschikbaarheid van bestaande spellen

`gameAvailabilityPolicy.ts` beschrijft uitsluitend bewezen bestaande
capabilities, aansluitend bij GAME_CATALOG. `gameAvailability.ts` toetst
normale contentrechten (ook voor admins), ContentWork.kind, werk/familie/taal,
GameSettings, de vereiste scope en echte inhoud. De aangeboden gameKeys zijn
nu de gecontroleerde uitkomst. Dezelfde controle beschermt directe starts en het legacy contentwisselcontract
voor spelroutes. Een ruwe scope geeft ook daar geen geldig route-equivalent.
Er is geen nieuwe game-engine, lesadapter of algemene resolver.

| Spel | Bestaande pool/capability |
|---|---|
| Woordzoeker | Officiële BOM-familie, vijf bestaande talen; werkelijke kandidaten voor alle generatorconfiguraties. Plaatsnamen alleen via echte verskoppeling in NL; geen ongevertalde metadata in andere taalpools |
| Woord van de Dag | Vaste Nederlandse BOM-vijfletterwoorden; geen nieuwe bronadapter |
| Woordspel | Bestaand vast Nederlands BOM-woordenboek |
| Legpuzzel V1/V2 | Bestaand kinderboekmanifest plus gekoppelde puzzelvragen, alle bestaande afbeeldingen behouden |
| Raad het hoofdstuk | Vaste BOM-hoofdstukken met kop/verzen; voldoende voor het aangevraagde aantal; onmogelijke aantallen niet selecteerbaar |
| Gezinsavond | Bestaande BOM-hoofdstukpool en alle gebruikte TRUE_FALSE/FILL_BLANK/WORD_BANK-categorieën |
| De Slimste Heilige | Geldige ingeschakelde vragen, onderwerpen, puzzel, galerij en geheugen; bestaande vertalingen gecontroleerd |
| Mysterie | Bestaande vaste BOM-puzzeldefinities; geen automatische uitbreiding naar andere werken |
| Snelle Zendeling | Bestaande BOM-arcadelevels; Genees-bronbehoud blijft de hierboven genoemde blokkade |
| Live-oefeningen/Uitdagingen | Bestaande bofm/DC/PGP-hoofdstukadapter, echte APPROVED-oefeningen, exact gekozen hoofdstuk/bronrechten |
| Samen studeren | Bestaande concrete cursusadapter, normale collectie-/cursusrechten, liveExercises-instelling en echte beschikbare units; bestaande podcastadapter blijft bestaan |

Voor vaste Nederlandse BOM-spellen wordt ook de normale toegang tot hun
werkelijke Nederlandse bron gecontroleerd. Een BOM-uitgave in een andere
gekozen taal maakt die vaste pools niet tot een nieuwe vertaalde speladapter.
UI-taal en gameplay blijven volgens hun bestaande contracten werken.

Onbeschikbaar betekent geen start, geen lege partij, geen voorkeurwijziging,
geen BOM-fallback en geen XP/reeks/hintmutatie. API-fouten en de melding bij
terugkeer naar Spelen zijn vertaald in de vijf UI-talen.

Adminscope-GET en PUT gebruiken dezelfde capabilities. PUT vereist Origin,
strikte payloadvalidatie en weigert enabling voor uitgeschakelde of technisch
ongeschikte collecties. Een oude ongeldige scope mag expliciet uitgezet worden;
er is geen automatische verwijdering. De beheer-UI begrenst de toggles tot
ondersteunde spel/collectiecombinaties. Scope blijft een aanbodinstelling en
is geen automatische publicatie of bewijs van voldoende inhoud.

### Starts tegenover hervatten

- Puzzelacties/resume valideren normale rechten op de vaste oorspronkelijke
  BOM-puzzelcontent; eigenaar, snapshot, versie en actionId blijven in de
  bestaande service gevalideerd. Actuele settings/scopes/bron blokkeren
  nieuwe starts, niet een eerder opgeslagen geldige poging.
- De actieve-spellenlijst gebruikt hoofdstuk-/cursus-FK's of de bewezen
  vaste bron, geen actuele aanbodscopes als identiteit van historische partijen.
- Woordzoeker gebruikt de opgeslagen `contentCollectionId` en eigenaar.
  Een User-rijlock voorkomt dubbele gelijktijdige eerste partijen. Geen
  snapshot of geldige puzzel wordt vervangen door een nieuwe bronkeuze.
- Bestaande dagelijkse woordspellen/dagquizruns blijven via hun vastgelegde
  rij bereikbaar; nieuwe dagen/starts worden op availability getoetst.
- Woordspel en hoofdstukraad-acties behouden eigenaarschapvalidatie en krijgen
  een normale rechtencontrole op de vaste BOM-bron, zonder nieuwe-startscope.
- Socket-joincontroles voor oefeningen, hoofdstukraden, Gezinsavond, Slimste
  Heilige, Samen studeren en Snelle Zendeling gebruiken de opgeslagen
  hoofdstuk/cursus of hun bewezen vaste BOM-bron. Geen impliciete
  adminpreview via realtime; bestaande settings/scopes worden niet opnieuw
  als nieuwe-startvoorwaarde opgelegd.
- Seizoensavonden verwijzen eerst naar een al lopende avond voordat een
  nieuwe-startcontrole wordt uitgevoerd.
- Arcade-runpagina's controleren eigenaar en oorspronkelijke vaste
  BOM-rechten, zonder actuele nieuwe-startscope. Het ontbreken van opgeslagen
  bronidentiteit voor latere Genees-vragen is hiermee **niet** opgelost.

## Testbewijs

Onderstaande controles zijn lokaal uitgevoerd; GitHub Actions controleert
de gepushte commit opnieuw. Alle DB-tests gebruiken eigen lokale wegwerpcontainers met
synthetische gegevens; geen productieaccounts, contentexport, seed of
productiemigratie.

- TypeScript, Prisma-validatie, schone productiebuild: geslaagd.
- ESLint: geen fouten; 132 bestaande waarschuwingen, geen nieuwe waarschuwingen.
- i18n: alle 26 nieuwe sleutels in vijf talen; 423 bestaande ontbrekende
  vertalingen per secundaire taal blijven afzonderlijke bestaande schuld.
- Eerste regressiesuite, inclusief beheer: 162 geslaagd, geen skips.
- Aanvullende spel/tijd/economie/Kompas-regressies: 254 geslaagd, geen skips.
- Contentintegratie: 127 geslaagd (110 bestaande + 17 gerichte 1D-tests),
  nul skips. De negen bestaande admin-layouttests zitten ook in de eerste regressiesuite.
  Migratiebehoud van 126/127 eerdere tabellen is opnieuw gecontroleerd;
  collectie-ID's/edities, 21 collecties, zeven werken, zes zichtbare/vijftien
  verborgen en synthetische FSY-publicatie-/conceptrecords blijven behouden.
- Puzzelintegratie: 40 geslaagd, nul skips, inclusief volledige catalogus,
  vraagflow/hints/replay en Kompas-DB-tests. Woordspelhintintegratie: 14 + 29
  geslaagd, nul skips (tijd, gameplay, betalingen, cooldown en ranking).
  Alle vijf bestaande puzzelbrowsertests zijn ook lokaal geslaagd op de
  expliciet gestarte productiebuild (flow, mobiel, drag, moeilijkheden, hints).
- Productie-Playwright: gewone kiezer op 320×844, 375×844, 390×844, 430×932,
  768×1024, 1280×900 en 844×390; light/dark en 100/200% tekst (28 varianten).
  Lange labels in alle vijf UI-talen, directe bron/taalkeuze, equivalenten,
  unavailable/edities, errorfocus, dubbele tik, late responses, back/forward
  en scrollherstel zijn opnieuw uitgevoerd.
- Beheerkiezer: 320×844, 390×844, 768×1024, 1280×900, 844×390, beide thema's
  en beide tekstgroottes (20 varianten); echte metadata, werk/taalfilter,
  OTB-preview, geen wijziging van voorkeur/beloning. Gewone header-/kaart- en
  Woordzoeker-browserregressies blijven in dezelfde runner.
- Realtime: 37 echte socketcontroles geslaagd, inclusief beide rollen en
  hidden/disabled/DRAFT bij alle zes bestaande live-modi. Een bestaande
  partij hervat vanuit Podcasts met nieuwe-startsettings uit.
- De eerste CI-puzzelbrowsertest gebruikte directe requests zonder Origin
  en kreeg terecht 403. De test stuurt nu dezelfde geldige Origin als een
  browser; de productieguard is behouden.
- De lokale puzzelrunner miste NODE_ENV=production; de Next-devtoolsportal
  bedekte de rotatieknop. De runner start nu expliciet de productiebuild,
  met behoud van de oorspronkelijke interactieasserties en puzzelengine.
- De eerste socketrun faalde op dubbele synthetische gebruikersnamen.
  De fixture is gecorrigeerd; de afzonderlijke socketrun is daarna groen.

Browserbewijs staat buiten Git in `/tmp/versado-layout-browser` en als
`header-wordsearch-browser` CI-artifact (7 dagen). Voorbeelden:
`content-picker-390x844-light-100.png`,
`admin-content-390x844-light-100.png`,
`admin-content-844x390-dark-200.png`. De browsercatalogus bevat een extra
synthetische uitgave voor de expliciete editie-keuzetest; screenshots zijn
geen nieuwe productie-inventaris. Alleen Chromium is uitgevoerd, geen
fysieke iPhone/Android of WebKit/Capacitor-uitrol.

## Aanvullende performancereview — 12 oktober 2026

Naar aanleiding van de [review bij PR #90](https://github.com/rjgout/Versado.app/pull/90#issuecomment-6126061450)
is vóór de applicatiewijziging een nulmeting uitgevoerd op `ca1f58d`.
De extra belasting was daarmee gemeten, niet uitsluitend vermoed:
`canStartGame()` bouwde eerst de volledige contentcontext met alle pools op
en controleerde vervolgens de gevraagde game nogmaals.

### Meetmethode en resultaten

De bestaande geïsoleerde PostgreSQL-16-runner bouwt de synthetische 21-collectie/
zeven-werkenfixture met de bestaande migraties. De benchmark voegt 250
hoofdstukken, 1.500 oefeningen en 553 vormgeldige Alleskenner-onderdelen toe.
BOM en Podcasts zijn voor deze test expliciet toegankelijk. Het brede
scenario heeft alle elf bekende scopes en alle GameSettings aan; daarnaast
zijn één scope en geen scopes afzonderlijk gemeten. Dezelfde fixture,
Node-versie (24.19.0), Prisma-client, PostgreSQL-versie en `NODE_ENV=production`
zijn vóór en na gebruikt; geen productiebenchmark of productiegegevens.

Per scenario: tien opwarmingen, daarna tachtig sequentiële serviceaanroepen.
Queryaantallen zijn echte Prisma-SQL-queryevents, inclusief afzonderlijke
relatiequeries; geen geschatte telling van delegate-aanroepen. Mediaan is
het gemiddelde van de middelste twee gesorteerde samples, p95 de 76e sample.
Uitvoering via dezelfde TSX-serviceomgeving als de integratietests; tijden
sluiten HTTP, authenticatie, Next-rendering en netwerk naar een NAS uit.
De oorspronkelijke productiebuild was aanwezig; na de wijziging is opnieuw
schoon gebouwd en de echte Next-productiebuild apart met HTTP/browser/socket
getest. Dit zijn servicemetingen, geen beloofde gebruikerslatenties.

| Scenario | Queries vóór → na | Mediaan vóór → na (ms) | p95 vóór → na (ms) |
| --- | ---: | ---: | ---: |
| `getContentContext`, BOM / alle scopes | 47 → 16 | 23,791 → 16,793 | 33,111 → 25,442 |
| `getContentContext`, Podcasts / alle scopes | 29 → 7 | 7,822 → 3,468 | 10,054 → 4,511 |
| `getContentContext`, BOM / één scope | 10 → 8 | 3,856 → 3,672 | 5,383 → 4,777 |
| `getContentContext`, BOM / geen scopes | 5 → 5 | 2,039 → 2,259 | 2,482 → 3,041 |
| `canStartGame`, toegestane jigsaw / BOM met alle scopes | 53 → 5 | 25,023 → 2,146 | 37,725 → 2,784 |
| `canStartGame`, geweigerde jigsaw / Podcasts | 34 → 3 | 9,811 → 1,173 | 19,205 → 1,502 |

De toegestane directe start gebruikt circa 91% minder queries en heeft in
deze fixture circa 91% lagere mediane servicetijd. Het brede BOM-overzicht
gebruikt circa 66% minder queries. Het scenario zonder scopes houdt precies
dezelfde vijf queries; de lichte tijdstijging (0,22 ms mediaan) is afzonderlijk
vermeld. Er is geen betrouwbaarheidsinterval of productiecapaciteitsclaim;
kleine tijdverschillen en p95 zijn gevoelig voor hostbelasting. Een tweede
nameting en de CI-budgetcontrole bevestigen de queryaantallen, zonder
flaky harde tijdgrenzen te introduceren.

### Gerichte wijziging en beveiliging

- `getActiveGameCollection()` hergebruikt de bestaande bron-/taalkeuze in
  `contentCollections.ts`, met normale serverrechten. Een expliciete,
  verborgen, DRAFT, uitgeschakelde of ontbrekende actieve collectie geeft
  geen vervangende BOM. Oude gebruikers zonder expliciete voorkeur behouden
  de bestaande eerste-werk/taalkeuze uit echte toegankelijke edities,
  zonder voorkeurmutatie of synthetische collectie.
- `canStartGame()` controleert uitsluitend de gevraagde game. Het roept geen
  `getContentContext()` aan en laadt geen andere spelpools, switcherinstellingen
  of studiecontext. Rechten op de vaste BOM-bron blijven vereist waar de
  bestaande adapter die gebruikt.
- `availableGameKeys()` deelt één collectie-/rechtenresultaat, GameSettings
  en scopeverzameling per aanroep. Dezelfde hoofdstuktelling en oefenpool
  worden intern gedeeld. Niet-ondersteunde/uitgeschakelde/ongescopeerde games
  bereiken hun pools niet. Een lege scopelijst veroorzaakt geen extra
  collectie- of poolqueries.
- De interne promises leven alleen tijdens deze aanroep. Geen globale,
  React- of langdurige toestemmingscache; na adminwijzigingen worden rechten,
  publicatie, settings, scopes en pools bij de volgende aanvraag opnieuw
  gelezen. De normale adminrechten blijven gescheiden van expliciete preview.
- Resume-, spelregel-, belonings-, bronselectie-, studiecontext- en preview-
  contracten zijn behouden. Geen migratie, adapter, Genees-wijziging of
  wijziging van lokale Mysterie-concepten.

### Reproduceerbaarheid en regressiebescherming

```sh
AVAILABILITY_PERFORMANCE_REPORT=/tmp/versado-availability.json \
  node scripts/content-architecture/test-access-isolated.mjs \
  --availability-performance --assert-budget
```

Voor de nulmeting vervalt `--assert-budget`. De runner negeert een externe
databasebinding, start uitsluitend zijn eigen lokale Docker-container,
controleert host/database, gebruikt synthetische inhoud en ruimt die database
weer op. Alleen aantallen/modelnamen en runtimes worden geëxporteerd, geen
SQL, credentials, gebruikersgegevens of privétekst. Rapporten blijven buiten
Git. De reguliere `test:content-access:integration` voert deze querybudget-
en versheidscontrole automatisch uit in de bestaande GitHub Actions-job.

Nieuwe regressies controleren normale versus adminrechten, twee onafhankelijke
gebruikers, geen fallback bij ingetrokken toegang, gebruikers zonder voorkeur,
verse settings/scopes/publicatie, gelijkheid tussen losse checks en gedeeld
aanbod en behoud van economie/voortgang. SQL-budgetten zijn maximaal
16/7/8/5 queries voor de vier contextscenario's en 5/3 voor de directe starts.
Voor jigsaw worden bovendien nul hoofdstuk-, oefen-, Alleskenner-, naam-,
switcher- of studiecontextqueries geëist.

Hercontrole: TypeScript, Prisma en schone productiebuild geslaagd; 169
basisregressies, 284 aanvullende spel/tijd/economie/navigatieregressies en
130 content/API/contextintegratiechecks geslaagd, zonder skips. ESLint:
nul fouten, dezelfde 132 bestaande waarschuwingen. Geen i18n-wijzigingen;
de bestaande 423 ontbrekende sleutels per secundaire taal blijven zichtbaar.
De volledige productie-browsermatrix is opnieuw geslaagd: 28 bestaande
shell/Woordzoeker-combinaties en 48 contentkiezer/beheercombinaties, vijf
talen, 320–1280 px, portrait/landscape, licht/donker en 100/200% tekst.
Ook alle 37 echte socketcontroles, 40 puzzel-DB-tests en alle vijf
productie-puzzelbrowsercases en 43 woordspelhint-/tijd-/gameplaychecks zijn
opnieuw geslaagd. Geen tests overgeslagen. De negen Actions op de exact
gepushte nieuwe HEAD worden bij oplevering in PR #90 gerapporteerd.
Omdat GitHub voor de performancepush geen automatische runs registreerde,
zijn de bestaande workflows ook handmatig op de exacte branch te starten.
De Docker-workflow heeft daarvoor nu eveneens `workflow_dispatch`;
registry-login en imagepublicatie blijven uitsluitend bij `push` (alleen
`main`). Handmatige reviewruns bouwen images zonder ze te publiceren.
De synthetische browserserver logde ook afgebroken responsestreams, mislukte
testfeedrequests en twee `user.update`-fouten; alle browserasserties en
runners slaagden. Deze afzonderlijke testserverlogs zijn niet als succesvolle
productievalidatie geïnterpreteerd en hun oorzaak is niet aanvullend onderzocht.

### Resterende prestatierisico's

Een breed BOM-overzicht controleert nog steeds echte pools: Alleskenner
leest en valideert de beschikbare onderdelen; Woordzoeker leest brongebonden
namen. Grotere toekomstige pools en echte NAS-/netwerklatenties zijn niet
gemeten. Request-local hergebruik is geen snapshotgarantie bij wijzigingen
tijdens dezelfde aanvraag; het bestaande TOCTOU-risico is niet verruimd en
geen recht wordt langdurig vastgezet. De afzonderlijk te beoordelen bronopslag
voor Snelle Zendeling/Genees en lokale Mysterie-drafts blijven open.

## Integratie met PR #91 — review van 12 oktober 2026

De [laatste review](https://github.com/rjgout/Versado.app/pull/90#issuecomment-6128948050)
vroeg de reeds gemergede Legpuzzel-multiplayer te behouden. `origin/main`
`e817f1d4882ca29d53c5a588dd488cfde7b5595b` is daarom met een normale
merge op deze werkbranch geïntegreerd, zonder rebase, force-push of merge
naar main. Dit voegt geen nieuwe multiplayerfase of spelregels toe.

### Conflicten en automatische samenvoegingen

Negen bestanden overlapten; alleen twee hadden echte tekstconflicten:

- `JigsawV2Client.tsx`: behoud van `allowStarts`, Solo-hervatten, Canvas,
  drag-elevatie, hints en brede CTA's, gecombineerd met de drie bestaande
  modi Solo/Samen/Tegen elkaar, FriendPicker, grote cooppuzzels en wedstrijden.
- `activeGames.ts`: behoud van vastgelegde hoofdstuk-/cursusbronnen en de
  bewezen vaste BOM-bronnen. De oude `gameContentScope`/`singleScope`-afleiding
  is niet teruggebracht; multiplayeractiviteiten krijgen de vaste kids/BOM-
  bron en blijven zichtbaar bij een andere huidige contentkeuze.

De automatische merges van `LiveLobbyForm`, de vijf i18n-bestanden en
`gameServer` zijn inhoudelijk gecontroleerd. De multiplayerregistratie,
events, speluitleg en nieuwe vertalingen zijn behouden naast de normale
bronrechten, kaartavailability en opgeslagen-bronvalidatie van fase 1D.
`gameAvailability.ts` en `contentCollections.ts` zijn bytegelijk aan de
goedgekeurde performancecode op `8d06ec8` gebleven.

### Nieuwe starts versus bestaande partijen

PR #91 gebruikte actuele contentkeuze/settings voor vrijwel alle acties,
ook lezen en hervatten; de socketguard had bovendien een adminbypass en
een vijftien-seconden-cache van GameSettings. Dat paste niet bij het
fase-1D-contract. De integratie maakt het onderscheid expliciet:

- Alleen `createCoopSession`/`createMatch` beoordelen een **nieuwe** start
  via dezelfde `canStartGame(userId, "jigsaw")`, vóór variant-/sessiewrites.
  Normale rechten, actuele collectie, technische ondersteuning, settings,
  scope en de echte kids-/vraagpool blijven vereist. Geen BOM-fallback
  voor een ongeldige actuele keuze en geen adminpreviewbypass.
- Bestaande state/sync/locks/commits/hints/invites en wedstrijdpogingen
  gebruiken normale toegang tot de bewezen vaste kids/BOM-bron, plus de
  bestaande eigenaar-/deelnemer-/uitnodigingscontroles. Een bronwissel,
  verdwenen startscope of uitgeschakelde startsetting reset/blokkeert
  geen geldige bestaande poging. Verborgen, disabled en DRAFT bronrechten
  worden ook voor beheerders geweigerd.
- `puzzle/access.ts` is een kleine serverhelper voor dit bestaande vaste
  broncontract, geen nieuwe speladapter of algemene resolver. De service-
  checks gelden ook voor socket-/interne serviceaanroepen. De routes
  controleren sessie en Origin bij POST en weigeren extra rootvelden.
- De HTTP-/SSR-hervatpaden en puzzelhub bewaren zowel Solo als bestaande
  Samen-/wedstrijdpartijen en uitnodigingen. Een geweigerde nieuwe start
  verbergt de modes/catalogus maar niet het bestaande partijenoverzicht.
- Realtime join/sync/lock/renew/commit en tijdelijke drag controleren
  normale oorspronkelijke bronrechten, zonder GameSettings/admincache.
  Een niet-deelnemer wordt door de bestaande services geweigerd.
  Locks kunnen bij disconnect nog veilig worden vrijgegeven; deadlines
  worden door onderhoud afgehandeld, ook bij tijdelijk ingetrokken toegang.
  Er zijn geen gewijzigde vergrendelingsvolgorde, klok-, vraag-, hint-, XP-
  of reeksregels. Match-state controleert deelname vóór luie settlement.
- Tijdens de audit bleek een werkelijke uitnodigingsbug: de overzichtsknop
  stuurde `sessionId` waar `inviteId` vereist is en navigeerde ook na fouten.
  De knop gebruikt nu het juiste contract en navigeert uitsluitend na
  succesvolle acceptatie; de gecombineerde browserregressie dekt dit.

### Nieuwe-main-migratie en gecombineerd testbewijs

Er zijn 136 bestaande migraties, inclusief
`20261026100000_puzzle_multiplayer` uit main. Schema en migratiebestanden
verschillen niet van `origin/main`. De verse eigen PostgreSQL-16-fixture
past ze alle toe en herhaalt migrate deploy zonder duplicaten. De
expand/compatibiliteitscontroles bewaren 131/132 eerdere tabellen, alle
21 collectie-ID's/edities, zeven werken, zes zichtbaar/vijftien verborgen,
16 gepubliceerde/21 concept-FSY-records en gebruikersvoortgang/annotaties.
Er is geen productie-DDL, backup, restore, seed of import uitgevoerd.

Lokaal opnieuw uitgevoerd:

- Prisma generate/validate, TypeScript en schone productiebuild: groen.
- 251 gerichte basis/content/puzzle/Kompas-unit-/architectuurchecks: groen.
- 132 content-/API-/contextchecks, inclusief multiplayer-startrechten,
  CSRF/payload, geen writers bij afwijzing, twee gebruikers, uitnodiging,
  actorisolatie, dubbele commit/actionId en dubbele beginpoging: groen.
- 40 Solo + 18 Samen/wedstrijd-DB-tests: groen, geen skips.
- 2 echte multi-instance-regressies: twee productie-`server.ts`-processen,
  eigen PostgreSQL en **eigen** Redis 7, cross-instance aanwezigheid,
  locks/deltas, concurrent commits, herconnect/herstart, notificaties,
  wedstrijdsignalen en privacy: groen.
- Alle vijf Solo-productiebrowsersuites en de multiplayerbrowsertest uit
  PR #91: groen. Deze laatste test ook bronwissel naar Podcasts met
  nieuwe-startsetting uit en acceptatie/hervatten via de echte hubknop.
  300 stukken: 477 frames, mediaan 16,7 ms en p95 16,8 ms in Chromium.
- ESLint: 0 fouten, 133 waarschuwingen: de eerdere 132 plus de ongewijzigde
  ongebruikte `beginMatchAttempt`-import uit de PR-91-browsertest. De vijf
  UI-talen hebben ieder 3.522/3.945 sleutels; dezelfde 423 bestaande
  ontbrekende vertalingen per secundaire taal. Geen nieuwe i18n-schuld.
- Shell/Woordzoeker: 28 browsercombinaties; contentkiezer/beheer: 48
  browsercombinaties (320–1280 px, landscape, licht/donker, 100/200% tekst,
  vijf talen): groen. Alle 45 sockets (37 eerdere + 8 multiplayerrechten),
  202 aanvullende spel/tijd/economie/navigatietests en 43 woordspelhint-/
  tijd-/gameplayintegratiechecks: groen, geen skips.
- De negen Actions op de nieuwe exacte merge-HEAD worden bij oplevering
  in PR #90 gerapporteerd; alleen reviewbuilds, geen imagepublicatie.

De bestaande geïsoleerde puzzelrunner en bestaande CI-job voeren nu ook de
18 nieuwe DB-tests, de twee-instance-suite, oorspronkelijke multiplayer-
prestatiemeting en zesde browsersuite uit met `--browser --multiplayer`.
Geen parallel framework of externe Redisbinding. Browserbewijs omvat
`/tmp/mp-*.png` in het bestaande `puzzle-v2-browser` artifact, waaronder
`mp-resume-source-switch-390.png`.

### Querybudget en prestatie na integratie

Een herhaling op dezelfde verse 21-collectie/zeven-werkenfixture, met de
nieuwe main-migratie, dezelfde toegevoegde pools, tien opwarmingen en
tachtig samples, bevestigt alle querybudgetten. De hier gerapporteerde
laatste meting is uitgevoerd nadat de multiplayerbrowser was afgesloten:

| Scenario | Queries | Mediaan ms | p95 ms |
| --- | ---: | ---: | ---: |
| BOM alle scopes | 16 | 14,343 | 18,719 |
| Podcasts | 7 | 3,052 | 3,842 |
| BOM één scope | 8 | 3,425 | 4,741 |
| BOM geen scopes | 5 | 2,264 | 3,187 |
| Toegestane directe puzzelstart | 5 | 2,016 | 3,370 |
| Geweigerde directe puzzelstart | 3 | 1,481 | 1,723 |

Een eerdere parallelle meting tijdens browserbelasting had dezelfde
queryaantallen maar bijvoorbeeld 53,915 ms p95 voor BOM alle scopes.
Dit onderstreept de bestaande hostbelastingsbeperking; geen harde tijdgrens
of claim over NAS-/HTTP-latentie. Het querybudget blijft het reproduceerbare
regressiecontract.

Ook de oorspronkelijke vier-speler-servertest uit PR #91 is uitgevoerd,
inclusief normale bronchecks in acties en zonder instellingen-/rechtencache:

| Stukken | Snapshot KB | Commit p50/p95 ms | State p95 ms | Patch-sync ms |
| --- | ---: | ---: | ---: | ---: |
| 24 | 1,8 | 35,5 / 61,8 | 35,7 | 9,0 |
| 48 | 3,5 | 27,3 / 44,4 | 18,2 | 8,1 |
| 96 | 7,1 | 27,3 / 41,6 | 14,9 | 7,8 |
| 150 | 11,5 | 26,0 / 40,1 | 14,9 | 6,4 |
| 300 | 24,1 | 27,3 / 41,1 | 14,4 | 6,1 |

Delta's blijven ongeveer 150–180 bytes; snap p95 maximaal 0,3 ms. Dit is
één lokale machine, geen fysieke telefoon of multi-host-netwerk. De
openstaande Snelle Zendeling/Genees-bronopslag, lokale Mysterie-drafts en
eerder geaccepteerde backup-herstelrisico's zijn niet opgelost of gewijzigd.

## Databehoud en privacy

Geen migraties of wijziging van bestaande sleutels/relaties. Geen nieuw User-
veld, StudyLesson, spelrecordmodel, valuta, beloning of annotatiemodel.
Productie is niet benaderd. Preview/keuze maakt geen ReadingSession,
ContentProgress, CourseProgress, UserStudyContext, persoonlijke annotatie,
XP-/reeksactiviteit of podcastpositie aan. Geweigerde starts zijn met
voor/na-metingen van gebruikersvoorkeuren, context en economie getest.

## Openstaande uitrolvoorwaarden

1. Afzonderlijke beoordeling van de ontbrekende arcade-bronopslag. Minimaal
   voorstel: nullable collectie-ID bij QuickMissionaryRun, nieuwe starts
   bewaren de gevalideerde exacte editie, Genees gebruikt die FK. Voor oude
   runs moet een bewezen bestaande vraagkoppeling of een expliciet
   compatibiliteitsbeleid gelden; onbekende oorspronkelijke bronnen niet
   gokken. Geen migratie zonder afzonderlijke toestemming.
2. Mysterie bewaart sommige onafgemaakte lokale varianten niet als actieve
   serverpartij. De bestaande inhoud blijft vast BOM; een volledige
   cross-source hervatgarantie voor die lokale drafts is niet geclaimd.
3. Lobbystarts zonder bestaand actionId-contract behouden hun bestaande
   meervoudige-lobbygedrag. Ze geven geen beloning; er is geen nieuw generiek
   idempotentiesysteem toegevoegd. Dagspel, puzzel en Woordzoeker beschermen
   hun bestaande poging tegen herhaalde/concurrente creatie.
4. Rechten kunnen wijzigen tussen beschikbaarheidscontrole en latere
   gameplay. Concrete frozen pool-/revisiesessies en speladapters horen bij
   latere goedgekeurde fasen; niet als verborgen schemawijziging in 1D.
5. Dagelijkse Synology Hyper Backup blijft door de eigenaar beheerd.
   De eerdere aanvullende herstelproef is bewust overgeslagen. Deze PR
   claimt geen onafhankelijk bewezen productieherstelbaarheid.

## Uitrol en rollback

- Concept-PR beoordelen, bovenstaande blokkades oplossen/afzonderlijk
  beslissen en GitHub Actions op de exacte gepushte commit controleren.
- Pas na afzonderlijke toestemming mergen en via het bestaande
  Synology-deploypaneel een expliciet gekozen image uitrollen. Automatische
  `prisma migrate deploy` bij containerstart blijft bestaan, maar deze PR
  bevat geen nieuwe migratie.
- Voor/na controleren: normale bron-/taalkeuze, verborgen read-afwijzing,
  beheerinspectie, exacte OTB-preview, FSY-beheer, geldige nieuwe starts,
  hervatten na bronwissel en ongewijzigde economie/progressie.
- Rollback: vorige appimage met dezelfde database; geen DDL, backfill,
  records verwijderen, seed, contentreload of snapshots herschrijven.
  Terugrollen herintroduceert de oudere availabilitygaten en is dus een
  expliciete tijdelijke herstelkeuze.

Fase 2-readers, CFM/FSY-conversie, volledige contentresolver, nieuwe adapters
of spelregels zijn niet gestart.

## Belangrijkste gewijzigde bestanden

- `src/components/content/FullscreenContentPicker.tsx`, `/content/page.tsx`:
  taalpositie, expliciete beheeringang.
- `src/lib/adminContentInspection.ts`, `src/components/admin/AdminContentInspectionClient.tsx`,
  `/adminbackend/content/inspect`, `/api/admin/content-inspection`:
  authentiek metadata-overzicht en sessiegebonden live-data.
- `/adminbackend/content/page.tsx`, `/adminbackend/content-preview/page.tsx`,
  `AdminFsyClient.tsx`, `SubpageBackBar.tsx`: beheerroute en veilige readers.
- `gameAvailabilityPolicy.ts`, `gameAvailability.ts`, `gameStartGuard.ts`,
  `study/startAvailability.ts`, `gameCatalog.ts`, `contentCollections.ts`,
  `contentSwitch.ts`, `activeGames.ts`, `wordSearch/content.ts` en
  `wordSearch/game.ts`: capabilities, pools, source-scoping en hervatten.
- `/api/admin/game-scopes`, normale spelstart-/hervat-API's en setup-/sessiepagina's;
  `src/server/gameServer.ts`, `alleskenner.ts`, `study.ts`, `quickMissionary.ts`:
  serverautoriteit en bestaande realtime-resources.
- Aanvullende review: `scripts/content-architecture/benchmark-availability.mjs`,
  de bestaande `test-access-isolated.mjs`-runner en drie extra
  `game-availability.integration.test.ts`-regressies.
- Alle vijf i18n-bestanden, gerichte nieuwe API/policy/sockettests,
  bestaande contentwissel-/pickerbrowsertests en twee bestaande CI-workflows.

De volledige bestandslijst en commits staan in de concept-PR. Er zijn geen
schema-, migratie-, globale CSS-, contentasset- of beloningswijzigingen.
