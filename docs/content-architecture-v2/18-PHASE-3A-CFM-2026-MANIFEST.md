# Fase 3A — officiële bronnen en CFM 2026-manifest

## Afbakening

Deze fase registreert uitsluitend gecontroleerde bronmetadata en valideert die
lokaal. Er is geen `ContentWork`, `ContentCollection`, `StudyPeriod`,
`StudyLesson`, `StudyLessonEdition`, `StudyRevision`, `ContentImportRun` of
mediarecord geschreven. Er is geen publieke cursus, ContentSwitcher-optie,
voortgangs-, XP- of reeksverandering.

Het machineleesbare manifest staat in
`src/lib/studyContent/cfm2026Manifest.ts`; de zuivere, netwerkloze validator
staat in `src/lib/studyContent/manifest.ts`.

## Onderzochte officiële bronnen

- De officiële Nederlandstalige inhoudsopgave: `https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/000-contents?lang=nld`.
- De officiële taal-API achter die inhoudsopgave:
  `https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=nld&uri=/manual/come-follow-me-for-home-and-church-old-testament-2026/000-contents`.
- Steekproef van lespagina `01`, met de officiële page identity, heading,
  volledige bron-URL en media-attributen.
- De officiële Terms of Use, bijgewerkt 2021-04-13:
  `https://www.churchofjesuschrist.org/learn/legal/terms-of-use/go?lang=eng`.

De verificatiedatum in het manifest is 2026-10-14. Gewone CI-tests lezen geen
live bron: zij gebruiken alleen het vastgelegde manifest.

## Bronidentiteit, kalender en volledigheid

De officiële publicatie is **Kom dan en volg Mij – voor thuis en in de kerk:
Oude Testament 2026**, taalcode `nld` (in Versado `nl`). De editieidentiteit
is `church-cfm-ot-2026`; het werk is bewust `cfm-old-testament-2026`, zodat
het nooit met een toekomstig programmajaar wordt samengevoegd.

De bron bevat **52** officiële lesperioden. De eerste is `01`, 29 december
2025–4 januari 2026; de laatste is `52`, 21–27 december 2026. Elke les houdt
de officiële twee-cijferige route-id als `sourceKey` en krijgt een vaste
`periodSourceKey` `cfm-old-testament-2026:<id>`. Een latere revisie van een
les verandert die logische identiteit niet.

De kalender is als expliciete datumintervallen vastgelegd, niet uit een
weekpatroon afgeleid. De validator controleert unieke les- en periodekeys,
verplichte metadata, officiële HTTPS-bron-URL, taal, geldige intervallen,
volgorde, overlap en gaten. Een afwijking wordt alleen als waarschuwing
gerapporteerd, zodat een later door de bron aangetoond interval niet stilzwijgend
wordt afgekeurd. De gecontroleerde kalender bevat geen gaten of overlap.

Pasen (`14`) en Kerstmis (`52`) zijn expliciete officiële lessen; zij zijn
niet door een generieke schriftboekregel gefabriceerd.

## Schriftverwijzingen en ReferenceResolver

De leskoppen en de bronpagina's bevatten de te bestuderen passages. Het
manifest bewaart die officiële labels, maar classificeert alle lesverwijzingen
voorlopig als `BLOCKED`: de bestaande `ReferenceResolver` heeft alleen
bewezen canonieke/edition-equivalentie voor de momenteel geregistreerde
Schriftbronnen en geen gecontroleerd Oudtestament-bewijs in een Nederlandse
editie. Er is daarom geen interne route en ook geen gefingeerde fallback-URL
toegevoegd.

Voor 3B is per concrete passage nodig: een officiële, precieze bron-URL,
canonieke boek-/hoofdstuk-/versmapping, een Nederlandse editie en het
evidence-record dat de bestaande resolver verlangt. Zonder dat bewijs moet de
adapter de verwijzing als geblokkeerd rapporteren, niet een andere vertaling
openen.

## Media-inventarisatie

De officiële API meldt bij elke gecontroleerde les negen `img`-elementen.
Dat omvat onder meer illustraties, pictogrammen en lesfiguren. Het manifest
registreert daarom per les de waargenomen mediahoeveelheid, maar markeert de
inventarisatie als `WARNING`: betekenis (essentieel, ondersteunend of
decoratief), alternatieve tekst, stabiele assetidentiteit en afzonderlijke
rechten zijn nog niet per asset beoordeeld. Er zijn geen bestanden gedownload,
geen lokale mediarecords aangemaakt en geen vervangende afbeeldingen gemaakt.

Een ontbrekende essentiële afbeelding kan hierdoor niet verborgen blijven:
fase 3B moet de inventaris per daadwerkelijke figure afronden voordat een
revisie compleet kan zijn.

## Rechten en licenties

De Terms of Use bevestigen dat materiaal, tekst en media eigendom zijn van of
in licentie zijn bij de Kerk. Zij staan bekijken, downloaden en afdrukken voor
eigen persoonlijk, niet-commercieel gebruik toe. Behalve voor expliciet
aangegeven Gospel Media is plaatsen van materiaal op een andere website of
computernetwerk zonder voorafgaande schriftelijke toestemming niet toegestaan.
De voorwaarden geven ook geen algemene licentie om afbeeldingen lokaal op te
slaan of volledige CFM-teksten via Versado te herpubliceren.

De projecteigenaar heeft na fase 3A expliciet bevestigd dat Versado volledige
gebruiksrechten heeft voor de officiële website-inhoud, inclusief teksten,
afbeeldingen, overige media en studieprogramma's. Daarom is
`rightsStatus: "VALID"` in het manifest opgenomen. De schriftelijke
bestaansbewijzen en eventuele specifieke voorwaarden moeten administratief
buiten deze repository beschikbaar en controleerbaar blijven; er is bewust
geen licentienummer, contractdatum of nadere voorwaarde gefingeerd.

Deze bevestiging verandert niets aan de technische publicatiepoort: fase 3B
mag pas inhoud publiceren nadat de bestaande Nederlandse Bijbeleditie en alle
te importeren verwijzingen concreet zijn gevalideerd.

## Voorbereiding voor fase 3B

Na een rechtenbesluit past één officiële CFM-adapter op de bestaande
`ContentImportRun`-keten. Hij maakt per manifestperiode een `StudyPeriod` en
per officiële `sourceKey` een `StudyLesson`; de bestaande importservice maakt
vervolgens collectiegebonden `StudyLessonEdition` en immutable
`StudyRevision`. De `sourceKey`/periodkey uit dit manifest zijn de enige
logische sleutels, terwijl een bronhash alleen de revisie-identiteit bepaalt.

De adapter moet de officiële API-HTML eerst naar een gecontroleerd tussenmodel
normaliseren en daarna naar `RichContentBlocks`:

| Officieel element | Doelblok | Voorwaarde |
| --- | --- | --- |
| Kop, alinea, lijst | heading, paragraph, list | stabiele bronankers |
| Citaat | quote | bron/attributie behouden |
| Vraag of uitnodiging | question of assignment | semantiek niet verwisselen |
| Schriftverwijzing | reference | alleen na resolver-evidence |
| Figuur | figure + `StudyRevisionMedia` | rechten, alt en mediarecord vereist |

Onbekende betekenisvolle HTML mag niet worden genegeerd: de adapter moet de
import met een diagnose stoppen totdat een bestaand of nieuw goedgekeurd
bloktype bestaat. 3A bouwt deze adapter niet.

## Validatie en tests

`tests/cfm-2026-manifest.test.ts` dekt de 52 perioden, begin/eindgrenzen,
officiële volgorde, stabiele sleutels, officiële URL's, dubbele sleutels,
ontbrekende metadata, ongeldige kalenderdata, incomplete media- en
referentiecontrole en herhaalbaarheid zonder netwerk.

De validator retourneert `VALID`, `WARNING` of `BLOCKED`. Dit manifest is
structureel consistent, maar het totaaloordeel is **BLOCKED** door de nog
ontbrekende bewezen Oudtestament-verwijzings- en media-evidence.

## Voorwaarden voor fase 3B

Fase 3B mag pas beginnen nadat per passage resolverbewijs en per
betekenisvolle afbeelding een media-inventaris bestaan. Zonder die technische
besluiten mag hoogstens dit metadata-manifest worden onderhouden; er mag geen
import, publicatie of publieke cursus plaatsvinden.

## Correctieronde 3A.1 — interne Bijbelverwijzingen

Versado's bestaande Bijbelimport is de Nederlandse Open Translation Bible:
`work: old-testament`, `editionKey: otb`, met canonieke boekcodes zoals
`gen`, `exo` en `isa`. De bestaande readerroute is `/scripture/[chapterId]`;
de `ReferencePreview` opent alleen na een server-side resolutie en `Meer
lezen` bewaart via de bestaande reference-trip de terugkeer naar de les.
Daardoor markeert een preview geen leesstatus, kent geen XP of munten toe en
verlengt geen reeks.

De huidige resolver accepteert echter alleen vastgepinde bewijsbestanden voor
Boek van Mormon, Leer en Verbonden en Parel van Grote Waarde. De OTB-collecties
worden door de importconfiguratie bovendien standaard als niet-zichtbaar
aangemaakt. Een read-only controle tegen de veilige testdatabase kon de
vereiste Bijbelstructuur niet uitvoeren omdat die database achter het actuele
schema loopt (`ContentCollection.publicationState` ontbreekt). Er is daarom
geen onbewijsbare interne mapping of fallback toegevoegd.

Voor 3B is nog nodig: een actuele, gemigreerde testdatabase met de
Nederlandstalige OTB-collectie, vastgepinde bewijsgegevens voor boek,
hoofdstuk en vers, én een expliciete bestaande-publicatiebeslissing voor die
collectie. Daarna kunnen enkel-, bereik- en samengestelde verwijzingen via
de bestaande `ReferenceResolver`, preview, reader en return-trip worden
gevalideerd zonder een tweede Bijbelreader te bouwen.

## Fase 3A.2 — OTB-validatie en interne verwijzingen

De ontbrekende kolom `ContentCollection.publicationState` is geïntroduceerd
door migratie `20261020120000_content_work_publication`. De eerder gebruikte
`LEARNING_TEST_DATABASE_URL` wijst naar de gedeelde veilige testdatabase en
bevat die migratie nog niet. Dat is geen geldige basis om schema- of
publicatiegedrag te testen en is daarom niet gemigreerd.

De bestaande structurele oplossing is
`scripts/content-architecture/test-access-isolated.mjs`: die negeert de
omgevings-`DATABASE_URL`, start een eigen Postgres-container, voert de gehele
migratieketen inclusief `20261020120000_content_work_publication` uit en
verwijdert container, volume en tijdelijke bestanden in `finally`. De runner
kon in deze uitvoeromgeving niet starten omdat de Docker-binary ontbreekt
(`spawnSync docker ENOENT`). Er zijn geen gedeelde of productiegegevens
gewijzigd.

De OTB-importer valideert vóór writes de gepinde upstreambron, alle 66 boeken,
hoofdstukken, verzen en de gelijke structuur van de ondersteunde talen. Voor
de Nederlandse Oude-Testamentcollectie schrijft hij de canonieke boekcodes
`gen` tot en met `mal`, `work: old-testament` en `editionKey: otb`. Hij maakt
de collectie bewust aan met `visibleToUsers: false`; de centrale
`collectionAccessWhere` blokkeert die collectie voor normale leesroutes tot
een expliciete publicatiebeslissing. Dat is geen foutieve instelling en mag
niet door een CFM-import of resolver worden omzeild.

Daarom zijn nog geen `INTERNAL_VERIFIED` CFM-verwijzingen toegevoegd. De
bestaande resolver gebruikt nu uitsluitend vastgepinde tekstbewijzen voor
bronnen die reeds normaal leesbaar zijn. Een OTB-mapping zou pas betrouwbaar
zijn nadat de wegwerpdatabase een volledige, gepinde Nederlandse OTB-import
heeft gevalideerd én de collectie volgens het bestaande publicatiepad
`PUBLISHED`, `enabled` en `visibleToUsers` is gemaakt. Pas dan kunnen
ReferencePreview, `Meer lezen` en de bestaande return-trip ongewijzigd de
interne `/scripture/[chapterId]`-route gebruiken.

## Fase 3A.3 — read-only productiediagnose

De beheerder kan de feitelijke OTB-aanwezigheid, publicatiepoort, canonieke
boekcodes en geaggregeerde hoofdstuk-/versstructuur zonder wijziging
controleren met `diagnose-otb-production-readonly.mjs`. De uitvoer en de
veiligheidsgrenzen staan in `19-PHASE-3A-OTB-PRODUCTION-DIAGNOSIS.md`.
De diagnose levert bewust geen interne resolvermapping op en mag niet worden
gebruikt om een collectie te publiceren of te herstellen.
