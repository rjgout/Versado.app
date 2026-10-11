# Fase 1A — gedeeltelijke implementatie en migratieblokkade

## Status en beginsituatie

PR #84 is verwerkt in main via `715c18adf62a379bf623efd02894a8bd6a34b307`.
Besluitcommit `7651e166dbd9750ebccd5ca604e531275de8c081` is een ancestor van
die main. Deze werkbranch, `codex/content-architecture-v2-1a`, is daarvan
gestart. Tussen de auditbasis en deze main zijn alleen de zeven goedgekeurde
architectuurdocumenten gewijzigd.

**Fase 1A is niet volledig afgerond.** De eigenaar heeft bij de hervatting
uitdrukkelijk toestemming gegeven voor uitsluitend lezende productie-
inventarisatie van Docker-container `jehova-db` op zijn Synology NAS.
Dagelijkse volledige backup is door de eigenaar bevestigd; hij noemt Synology
Hyper Backup als oplossing. Hij heeft de aanvullende geïsoleerde herstelproef
bewust overgeslagen en het risico expliciet geaccepteerd. De oude herstelgate
is voor deze hervatting dus geen opnieuw te vragen productbeslissing.

De daadwerkelijke inventarisatie blijft technisch geblokkeerd: de werkruimte
heeft geen geconfigureerde NAS-verbinding, VPN/TCP-grant, SSH-configuratie of
productiedatabasebinding. De eigenaar heeft aangegeven een beveiligde verbinding
te zullen koppelen; deze is nog niet als beschikbaar waargenomen. Er zijn
geen productiequery's uitgevoerd en geen productie-aantallen vastgesteld.
ContentWork, publicatiestatus en backfill wachten op die inventaris en een
conflictvrije mapping; geen schemawijziging of productieactie uitgevoerd.

Wel uitgevoerd: centrale legacy-toegangsbeveiliging, de correctie die normale
beheerdersverzoeken van expliciete preview scheidt, HTTP-/DB-regressietests en
veilige inventarisatievoorbereiding. Geen fase 1B, 1C of 1D is gestart.

## Centrale legacy-toegangsservice

`src/lib/contentAccess.ts` centraliseert de bestaande flags:

| Doel | Gewone gebruiker | Server-geauthenticeerde beheerder |
| --- | --- | --- |
| Catalogus | enabled én visibleToUsers | enabled; verborgen collecties mogen zichtbaar zijn |
| Gewoon lezen | enabled én visibleToUsers | dezelfde regel |
| Expliciete beheerpreview | geweigerd | bestaande collectie, ook hidden/disabled |

`readingAccessWhere(actor)` geeft nu altijd normale leesrechten, óók als de
server-geauthenticeerde gebruiker beheerder is. Alleen een expliciete
serveraanroep met `"admin-preview"` verruimt de scope; de service controleert
daarbij de adminrol. De bestaande `/adminbackend/content-preview` doet deze
expliciete aanroep na zijn login-/rolcontrole en blijft een alleen-lezenpreview.
Een queryparameter `preview=true` of clientpayload met `isAdmin: true` geeft
geen uitgebreide rechten op gewone API's.

Ook `isContentCollectionSelectable`, de woordenboek-API's en conceptoefening-
check/hint geven geen automatische adminbypass meer. Normale oefen-API's
vereisen voor beide rollen APPROVED. Ontbrekende actor of collectie geeft
geen toegang; nullable collectie-ID's geven ook admins geen bypass.
De bestaande adminbeheer-API's behouden hun afzonderlijke serverrolcontrole.

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
  toegang tot de bron én APPROVED-status vereist voor beide rollen.
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

`scripts/content-architecture/test-isolated.mjs` past uitsluitend de bestaande
migraties toe op een eigen lege PostgreSQL-container. De productie-HTTP-handler
start zonder seed, scheduler of FSY-sync. De runner controleert de echte
routes en de inventaris op synthetische fixtures. Hij maakt voortaan **geen
backup of herstelproef**. De uitvoer meldt expliciet dat productie-inventaris,
backupcreatie en herstel niet zijn uitgevoerd.

De read-only inventaris gebruikt naast BEGIN/COMMIT/ROLLBACK uitsluitend SELECT,
ook voor `transaction_read_only`. Verbindingsfouten worden uitsluitend met
een veilige foutcode gemeld; driverdetails, gebruikersnaam en URL verschijnen
niet in gedeelde logs. FSY-conceptaantallen en alle migratiestatussen,
inclusief onvoltooide/teruggedraaide migraties zonder logs, zijn opgenomen.
De actuele handleiding staat in
[de voorbereidingshandleiding](../../scripts/content-architecture/README.md).

### Backupmetadata en geaccepteerde risico's

| Onderdeel | Vastgesteld | Onbewezen |
| --- | --- | --- |
| Backupbeleid | Eigenaarsbevestiging: dagelijks volledige NAS-backup via Hyper Backup | Laatste succesvolle uitvoering, timestamp, omvang en taakstatus |
| Database | Eigenaar noemt jehova-db; repository noemt /volume1/docker/jehova-app/postgres | Werkelijke NAS-mount en opname in de backuptaak; consistente backup van draaiend PostgreSQL/WAL |
| Media | Repository noemt /volume1/docker/jehova-app/audio en Docker-volume branding_assets | Werkelijke volumes, gerefereerde media en Hyper Backup-selectie |
| Herstel | Bewust overgeslagen; expliciet geaccepteerd door eigenaar | Leesbaarheid/volledigheid van backup, werkende decryptie/sleutels, database-/mediaherstel en daadwerkelijke hersteltijd |

De repositorypaden zijn aanwijzingen voor een latere metadata-/mountcontrole,
geen bewijs van live configuratie of backupdekking. Geen nieuwe NAS-backup,
restore, containerherstart of productie-DDL uitvoeren. Recente bestandsmetadata
alleen bewijst bovendien geen consistente of succesvol terugzetbare database.
De oorspronkelijke synthetische fixtureherstelproef bij `f1ed318` was geslaagd,
maar was nooit een NAS-herstelbewijs; die wordt niet opnieuw uitgevoerd.
De uitzondering geldt voor deze fase-1A-hervatting, niet automatisch voor latere
migraties of destructieve contractacties.

Geen bestaande content-, cursus- of annotatierecords worden verwijderd. De
integratietests vergelijken verborgen privérecords vóór/na geweigerde requests
voor beide rollen; ook een lege notitiemutatie kan niets ongemerkt verwijderen.

## Validatie en resterende voorwaarden

Uitgevoerd op deze werkbranch:

| Controle | Resultaat |
| --- | --- |
| Gerichte toegang/inventaris/HTTP-DB-tests | 24 geslaagd, 0 overgeslagen |
| Bestaande editie-, wissel-, leer- en reeksregels | 31 geslaagd (47 inclusief 10 toegang- en 6 inventaris-unittests) |
| Focus/shell | 23 geslaagd |
| Live data | 51 geslaagd |
| TypeScript | geslaagd |
| Prisma-validatie | geslaagd; dummy-URL, geen databasequery |
| Volledige ESLint | 0 fouten; 132 bestaande waarschuwingen |
| ESLint nieuwe service/tests/scripts | 0 fouten, 0 waarschuwingen |
| i18n | geslaagd met bestaande dekking: en/de/fr/es 3261/3684; geen UI-teksten gewijzigd |
| Schone lokale productiebuild | geslaagd; vorige .next buiten de repository bewaard |
| Backup/herstel | niet opnieuw uitgevoerd; herstelproef bewust overgeslagen |

De HTTP-tests omvatten gewone API's en leespagina's voor beide rollen, een
expliciete beheerpreview, echte eerder uitgegeven
oefensessies, verborgen personen, twee talen en een null-work-legacycollectie.
De tests bewijzen geen volledig browser-/Capacitor-regressieonderzoek en geen
prodmedia-herstel. Buildbevestiging voor de definitieve commit wordt daarnaast
via de nieuwe concept-PR-workflow `content-access.yml` gecontroleerd.
De runner rapporteert `productionInventoryPerformed: false`,
`backupCreated: false`, `restorePerformed: false`, `productionBackupVerified: false`.

Gewijzigde bestanden: de hierboven genoemde routes/pagina's,
`src/lib/contentAccess.ts`, `src/lib/contentCollections.ts`, `package.json`,
de drie `tests/content-access*`/`content-inventory.test.mjs`-bestanden,
`scripts/content-architecture/{inventory,test-isolated,test-server}.mjs`, hun
README, `.github/workflows/content-access.yml` en dit statusdocument.
Ook de bestaande beheerpreviewpagina en documenten 03/05/06 zijn gericht
aangepast. `prisma/schema.prisma`, migraties, spel-UI en vertalingen zijn ongewijzigd.

Collection-DRAFT-tests en ContentWork-DB-tests zijn niet
uitvoerbaar zolang de bijbehorende schemawijziging terecht geblokkeerd is.
Conceptoefening-tests mogen niet als vervanging daarvan worden geïnterpreteerd.

Voor afronding van 1A blijven nodig: de beschikbare beveiligde NAS-verbinding,
daadwerkelijke inventaris en waar mogelijk bestaande backupmetadata, beoordeelde
risicoregistratie, gecontroleerde mapping, additief ContentWork-model en
publicatiestatus, compatibele backfill en bijbehorende legacy/nieuwe-bron/
conflict-/conceptintegratietests. De goedgekeurde verwijzingseditievoorwaarden
van fase 2D blokkeren 1A niet. Fase 1B kan pas na beoordeling en afronding van
dit bronfundament starten; hier is geen UserStudyContext toegevoegd.
