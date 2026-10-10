# Fase 2 — herstel volledige speelcyclus

Onderzocht vanaf actuele `main` `813d033`, branch
`fix/legpuzzel-v2-session-flow`. Geen fase 3, visueel redesign, merge of
productiedeployment. Het oorzakenonderzoek is vóór de codewijzigingen afzonderlijk
vastgelegd in commit `7a17360` en [rapport 09](09-PHASE-2-FLOW-ROOT-CAUSES.md).

## 1. Oorzaken van de vier problemen

| Scenario | Aantoonbare oorzaak in de implementatie |
| --- | --- |
| Puzzel voltooien | Status/version buiten de schrijftransactie, onvoorwaardelijke updates en overlappende clientacties maakten completion overschrijfbaar. Een retry van een succesvolle laatste verbinding werd vóór zijn actionId op oude version/status afgewezen. |
| Vraag opnieuw beantwoorden | De claim/reeks, sessieafsluiting en het record werden apart gecommit. Een fout of concurrent antwoord kon een claim zonder afsluiting laten staan. Er was geen duurzaam antwoordresultaat voor retries/hervatten. Vraagcontent-id is **niet** de claim-scope; de bestaande sessie-scope was al juist. |
| Puzzel opnieuw openen | Start zocht alleen ACTIVE, niet COMPLETED met open vraag. Automatische resume kon een latere selectie overschrijven; de niet-gekeyde Puzzle behield state tussen sessies. Een oude ANSWERED-key kon een resultaat zonder opgeslagen uitslag heropenen. Geen expliciete herstart van dezelfde variant. |
| Contentselectie | De volledige catalogus was al aanwezig. Een verborgen standaard/oude index bleef startbaar na zoeken/pagineren, zelfs bij nul resultaten. API-identificatie gebruikte arraypositie en hardcoded grens 215. Een late resume kon de gekozen puzzel vervangen. |

De verse database reproduceerde daarnaast een unique-constraint-race bij de
lege-update-upsert van nog niet aangemaakte definities/varianten. De constraints
blijven behouden; hun factories gebruiken nu conflictbestendige insert en lezen
de canonieke rij. Een tijdrecord in Int kon antwoorden na 24,8 dagen blokkeren;
double precision bewaart bestaande milliseconden exact en ondersteunt ook oude
hervatte sessies. Zie rapport 09 voor het aanvullende bewijs.

Dit zijn bewezen codefouten/reproducties. Zonder productietrace kan niet worden
gesteld welke afzonderlijke race iedere eerdere live-mislukking veroorzaakte.

## 2. Aangepaste bestanden

| Bestanden | Wijziging |
| --- | --- |
| `src/lib/puzzle/solo.ts` | Sessie-locks, versievalidatie/idempotentie binnen transactie, canonical factories, open vraag hervatten, herstel van aantoonbaar complete oude snapshots, atomisch en duurzaam antwoord. |
| `src/lib/streak.ts` | Bestaande centrale completeJigsaw kan deelnemen aan de caller-transactie; legacy callers behouden hun gedrag. |
| `src/app/api/jigsaw-v2/route.ts` | Unieke catalogus-URL als imageId, dynamische legacy-indexvalidatie, vertaalde fouten; dezelfde toegangsvoorwaarden. |
| `src/components/JigsawV2Client.tsx` | Zichtbare expliciete selectie, resume/start-grenzen, session-key/reset, move→snap als één bezette handeling, veilig retry/herstel, afzonderlijke voltooiingsstappen, replay en navigatie. |
| `prisma/schema.prisma`, `prisma/migrations/20261025100000_puzzle_session_answer_result/migration.sql` | Nullable answerResult en verbreding recordduur; geen sessiehistorie verwijderen/overschrijven. |
| `src/lib/i18n/messages/{nl,en,de,fr,es}.ts` | Zes nieuwe sleutels per taal, waaronder replay/foutmelding en bestaande moeilijkheidsnamen vertalen. |
| `tests/jigsaw.integration.test.ts` | Ontbrekende V2-tabellen zijn een fout; duurzaam antwoord bij retry controleren. |
| `tests/puzzle-solo.integration.test.ts` | Tien V2-database-integraties met concurrency, echte serviceacties, foutinjectie, historie, dagregels en alle 216 contentstarts. |
| `tests/puzzle-flow.browser.mjs` | Echte Chromium/API/database-flow, laatste muisverbinding, catalogus, replay en verloren responses. |
| `scripts/puzzle/test-isolated.mjs`, `package.json` | Reproduceerbare runner met eigen gemigreerde wegwerpdatabase en optionele applicatieserver/browser. |
| `.github/workflows/puzzle-v2.yml` | Dezelfde integratie/browser-runner in PR-CI; screenshots als artifact. |
| `docs/puzzle-v2/{02-PRODUCT-SPECIFICATION,06-TEST-STRATEGY,09-PHASE-2-FLOW-ROOT-CAUSES,10-PHASE-2-FLOW-REPAIR-REPORT}.md` | Sessiescope, onderzoek, tests en oplevering. |
| `CLAUDE.md` | Door Next gegenereerde verplichte agent-instructie behouden. |

## 3. Sessie- en voltooiingslogica

Alle sessiemutaties lezen onder een PostgreSQL-rowlock met eigenaar/mode-
controle. Geaccepteerde actionId wordt vóór ACTIVE/version gecontroleerd;
dezelfde actie kan veilig terugkeren met de actuele sessiestatus. Dezelfde id
met een andere payload wordt geweigerd. Een nieuwe verouderde actie geeft 409.
Snapshot, actionlog, versie, COMPLETED, vraag en optievolgorde committen samen.

De client laat een volledige move→snap-keten afronden voordat een volgende
bordmutatie begint. Bij netwerk/5xx herhaalt hij dezelfde request eenmaal; bij
blijvende bordfouten toont hij de fout en hervat de autoritatieve sessie. Een
fout schakelt geen geometrie- of servervalidatie uit.

Na de laatste verbinding verdwijnt het canvas en verschijnt de bestaande
volledige afbeelding zonder puzzelcontouren. Verder opent de afzonderlijke
vraagstap. COMPLETED hervat die afbeelding of, als Verder in deze browser al is
gebruikt, de vraag. Zonder browseropslag kan dezelfde variant via Start alsnog
de open voltooiingsstap ophalen. Het bord hoeft niet opnieuw gespeeld te worden.

Het antwoord, centrale claim/reeks en eventuele recordopslag committen samen.
Een geïnduceerde recordfout rolt **alle** onderdelen terug. Na commit wordt het
bestaande streak_changed-event verstuurd. Retries krijgen de opgeslagen uitslag,
ook wanneer ze een andere keuze meesturen. Het resultaat toont bestaande
feedback/felicitatie en vervolgnavigatie.

Oude ACTIVE/COMPLETED-rijen met ontbrekende voltooiingsgegevens worden alleen
hersteld na controle van alle unieke stukken, nulrotatie, geldige unieke
buurverbindingen en een volledige spanning tree. Een timestamp alleen is geen
bewijs. Historische ANSWERED/ABANDONED-sessies worden niet herschreven.

## 4. Historisch beantwoorde vragen en beloningen

Vraagcontent, antwoord van deze poging, historische claim en centrale activiteit
blijven onderscheiden. De vraag kan in iedere nieuwe sessie opnieuw aangeboden
worden; claim-scope blijft `jigsaw-answer:v2:<sessionId>` en activiteit-scope
`jigsaw:v2:<sessionId>`. Een historisch correct antwoord zet nieuwe knoppen niet
uit. Iedere poging kan aflopen, inclusief fout antwoord.

De bestaande finishActivity/dag/tijdzoneregels blijven beslissend: meerdere
geldige pogingen op dezelfde dag kunnen activiteiten registreren maar verlengen
de reeks niet opnieuw. Een geldige nieuwe poging op de volgende persoonlijke
kalenderdag kan wel tellen. Geen nieuwe XP-beloning. Legacy callers blijven via
dezelfde completeJigsaw werken.

Een oude reeds geclaimde maar niet afgesloten sessie wordt veilig ANSWERED met
`alreadyAnswered`; er wordt geen historisch antwoord verzonnen en geen tweede
beloning toegekend. Omdat oude records geen uitslag bewaarden, toont deze
compatibiliteitsroute bestaande neutrale antwoordfeedback. Nieuwe pogingen
hebben steeds het volledige opgeslagen resultaat.

## 5. Hervatten en opnieuw spelen

| Geval | Gedrag |
| --- | --- |
| A — ACTIVE | Exact opgeslagen snapshot en dezelfde variant/sessionId. |
| B — COMPLETED, onbeantwoord | Open voltooiings-/vraagstap; Start van dezelfde variant vindt deze sessie ook zonder localStorage. |
| C — ANSWERED | Nieuwe poging met nieuw id en lege beginverbindingen; oude sessie/claim/record blijven bestaan. Expliciete knop voor dezelfde variant. Bij terugkeer wordt een oude lokale ANSWERED-key losgelaten en de kiezer geopend. |
| D — andere puzzel/variant | Canonieke definitie/variant voor de gekozen unieke URL, eigen sessie. Puzzle wordt opnieuw gemount op sessionId; geen oude vraag/refs/camera/keuze. |

Gelijktijdige starts worden per gebruiker geserialiseerd. De start-userlock
wordt losgelaten vóór de sessielock om een omgekeerde lockvolgorde met antwoorden
te voorkomen. Er is geen user/variant-uniciteit toegevoegd die replay verhindert.

## 6. Contentselectie en rechten

Er zijn 216 unieke, als puzzel aangewezen afbeeldingen in het bestaande manifest.
Dit pad leest geen pagineerbare contenttabel: de gehele canonieke clientcatalogus
wordt gebruikt en definities worden bij starten aangemaakt. Andere aanwezige
assets worden niet automatisch speelbaar. De manifestvolgorde is stabiel en
de URL is de unieke selectie/start-id; legacy indexrequests blijven geldig.

Negen pagina's van 24, zoeken vóór pagineren, paginaterugstelling bij gewijzigd
zoeken en een zichtbare expliciete selectie. Start is uitgeschakeld als de
selectie niet op de getoonde pagina staat of er geen resultaten zijn. De API
accepteert alleen cataloguscontent. jigsawEnabled/admin en gameContentScope
blijven behouden; geen rechten uitgebreid.

## 7. Integratie- en browsertests

`npm run test:puzzle:integration -- --browser` creëert/verwijdert zijn eigen lokale
PostgreSQL 16-container, past alle 132 migraties toe en genereert Prisma. De
runner negeert externe DATABASE_URL. V2-tests en browser weigeren een ander
host/databasepad; geen destructieve actie op productie.

16 echte integratietests (6 legacy + 10 V2): creëren, opslaan, exacte resume,
owner/variantcontrole, completeren, concurrente autosave/completion, dubbele
actionId, verloren commitresponse, atomisch antwoord, concurrente verschillende
keuzes, foutantwoord, historische identieke vraag, daggrens, geen dubbele
reeks/XP, nieuwe poging, andere puzzel, concurrente eerste imports, herstel
oude status, rollback bij opslagfout, oude claim, 30 dagen oude sessie en
starten van alle werkelijke 216 catalogus-URL's. Geen skips of ontbrekende tabellen.

Browser: echte pagina's en API, alle negen cataloguspagina's zonder gaten/dubbels,
zoeken+pagineren, zoekresultaat 216 daadwerkelijk starten, terugkeren/wisselen/
hervatten, laatste stuk met muis verbinden, canvas weg/volledige afbeelding,
Verder, herladen vóór en na Verder, juiste antwoord/felicitatie, opnieuw dezelfde
puzzel/identieke historische vraag, dagregels en /live-navigatie. Transporttests
laten na echte commit completion- en antwoordresponses vallen en controleren dat
die fout daadwerkelijk is geïnjecteerd. Alleen de doorgeef-serviceworker is in
deze Playwright-context geblokkeerd zodat request-interceptie mogelijk is.
390px/nl en 320px/de/200% tekst: geen horizontale overflow. API: 401 zonder login,
403 bij uitgeschakeld spel en 403 voor contentcollectie zonder jigsaw-recht.

## 8. Overige verificatie

| Controle | Resultaat |
| --- | --- |
| Verse geïsoleerde database, alle 132 migraties, legacy + V2-integratie | 16 geslaagd, 0 fouten, 0 skips. De opzettelijke P0001-recordfout in de log hoort bij de geslaagde rollbacktest. |
| Chromium via eigen `server.ts`, echte API/database | Alle hierboven beschreven flows geslaagd, inclusief aantoonbaar verloren completion- en antwoordresponses; geen browser-runtimefouten. |
| Engine/legacy/focus/shell/live-data/reeks-regressies | 115 geslaagd, 0 fouten, 0 skips; waaronder de bestaande 25 puzzeltests. |
| Kompas unit/integratie/layout | 69 geslaagd, 0 fouten, 0 skips, eigen testdatabase. |
| Learning-regressies met geïmporteerde lokale hoofdstukken | 25 geslaagd, 0 fouten; 1 bestaande test over een leesstap zonder vragen overgeslagen omdat de beperkte fixture zo'n stap niet bevat. Dit betreft geen V2-test. |
| `npx tsc --noEmit` | Geslaagd. |
| `npm run lint` | Exit 0, 0 fouten, 135 bestaande repositorywaarschuwingen. Gerichte lint van alle gewijzigde code/testbestanden: 0 fouten/waarschuwingen. |
| Prisma validate/generate | Geslaagd; verse migratietoepassing geslaagd. |
| i18n | Alle 72 jigsaw-sleutels in nl/en/de/fr/es compleet. Globale checker exit 0: en/de/fr/es ieder 3194/3617; de bestaande 423 ontbrekende algemene vertalingen per taal vallen buiten dit herstel. Geen useT-servercomponentfouten. |
| Schone lokale productiebuild (`rm -rf .next`, `npm run build`) | Geslaagd, inclusief TypeScript en static generation. |
| GitHub Actions | [PR #76 checks](https://github.com/rjgout/Versado.app/pull/76/checks) registreren de uiteindelijke Docker-productiebuild en de nieuwe geïsoleerde integratie/browserjob; lokale resultaten worden daarvan onderscheiden. |

### Dekking van de acceptatiecriteria

| Criteria | Automatisch bewijs |
| --- | --- |
| Nieuwe puzzel volledig afronden; afbeelding; Verder; vraag | Browser voert laatste muisverbinding uit, controleert afbeelding/canvas weg, klikt Verder en ziet vraag. |
| Correct beantwoorden; felicitatie; vervolgnavigatie | Browser antwoordt, ziet Goed!/resultaatknoppen en navigeert naar /live. |
| Historische vraag opnieuw speelbaar; geen onterechte dubbele reeks | Browser en integratie herhalen exact dezelfde vraag in nieuwe sessie; dezelfde dag geen reeksverlenging, volgende dag wel via centrale regels; retry maakt geen nieuwe claim. |
| Afgeronde puzzel opnieuw starten | Browser gebruikt expliciete replay; integratie controleert nieuw id, beginsnapshot en behoud oude sessie. |
| Lopende puzzel exact hervatten | Integratie vergelijkt opgeslagen snapshot; browser kiest dezelfde lopende variant opnieuw. |
| Compleet met open vraag hervatten | Browser herlaadt vóór en na Verder; integratie hervat COMPLETED via resume én Start. |
| Andere puzzel zonder vervuiling | Browser wisselt tussen 216 en 30 en controleert URL/id; integratie controleert andere variant en eigenaar. |
| Alle toegestane content; zoekresultaat buiten twintig starten | Browser leest alle negen pagina's, zoekt/pagineert/start 216; integratie start alle 216 echte URL's. Rechtenweigeringen 401/403 blijven getest. |
| V2-integratie met juiste DB; engine intact; TypeScript/lint/i18n/build | Verse Docker-database met alle migraties, 16 integraties zonder skip, bestaande engine-regressies en controles hierboven. |

## 9. Grenzen en resterende controles

De engine-, geometry-, viewport-, worktable- en catalogusmodules zijn ongewijzigd.
Automatische engine-regressies bewaken geometry v1/v2, klassieke aansluitende
vormen, magnetische groepen, verplaatsen, rotatie en camera/pan/zoom. Dit is geen
claim dat iOS Safari, Capacitor of Android WebView fysiek opnieuw getest zijn.
De nieuwe browsercontrole gebruikt Chromium; de bestaande geaccepteerde pinch/
touch-functionaliteit is behouden en vereist normale live-acceptatie op apparaten.

Geen productiemigratie of deployment uitgevoerd. De nullable kolom/migratie moet
bij reguliere uitrol aanwezig zijn voordat de nieuwe servercode draait. De
nieuwe duurtypewijziging bewaart bestaande records. Een al vóór dit herstel
overschreven snapshot kan zonder backup niet worden teruggevonden.

Fase 2 wordt niet namens de gebruiker goedgekeurd; fase 3 blijft buiten scope.

## 10. Branch, commits en PR

Branch: `fix/legpuzzel-v2-session-flow`.
Onderzoekscommit: [`7a17360`](https://github.com/rjgout/Versado.app/commit/7a17360).
Implementatie/testcommit: [`1e728e1`](https://github.com/rjgout/Versado.app/commit/1e728e1).
PR: [#76 — Legpuzzel V2: betrouwbare voltooiing, vraag, hervatten en opnieuw spelen](https://github.com/rjgout/Versado.app/pull/76).
De documentatiecommit staat eveneens in de PR-tab Commits. Niet gemerged.
