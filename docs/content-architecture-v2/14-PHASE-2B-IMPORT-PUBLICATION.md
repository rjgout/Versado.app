# Fase 2B — veilige import, persistente media en gecontroleerde publicatie

## Basis, toestemming en grens

Werkbranch: `codex/content-architecture-v2-2b-import-publication`. Basis is
`origin/main` **aa741c81e6de1c925a928e8a032351e2f8d06311**, inclusief gemergede
PR #95 (fase 2A) en PR #94 (legpuzzelcorrecties). Main is tijdens de uitvoering
opnieuw opgehaald; er waren geen nieuwere commits. De eigenaar heeft de nieuwe
additieve modellen, migratie en volumeconfiguratie expliciet goedgekeurd voor
ontwikkeling en concept-PR. Dat is geen toestemming voor productie-uitrol.

Hergebruikt: `StudyPeriod`, `StudyLesson`, `StudyLessonEdition`, immutable
`StudyRevision`, schema v1, canonieke SHA-256, `appendStudyRevision()`, centrale
`contentAccess`, adminauthenticatie, Originbeleid, rate limiting, `AdminSection`,
`AdminNotice`, `ConfirmProvider`, centrale live queries en scopes. Geen tweede
revisie-, rechten-, les-, reader- of jobsysteem. De importer gebruikt geen
`runSeed`, algemene contentreload, FSY-scraper of Redis-queue. De bestaande
reseedjob is niet geschikt: hij heeft een ander, deels destructief lifecycle.
De audiolaag geeft nuttige deploymentconventies, maar zijn fallback/downloader
is niet geschikt voor gesloten studiepublicatie.

## Additief schema en databehoud

Migratie: `20261030120000_study_import_publication`. Eén atomische DDL-eenheid,
met locktimeout 5 seconden en statementtimeout 60 seconden. Conflicterende
objectnamen vereisen expliciete beoordeling; geen `DROP`, backfill of
hernummering van bestaande records.

| Model | Verantwoordelijkheid en constraint |
| --- | --- |
| `ContentImportRun` | Gepinde adapter/bron/hash/snapshot, exacte werk-/collectie-/editie-/taalidentiteit, periode, aantallen, begrensde diagnose, status en lease/fence. Uniek `(scopeKey, sourceHash)`; maximaal één CREATED/RUNNING-run per scope. |
| `ContentImportItem` | Stabiele bronles → editie/revisie per run. Immutable; samengestelde revisie-/editie-FK. Geen scalar toegevoegd aan de immutable 2A-revisie. |
| `ContentMedia` | Unieke checksum en storageKey, volume-ID, MIME/bytes/afmetingen, herkomst/rechten, STAGED/READY. Alleen gecontroleerde STAGED→READY-mutatie. |
| `StudyRevisionMedia` | Immutable revisie/mediaKey → media-ID. Dedupe verwijdert geen eerdere verwijzing. |
| `ContentReference` | Immutable occurrenceKey, label, originele/genormaliseerde doelen en fallback; diagnose/evidence kunnen gecontroleerd worden. Geen interne resolver. |
| `StudyPublicationAction` | Immutable actor/actionId/requesthash, import, editie, vorige/nieuwe revisie, PUBLISH/ROLLBACK en versie. Uniek editie/actionId én editie/versie; revisie en importitem horen bij exact dezelfde editie. |

`StudyLessonEdition.publicationVersion` start op 0. Bestaande publicatie- en
conceptpointers blijven ongewijzigd. Extra indexen versnellen exacte
importidentiteiten en revisiehashvergelijking. FK's beschermen inhoud, media en
historie met RESTRICT. Verwijdering van een beheeraccount mag de nullable
actorrelatie leegmaken; de technische actorKey en audit blijven bestaan.
Er zijn geen wijzigingen aan FSY-publicaties, gebruikerscontext, cursus-
voortgang, annotaties, XP, reeks, hinttegoed, podcasts of spelregels.

De migratieproef telt de **werkelijke** schemaobjecten en vergelijkt alle oude
rijvelden (uitsluitend de nieuwe publicationVersion uitgezonderd). Voor deze
basis: **138 tabellen, 344 bestaande constraints en 357 bestaande indexen**
ongewijzigd. Deze cijfers zijn testuitvoer, geen hardcoded migratievoorwaarde.
Afgebroken DDL, conflicterende tabel/index en locktimeout laten geen gedeeltelijk
schema achter. Herhaalde `migrate deploy` is een no-op; het SQL-bestand handmatig
opnieuw uitvoeren stopt bewust met `STUDY_PUBLICATION_REVIEW_REQUIRED`.

## Importcontract en herstel

De enige adapter is een lokale, gecontroleerde **synthetische** snapshotregistry:
`sample`, `updated`, `unresolved`, `invalid`, `batch-error`. Geen willekeurige
URL, HTML-scraper, CMS, scriptuitvoering of officiële import. Fixtures zijn
uitsluitend toegestaan in de lokale testdatabase, met werk
`synthetic-study-*`, familie `fixture-v1`, taal `nl`. De classificatie komt uit
`ContentWork.kind`; het prefix is alleen een extra synthetische veiligheidsgrens.
Er wordt geen CFM-collectie of FSY-conversie gemaakt.

Pipeline: pinned snapshot/hash → officiële synthetische identiteit en manifest
→ volledige rich-content-validatie → bron/rechten → gevalideerde media →
verwijzingsaudit → volledigheid → immutable conceptrevisie → duurzame uitkomst.
Betekenisvolle onbekende velden of ontbrekende ankers/media/references falen.
Inline links zonder stabiele occurrenceKey worden bij nieuwe imports niet
stilzwijgend overgeslagen: een adapter moet ze expliciet normaliseren naar
schema-v1-referenceblokken. Bestaande 2A-revisies worden niet herschreven.

De inhoudshash gebruikt de bestaande 2A-hashservice. Een optioneel, berekend
mediamanifest in bronmetadata pint checksum/MIME/afmetingen/rechtenhash per
mediaKey. Daarmee levert gewijzigde afbeeldingdata ook bij gelijke tekst en
blok-ID's een andere revisie op. Een optionele referenceAuditHash pint ook het verwijzingsbewijs; een nieuwe
onopgeloste audit kan niet stilzwijgend een eerdere goedkeuring hergebruiken.
Dubbele media-/evidence-identiteiten worden vóór verwerking geweigerd.
Oude hashes zonder deze optionele velden blijven
geldig. Exact dezelfde import deelt run en revisie; een gewijzigde snapshot
kan een nieuwe revisie maken maar overschrijft nooit een oude.

Status: CREATED → RUNNING → DRAFT_READY of FAILED. CREATED is duurzaam vóór
het achtergrondwerk start. Geen nieuwe scheduler of queue. Een beheerder kan
na procesonderbreking expliciet hervatten. Lease 45 seconden, databaseklok en expliciet UTC per schrijftransactie,
nieuwe holder/fence bij claim, hercontrole bij ieder schrijfcommit. Een levende
lease weigert een tweede worker. Een verlopen worker kan geen revisie/pointer
meer schrijven. Lockvolgorde: bronscope → run → editie; mediaregistratie gebruikt
run → mediahashlock en verkrijgt nooit daarna een bronscopelock.

Een batchfout behoudt al gecontroleerde conceptitems, maar FAILED mag niet
publiceren. Hervatten hergebruikt bestaande itemkoppelingen. De vorige publicatie
blijft altijd staan. Run-snapshots, media-identiteiten en itemkoppelingen zijn ook
bij directe SQL beschermd tegen wijzigen of verwijderen.

## Persistente media en compensatie

`STUDY_MEDIA_DIR=/data/study-media`; geen tijdelijke fallback. De app controleert
het exacte Linux-mountpoint, rw-vlag, directoryrechten, symlinks in het pad en
volumemarker `.versado-study-volume.json`. De marker bevat een blijvende
volume-identiteit. Alleen de eigenaar initialiseert hem met
`scripts/study-content/prepare-storage.mjs`; appstart doet dat nooit.

Een lokale testexemptie werkt alleen op de eigen database en exact de door de
runner aangewezen testroot. Daarnaast testen echte wegwerpcontainers het
mountcontract zonder deze exemptie. Twee onafhankelijk aangemaakte containers
lezen dezelfde bytes en volume-identiteit uit één persistent testbindvolume.
Een readonly mount en ontbrekende mount moeten worden geweigerd.

Afbeeldingen: maximaal 10 MiB, maximaal 8192 per dimensie / 16 miljoen pixels,
PNG/JPEG/WebP, echte signature en volledige Sharp-decode, single-page en SHA-256.
Geen SVG/HTML of actieve inhoud. Quarantainebestanden zijn exclusief en 0600;
na volledige validatie volgt fsync en een exclusieve atomische hardlink naar
`sha256.ext` (0440). Bestaande hashbestanden worden nooit overschreven. Geen
padnamen uit clients, geen symlink-following.

De downloader is voorbereid voor concrete toekomstige adapters: expliciete
HTTPS-hostallowlist, alle DNS-antwoorden publiek, gepinde DNS/TLS-hostnaam,
maximaal drie redirects die opnieuw door URL/DNS-controles gaan, 15 seconden
voor DNS/transport/stream, bytecap tijdens stream en exacte lengte/checksum.
De synthetische importer doet geen externe netwerkdownload.

DB en filesystem hebben geen gezamenlijke transactie. Daarom: STAGED-record →
gevalideerd fysiek bestand → hercontrole → READY-commit. Een DB-fout kan een
STAGED-record met bestand achterlaten; een retry verifieert/hergebruikt dit
bestand. Een bestand zonder bewezen DB-commit wordt niet publiek. Ontbrekende
of corrupte READY-bytes blokkeren publicatie; er is geen automatische GC,
verwijdering of stilzwijgende reconstructie van historische bestanden.

## API, beheerpreview en verschillen

`/adminbackend/content/study-publications` is onderdeel van het bestaande
Adminbackend → Content. Geen nieuwe shell of StudieReader. Native AdminSection,
Versado-tokens, vijf UI-talen en bestaande live-data-architectuur. Alleen de
synthetische testomgeving pollt tijdens imports; geen nieuwe globale listener.

- `GET/POST /api/admin/study-publications`: sessie en isAdmin, strikte Zod-input,
  alleen bekende acties, POST-Origin/CSRF, 30 mutaties/minuut, maximaal 16 KiB.
- `GET /api/admin/study-media/[mediaId]`: aparte expliciete beheerpreview.
- `GET /api/study-media/[mediaId]`: normale leesrechten, ook voor admins;
  uitsluitend media die daadwerkelijk in een toegankelijke **actuele**
  gepubliceerde revisie voorkomen. Een historisch publicatieauditrecord
  verleent geen mediarechten; oude revisieafbeeldingen blijven bewaard voor
  aparte adminpreview en rollback. Een queryparameter verleent nooit previewrechten.

Beheerqueries draaien READ ONLY met query-/locktimeout van 5 seconden;
schrijfqueries hebben begrensde locks, statements en transacties.

Responses zijn private/no-store met nosniff; mediacontent heeft expliciete
MIME/lengte, same-origin-policy en sandboxheader. Geen ruwe DB-fouten, paden,
credentials, profielen of privéschrijfacties. Content-addressed dedupe betekent
wel dat dezelfde reeds gepubliceerde bytes opnieuw in een concept mogen staan;
het concept zelf wordt daarmee niet openbaar.

Reviewcorrecties vóór merge: publieke media-autorisatie gebruikt alleen de
huidige `publishedRevisionId`-relatie en niet de historische
`StudyPublicationAction`-audit. Bij hergebruik van dezelfde afbeeldinghash
weigert de import uiteenlopende rechtenmetadata; bij publicatie wordt bovendien
de opgeslagen `ContentMedia.rightsMetadata` canoniek gehasht en vergeleken
met de `rightsHash` van het onveranderlijke revisiemanifest. Ook de normale
mediaresponse valideert die pin. Gerichte regressies controleren historische
media na revisiewissel, conflicterende importrechten en een corrupte
rechtenregistratie die nooit gepubliceerd mag worden.

De preview behoudt alle negen semantische bloktypen, afbeeldingen, bijschriften,
vragen en opdrachten. Ongecontroleerde links worden als tekst weergegeven,
niet gevolgd. Diff gebruikt stabiele sectie-/blok-/lijstitemankers, inclusief
verdwenen ankers, gewijzigde opdrachten, media, verwijzingen en bron/rechten.
Historische revisies blijven bereikbaar via begrensde keyset-paginering.
De preview meldt ontbrekende 2A-media-/referencekoppelingen expliciet, zonder
backfill. Mutatiebediening wacht op clientregistratie in de bestaande querylaag;
de browsercontrole vergelijkt de verstuurde collectie exact met de keuze.
Fouten invalidateren alleen de beheerdata, zodat een conflict/verloren response
via actuele serverstatus hersteld wordt. Netwerkfouten zijn vertaald.

Bevestigingen hergebruiken ConfirmProvider met een optionele native dialog in
de browser-top-layer, focus-trap, Escape, focusherstel en safe-area-bounds.
Bestaande bevestigingsaanroepen behouden hun interface. Annuleren schrijft niets.

## Publicatie en rollback

Service valideert admin, exacte editie/revisie/import, verwachte versie en UUID
actie-ID, snapshot/schema/hash, volledige batch, werk/familie/taal/collectie,
bron/rechten, alle READY-mediabestanden en alle references. Voor 2B bestaat
**geen bewezen interne mapping**: INTERNAL_VERIFIED is niet voldoende om te
publiceren. Alleen de expliciet gecontroleerde synthetische externe evidence
werkt in tests. Een onbekende betekenisvolle referentie blokkeert publicatie.

Transactie: scope → run → editie FOR UPDATE → idempotentie/CAS → gates → pointer
+ publicationVersion + immutable audit in één commit. Een identieke retry
retourneert de actuele pointer en oorspronkelijke actionVersion, niet een oude
publicatie. Andere actie met stale versie krijgt conflict. Twee beheerders kunnen
elkaar niet stilzwijgend overschrijven. Live-data-event pas na wijzigingscommit.

Import publiceert nooit. PUBLISH vereist de exacte actuele conceptpointer.
ROLLBACK vereist een eerder werkelijk gepubliceerde revisie, hercontroleert
media/references/hash en verandert alleen pointer/versie/audit. Revisies, concept,
media, contexten en gebruikersgegevens blijven behouden. Een auditfout rolt ook
de pointerwijziging terug. Rollback is geen intrekking.

## Productiegate en beperkingen

**Officiële import en publicatie blijven uitgeschakeld.** `synthetic-test`
vereist localhost PostgreSQL met database `versado_content_access_test` én de
synthetische adapter. Een vlag op `jehova-db` maakt niets vrij. Er is nog geen
gecontroleerde officiële adapter, officiële bronfixture of betrouwbare interne
editie-equivalentie. Dit wordt niet als bestaand bewijs voorgesteld.

De werkelijke NAS-map is niet bezocht. De voorgestelde bind mount volgt de
bestaande audioconventie. Stackconfiguratie + mount + marker zijn eenmalige
owneracties na afzonderlijk akkoord; image-only Adminbackend-deploy voegt een
mount niet toe. Deployagent kopieert bestaande mounts/env en hoeft niet aangepast
te worden. Zie [Synology-instructies](../DEPLOY-SYNOLOGY.md#fase-2b-studielesmedia--eenmalige-voorbereiding-na-afzonderlijk-uitrolakkoord).

De eigenaar bevestigde dagelijkse Hyper Backup. Geen onafhankelijke restoretest
uitgevoerd; eerder expliciet geaccepteerd restrisico. Deze ronde heeft geen
productiequery, back-up, NAS-map, import, seed, migratie of deployment uitgevoerd.

## Testresultaten

Lokaal uitgevoerd op 13 oktober 2026, uitsluitend met eigen synthetische data:

| Controle | Werkelijk resultaat |
| --- | --- |
| Prisma validate/generate en TypeScript | Geslaagd. |
| Schone Next.js-productiebuild | Geslaagd; browsertests gebruiken deze build. |
| ESLint | Geen fouten; 134 bestaande waarschuwingen, bevestigd door afzonderlijke lintcontrole van dezelfde bestanden uit de basiscommit. Nieuwe fase-2B-bestanden hebben geen lintwaarschuwingen. |
| i18n | Geslaagd; 84 nieuwe sleutels in alle vijf talen. Bestaande onvolledige vertaaldekking buiten deze sleutels blijft staan. |
| Studie-unitchecks | 61 geslaagd: 33 nieuwe import/media/publicatiechecks en 28 bestaande 2A-checks. |
| Bredere unitregressies | 174 geslaagd, inclusief contentwisseling, focus/shell, live data, adminlayout, tijd en centrale beloningsregels. |
| Volledige geïsoleerde 1A–2B-run | 304 tests geslaagd: 281 bestaande toegang/context/content/leerregressies en 23 nieuwe database-integratietests; geen skips. |
| Nieuwe DB-foutinjectie | Afschrijving/beloningen blijven onaangetast; audit-/pointerrollback, leaseverlies, herstart, twee workers, stale versie, identieke retry, readonly/missing media, cross-edition en ontbrekende tabel/timeout gecontroleerd. |
| Snelle Zendeling / Genees | 173 speltests, 58 economytests, 18 bron/isolationtests en 2 multi-instance/browsertests geslaagd; eigen PostgreSQL/Redis en twee echte serverinstances. |
| Legpuzzel-unitregressies | 41 geslaagd. |
| Mysterie-unitregressies | 44 unitchecks, 11 database-integratietests en 7 productiebuild-browserflows geslaagd; hervatten, nieuw toestel, bronwissel, hints en foutafhandeling gecontroleerd. |
| Nieuwe beheerbrowserflows | 19 geslaagd; geen browserfouten. |
| Persistent mediavolume | Twee afzonderlijke containers met aantoonbaar verschillende image-ID's lezen dezelfde volume-ID en SHA-256; readonly en ontbrekende mount worden geweigerd. |
| Migratiedatabehoud | 138 bestaande tabellen, 344 constraints, 357 indexen en oude kolomhashes behouden; afgebroken DDL, objectconflicten, locktimeout en herhaald migrate deploy getest. |
| Availability-querybudgetten | Bestaande limieten en verse rechten/settings/scopes blijven geldig; geen productiemetingen. |

Browsermatrix: 320×844, 390×844, 1280×900 en 844×390 landscape, elk
licht/donker, volledige flow import → concept → semantische preview → diff →
publicatie → nieuw concept → publicatie → historische rollback → refresh.
Daarnaast 320px met 200% tekst in alle vijf UI-talen en beide thema's, gemodelleerde
20px boven-/34px ondersafearea, focus-trap, Escape, annuleren en netwerkfoutherstel.
De laatste flow blokkeert een onopgeloste verwijzing zonder publicatie. Browseracties
vergelijken de werkelijk verstuurde collectie met de geselecteerde collectie en
controleren dat gebruikersdata byte-identiek blijven.

Dit zijn Chromium-productiebuildtests met mobiele emulatie; **geen fysieke iOS- of
Android-toestellen**. Screenshots en `results.json` komen als CI-artifact
`study-import-publication-browser`, gekoppeld aan de exacte commit in de concept-PR.
Geen grote gegenereerde bestanden in Git. De toepasselijke Actions worden na push
op de exacte gepushte commit gecontroleerd; de PR vermeldt hun uiteindelijke status.

Een eerste aanvullende Mysterie-run kon zijn eigen lokale PostgreSQL-container
niet starten tijdens gelijktijdige tests. Dat was geen applicatieresultaat; de
controle is opnieuw uitgevoerd en volledig geslaagd. Eventuele PostgreSQL-driverwaarschuwingen worden
onderscheiden van de bewust geïnjecteerde databasefouten. Ruwe fouten blijven uit
API-responses.

## Gewijzigde onderdelen

- Prisma-schema en uitsluitend nieuwe migratie `20261030120000_study_import_publication`.
- `src/lib/studyContent/`: gedeelde revisie-uitbreiding, fixtureadapter, importlease,
  publicatie, readonly beheerqueries, opslag, SSRF-veilige downloader en mediarechten.
- Adminpagina/API's, private normale media-API, `AdminStudyPublicationsClient`,
  semantische preview en optionele native bevestiging in `ConfirmProvider`.
- Centrale live-data-scope, terugbalkregistratie en vijf i18n-bestanden.
- Compose-/image-/omgevingsconfiguratie, expliciete volumemarker-tool,
  isolated runner, nieuwe unit/DB/browser/migratietests en bestaande Actions-workflow.
- Dit statusdocument, `docs/DEPLOY-SYNOLOGY.md` en `docs/DATA-REFRESH.md`.

Geen bestaande content-, voortgangs- of beloningslogica vervangen; geen legacy-FSY
synchronisatie, algemene seed of NAS-configuratie uitgevoerd.

## Uitrol, rollback en vervolg

1. Review exacte PR/commit, additieve DDL, databehoud/foutinjectie en groene Actions.
2. Afzonderlijk eigenaarakkoord voor merge en productie-uitrol; geen automatische
   uitvoering vanuit deze opdracht. Containerstart voert Prisma-migraties uit.
3. Bestaande deploymentconfig controleren; eenmalige permanente media-mount en
   marker voorbereiden volgens bovenstaande eigenaarinstructies.
4. Gecontroleerde image-update, migratiestatus/gezondheid/legacyfuncties controleren;
   officiële productiepublicatie gesloten houden.
5. Bij fout vorige image terugzetten, nieuwe schemaobjecten en volume behouden;
   geen destructieve down-migratie of verwijdering van audit/media. Bij gedeeltelijke
   mislukte DDL stopt startup; onderzoek Prisma-status vóór een recoveryactie.

2C kan de semantische revisie/mediabindingen gebruiken voor de gedeelde reader;
leespositie en gebruikersprogressie zijn hier niet gebouwd. 2D moet betrouwbare
canonieke én editie-equivalentie aantonen voordat officiële references intern
worden vrijgegeven. Officiële adapters vereisen apart gecontroleerde bronstructuur,
licentievoorwaarden en completeness-fixtures; de synthetische adapter is geen
vervanging voor die validatie.
