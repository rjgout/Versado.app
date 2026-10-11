# Veilige inventarisatie via het beheer

Zelfstandig voorbereidingswerkpakket voor fase 1A, vanaf main `715c18a`.
PR #84 is verwerkt; concept-PR #85 (`612d566`) blijft ongemerged en ongewijzigd.
Dit werkpakket voert geen ContentWork-mapping, backfill of schemawijziging uit.

## Gebruik en publiceren

1. Beoordeel deze afzonderlijke PR en laat de eigenaar hem naar main mergen.
2. Wacht op de groene build/publicatie van de nieuwe main-image.
3. Open **Adminbackend → Systeem → Deployen & onderhoudsmodus**, klik **Nu
   deployen** en wacht tot de gezondheidscontrole de nieuwe versie bevestigt.
   Dit gebruikt het bestaande deploypaneel; geen NAS-/SSH-verbinding nodig.
4. Ga als ingelogde beheerder naar **Adminbackend → Content →
   Database-inventarisatie**. Open het blok en kies **Inventarisatie uitvoeren**.
5. Controleer timestamp, collecties, werk-/editie-/taalidentiteiten, flags,
   FSY-kopieën, recordaantallen, relaties en migraties. Kies **Rapport downloaden**.
   Deel het JSON-bestand met Codex voor de vervolganalyse van fase 1A.

Deze PR bevat **geen nieuwe Prisma-migratie**. De normale deployprocedure kan
zoals altijd bestaande nog openstaande migraties uitvoeren; de inventarisatie
zelf biedt daar geen bediening voor en voert ze nooit uit. Een productie-
inventarisatie is nog niet uitgevoerd tijdens ontwikkeling: de nieuwe functie
moet eerst door de eigenaar worden beoordeeld en gedeployed.

## Beveiliging en databasegedrag

`POST /api/admin/content-inventory` controleert sessie en `isAdmin` voordat
inventarisatiequeries worden uitgevoerd. De bestaande authenticatie leest wel
het account voor sessieversie en rechten. Geen automatisch adminvoorrecht voor
gewone content-API's wordt toegevoegd. `GET` biedt geen inventarisatie aan.

De bestaande cookie is `SameSite=Lax`; er bestaat op main geen gedeelde expliciete
CSRF-middleware. Deze beheeractie voegt een fail-closed Origincontrole toe:
`APP_URL` indien ingesteld, anders de publieke Host zoals de bestaande nginx die
zet. HTTPS mag vóór een interne HTTP-proxy eindigen. Andere hosts/poorten,
ontbrekende/null Origin en cross-site fetch worden geweigerd. Geen nieuwe
origin wordt opgeslagen of uit een verzoek als configuratie overgenomen.

De bestaande limiter staat één poging per minuut per beheerder toe, ook bij
parallelle aanvragen of fouten. Zoals de bestaande limiter is deze process-local,
passend bij de huidige ene app-instantie; bij horizontaal schalen is een gedeelde
limiter nodig. De client beschermt ook tegen dubbelklikken.

De bestaande Prisma-pool voert één `RepeatableRead`-transactie uit:

- `SET TRANSACTION READ ONLY` vóór de eerste gegevensquery;
- transaction-local `statement_timeout=10s`, `lock_timeout=3s`;
- maximaal 20 seconden voor de transactie, 5 seconden om een transactie te starten;
- controle van `transaction_read_only`;
- uitsluitend vastgelegde SELECTs voor collecties, aggregaties, integriteit en
  Prisma-migraties. Geen gebruikers-SQL, dynamische tabelkeuze of contentmutatie.

Transactie-instellingen gelden niet voor andere requests. Fouten rollen de
transactie terug en geven een veilige 503 zonder ruwe driver-/SQL-fout; retry na
één minuut. Alle routeantwoorden zijn `no-store, private`. De gewone Prisma-
foutlogger kan een technische tabelnaam/foutcode loggen; deze queries bevatten
geen credentials, privéteksten of gebruikersparameters. Er worden geen rapporten
naar algemene logs geschreven.

Collecties zijn begrensd tot 5000, migratierecords tot 2000. Bij overschrijding
wordt geen gedeeltelijk schijnrapport gegeven. Aantallen zijn decimale strings,
zodat grote PostgreSQL-counts zonder verlies exporteerbaar zijn. Ontbrekende of
verouderde tabellen/kolommen geven een gecontroleerde fout, geen fictieve nullen.

## Rapport en privacy

Formaat 3 gebruikt een geneste Zod-allowlist. Alleen technische collectie-
identificaties, editie/taal, flags, geadviseerde soortmapping, aggregaties,
relatieproblemen en geselecteerde migratiemetadata worden teruggegeven.
Migratielogs, gebruiker-ID's, e-mails, profielen, privénotitieteksten, bronteksten,
sessietokens, hashes en verbindingsstrings worden niet geselecteerd/geëxporteerd.

Het huidige schema heeft geen collectie-publicatieveld. Het rapport toont dat
expliciet; `enabled` en `visibleToUsers` zijn geen nieuw bewijs van publicatie.
Als later `publicationState` bestaat, kan het rapport dat veld via een vaste
SELECT uitlezen zonder een nieuwe migratie. FSY telt concepten, status PUBLISHED,
gepubliceerde kopieën en concepten met een bestaande publicatie afzonderlijk.
Een werksoort is slechts een mappingvoorstel; onbekende bronnen en podcasts zijn
OTHER. Conflicten worden gemeld, niet automatisch gecorrigeerd.

De download bevat dezelfde gesaneerde serverresponse, uitsluitend vanuit
browsergeheugen. Geen opslag in Git, `/public`, localStorage of een NAS-volume.
Bewaar het gedownloade technische rapport zelf op een geschikte privéplek.

## Eén implementatie en vervolg van PR #85

De benodigde onderdelen van `inventory.mjs` uit PR #85 zijn uitgehaald naar
`src/lib/content-inventory/core.ts`: identiteitcontrole, vaste SELECTs en
rapportvalidatie. De beheerfunctie en het optionele CLI-script gebruiken beide
deze ene implementatie. Het CLI-script behoudt de expliciete
`CONTENT_INVENTORY_DATABASE_URL` en heeft geen `DATABASE_URL`-fallback; voor
normaal gebruik is het beheer voldoende.

Na merge van dit werkpakket kan PR #85 op main worden gerebased. Bij het conflict
in `scripts/content-architecture/inventory.mjs` moet deze gedeelde wrapper worden
behouden, zonder de oude analyse/querykopie terug te zetten. Pas de bestaande
PR-85-inventarisatietests aan voor formaat 3 en de transaction-local timeouts.
De oude velden blijven bestaan; formaat 3 voegt timestamp, read-only bewijs,
publicatieveldaanwezigheid, FSY-status en extra relatiechecks toe. Neem geen
ContentWork-migratie mee in deze inventarisatie-PR. Het werk aan de
`readingAccessWhere`-correctie en overige beveiliging in PR #85 blijft apart.

## Validatie

Lokaal uitgevoerd op 11 oktober 2026: 18 unit-/beheerregressies, 23 shell/focus-
tests en 51 live-data-tests geslaagd. De geïsoleerde HTTP-/databasesuite slaagt,
inclusief echte lock- en statement-timeouts, verouderde kolom, beschadigde
relatie en lege catalogus. Alle 20 browsercombinaties plus de vier aanvullende
vertalingen slagen. TypeScript en Prisma-validatie slagen; ESLint heeft nul
fouten en de 132 bestaande waarschuwingen (nieuwe bestanden: nul). Alle 42
nieuwe tekstsleutels zijn in vijf talen aanwezig; de 423 eerder ontbrekende
sleutels per niet-Nederlandse taal blijven buiten scope. De lokale schone
productiebuild heeft exit 0; de exacte gepushte build wordt afzonderlijk door
de PR-workflows gecontroleerd.


Reproduceer na een schone productiebuild:

```sh
npx tsx --test tests/content-inventory.test.ts tests/admin-layout.test.ts
node scripts/content-architecture/test-isolated.mjs
```

De runner maakt uitsluitend een eigen lokale PostgreSQL 16-container met alle
bestaande migraties. Geen seed, import, scheduler, productieverbinding, backup of
herstel. De tests gebruiken synthetische accounts/teksten en controleren echte
HTTP-authenticatie, CSRF, parallelle rate limiting, onveranderde records,
sanering, echte PostgreSQL-writeblokkade, CLI-pariteit, ontbrekende schemaonderdelen
en timeouts. Browserbewijs wordt buiten de repository of als privé CI-artifact
bewaard. De workflow `content-inventory.yml` voert dezelfde controles uit.

De mobiele/desktopmatrix gebruikt 320/390/768/1280 px en 844×390 landscape,
licht/donker, 100/200% tekst; de overige vier UI-talen op 320 px met 200% tekst.
Dit is echte Chromium-rendering met touch-emulatie, geen fysieke iPhone- of
Capacitor-test. Rapportdownload, tabel-focus, laad-/succes-/fouttoestand en
horizontale overflow worden gemeten.

Een inventarisatierapport bewijst geen backupdekking of herstelbaarheid. De eerder
door de eigenaar geaccepteerde overslag van een aanvullende herstelproef wordt
hiermee niet alsnog getest of als geslaagd verklaard. Inventarisatie is geen
uitroltoestemming voor de latere fase-1A-migratie.
