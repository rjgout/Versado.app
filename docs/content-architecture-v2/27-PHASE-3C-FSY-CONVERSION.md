# Fase 3C — expliciete FSY-writerhandover

Basis: `origin/main` 97670085. PR #140 was bij aanvang open (b5c99168); geen merge/cherry-pick, geen concurrerende programmapublicatieservice.

## Contract en databehoud

De nullable, unieke `FsyLesson.studyLessonEditionId` verwijst restrictief naar de gedeelde editie. De migratie voegt geen mapping of inhoud toe. Een databaseguard weigert insert met mapping en wijzigingen/verwijdering van overgedragen legacyrijen. Alleen de conversietransactie kan een gecontroleerde mapping zetten. Scheduler en handmatige legacypublicatie slaan overgedragen rijen over/weigeren ze; automatische publicatie blijft uitsluitend op niet-overgedragen legacyrijen werken.

De beheerder start per les bewust een preflight en bevestigt de overdracht in bestaand FSY-beheer. De oorspronkelijke rijhash wordt onder een row lock hercontroleerd. Jaar, maand, categorie, volgorde en `fsy:<legacyId>` blijven bewaard; geen weekmodel. Eén jaarperiode per concrete legacycollectie houdt bronnen gescheiden. Het gepubliceerde tekst-/titel-/afbeeldingssnapshot wordt een afzonderlijke immutable revisie, ook wanneer de legacy-status inmiddels DRAFT is. Een afwijkend concept wordt afzonderlijk bewaard. Gelijke kopieën delen één revisie. Bestaande publicatiedatum, bronhash en volledige legacyrij blijven zowel in de oude rij als in de importaudit bewaard. Nieuwe ankers worden eenmalig toegekend en daarna immutable opgeslagen; er wordt geen revisie-equivalentie verzonnen.

Alle writes (revisies, importaudit, pointers, mapping) zijn één transactie. Oude routes, cursus-ID's, `fsy:<id>`-leskeuzes en gebruikersgegevens blijven bestaan. De gemapte `/fsy/<id>` gebruikt de bestaande StudyReader; ongemapte rijen blijven de legacyreader gebruiken. Een ingetrokken gemapte publicatie valt nooit terug op de oude kopie.

## Bron- en publicatiegrenzen

Deze adapter ondersteunt alleen bewezen Nederlandse legacy-FSY met officiële `ftsoy/<jaar>/<maand>`-bron en `lang=nld`, opgeslagen bronhouder/licentie en volledig valide opgeslagen blokken. Ontbrekende rechten, onbekende blokken of onvolledige snapshots blokkeren zonder wijziging. Verloren inline-links worden niet gereconstrueerd; de preflight en audit melden dit expliciet.

Afbeeldingen moeten al ondubbelzinnig als READY-medium voor dezelfde bron-URL geregistreerd zijn, op het gecontroleerde persistente volume aanwezig zijn en hash/metadata-validatie doorstaan. Losse afbeeldingen zonder bewezen plaats in de tekst blokkeren. Geen scrape/download, geen gokwerk en geen productiefixture. Daardoor is deze voorbereide conversie nadrukkelijk geen claim dat alle werkelijke FSY-rijen direct converteerbaar zijn.

Nieuwe publicaties lopen uitsluitend via de bestaande gedeelde publisher. Deze herleidt het importbewijs opnieuw naar de bevroren legacyrij en vergelijkt alle betekenisvolle blokken; reguliere schema-, hash-, media-, referentie-, versie- en auditgates blijven gelden. Er is geen koppeling aan startup, seed, contentreload of deployment.

## Writerrollback en uitrol

Vóór uitrol: onafhankelijke review, afzonderlijk merge-/uitrolbesluit van eigenaar, backup en behoud van studie-mediavolume. Synology voert de additieve migratie bij containerstart uit; die verandert alleen schema/guard en **schakelt geen enkele les om**. Daarna uitsluitend bewuste, per-les preflight en handover na inhoudelijke acceptatie. Geen NAS-/productiehandelingen door Codex.

Een nog ongewijzigde overdracht kan via dezelfde beheeromgeving terug naar de legacywriter. CAS op publicationVersion en controle van de oorspronkelijke importpointers blokkeren rollback na nieuwe publicatie of gewijzigde conceptpointer. De gedeelde les wordt retired; alle revisies/audits blijven behouden. Een oude conversieretry activeert haar niet opnieuw; een nieuwe bevestigde actie is vereist. Terugzetten naar een appimage die de guard niet begrijpt is voor gemapte rijen niet voldoende: voer eerst de gecontroleerde writerrollback uit. Voor later gewijzigde publicaties is afzonderlijk herstelontwerp nodig; verwijder nooit revisies of gebruikersdata.

## Technische verificatie

- Migratieproef: 146 oude tabellen en 810 schemaobjecten behouden; oorspronkelijke kolommen, tijdstempels en pointers identiek, geen backfill. Naamconflict rolt de volledige DDL terug; herhaalde migrate deploy heeft geen pending stappen.
- Gerichte bestaande unitregressies: 90 geslaagd; TypeScript en productiebuild geslaagd.
- 10 integratietests geslaagd: publicatie/concept, onbekende bron/rechten/media, concurrentie/retry, onderbreking, rollback, gedeelde publicatievalidatie, authenticatie/Origin, legacycontext en READY-mediaverlies. Twee nieuwe pure contracttests geslaagd (totaal 92 unitregressies).
- Productiebrowser: 320×844 licht/200%, 390×844 donker, 768×1024 licht, 1280×900 donker en 844×390 donker/200%; echte preflight, bevestiging, handover en gedeelde reader via oude URL geslaagd, geen horizontale overflow. CI wordt op de gepushte head gevolgd.
- Integratierunner meldt een bestaande pg-query-deprecation; geen test is overgeslagen. De tests vonden en verholpen vóór oplevering een JSON-datumhashverschil en SQL-NULL-afhandeling in de nieuwe writerguard.
- Lint: twee bestaande warnings in AdminFsyClient (effect/dependency); geen gerichte lintfouten. i18n meldt bestaande vertaalachterstand; alle nieuwe sleutels bestaan in vijf talen.
- Browserbewijs: CI-artifact `fsy-conversion-browser`, niet in Git. Geen echte iOS-/Android-toestellen of productie getest.

CI-regressie: de oude 1B-test `draft-copy` is aangepast aan M3: een bewaarde publicatie blijft toegankelijk naast een gewijzigd legacyconcept. De vervangende positieve test controleert tevens dat concepttekst niet wordt geretourneerd en een echte ongepubliceerde les geweigerd blijft. De volledige geïsoleerde contentaccess-run (inclusief context, selectie en spellen) slaagt na deze correctie.
