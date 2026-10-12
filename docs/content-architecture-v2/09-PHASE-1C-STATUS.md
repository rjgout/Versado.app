# Fase 1C — fullscreen contentkiezer

Vervolg: [compacte visuele polish](09-PHASE-1C-POLISH.md) vervangt de hieronder
beschreven kaartaccordions, talenrijen en previewknoppen. De technische
selectie-, shell- en beveiligingscontracten blijven behouden.

## Basis en scope

Werkbranch `codex/content-architecture-v2-1c`, vanaf `origin/main` `29ec1d1`
(merge fase 1B, PR #87). Bij aanvang waren er geen nieuwere main-commits.
De eigenaar bevestigt dat fase 1A/1B in productie draaien. Deze fase gebruikt
geen productieverbinding, queries, contentimport, seed, deployment of DDL.
Het Prisma-schema en alle migraties blijven ongewijzigd.

Hergebruikt: ContentWork/publicatie- en toegangsservice uit 1A; studiecontext
uit 1B; contentCollections/contentRouting/contentSwitch; bestaande Focus-shell,
ShellMetrics, SubpageBackBar, NavigationScroll/navigationHistory; ContentIcon,
PageIntro, officiële bronassets, VS-tokens; centrale live-data en Kompas.

## Oorspronkelijke knelpunten

- De headerkiezer combineerde een portal, dropdownpositionering, eigen
  scrollberekeningen en een bevestigingsdialoog. Die publieke dropdown is weg.
- De oude vertrekroute kwam rechtstreeks van de pagina met de dropdown.
  Zonder apart vertrekcontract zou de nieuwe serverflow `/content` ontvangen.
- De taalresolver kon automatisch een andere editie-familie kiezen.
- Een expliciete collectie-update wijzigde niet altijd contentLanguage mee.
- Een lege catalogus leverde een synthetisch selecteerbare BOM-collectie op.
- Een late succesvolle mutatie na terugnavigatie kon de headernaam verouderd
  achterlaten. De nieuwe header volgt dezelfde live servercontext als de
  contentgebonden querykeys.

## Route, header en ontwerp

`src/app/content/page.tsx` vereist de bestaande sessie; anonieme bezoekers
krijgen `/login`. `FullscreenContentPicker` is een zelfstandige routepagina,
geen dialog of overlay. `/content` gebruikt Focus-modus maar telt niet als
leeractiviteit. De bestaande vaste terugbalk blijft zichtbaar; globale header
én ondernavigatie verdwijnen. `.page-fill` volgt de gemeten shellpadding en
safe areas. Geen tweede scrollcontainer, header, toolbar of handmatige offset.

PageIntro, rustige VS-surfaces/randen, bestaande bronafbeeldingen en een
responsieve grid met een rem-minimum vormen het scherm. Bij grote tekst
schakelen de kaarten ook in landscape naar één kolom. Alle kaarthoogtes zijn
flexibel. Een vinkje, tekst en aria-pressed maken de selectie herkenbaar.
Knoppen hebben minimaal 48 CSS-pixels hoogte. De paginatitel ontvangt focus
bij openen; gewone selectieknoppen ondersteunen Enter en spatie. Tijdens
verwerken blijft focus behouden; één centrale lock voorkomt herhaalde acties.

De header is een semantische link, met behouden ResizeObserver-weergave
(volledige naam, afkorting of icoon), ContentIcon en het bestaande
`data-kompas-target="content-switcher"`. Kompas-onderwerp en rondleidingen zijn
in alle vijf UI-talen bijgewerkt. De publieke dropdown/portal en oude
bevestigingsdialoog zijn verwijderd; andere adminpreviews blijven bestaan.

## Catalogus, podcasts en rechten

`GET /api/content-context?view=picker` geeft één werk met exacte edities terug,
met ContentWork.kind als serverclassificatie. SCRIPTURE staat onder Schriften;
STUDY_PROGRAM onder Studieprogramma’s. Podcasts blijven OTHER, als aparte
herkenbare rij binnen die tweede groep; geen les- of weekcontext. Andere
beschikbare OTHER-werken kunnen in dezelfde groep verschijnen met een
algemene toelichting, zonder tot studieprogramma te worden omgeclassificeerd.

Gewone gebruikers zien uitsluitend collecties met geldige werkidentiteit,
LEGACY/PUBLISHED, enabled en visibleToUsers. Ongeldige editie-/taalmetadata
wordt niet selecteerbaar. Administrators kunnen verborgen catalogusitems
herkennen, maar de normale selectie blijft geweigerd. Voor de bestaande OTB-
collecties is uitsluitend een afzonderlijke link naar de bestaande expliciet
geautoriseerde adminpreview beschikbaar. FSY wordt niet zichtbaar gemaakt en
krijgt geen nieuwe preview of leskiezer. DRAFT en disabled blijven uitgesloten.

Een lege catalogus toont twee duidelijke lege groepen, zonder selecteerbare
standaard-BOM. Het oude niet-null `ContentContext.active` behoudt uitsluitend
voor bestaande clients zijn historische labelplaceholder; collections/works
zijn leeg. De nieuwe picker gebruikt activeCollectionId=null. De laatste
productie-inventaris (21/7/6/15) is alleen testfixture, nooit UI-inhoud.

## Selectie- en taalcontract

De bestaande geauthenticeerde PUT-route krijgt additief `picker:true` en
`expectedSelection:{activeContentCollectionId,contentLanguage}`. De oude
responsevormen en force-flow blijven voor bestaande clients behouden. De
nieuwe picker gebruikt geen force/confirm. Strikte Zod-validatie accepteert
geen userId, admin- of previewrechten uit de payload. De bestaande Origin-
controle is ook op deze voorkeurmutatie toegepast. Responses zijn no-store.

De nieuwe flow gebruikt pickTargetCollection met `familyPolicy="exact"`:
expliciete collectie-ID kiest exact die editie en taal; taalwissels blijven
binnen dezelfde familie. Ontbrekende combinaties geven een herstelbare melding
zonder mutatie. Alle beschikbare exacte edities zijn bewust te kiezen via de
kaartdetails; taalnamen komen uit languages.ts. User.uiLanguage verandert niet.
Voor oude profile-/API-clients blijft de historische resolverfallback expliciet
behouden; de nieuwe pagina gebruikt deze fallback niet.

Een transactie vergrendelt de eigen User-rij, valideert de doelcollectie opnieuw
onder normale rechten, vergelijkt het oude bron-/taalpaar en schrijft beide
velden samen. Geen andere voorkeur of gegevens worden geschreven. Een
coherente huidige keuze en herhaalde identieke keuze zijn no-ops. Bij een
legacygebruiker zonder expliciete collectie blijft het opnieuw kiezen van de
effectieve standaard een no-op, inclusief null in de opgeslagen voorkeur.
Een oude inconsistente collectie-/taalcombinatie wordt bij een bewuste nieuwe
selectie coherent gemaakt; GET wijzigt niets.

Verschillende gelijktijdige keuzes vanaf hetzelfde oorspronkelijke paar krijgen
één winnaar en HTTP 409 met uitsluitend de eigen actuele voorkeur. Identieke
retries op het reeds gekozen doel zijn idempotent. Dit gebruikt geen
UserStudyContext.version, nieuw veld of migratie. Het paar is geen monotone
serverversie: een ABA-wissel (A→B→A) kan niet van dezelfde oorspronkelijke A
worden onderscheiden. Ook is oude-clientcompatibiliteit geen cross-device
versiegarantie. Voor een later vereiste volledige garantie is een afzonderlijk
goedgekeurde monotone bronselectieversie nodig; dat valt buiten deze PR.

De client serialiseert acties en negeert antwoorden na unmount, een andere
history-entry of terugnavigatie. Vóór navigatie haalt hij de actuele serverkeuze
nogmaals op, zodat een intussen nieuwere apparaatkeuze niet met een oud
response-doel wordt overschreven. Er blijft een kleine race ná deze read;
actuele live-data corrigeert de zichtbare bron. Geen absolute garantie zonder
het genoemde aparte versiecontract.

## Vertrekcontext en bestemming

navigationHistory bewaart een tijdelijke, tabgebonden sessionStorage-entry:
interne pathname, geallowliste queryparameters (view/cursus/vers/mode),
vertrek-historykey, picker-historykey, tijdstip en een onomkeerbare hash van de
bestaande sessiecookie. De hash is geen token en kan niet authenticeren.
Geheimen/challengeparameters gaan niet mee; er staat geen return-URL in een
publieke link. Andere login, tab/history-entry, verlopen context (30 minuten),
externe/protocol-relative/ongeldige route of rechtstreeks bezoek geeft een
veilige `/dashboard`-fallback. Binding gebeurt alleen bij de echte overgang
naar `/content` binnen 30 seconden. Geen permanente gebruikersinstelling.

De bestaande NavigationScroll slaat de werkelijke vertrekpositie op en herstelt
haar bij terug/vooruit; geen tweede scrollmanager. Zonder selectie blijft de
bron ongewijzigd. Een geldige keuze vervangt de picker-entry door de bestemming.

resolveContentSwitch blijft de centrale equivalentzoeker. Een bestaande
hoofdstuk-/cursusequivalent wordt gebruikt; ontbrekende equivalenten openen de
bruikbare contenthub. Vanaf Spelen gaat de gebruiker naar `/live`, nooit een
automatisch gestart spel. Neutrale pagina’s blijven waar mogelijk behouden.
Geen cursussen of ondersteunde programmalessen: de bron wordt geldig opgeslagen
met `/content?status=no-destination`, een leesbare status en andere keuzes.
Geen fictieve CFM-les, lege cursuskaart of ongeautoriseerde FSY-les. Een reeds
geldige FSY-studiekeuze mag als bestemming worden gelezen, nooit gewijzigd.

## Live-data, privacy en databehoud

Een geslaagde commit emit contentChanged naar uitsluitend de eigen gebruiker.
LiveDataProvider observeert het bestaande content-contextcontract met de
centrale useLiveQuery; header en contentScope krijgen dezelfde actuele bron.
Cachekeys van context en picker zijn sessiegebonden. Content-scoped SSR-data
wordt alleen bij de oorspronkelijke key gebruikt. De bestaande globale
focus/resume/socketlisteners blijven de enige listeners.

Alle writes zijn beperkt tot User.activeContentCollectionId/contentLanguage.
Geen UserStudyContext, activeCourseId, XP, reeks, hints, abonnement, voortgang,
lees-/oefensessie, podcastpositie, annotatie of spelstatus wordt geschreven.
Integratietests vergelijken tabelvingerafdrukken, met uitsluitend die twee
bronvoorkeuren uitgesloten. Browserannulering vergelijkt voorkeuren zonder de
bestaande websocket-aanwezigheidsvelden lastSeenAt/onlineSocketCount.

## Validatie en browserbewijs

Statische controles: TypeScript en Prisma-validatie/generate geslaagd; schone
productiebuild geslaagd. ESLint: nul fouten, uitsluitend 132 bestaande
waarschuwingen; geen waarschuwingen in de gewijzigde TypeScript-bestanden.
i18n: 3326/3749 per extra taal; alle nieuwe picker-/Kompas-teksten vertaald,
423 bestaande ontbrekende sleutels per extra taal blijven buiten scope.
De build gebruikt een onbereikbare synthetische database-URL; de bestaande
brandingmetadata-fallback meldt verwachte databasewaarschuwingen.

Unit/regressie: picker/route/focus/shell 37; live-data 51; editie/leer-/reeks/
OTB-/studiescoring 45; puzzel 41; Woord-van-de-Dag-hints 5: allemaal geslaagd.
Kompas 60 geslaagd en 9 DB-tests overgeslagen in de losse runner zonder
DB-binding. Die negen worden wel uitgevoerd in de geïsoleerde puzzelrunner:
40 integratietests geslaagd, nul skips, inclusief Kompas en de echte 216
puzzelafbeeldingen. Woord-van-de-Dag: 14 hintintegratietests + 29 tijd/spel-
regressietests geslaagd, nul skips.

Geïsoleerde content-/toegangs-/studiecontext-/picker-run: 107 geslaagd,
nul failures/skips (59 + 10 + 22 + 16). Inclusief echte HTTP-rollen/Origin/
rechten, exacte edities, lege catalogus, no-op voor oude gebruikers zonder
bronkeuze, gelijktijdige keuzes en behoudvingerafdrukken van bestaande tabellen.

Browser: bestaande shell/kaarten/Woordzoeker-matrix 28 combinaties + vijf UI-
talen en drie echte spelafrondingen geslaagd. Picker-matrix 28 combinaties +
vijf UI-talen en interacties geslaagd, zeven kaartregressies geslaagd. Het
verbeterde rem-grid is opnieuw op de definitieve schone build getest; alle
200%-varianten gebruiken aantoonbaar één leesbare kaartkolom.

Voorbereidende proefruns vonden echte focus-/headerstalenessfouten (gerepareerd)
en fixturefouten (dubbele boekkey, ontbrekend icoon, onvolledige onboarding).
Die zijn opgelost; een aanvankelijke gelijktijdige Prisma-generate-botsing is
vermeden door database-runners daarna sequentieel uit te voeren. Geen testfout
is als productiegegeven behandeld of stilzwijgend overgeslagen.
De bestaande runners gebruiken uitsluitend eigen PostgreSQL 16-containers met
historische migraties en synthetische fixtures, zonder algemene seed. De
browserrunner test de daadwerkelijk gebouwde Next-productieapp en bestaande
custom server. OTB-catalogusmetadata ontstaat normaal via import, niet schema-
migraties; de runner maakt daarom de 21 fixture-identiteiten expliciet aan.

Verplichte browsermatrix: 320×844, 375×844, 390×844, 430×932, 768×1024,
1280×900 en 844×390; licht/donker en 100/200% tekst (28 combinaties).
Daarnaast vijf lange UI-taalvarianten op 320px/200%, synthetische safe areas,
kaartposities/overflow/scroll, touch/toetsenbord, focus, daadwerkelijke
terug/vooruit en vertrek-scrollherstel, API-fout, dubbelklik en late responses.
De bestaande Vandaag/Leren/Spelen/header/kaart-/Woordzoeker-suite blijft draaien.

Screenshots en JSON-meetrapporten staan buiten Git in
`/tmp/versado-layout-browser`, met onder andere:

- `content-picker-390x844-light-100.png` (telefoon)
- `content-picker-768x1024-dark-100.png` (tablet)
- `content-picker-1280x900-light-100.png` (desktop)
- `content-picker-844x390-dark-200.png` (landscape/grote tekst)
- `content-picker-results.json` (matrix en interactiebewijs)

GitHub Actions bewaart deze als `header-wordsearch-browser` (zeven dagen).
Geen productieaccounts of grote gegenereerde bestanden in Git. Native iOS/
Android/Capacitor-toestellen en WebKit zijn hier niet beschikbaar; Chromium-
touch/safe-area-emulatie bewijst geen fysieke WebView-compatibiliteit.

## Uitrol, rollback en fase 1D

1. Review de concept-PR en de checks op de exacte commit; geen automatische merge.
2. Controleer de actuele main bij merge en laat eventuele regressies opnieuw lopen.
3. Alleen na afzonderlijke toestemming publiceren via het bestaande Synology-
   deploypaneel. Dit werkpakket wijzigt geen productiegegevens vóór de uitrol.
4. Het starten van de container voert bestaande Prisma migrate deploy uit.
   Er is in deze PR geen nieuwe migratie/backfill; controleer alsnog het
   migratielog en de juiste container/image-tag.
5. Controleer live Vandaag/Leren/Spelen → picker → bron/taal, annuleren,
   verborgen collecties, podcasts en bestaande FSY-context. Bronwissels wijzigen
   bewust twee eigen voorkeurvelden en mogen geen beloningsactie veroorzaken.
6. Bij problemen terug naar de eerder goedgekeurde app-image. Geen database-
   rollback, verwijdering van persoonlijke gegevens of contractmigratie nodig.
   Bestaande IDs, schema en voortgang blijven compatibel; gewijzigde eigen
   bronvoorkeuren blijven geldige bestaande waarden.

De eigenaar beheert dagelijkse Synology Hyper Backup en heeft de aanvullende
geïsoleerde herstelproef bewust overgeslagen. Herstelbaarheid is hier niet
onafhankelijk getest; deze eerdere risicoacceptatie blijft gelden.

Fase 1D moet de bestaande spelpools/availability breder auditen. Deze PR opent
slechts een veilige spellenhub; zij belooft geen pool voor ieder spel en bouwt
geen nieuwe resolver/adapters. Nieuwe programmalessen, CFM-import, FSY-conversie,
rich reader, annotaties of Mijn studiemap blijven buiten scope.
