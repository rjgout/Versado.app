# Fase 1A — ContentWork, publicatiecompatibiliteit en centrale toegang

Deze PR is voorbereid voor beoordeling; **geen productie-uitrol uitgevoerd of toegestaan**.
Fase 1B, 1C en 1D zijn niet gestart. De afzonderlijk te beoordelen additieve
migratie wordt automatisch uitgevoerd zodra deze code via het deploypaneel
in productie start. Een merge of groene test is geen toestemming voor die deploy.

## Beginsituatie en synchronisatie

PR #84 inclusief besluitcommit `7651e16` staat in main. PR #85 begon op
`715c18a`; de bestaande commits `f1ed318`, `2b4c631` en `612d566` zijn behouden.
PR #86 is op 11 oktober gemerged via `e8e922a`. Mergecommit `9fc5e55` synchroniseert
1A met die main, zonder rebase of force-push. Conflicten betroffen uitsluitend
`inventory.mjs` en `test-isolated.mjs`: main levert de gedeelde inventarisatie-CLI
en adminrunner; de 1A-runner heet nu `test-access-isolated.mjs`. De oude zes
inventarisatietests zijn vervangen door de uitgebreidere gedeelde TS-suite.
Alle centrale guards en de scheiding normaal lezen/beheerpreview blijven behouden.

## Echte inventaris en checksumbewijs

Bron: door de eigenaar aangeleverd JSON-rapport, **2026-10-11T18:51:50.752Z**.
SHA-256: `68d526b4bb103acc6d60172c5d0b7787060fe8ee4dd1a6def88c57f14b208131`.
Het originele rapport wordt niet in Git opgeslagen. De werkruimte heeft geen
nieuwe productiequeries uitgevoerd; een NAS-koppeling is geen resterende blokkade.

`validate-inventory.mjs` valideert offline via de Zod-allowlist uit
`src/lib/content-inventory/core.ts` en herberekent dezelfde identiteitsanalyse.
Bewezen: 21 ingeschakelde collecties, zeven werken, nul null-workwaarden en
identiteitsconflicten, zes zichtbaar/vijftien verborgen, tien integriteitsmetingen
allemaal nul. `publicationFieldPresent=false`. Users: 28. FSY: 37 lessen,
16 gepubliceerd en 21 concept, nul concepten met oudere gepubliceerde kopie.
De inventaris heeft geen privénotitieteksten of gebruikersprofielen.

Migratiecontrole op de 136 registraties:

- **133 succesvolle registraties** matchen de huidige SQL-bestanden byte voor
  byte via SHA-256. Geen bestaand migratiebestand is in deze PR veranderd.
- **Twee succesvolle historische namen** zijn bewezen hernoemingen uit
  commit `48c5384`: `1789767235_add_person_fields` →
  `20260918213534_add_person_fields` en `1789831396_add_user_avatar_emoji` →
  `20260919152904_add_user_avatar_emoji`. De opgeslagen checksums matchen de
  oorspronkelijke bestanden uit `48c5384^`; ook beide huidige vervangende
  migraties zijn succesvol geregistreerd met de huidige checksum.
- **Eén historische rollback** van
  `20261015120000_recipient_activity_reaction_batches` is gevolgd door een
  succesvolle registratie van dezelfde naam met de huidige checksum.
  Dit is geen actuele mislukte migratie. Het oude mislukte SQL-bestand wordt
  niet als huidig toegepast bestand behandeld.
- Geen onvoltooide registratie of onverklaarde afwijking. De nieuwe 1A-migratie
  staat vanzelfsprekend nog niet in de productiemomentopname.

De verifier heeft alleen deze twee expliciet bewezen naamuitzonderingen; andere
ontbrekende SQL-bestanden, drift, onvoltooide migraties en rollbacks zonder
bewezen later succes vereisen beoordeling.

## Definitieve mapping: 21 collecties, zeven werken

| Werk | Soort | Editiefamilie | Collectie-ID’s en talen |
| --- | --- | --- | --- |
| bofm | SCRIPTURE | bofm | content_bom (nl), content_bom_de (de), content_bom_en (en), content_bom_es (es), content_bom_fr (fr) |
| old-testament | SCRIPTURE | otb | content_old_testament_otb_de/en/es/fr/nl (respectieve taal) |
| new-testament | SCRIPTURE | otb | content_new_testament_otb_de/en/es/fr/nl (respectieve taal) |
| dc-testament | SCRIPTURE | dc-testament | content_dc (nl), content_dc_en (en) |
| pgp | SCRIPTURE | pgp | content_pgp (nl), content_pgp_en (en) |
| fsy | STUDY_PROGRAM | fsy | content_fsy (nl) |
| podcasts | OTHER | podcasts | content_podcasts (nl) |

De vijf bofm-edities en podcasts zijn zichtbaar; alle overige collecties zijn
verborgen. Alle enabled-/visibilitywaarden worden behouden. De exacte metadata
staat als veilige content-only fixture in `tests/fixtures/content-1a-catalog.json`.
Geen CFM-collectie, nieuwe FSY-les of dubbele editie wordt aangemaakt.

## Modellen en migratie

`ContentWork` bevat uitsluitend `key` (PK) en `kind`
(`SCRIPTURE`, `STUDY_PROGRAM`, `OTHER`). De relatie gebruikt het bestaande
nullable `ContentCollection.work`, met FK RESTRICT voor verwijderen én
hernoemen van een gerefereerd werk. Er komt geen tweede workId. De bestaande
unieke `(work,editionKey,language)` blijft behouden en indexeert ook de FK.
Nullable opslag blijft compatibel; een ontbrekende werkrelatie geeft geen toegang.

`ContentPublicationState` heeft `LEGACY`, `DRAFT`, `PUBLISHED`.
Migratie `20261020120000_content_work_publication`:

1. Vergrendelt ContentCollection met een vijf seconden lock-timeout en
   controleert lege/null/conflicterende identiteiten.
2. Registreert exact de zeven geverifieerde werken, zonder conflict-updates.
   Onbekend werk vereist vooraf expliciete registratie/beoordeling; een
   afwijkende soort voor een bekend werk stopt de migratie.
3. Voegt publicationState eenmalig toe met LEGACY voor bestaande rijen.
   Zet daarna de insertdefault DRAFT en visibleToUsers-default false.
   Bestaande rijen/vlaggen veranderen niet.
4. Voegt de gevalideerde FK toe. Eén DO-statement maakt alle stappen atomisch.

Heruitvoering maakt geen dubbele werken en verheft latere DRAFT-rijen niet tot
LEGACY. Een later expliciet geregistreerd OTHER-werk wordt behouden.
Nieuwe collecties kunnen een bekende werkidentiteit gebruiken of vragen een
expliciet nieuw ContentWork-record; er is geen classificatie op titel/slug.
Geen schema voor lessen/revisies, UserStudyContext of nieuwe publicatie-editor.

## Toegangsbeleid en API-impact

| Doel | Gewone gebruiker | Beheerder |
| --- | --- | --- |
| Normaal lezen/muteren | werkrelatie + LEGACY/PUBLISHED + enabled + zichtbaar | dezelfde regel |
| Bestaande catalogus | dezelfde regel | LEGACY/PUBLISHED + enabled; bestaande verborgen bronnen blijven herkenbaar |
| Expliciete adminpreview | geweigerd | werkrelatie vereist; mag concept/verborgen bron inspecteren |

`collectionAccessWhere`, `readingAccessWhere`, `canAccessCollection` en
`getContentAvailability` vormen één centrale service. Een gewone beheerdersrequest,
`preview=true` of een payload met `isAdmin:true` verruimt geen leesrechten.
Publicatie betekent geen automatische zichtbaarheid; enabled alleen betekent
evenmin publicatie. De relationele identiteitsfilter overschrijft geen bestaande
work-/editiefilters, ook niet op de OTB-previewpagina.

Bestaande guards krijgen dezelfde publicatiecontrole vóór reads/mutaties:

- `/api/chapters`, `/api/chapters/[chapterId]`, `/read`, `/submit`, `/audio-languages`.
- `/api/reading-sessions`, `/api/reading-lessons/submit`, `/api/live/create`.
- `/api/verses/[verseId]/bookmark`, `/highlight`, `/note` en `/api/bookmarks`.
- `/api/exercises/[exerciseId]/check`, `/hint`, `/api/practice/submit`;
  APPROVED blijft verplicht, ook voor admins.
- `/api/dictionary`, `/api/dictionary/[word]`, `/api/persons/[slug]`.
- `/lesson/[chapterId]`, `/reading-lesson/[lessonId]`,
  `/courses/[courseId]/chapter/[chapterId]` en bestaande selectability-consumenten
  voor cursus-/FSY-/studietoegang.
- Expliciete `/adminbackend/content-preview`, na sessie-/admincontrole.

Verborgen privéannotaties worden niet verwijderd; `/api/bookmarks` levert geen
volledige verborgen brontekst via een persoonlijke lijst. De integere records
blijven aanwezig en komen terug bij herstelde toegang. De adminbeheer-API’s
blijven afzonderlijk rolbeveiligd. Er is geen nieuwe gewone preview-API.

De huidige contentswitcher, editie-/taalkeuze, FSY-kopieën, podcasts en
voortgangssleutels blijven bestaan. Defaultcollectie en zichtbaarheidstellers
gebruiken nu eveneens het publicatiebeleid. De bestaande synthetische lege-
catalogus-contextfallback wordt niet in 1A herschreven; beschermde leespaden
controleren altijd de echte collectie. Een volledige spelresolver blijft 1D/5A.

## Testbewijs en databehoud

De 1A-runner creëert uitsluitend zijn eigen lokale PostgreSQL 16-container.
Prisma past eerst de 133 oude migraties toe. Daarna worden synthetische
bestaande records geladen, dan past **prisma migrate deploy** de nieuwe
migratie toe. Geen algemene seed, scheduler, import of FSY-sync.

De fixture gebruikt de echte collectie-ID’s/edities en relevante aantallen:
28 synthetische users, 37 FSY-lessen (16/21), 60 cursusvoortgangsrecords,
29 lesvoortgangen, 44 legacy-hoofdstukvoortgangen, 8 kinder-/24 introvoortgangen,
113 inhoudsvoortgangen, 60 credits, 89 oefensessies, 260 leesessies,
12 podcastposities, 11 podcastresultaten, 370 XP-transacties,
149 reeksactiviteiten en 148 reeksdagen. Daarnaast synthetische privéannotaties,
woordspel met betaalde hints en een lopende puzzelsnapshot. Het rapport had nul
notities; bewust wordt één synthetische notitie toegevoegd voor behoudsbewijs.
Grote leesteksttabellen zijn representatief verkleind; geen productiegebruikers
of volledige productieteksten worden gekopieerd.

Alle bestaande **126 tabellen** worden vóór/na vergeleken met rij-aantallen en
geordende JSONB-fingerprints. Alleen het nieuwe publicatieveld, de nieuwe tabel
en de Prisma-migratieregistratie worden buiten die vergelijking gehouden.
Bewezen: exacte collectie-ID’s, editie-identiteiten, 6/15-vlaggen en alle
synthetische bestaande rijen blijven gelijk; FSY-content/status/kopieën en
persoonlijke voortgang/timestamps wijzigen niet. Dit bewijst de geteste
migratie, geen uitgevoerde productiebackfill of herstelbaarheid van de NAS-backup.

Ook getest: heruitvoering van SQL én Prisma deploy, latere DRAFT-rij behouden,
FK tegen onbekend werk, werk verwijderen/hernoemen, nul/lege/dubbele identiteit,
conflicterende kind, lock-timeout en expliciet afbreken/rollback vóór commit.
Alle mislukte migraties laten de bestaande fixture intact; geen gedeeltelijke DDL.

Uitgevoerd op de gesynchroniseerde werkbranch:

| Controle | Resultaat |
| --- | --- |
| Geïsoleerde migratie | 126 bestaande tabellen behouden; exacte 21/7-mapping; conflict/abort/lock/retry bewezen |
| Toegang/inventaris/offlinevalidatie/contentwissel | 59 geslaagd, 0 skipped; echte HTTP/DB-tests in eigen container |
| Gerichte unit-run | 40 geslaagd, 0 skipped (ook onderdeel van de 59) |
| Admininventarisatie | echte HTTP/read-only/CSRF/privacy/timeouttests geslaagd |
| Adminbrowser | 20 combinaties + vier vertalingen; 320/390/768/1280 en 844×390 landscape, licht/donker, 100/200% tekst, download/toetsenbord |
| Editie/wissel/leer/reeks/bron/OTB/studie-regressies | 53 geslaagd, 0 skipped |
| Focus/shell | 23 geslaagd |
| Live data | 51 geslaagd |
| Puzzelintegratie + Kompas DB-subset | 40 geslaagd, 0 skipped, eigen PostgreSQL |
| Woord-van-de-Dag-integratie/hints | 29 geslaagd, 0 skipped, eigen PostgreSQL |
| Puzzel / woordhints / woordzoeker unit | respectievelijk 41 / 5 / 4 geslaagd |
| Kompas totaalscript zonder DB-binding | 60 geslaagd, 9 DB-tests skipped; DB-subset apart in puzzelrunner, geen claim dat skipped tests zijn uitgevoerd |
| TypeScript en Prisma | geslaagd |
| ESLint | 0 fouten, 132 bestaande waarschuwingen; gerichte gewijzigde code 0 waarschuwingen |
| i18n | geslaagd; en/de/fr/es elk 3303/3726, bestaande achterstand 423 sleutels; geen nieuwe UI-teksten |
| Schone lokale productiebuild | geslaagd met onbruikbare dummy-DB-URL; geen productiebinding |

GitHub Actions op de gepushte commit wordt afzonderlijk vóór de chatoplevering
gecontroleerd; actuele runs staan bij [PR #85](https://github.com/rjgout/Versado.app/pull/85/checks).
De gecontroleerd uitgelokte PostgreSQL-errors 42P01/42703/55P03/57014 in de
adminintegratielog zijn geslaagde fout-/timeouttests, geen resterende failures.
Browserartefacten blijven buiten Git en zijn via de inventory-workflow downloadbaar.
Geen fysieke Safari/iOS/Android/Capacitor- of live-productiesmokecheck uitgevoerd.

## Backupbesluit en veilige productie-uitrol

Dagelijkse volledige Synology Hyper Backup is door de eigenaar bevestigd.
Laatste succesvolle uitvoering, taakmetadata, database-/WAL-consistentie,
media-volume-dekking en daadwerkelijke terugzetbaarheid zijn hier **niet bewezen**.
De eigenaar heeft de aanvullende productiebackup-herstelproef bewust overgeslagen
als geaccepteerd risico. Er is geen nieuwe backup of restore uitgevoerd.

Uitrol vereist een afzonderlijk expliciet besluit; deze PR blijft concept en ongemerged:

1. Review mapping, SQL, checksumuitzonderingen, databehoudsbewijs en risicoacceptatie.
   Beoordeel vlak vóór de daadwerkelijke uitrol opnieuw de actualiteit van de
   momentopname via de bestaande admininventarisatie; de huidige opdracht voert
   die nieuwe productiequery niet uit. Onbekende nieuwe bronnen vereisen beoordeling.
2. Eigenaar controleert binnen zijn eigen beheer de recentheid/taakdekking van
   Hyper Backup. Geen herstelclaim en geen nieuwe backupactie vanuit deze opdracht.
3. Leg de goedgekeurde image-digest/SHA en een **publicatiebewuste compatibele
   rollbackimage** vast. Een oude image zonder DRAFT-guards is geen veilig
   algemeen rollbackpad wanneer later DRAFT-content zichtbaar is ingesteld.
4. Na afzonderlijke merge-/deploytoestemming: beheerder gebruikt het bestaande
   Versado-deploypaneel. Docker CMD draait recovery-check → prisma migrate deploy →
   appstart. Eén nieuwe migratie; geen seed/import/backfillknop of live DDL vanuit Codex.
   Reserveer een kort onderhoudsvenster en voorkom gelijktijdige schema-/contentwrites.
5. Bij preflight-/lockfout: stop uitrol, behoud oude app en gegevens, onderzoek de
   oorzaak. De DO-transactie rolt terug; Prisma kan een mislukte registratie
   achterlaten. De bestaande recovery-allowlist autoriseert deze nieuwe migratie
   **niet** automatisch. Eventueel migrate resolve vereist gecontroleerde,
   afzonderlijk geautoriseerde opvolging na bewezen rollback; geen automatische retrypatch.
6. Na succesvolle migratie: via beveiligde admininventarisatie 21 collecties met
   LEGACY, onveranderde flags/IDs en integriteit controleren; geen vergelijking van
   vóór/na-totalen die normale concurrente gebruikersactiviteit als verlies behandelt.
   Smokecheck normale leestoegang, verborgen/DRAFT-blokkade, expliciete preview,
   cursussen, annotaties en podcastpositie. Geen beloning of voortgang resetten.
7. Bij approllback blijft het additieve schema behouden. Gebruik een compatibele
   publicatiebewuste image; geen tabellen/kolommen verwijderen, geen backuprestore
   die nieuwere voortgang wist. Destructieve contractstappen vallen buiten scope.

Voor fase 1B: eerst beoordeling van dit werkpakket, daarna afzonderlijke opdracht
voor UserStudyContext. Geen nieuwe bron publiceren voordat de relevante content-
validatie en vervolg-gates zijn uitgevoerd.

## Gewijzigde bestanden

Nieuwe 1A-uitwerking: `prisma/schema.prisma`, de genoemde nieuwe `migration.sql`,
`src/lib/contentAccess.ts`, `src/lib/contentCollections.ts`,
`scripts/content-architecture/{test-access-isolated,validate-inventory}.mjs`,
`tests/content-work-migration.mjs`, `tests/content-inventory-validation.test.mjs`,
`tests/fixtures/content-1a-catalog.json`, toegang-/contentwissel-/inventarisatie-
fixtures, `package.json` en `.github/workflows/content-access.yml`.
Documentatie: 02/03/04/05/06, dit statusrapport en scripts-README.
De bestaande PR-85-guards in de hierboven opgesomde API’s/leespagina’s zijn
behouden; main’s `core.ts`, CLI-wrapper, admin-UI en inventarisatierunner zijn
niet door parallelle implementaties vervangen. Geen oude migratie gewijzigd.
