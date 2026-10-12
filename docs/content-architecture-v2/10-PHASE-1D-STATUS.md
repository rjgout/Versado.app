# Fase 1D — Spelavailability en beheercontent

## Status en grenzen

Werkbranch: `codex/content-architecture-v2-1d`, vanaf `origin/main` `ab69c15`
(merge PR #89). Geen Prisma-schemawijziging, migratie, productiequery, deploy
of merge. Deze PR maakt de onderstaande correcties reviewbaar.

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
- Alle vijf i18n-bestanden, gerichte nieuwe API/policy/sockettests,
  bestaande contentwissel-/pickerbrowsertests en twee bestaande CI-workflows.

De volledige bestandslijst en commits staan in de concept-PR. Er zijn geen
schema-, migratie-, globale CSS-, contentasset- of beloningswijzigingen.
