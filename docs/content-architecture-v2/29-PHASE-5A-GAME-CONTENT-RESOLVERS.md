# Fase 5A — bestaande speladapters en bevroren Woordzoekerbron

Stacked op fase 3D; GAME_CATALOG en de fase-1D-bronbeperkingen blijven leidend. Geen nieuwe spelmodus, beloning, score- of hintregel.

## Resolvercontract

`gameContentResolver.ts` centraliseert het bestaande concrete bron-/poolonderzoek. De adapteridentiteiten komen uit de bestaande catalogus/scopekeys. `resolveGameContent` gebruikt de server-side gebruikerskeuze en geeft een afwijzingsreden of gevalideerde broncontext terug; Woordzoeker krijgt bovendien de echte kandidaatset. De compatibele `gameAvailability.ts`-ingang blijft bestaan. De bestaande strengere publieke spelbroncontrole blijft behouden, ook voor beheerders; er wordt geen beheerpreviewrecht aan gameplay toegevoegd. Gewone aanbodresponses bevatten alleen beschikbaarheid, nooit kandidaatwoorden of private speldata.

- Woordzoeker: bestaande vijf taalbanken plus brongebonden personen, boeken en bewezen Nederlandse plaatsnamen; minimuminhoud voor alle bestaande moeilijkheden. Onbekende taal geeft een lege pool, nooit Nederlandse fallback.
- Woord van de Dag en Scrabble: bestaande expliciete Nederlandse BOM-woordenlijsten en lengtecriteria; zes pogingen, 18:00-grens en economie ongewijzigd.
- Raad het hoofdstuk en Gezinsavond: echte vaste BOM-hoofdstukken; Gezinsavond vereist tevens bestaande goedgekeurde vraagtypen.
- Alleskenner: bestaande gevalideerde items en echte vertalingen; bestaande minimumvragen, onderwerpen en puzzeltypen.
- Legpuzzel: bestaand manifest met echte afbeeldingen en bijbehorende vragen.
- Live-oefeningen en uitdagingen: bestaande goedgekeurde oefeningen binnen de ondersteunde Schriftuurbron.
- Mysterie en Snelle Zendeling: bestaande vaste puzzels/levels. Hun eerdere persistente pogingen en bron-/Genees-snapshots blijven leidend.

Instelling, scope, bronrechten, technische ondersteuning en voldoende inhoud blijven afzonderlijke gates. Geen studieprogramma wordt geschikt doordat een scope wordt toegevoegd. Bestaande gameplaybouwers voor de andere spellen blijven intact; dit is geen algemene nieuwe game-engine. Hun bestaande opgeslagen sessiegegevens blijven het hervatcontract. Alleen voor de daadwerkelijk gewijzigde Woordzoekeradapter is nieuwe snapshotopslag toegevoegd. Een `poolHash: null` bij andere legacyadapters is geen claim dat een generieke pool bevroren is.

## Woordzoeker en M5

De nullable JSON-kolom `WordSearchGame.sourceContext` bewaart collectie, editie, taal, daadwerkelijke bron-/pooltaal, SHA-256 van de kandidaatset/configuratie, normalisatieversie en rulesVersion. De identiteit is onafhankelijk van databasevolgorde. Nieuwe starts gebruiken de kandidaatset rechtstreeks uit de resolver, zonder een tweede poolquery. De gelijktijdige bestaande-sessietak controleert eveneens opnieuw de oorspronkelijke bron; een ingetrokken oude bron kan niet via een andere huidige editie alsnog als bestaande sessie teruggegeven worden. Vlak vóór INSERT worden bronrechten, editie/taal, scope en instelling onder de bestaande gebruikerslock opnieuw gecontroleerd. Een bestaande actieve sessie wordt eerst hervat; nieuwe-startinstellingen mogen die niet afwijzen.

De bestaande grid, gekozen woorden/posities, seed, moeilijkheid, gevonden woorden en score blijven ongewijzigd. De broncontext en collectie-ID kunnen na INSERT niet worden herschreven. Een gerichte BEFORE DELETE-guard op ContentCollection voorkomt dat de bestaande cascade historische Woordzoekerrecords wist. Accountverwijdering wordt niet door deze bronguard veranderd. Oude sessies blijven NULL; geen afleiding uit huidige voorkeur of backfill.

## Verificatie

Migratieproef bewaart alle oorspronkelijke rijinhoud in 146 tabellen en 812 bestaande schemaobjecten, inclusief een vooraf aangemaakte oude Woordzoekersessie. Naamconflict rolt de hele transactie terug; herhaalde migrate deploy is veilig. Vier gerichte nieuwe integratietests en de 22 bestaande gameavailabilitytests slagen; 9 resolver-/policy-unitchecks slagen. Tests dekken echte poolidentiteit, private aanbodresponses, dubbele start, bronwissel/settings-uit, bronimmu­tabiliteit, verwijderbescherming en legacyresume. Pure resolver-/policytests, 154 Legpuzzeltests, 5 woordhinttests en 20 tijdzone/daggrensregressies slagen. Prisma validate/generate, TypeScript, gerichte lint, i18n en productiebuild gecontroleerd. Definitieve CI wordt op de gepushte head gevolgd.

Bestaande querybudgetten blijven geldig: volledig BOM-aanbod 16 queries (p95 20,608 ms), podcasts 7, één scope 8, geen scopes 5, geldige Legpuzzelstart 5 en geweigerde start 3. Dit zijn lokale wegwerpdatabase-metingen, geen productiemetingen.

## Uitrol, rollback en grenzen

Eerst de onderliggende PR's reviewen; niet automatisch mergen. De eigenaar rolt uit. Synology voert de additieve migratie bij containerstart uit; er wordt geen inhoud geïmporteerd of gepubliceerd. Vorige appimage kan de extra nullable kolom negeren; behoud kolom, guard en historische snapshots. Oude appstarts kunnen daarna weer NULL-metadata maken en blijven legacycompatibel, zonder verzonnen herkomst. Geen productie-/NAS-test of onafhankelijk bewezen backupherstel geclaimd.

Fase 5B levert uitsluitend studie-woordpoolinfrastructuur. CFM/FSY krijgen hierdoor geen automatische ondersteuning in de bestaande spellen. Nieuwe gameplay en concrete studiegame-sessieopslag vereisen een volgende goedgekeurde fase.
