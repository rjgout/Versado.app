# Veilige voorbereiding van Contentarchitectuur V2 — 1A

Deze hulpmiddelen wijzigen geen productiegegevens. De inventarisatie is
uitsluitend lezend; de 1A-runner test ContentWork/publicatie-DDL alleen op
zijn eigen wegwerpdatabase. De daadwerkelijke inventarisatie is beoordeeld. De eigenaar
heeft dagelijkse Hyper Backup bevestigd en de aanvullende herstelproef bewust
overgeslagen. Die risicoacceptatie is geen bewijs van getest herstel.

## Alleen-lezen inventarisatie

Na afzonderlijke toestemming voor de betreffende database:

```sh
CONTENT_INVENTORY_DATABASE_URL='<expliciet geautoriseerde verbinding>' \
  node scripts/content-architecture/inventory.mjs /veilig/pad/inventaris.json
```

Het script gebruikt geen `DATABASE_URL`-fallback. Het leest in een
repeatable-read, read-only transactie en schrijft een nieuw bestand met modus
0600. Het bestand bevat collectie-identiteiten, editie/taal, bestaande flags,
null-workwaarden, mogelijke identiteitconflicten, aantallen, relatiecontroles,
FSY-publicatiekopieën/conceptaantallen en migratiestatus, inclusief
onvoltooide/teruggedraaide migraties zonder logteksten. Geen privénotitieteksten of
gebruikersidentiteiten worden geëxporteerd. De verbindingsstring hoort niet in
Git, een PR of een gedeeld logbestand. Bij een fout toont het script alleen
een veilige foutcode, geen ruwe driverdetails of verbindingsgegevens.

`suggestedKind` is uitsluitend een voorbereidingsadvies op basis van bekende
werksleutels. Null-work en onbekende bronnen blijven OTHER in dit advies; er
wordt niets geclassificeerd of gewijzigd in de database. Een fallback-ID die
botst met een expliciete werksleutel, lege identiteit of dubbele editie/taal
vereist beoordeling. Ook probleemloze output bewijst niet dat de officiële
bron of editie-equivalentie inhoudelijk is gecontroleerd.

## Wegwerpdatabase zonder backup of herstel

Na een schone productiebuild:

```sh
npm run test:content-access:integration
```

De runner maakt zijn eigen lokale PostgreSQL-container met een willekeurige
naam en poort. Hij gebruikt uitsluitend de lokale Docker-socket en overschrijft
de databaseconfiguratie. Eerst bestaande main-migraties, daarna synthetische records op basis van de
geverifieerde catalogus en vervolgens de nieuwe additieve 1A-migratie via Prisma. Geen algemene seed, scheduler of FSY-sync draait.

De tests spreken de echte productie-HTTP-routehandlers aan en vergelijken
privérecords vóór/na geweigerde mutaties. Daarna draait de read-only inventaris
op de synthetische fixtures. De runner maakt geen dump of restore; alleen de
eigen wegwerpcontainer wordt opgeruimd.

De uitvoer meldt `productionInventoryPerformed: false`, `backupCreated: false`,
`restorePerformed: false` en `productionBackupVerified: false`. Dit is geen
productie-inventaris of backupcontrole. Gebruik `scripts/backup.sh` en
`scripts/restore.sh` niet: nieuwe backups en herstelacties vallen buiten deze
hervattingsopdracht.

## Bewijs vereist vóór ContentWork-DDL/backfill

- Toestemming, bronomgeving, tijdstip en schema-/commitreferentie van de
  inventarisatie; beoordeelde null-workwaarden, conflictsituaties en
  edition families. Geen stilzwijgende samenvoegingen.
- Dagelijkse Hyper Backup is een eigenaarsbevestiging. Controleer waar mogelijk
  bestaande taak-/bestandsmetadata: laatste geslaagde backup, tijdstip en
  database-/mediabereik. Geen private backupinhoud of credentials publiceren.
- Voor deze hervatting is de aanvullende herstelproef expliciet overgeslagen.
  Leg de onbewezen herstelbaarheid, consistentie en onbekende dekking vast;
  claim geen geslaagde restore. Geïsoleerde migratie-/databehoudtests blijven vereist.
- Afzonderlijk gereviewde additieve migratie met één werkidentiteit, bestaande
  collecties LEGACY en nieuwe collecties DRAFT/onzichtbaar. Geen aanscherping
  van constraints voordat veilige mapping is bewezen.
- Een concreet terugrolpad zonder verlies van sinds de backup ontstane
  voortgang en privégegevens; geen destructieve contractmigratie of automatische
  garbage collection.

Leg bewijsreferenties vast zonder persoonsgegevens of verbindingsgeheimen in
de repository te plaatsen. De productie-inventaris van 2026-10-11 is aangeleverd en offline gevalideerd. Ontbrekend herstelbewijs is binnen deze hervatting een vastgelegd
geaccepteerd risico, geen opnieuw te stellen productvraag.

## Aangeleverd rapport offline controleren

```sh
node scripts/content-architecture/validate-inventory.mjs /veilig/pad/inventaris.json
```

Dit gebruikt de Zod-allowlist en identiteitsanalyse uit main. Geen databasequery.
Alleen een samenvatting en technische checksumafwijkingen worden getoond.
De twee bewezen historische migratiehernoemingen zijn expliciete uitzonderingen,
een teruggedraaide poging vereist later succesvol checksumbewijs. Het originele
rapport hoort niet in Git. De gedeelde adminrunner blijft `test-isolated.mjs`;
1A gebruikt `test-access-isolated.mjs` en heeft geen eigen inventarisatieservice.
Productie-deploy voert de migratie automatisch uit en vraagt daarom afzonderlijke
uitroltoestemming. Zie het [status- en uitrolplan](../../docs/content-architecture-v2/07-PHASE-1A-STATUS.md).

## Fase 1B studiecontext

`npm run test:study-context` test het pure actie-/querykeycontract.
`npm run test:study-context:integration` hergebruikt dezelfde veilige
`test-access-isolated.mjs`-runner. Na de 1A-behoudtests worden alle bestaande
127 tabellen opnieuw gefingerprint, 1B via Prisma gemigreerd en gecontroleerd.
De echte context-HTTP-tests en cursusregressies draaien achtereenvolgens,
zodat een tijdelijke fouttrigger of globale fingerprint niet tegelijk loopt
met andermans synthetische fixtures. Geen productie, algemene seed of restore.
Zie [1B-status, API en uitrol/rollback](../../docs/content-architecture-v2/08-PHASE-1B-STATUS.md).
