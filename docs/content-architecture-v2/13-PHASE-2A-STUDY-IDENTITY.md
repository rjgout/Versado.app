# Fase 2A — Stabiele lesidentiteit en immutable revisies

Werkbranch: `codex/content-architecture-v2-2a-study-identity`.
Basis: actuele `origin/main` `d60e94e`, inclusief gemergede fase 1F/PR #93.
Scope: uitsluitend 2A. Geen merge, deployment, productiequery, import of FSY-verwijdering.

## Beginsituatie en onderzochte afhankelijkheden

`ContentWork` classificeert werken; `ContentCollection.work`, editie-familie en taal
identificeren de bestaande concrete uitgave. `contentAccess.ts` scheidt gewone
leesrechten van expliciete beheerpreview. `studyContext.ts` gebruikt nog de
gevalideerde legacykey `fsy:<FsyLesson.id>`, met versie/actionId-contract en
zelfstandige context per werk. `ContentProgress`, `contentIdentity.ts`,
`progressState.ts` en `streak.ts` regelen bestaande voortgang en beloningen.
Geen van deze contracten wordt herschreven.

Onderzocht: schema en migratiegeschiedenis; contentCollections/contentAccess;
studyContext/studyContextContract; learning/contentIdentity/contentProgress/
progressState; streak; fsyContent; LessonFlow/ReadingLessonFlow/ChapterPopup;
content-, editie-, cursus-, studiecontext-, Mysterie- en Genees-tests;
de goedgekeurde fase-0-architectuur, roadmap en migratie-/risicoplannen.

Bestaande relaties naar ContentCollection (boeken, cursussen, actieve
gebruikerskeuze, FSY, personen, scopes, woordzoeker, Genees-voortgang,
Snelle-Zendeling-runs/lobbydeelnemers en Mysterie-pogingen) blijven ongewijzigd.
Aan ContentWork komen alleen inverse relaties voor nieuwe perioden/lessen;
aan ContentCollection alleen een inverse leseditierelatie en unieke `(id,work)`-
index voor de samengestelde FK. Geen nieuwe User-relatie of massale backfill.

## Modellen en integriteit

| Model | Identiteit en eigenschappen | Databasebescherming |
|---|---|---|
| StudyPeriod | Cuid-ID, workKey, officiële sourceKey, label, optioneel jaar/JSON-bronkalendermetadata | Uniek `(workKey,sourceKey)`; FK naar ContentWork |
| StudyLesson | Cuid-ID, workKey, periodId, officiële sourceKey, order, optionele categorie/maand/datumgrenzen/retiredAt | Uniek `(workKey,periodId,sourceKey)`; samengestelde periode/werk-FK |
| StudyLessonEdition | Cuid-ID, lessonId, collectionId, constrained workKey, slug, nullable concept-/publicatiepointer | Uniek `(lessonId,collectionId)` en `(collectionId,slug)`; samengestelde les/werk- en collectie/werk-FK's |
| StudyRevision | Cuid-ID, editie, oplopend revisienummer, schemaVersion, SHA-256, titel, body, bron-/rechtenmetadata, UTC-createdAt | Uniek nummer per editie; INSERT-only trigger; beschermende FK's |

`StudyLessonEdition.workKey` is uitsluitend denormalisatie voor composite FK's:
het kan niet onafhankelijk van les en collectie worden gewijzigd. De bestaande
`ContentCollection.work` blijft de bronidentiteit. Beide revision pointers
gebruiken `(revisionId,editionId)` → `(id,lessonEditionId)`; een revisie van een
andere editie is ook met directe SQL onmogelijk te koppelen.
Alle nieuwe relaties gebruiken RESTRICT bij verwijderen én sleutelwijziging.
Geen stilzwijgende cascade of garbage collection. Een les kan retired worden;
haar historische revisies blijven behouden. De service valideert daarnaast
STUDY_PROGRAM en consistent werk/periode/collectie. Er is geen 52-wekenmodel;
maand/categorie zijn optioneel en onafhankelijk van lesvolgorde.

Geen importRunId zonder bestaande importaudit: 2B kan dit later gericht toevoegen.
Geen nieuwe lesinhoud, CFM-collectie, officiële kalender of bron-URL aangemaakt.

## Rich-content-schema, versie 1

`src/lib/studyContent/schema.ts` is de centrale strikte Zod-validator.
Documenten bevatten `schemaVersion:1` en geordende secties/blokken met
adapter-aangeleverde blijvende ankers. Ondersteund: heading, paragraph, list,
quote, question, assignment, figure, reference en divider. Inline-inhoud:
tekst met nadruk/strong, veilige link en semantische verwijzing.
Lijsten hebben maximaal één genest kindniveau. Vragen/opdrachten zijn leestekst,
geen Exercise en geen antwoordregistratie.

Documentbrede unieke ankers omvatten secties, blokken, lijstitems en inline-
reference-occurrences. Geen HTML, events, CSS of iframes; onbekende velden en
betekenisvolle bloktypen worden afgewezen, niet verwijderd. Alleen absolute
HTTPS-links zonder credentials, backslashes of control/whitespace zijn toegestaan.
Dit valideert URL-structuur, niet officiële herkomst of SSRF-toestemming; er
wordt in 2A geen URL opgehaald. Figure bevat een mediaKey/alt/afmetingen,
geen ongecontroleerde embed. Referenties bewaren bedoelde source/work/editie/taal;
de resolver of bewezen editie-equivalentie wordt hier niet geïmplementeerd.

Grenzen: 200 secties, 200 blokken per sectie, 200 inline-items, 100 lijstitems,
20.000 tekens per tekstdeel, 2 MB JSON, preflight maximaal 100.000 nodes en
12 nestingniveaus. Cyclische of corrupte data wordt gecontroleerd afgewezen.
Tekst en Unicode worden niet stilzwijgend genormaliseerd/afgekapt.
De validator detecteert dubbele/ongeldige ankers; hun officiële provenance en
stabiliteit tussen imports moet de bronadapter in 2B aantonen. Geen hashes of
array-indexen als identitygenerator.

Callouts, voetnoten, tabellen en audio/video volgen alleen als echte bronfixtures
ze vereisen. Tot dan zijn ze expliciete validatiefouten. 2B moet een schema-
uitbreiding/version-strategie beoordelen, zonder betekenisvolle broninhoud weg te laten.
Alle fixtures zijn synthetisch en alleen in eigen wegwerpdatabases aanwezig.

## Immutable write en read-only contract

`appendStudyRevision()` is een kleine interne, expliciet admin-geautoriseerde
insert-only bouwsteen; geen publiek write-, preview- of publicatie-endpoint.
Valideert vóór de transactie, vergrendelt de editie, controleert werk/collectie,
STUDY_PROGRAM en retired-status, en kent het volgende nummer atomair toe.
Geen upsert, update of automatische pointerwijziging. Twee gelijktijdige writes
krijgen verschillende nummers. Een database-trigger weigert iedere UPDATE en
DELETE van revisies, ook identieke updates en directe SQL.

De SHA-256 omvat het canoniek geserialiseerde `{schemaVersion,title,body,
sourceMetadata,rightsMetadata}`. Objectkeys worden lexicografisch gesorteerd;
arrays, tekst, Unicode en volgorde blijven exact onderdeel van de hash.
Een import die alleen titel/rechten wijzigt maakt dus een nieuwe revisie.
De DB controleert basale JSON-vorm/hashformaat en versiecoherentie; volledige
semantische validatie/hashverificatie gebeurt in de gedeelde service.

`getPublishedStudyLesson()` vereist de exacte logische les én concrete collectie.
`findPublishedLogicalLesson()` en `findPublishedLessonEdition()` gebruiken
exact dezelfde gate, niet een losse conceptdetailquery. Normale leesrechten
uit contentAccess gelden ook voor admins: enabled + visible + LEGACY/PUBLISHED
+ geldige werkidentiteit + niet-retired STUDY_PROGRAM + werkelijke publicatiepointer.
Body, metadata en hash worden opnieuw gevalideerd; corrupte directe inserts
geven `null`, nooit een half geldige les. Geen taal-/familie-fallback.
De DTO is compile-time deep readonly én runtime diep frozen. Interne rechten-
en bronmetadata worden niet in deze DTO geëxporteerd. Geen cache, gebruiker-
mutatie, XP, reeks, hintafschrijving, voortgang of nieuwe publieke route.

De normal-read-published DTO is technisch bruikbaar voor 2B–2C, maar nog niet
gekoppeld aan UI of officiële catalogus. Een draftRevisionId is geen publicatie.
Een pointer kan in tests expliciet worden gezet; de echte beveiligde publish/
rollbackworkflow, bron-/rechten- en media-readygates horen bij 2B.

## UserStudyContext en FSY

De optionele activeLessonId-FK is **uitgesteld**, niet als tweede selectie
naast activeLessonKey aangelegd. Er bestaat geen betrouwbare oude→nieuwe
lesmapping en de bestaande FSY-contextadapter verwijst bewust naar FsyLesson.
De huidige lees-/schrijf-, version-/actionId- en live-data-contracten blijven
onveranderd. Er ontstaan geen contextrecords bij GET, login of schema-upgrade.
Een latere goedgekeurde adapter kan een echte logische les koppelen, met één
canonieke selectie en een composite werk-FK, zodra die les aantoonbaar bestaat.

Deze opdracht wijkt bewust af van de oorspronkelijke volledige FSY-conversie-
aanbeveling: de eigenaar wil nieuwe architectuur onafhankelijk van oude FSY-
inhoud. Geen kopie, conversie, sync, publicatie, zichtbaarheid of verwijdering
van FsyLesson. Bestaande routes, cursus, abonnementen en privégegevens blijven.

Latere uitfasering vereist een afzonderlijke opdracht: controleer echte
cursus-/context-/linkafhankelijkheden, maak een expliciete legacyroute-/keuze-
strategie, stop pas daarna oude writes/sync, behoud gebruikersgegevens en
historische publicaties conform het bewaarbeleid. Toestemming om oude lescontent
later te laten verdwijnen is geen toestemming om gebruikersdata of tabellen
nu te verwijderen. Geen heuristische mapping op titel/maand/slug.

## Migratie en databehoudbewijs

`20261029120000_study_identity/migration.sql` is één atomisch DO-statement,
met lock-timeout 5s en statement-timeout 60s. Vier nieuwe tabellen, indexen,
RESTRICT-FK's, checks en immutable trigger; geen bestaande kolomwijziging.
Een onverklaarde bestaande doelstructuur stopt met STUDY_IDENTITY_REVIEW_REQUIRED.
Geen destructieve statements, seed, backfill, import of FSY-sync.
Herhaald `prisma migrate deploy` gebruikt de migratieregistratie en doet niets;
het ruwe DDL opnieuw uitvoeren wordt bewust geweigerd in plaats van een
onbekend bestaand schema stilzwijgend te accepteren.

De bestaande geïsoleerde runner bouwt de volledige historische migratieketen
op, met synthetische fixtures voor de 21/7-catalogus, gebruikers, 37 FSY-lessen,
cursussen, abonnementen, lees-/spelvoortgang, annotaties, XP en reeksen.
Vóór 2A wordt een historische `fsy:m-fsy-1`-context met versie 4 opgeslagen.
De tabeltelling komt uit pg_tables, niet uit een vaste verouderde waarde.
Counts/MD5 over canoniek geordende volledige JSON-rijen, bestaande FK/primary/
unique constraints én alle oude indexdefinities worden vóór/na vergeleken.
Er zijn geen productiegebruikers/-teksten gekopieerd.

De migratieproef behoudt **134 bestaande tabellen, 332 constraints en 341
indexen**; alle oude counts/rijhashes en definities zijn identiek. Vier nieuwe
lestabellen zijn leeg na de migratie. Ook afgebroken DDL, een conflict halverwege,
lock-timeout, beschermende relaties en herhaald migrate deploy zijn gecontroleerd.

## Testmatrix en bewijstoestand

| Controle | Werkelijk resultaat |
|---|---|
| Nieuw rich-schema/hash-contract | 28 unitchecks, 0 mislukt, 0 skipped |
| Nieuwe lesidentiteit/revisie/DTO | 13 echte PostgreSQL-integratietests, 0 mislukt, 0 skipped |
| Bestaande contentaccess/editiewissel, cursus, studiecontext, contentkiezer, spelavailability | 59 + 10 + 22 + 19 + 22 checks geslaagd, 0 skipped |
| Leervoortgang, reeksreturn/-kalender en tijd | 26 + 52 + 1 + 29 checks met eigen DB geslaagd, 0 skipped |
| Extra pure editie-/route-/leer-/reeks-/studiecontext-/OTB-/studiechecks | 78 geslaagd, 0 skipped |
| Live-data en Focus-shell | 51 + 22 geslaagd, 0 skipped |
| Mysterie | 44 unitchecks; 11 DB-scenario's; 7 productie-Chromium-flowrecords; geen consolefouten |
| Genees/Snelle Zendeling | 173 + 58 bestaande regels/economiechecks, 18 bron-/Solo-integratiechecks en 2 twee-instance PostgreSQL/Redis-scenario's geslaagd |
| Beschikbaarheid-querybudget | Ongewijzigd 16/7/8/5 queries voor contexten en 5/3 voor toegestane/geweigerde puzzelstart |
| Contentkiezer/beheerpreview in productie-Chromium | 48 viewport/thema/tekstcombinaties, vijf UI-talen, 45 echte socketcontroles en 7 kaartregressies geslaagd |
| Prisma validate/generate, TypeScript en laatste schone Next.js-productiebuild | Geslaagd |
| ESLint | 0 fouten, 133 bestaande waarschuwingen; gewijzigde nieuwe code/testbestanden zonder waarschuwingen |
| i18n | Geslaagd; ongewijzigde bestaande achterstand: en/de/fr/es 3543/3961 vertaald, 418 ontbrekend; geen nieuwe UI-tekst |

De bestaande content-access-workflow voert de nieuwe tests
en migratiebewijs uit; Mysterie, Genees, layout, puzzel en woordspel behouden hun
eigen CI-jobs. Exacte SHA, GitHub Actions-resultaten en artefactlinks staan in
de concept-PR; geen green-CI-claim op basis van uitsluitend lokale checks.

De eerste lokale orchestratierun startte vóór de build klaar was en is opnieuw
uitgevoerd. De migratiefixture kreeg vervolgens een andere synthetische gebruiker
om niet te botsen met een bestaande test die een lege context verwacht. Een
bestaande desktop-browsertest mat direct na refresh, terwijl NavigationScroll
nog een herstel-loop had: die test gebruikt nu Control+Home als echte
gebruikersactie en wacht op scrollY=0. Geen app-/shellwijziging. Alle betrokken
suites zijn daarna opnieuw uitgevoerd; deze eerdere fouten worden niet als
geslaagde tests geteld.

Mysterie-bewijs: Chromium 320/390/1280px, licht/donker, touch/toetsenbord, refresh,
tweede toestel, bronwissel, conflict, mislukte autosave/retry, verloren hintresponse,
voltooiing en herspelen; 320px ook 200% tekst. Screenshots in
`/tmp/versado-mystery-browser`, als CI-artifact `mystery-persistence-browser`.
Geen fysieke iOS/Android-, Safari/WebKit- of Capacitor-uitroltest; 2A voegt geen UI toe.

## Gewijzigde bestanden

- prisma/schema.prisma en nieuwe study_identity-migratie.
- src/lib/studyContent/schema.ts en revisions.ts.
- tests/fixtures/study-content.ts; study-content.test.ts;
  study-content.integration.test.ts; study-identity-migration.mjs.
- scripts/content-architecture/test-access-isolated.mjs: migratie gefaseerd
  testen en nieuwe suites opnemen, met behoud van bestaande runners.
- package.json: test:study-content en test:study-content:integration.
- .github/workflows/content-access.yml: bestaande job gericht uitbreiden.
- tests/mystery-attempt.browser.mjs: uitsluitend betrouwbare scrollmeting.
- Dit fase-2A-statusrapport.

## Uitrol, rollback en overgang naar 2B

Deze concept-PR geeft **geen** productie-uitroltoestemming. Synology voert
Prisma migrate deploy uit bij containerstart: review daarom DDL, lockbudget,
het testbewijs en de exacte image/commit vóór afzonderlijke merge/deploygoedkeuring.
Eigenaar controleert bestaande dagelijkse Hyper Backup en passend database-/
mediabereik. De aanvullende productiebackup-herstelproef was bewust overgeslagen;
herstelbaarheid is niet onafhankelijk bewezen en wordt hier niet geclaimd.
Geen nieuwe backup, restore of productieverbinding uitgevoerd.

Bij uitrol na aparte toestemming: laat alleen migrate deploy uitvoeren,
geen seed/import/sync. Controleer migratieregistratie, oude counts/flags en
bestaande FSY-/lees-/cursusroutes. De nieuwe catalogus blijft leeg en publiek
niet geactiveerd. Bij lock-timeout/conflict: stop uitrol; inspecteer in review,
geen automatische repair/backfill. De DDL-eenheid voorkomt gedeeltelijke objecten.

Rollback: vorige compatibele appimage, **schema behouden**. Oude app gebruikt
nieuwe tabellen niet; bestaande content en context zijn ongewijzigd. Nooit
revisies of nieuwe tabellen droppen om een approllback mogelijk te maken.
Zodra 2B publiceert, rollback van inhoud via een gecontroleerde pointer naar
bewaarde revisie, niet via overschrijven/deleten. Dat is nog geen 2A-functionaliteit.

2B kan voortbouwen op de gevalideerde body, exacte editie-FK's, append-only
service en readonly DTO. Nog nodig: concrete officiële bronfixtures/talen/
identiteiten, secure media en importaudit, volledigheidscontrole, adminpreview,
diff, rechtenreview en atomische publicatie/rollback. Geen officiële vragen
omzetten in quizzen. 2C–2E, CFM-import, reader, posities, verwijzingsresolver,
annotaties en beloningswijzigingen blijven buiten deze PR.
