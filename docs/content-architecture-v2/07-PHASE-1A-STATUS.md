# Fase 1A — gedeeltelijke implementatie en migratieblokkade

## Status en beginsituatie

PR #84 is verwerkt in main via `715c18adf62a379bf623efd02894a8bd6a34b307`.
Besluitcommit `7651e166dbd9750ebccd5ca604e531275de8c081` is een ancestor van
die main. Deze werkbranch, `codex/content-architecture-v2-1a`, is daarvan
gestart. Tussen de auditbasis en deze main zijn alleen de zeven goedgekeurde
architectuurdocumenten gewijzigd.

**Fase 1A is niet volledig afgerond.** Een inventarisatie van de bestaande
live collecties en bewijs van een geschikte recente backup met geïsoleerde
herstelproef zijn niet aangeleverd of uitgevoerd. Er is geen toestemming voor
productiequery's of backupacties. Conform document 03 en 05 zijn daarom geen
schemawijziging, ContentWork-backfill of productieactie uitgevoerd.

Wel uitgevoerd: onafhankelijke toegangsbeveiliging op het bestaande schema,
automatische HTTP-/DB-regressietests en veilige voorbereiding van de
inventarisatie en herstelvalidatie. Geen fase 1B, 1C of 1D is gestart.

## Centrale legacy-toegangsservice

`src/lib/contentAccess.ts` centraliseert de bestaande flags:

| Doel | Gewone gebruiker | Server-geauthenticeerde beheerder |
| --- | --- | --- |
| Catalogus | enabled én visibleToUsers | enabled; verborgen collecties mogen zichtbaar zijn |
| Gewoon lezen | enabled én visibleToUsers | dezelfde regel |
| Expliciete beheerpreview | geweigerd | bestaande collectie, ook hidden/disabled |

`readingAccessWhere` kiest de bestaande beheerpreview uitsluitend op basis
van de door `getCurrentUser` verkregen adminrol. Een clientpayload met
`isAdmin: true` heeft geen invloed. Ontbrekende actor of collectie geeft geen
toegang; een nullable collectie-ID geeft ook voor een beheerder geen bypass.
`contentCollections.ts` gebruikt dezelfde service voor het catalogusfilter
en de bestaande directe collectiecontrole.

Dit is **nog geen publicatiebeleid voor nieuwe bronnen**. De bestaande schema-
defaults en bestaande enabled/visibleToUsers-waarden zijn ongewijzigd.
ContentWork en opgeslagen LEGACY/DRAFT/PUBLISHED ontbreken nog. Nieuwe
contentbronnen mogen daarom niet via deze gedeeltelijke oplevering worden
geïntroduceerd. De vereiste veilige DRAFT-default en werkrelatie volgen pas
na het migratiebewijs; het complete fase-1A-acceptatiecriterium is niet gehaald.

## Beveiligde toegangspaden

De controle vindt plaats vóór brontekst uitlezen of de bestaande mutatie:

- `/api/chapters/[chapterId]`, `/read`, `/submit`, `/audio-languages` en
  `/api/chapters`.
- `/api/reading-sessions`, `/api/reading-lessons/submit`, `/api/live/create`.
- `/api/verses/[verseId]/bookmark`, `/highlight` en `/note`.
- `/api/bookmarks`: bestaande privérecords blijven opgeslagen, maar records
  uit verborgen/uitgeschakelde bronnen worden niet met hun volledige
  brontekst aan een gewone gebruiker teruggegeven.
- `/api/exercises/[exerciseId]/check`, `/hint` en `/api/practice/submit`:
  toegang tot de bron én bestaande APPROVED-status vereist voor gewone users.
  Ook de optionele bronvers-relatie van een oefenhint is gefilterd.
- `/api/dictionary`, `/api/dictionary/[word]` en `/api/persons/[slug]`;
  bij personen ook gerelateerde vader/kinderen.
- Leespagina's `/lesson/[chapterId]`, `/reading-lesson/[lessonId]` en
  `/courses/[courseId]/chapter/[chapterId]`, inclusief zowel cursusbron als
  hoofdstukbron bij een leesles.

Bestaande FSY-/cursus-/abonneer-/studiepaden die al
`isContentCollectionSelectable` gebruiken, krijgen daarmee dezelfde centrale
controle. De audit beschreef sommige leespagina's als reeds beschermd; de
actuele codecontrole vond daar nog ontbrekende guards en corrigeert die
vaststelling in deze implementatiestatus.

De oorspronkelijke contentswitcher, taal- en editie-routing, progressiesleutels,
FSY-publicatiekopieën, podcastmodellen en beloningsservices blijven bestaan.
De bestaande synthetische fallback in contentcontext wordt niet herschreven;
de beveiligde data-API's controleren de daadwerkelijke collectie alsnog.
Dit is geen volledige spelcontentresolver of audit van ieder bestaand spelpad.

## Databescherming en voorbereiding

`scripts/content-architecture/inventory.mjs` levert een expliciet aangevraagde,
read-only inventaris met werk-/editie-/taalidentiteiten, nulls, conflicten,
recordaantallen, relatiecontroles, FSY-kopieën en migratiechecksums. Het script
is uitsluitend op synthetische testdata uitgevoerd. Bekende werksleutels
krijgen een classificatieadvies; onbekende bronnen en null-workwaarden worden
niet automatisch Schriftuur of Studieprogramma. Podcasts blijven OTHER.

`scripts/content-architecture/test-isolated.mjs` past alleen de bestaande
migraties toe op een eigen lege PostgreSQL-container. De productie-HTTP-handler
start zonder seed, scheduler of FSY-sync. De runner controleert daarna een
dump/herstel van uitsluitend de synthetische fixtures. Dit bewijst de
voorbereidingsprocedure, **niet een geschikte productiebackup**.

De uitvoerprocedure en verplichte bewijsstukken staan in
[de voorbereidingshandleiding](../../scripts/content-architecture/README.md).
Geen bestaande content-, cursus- of annotatierecords worden verwijderd.
De integratietests vergelijken verborgen privérecords vóór en na geweigerde
requests; ook een lege notitiemutatie kan die niet ongemerkt verwijderen.

## Validatie en resterende voorwaarden

Uitgevoerd op deze werkbranch:

| Controle | Resultaat |
| --- | --- |
| Gerichte toegang/inventaris/HTTP-DB-tests | 19 geslaagd, 0 overgeslagen |
| Bestaande editie-, wissel-, leer- en reeksregels | 31 geslaagd (41 inclusief 10 toegangs-unittests) |
| Focus/shell | 23 geslaagd |
| Live data | 51 geslaagd |
| TypeScript | geslaagd |
| Prisma-validatie | geslaagd; dummy-URL, geen databasequery |
| Volledige ESLint | 0 fouten; 132 bestaande waarschuwingen |
| ESLint nieuwe service/tests/scripts | 0 fouten, 0 waarschuwingen |
| i18n | geslaagd met bestaande dekking: en/de/fr/es 3261/3684; geen UI-teksten gewijzigd |
| Schone lokale productiebuild | geslaagd; vorige .next buiten de repository bewaard |
| Fixture-dump/herstel | geslaagd, schema/aantallen en beschermde records identiek |

De HTTP-tests omvatten de drie beveiligde leespagina's, echte eerder uitgegeven
oefensessies, verborgen personen, twee talen en een null-work-legacycollectie.
De tests bewijzen geen volledig browser-/Capacitor-regressieonderzoek en geen
prodmedia-herstel. Buildbevestiging voor de definitieve commit wordt daarnaast
via de nieuwe concept-PR-workflow `content-access.yml` gecontroleerd.
De fixtureherstelproef rapporteert expliciet `productionBackupVerified: false`.

Gewijzigde bestanden: de hierboven genoemde routes/pagina's,
`src/lib/contentAccess.ts`, `src/lib/contentCollections.ts`, `package.json`,
de drie `tests/content-access*`/`content-inventory.test.mjs`-bestanden,
`scripts/content-architecture/{inventory,test-isolated,test-server}.mjs`, hun
README, `.github/workflows/content-access.yml` en dit statusdocument.
`prisma/schema.prisma`, migraties, UI-componenten en vertalingen zijn ongewijzigd.

Collection-DRAFT-tests en ContentWork-DB-tests zijn niet
uitvoerbaar zolang de bijbehorende schemawijziging terecht geblokkeerd is.
Conceptoefening-tests mogen niet als vervanging daarvan worden geïnterpreteerd.

Voor afronding van 1A blijven nodig: daadwerkelijke inventaris en geschikte
backup/herstelbewijzen, gecontroleerde mapping, additief ContentWork-model en
publicatiestatus, compatibele backfill en bijbehorende legacy/nieuwe-bron/
conflict-/conceptintegratietests. De goedgekeurde verwijzingseditievoorwaarden
van fase 2D blokkeren 1A niet. Fase 1B kan pas na beoordeling en afronding van
dit bronfundament starten; hier is geen UserStudyContext toegevoegd.
