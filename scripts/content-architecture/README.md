# Veilige voorbereiding van Contentarchitectuur V2 — 1A

Deze hulpmiddelen veranderen geen werkidentiteiten, publicatiestatussen of
productiegegevens. ContentWork en de bijbehorende backfill mogen pas worden
uitgevoerd nadat de inventarisatie en een geschikte backup/herstelproef zijn
beoordeeld. Een test met synthetische fixtures vervangt dat bewijs niet.

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
FSY-publicatiekopieën en migratiechecksums. Geen privénotitieteksten of
gebruikersidentiteiten worden geëxporteerd. De verbindingsstring hoort niet in
Git, een PR of een gedeeld logbestand.

`suggestedKind` is uitsluitend een voorbereidingsadvies op basis van bekende
werksleutels. Null-work en onbekende bronnen blijven OTHER in dit advies; er
wordt niets geclassificeerd of gewijzigd in de database. Een fallback-ID die
botst met een expliciete werksleutel, lege identiteit of dubbele editie/taal
vereist beoordeling. Ook probleemloze output bewijst niet dat de officiële
bron of editie-equivalentie inhoudelijk is gecontroleerd.

## Wegwerpdatabase en fixtureherstel

Na een schone productiebuild:

```sh
npm run test:content-access:integration
```

De runner maakt zijn eigen lokale PostgreSQL-container met een willekeurige
naam en poort. Hij gebruikt uitsluitend de lokale Docker-socket en overschrijft
de databaseconfiguratie. Alleen bestaande main-migraties worden op deze lege
database toegepast. Geen algemene seed, scheduler of FSY-sync draait.

De tests spreken de echte productie-HTTP-routehandlers aan. Daarna maakt de
runner een custom-format dump van uitsluitend de synthetische testdatabase,
herstelt die in een tweede database in dezelfde eigen container en vergelijkt
schema-inventaris, aantallen en fingerprints van beschermde records.
De dump blijft buiten Git. Alleen deze eigen container wordt opgeruimd.

`productionBackupVerified: false` blijft uitdrukkelijk onderdeel van de
rapportage. Dit is geen herstelbewijs van de bestaande live collectiegegevens
of mediavolumes. Gebruik bestaande `scripts/backup.sh` en `scripts/restore.sh`
niet met hun standaard productiecontainer om deze tests uit te voeren.

## Bewijs vereist vóór ContentWork-DDL/backfill

- Toestemming, bronomgeving, tijdstip en schema-/commitreferentie van de
  inventarisatie; beoordeelde null-workwaarden, conflictsituaties en
  edition families. Geen stilzwijgende samenvoegingen.
- Recente databasebackup en consistente media-snapshot, met private
  opslagreferentie, timestamp, checksums en relatie tot de inventarisatie.
- Bewezen herstel op een geïsoleerde kopie: schema/migratieversies, aantallen,
  relaties, collectie-ID's, flags, FSY-publicatiekopieën, gebruikersvoortgang en
  persoonlijke annotaties aantoonbaar behouden; gerefereerde media beschikbaar.
- Afzonderlijk gereviewde additieve migratie met één werkidentiteit, bestaande
  collecties LEGACY en nieuwe collecties DRAFT/onzichtbaar. Geen aanscherping
  van constraints voordat veilige mapping is bewezen.
- Een concreet terugrolpad zonder verlies van sinds de backup ontstane
  voortgang en privégegevens; geen destructieve contractmigratie of automatische
  garbage collection.

Leg bewijsreferenties vast zonder persoonsgegevens of verbindingsgeheimen in
de repository te plaatsen. Zonder deze voorwaarden blijft de schemawijziging
geblokkeerd.
