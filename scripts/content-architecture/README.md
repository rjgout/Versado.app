# Veilige voorbereiding van Contentarchitectuur V2 — 1A

Deze hulpmiddelen veranderen geen werkidentiteiten, publicatiestatussen of
productiegegevens. ContentWork en de bijbehorende backfill mogen pas worden
uitgevoerd nadat de daadwerkelijke inventarisatie is beoordeeld. De eigenaar
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
Git, een PR of een gedeeld logbestand.

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
de databaseconfiguratie. Alleen bestaande main-migraties worden op deze lege
database toegepast. Geen algemene seed, scheduler of FSY-sync draait.

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
de repository te plaatsen. Zonder daadwerkelijke productie-inventaris blijft de schemawijziging
geblokkeerd. Ontbrekend herstelbewijs is binnen deze hervatting een vastgelegd
geaccepteerd risico, geen opnieuw te stellen productvraag.
