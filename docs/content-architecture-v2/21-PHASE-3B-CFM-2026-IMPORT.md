# Fase 3B — volledige Nederlandse CFM 2026-conceptimport

## Basis en resultaat

Gebaseerd op `origin/main` met gemergede PR #116 (`c34860e6`). De bestaande
CFM-manifestidentiteiten, importleases, immutable revisies, mediaopslag,
ReferenceResolver, StudyReader en beheerpreview worden hergebruikt. Er is geen
Prisma-schemawijziging, nieuwe reader of productie-import.

Alle 52 daadwerkelijke Nederlandse officiële lessen zijn gepind op 15 oktober
2026. De bron is de Nederlandse editie van *Kom dan en volg Mij 2026 — Oude
Testament*, vanaf de officiële inhoudsopgave in het bestaande manifest. De
bron-enveloppen bevatten de volledige officiële HTML; SHA-256 in `source-lock.json`
controleert de exacte bytes. De rechtenbevestiging van de eigenaar blijft in de
revisiemetadata opgenomen. Er is geen inhoud of ontbrekende alttekst verzonnen.

| Controle | Resultaat |
| --- | ---: |
| Verwachte / voorbereide / in test geïmporteerde lessen | 52 / 52 / 52 |
| Semantische blokken, inclusief ingebedde lijstblokken | 3.200 |
| Expliciete bronverwijzingen | 3.609 |
| Daarvan Bijbelverwijzingen (OT/NT) | 2.242 |
| Bron-gecontroleerde interne OTB-kandidaten / in test opgelost | 1.679 / 1.679 |
| Bestaande bewezen officiële externe fallbacks | 449 |
| Geblokkeerde verwijzingen | 1.481 |
| Tabellen | 10 |
| Afbeeldingen/posters: occurrences / unieke bestanden | 563 / 356 |
| Gepinde afbeeldingsbytes | 10.473.831 |
| Ontbrekende afbeeldingen | 0 |
| Niet gespiegeld videobestand, met oorspronkelijke URL en poster bewaard | 95 |
| Ontbrekende bron-alttekst (hetzelfde bannerbestand) | 52 |

De machineleesbare uitsplitsing per les en verwijzing staat in
`data/study-content/cfm-2026-nl/quality-report.json`. Een vaste bronindex bewijst
geen actuele productie-inhoud of toegangsrechten: de resolver blijft deze bij
gebruik controleren. Er zijn geen productiequeries uitgevoerd.

## Normalisatie en inhoudsbehoud

`cfm2026Adapter.ts` verwerkt alleen de gecontroleerde officiële bronstructuur.
Titels komen uit de volledige brontitel; volgorde en perioden uit het bestaande
52-lessenmanifest. De bron-einddatum is inclusief en wordt bij opslag één dag
verhoogd naar `endsOnExclusive`. Afwijkende bestaande lesdatums stoppen de import.

Koppen, alinea's, nadruk, lijsten, citaten, afbeeldingen, bijschriften en
verwijzingen blijven semantisch behouden. De bestaande JSON-v1-structuur is
additief uitgebreid met begrensde tabellen en ingebedde lijstblokken, omdat de
echte bron afbeeldingen, video's en alinea's binnen lijstitems bevat. De 56
ingebedde afbeelding/posterblokken en drie geneste lijsten blijven op hun eigen
plaats in hetzelfde lijstitem. Zowel reader als beheerpreview renderen deze
structuur. Bestaande documenten blijven geldig; website-CSS wordt niet overgenomen.

De adapter vergelijkt de volledige betekenisvolle brontekst met de genormaliseerde
inhoud. Onbekende betekenisvolle HTML, ontbrekende media, verkeerde taal,
bronidentiteit of bronhash veroorzaken een fout. Officiële vragen blijven
leestekst, zonder automatische omzetting naar oefeningen.

## Referentiedekking en veiligheidsgrenzen

Alle interne Bijbeldoelen zijn exact `old-testament / otb / nl`. De contenttaal
van de les bepaalt de verwijzingstaal; de UI-taal speelt geen rol. Er worden geen
andere vertalingen geïmporteerd of nieuwe equivalenties geregistreerd.

De testdatabase bevat de daadwerkelijke gepinde openbare Nederlandse OTB-bron:
39 boeken, 929 hoofdstukken en 23.145 verzen. Elke hoofdstukfile is gecontroleerd
tegen zijn Git-blobhash in upstreamcommit
`31d411ac1c2d277242a3bd85697f354eaa11526b`. `otb-index.json` bewaart bronpaden,
blobidentiteiten en versinventaris. De bestaande resolver controleert vervolgens
de echte databasepassages, editie, taal en normale toegangsrechten.

| Blokkeringsreden | Aantal |
| --- | ---: |
| Officiële resource nog niet geregistreerd | 670 |
| Meerdere hoofdstukken niet ondersteund | 257 |
| Nieuwe Testament buiten goedgekeurde OTB-mapping | 209 |
| PDF vereist afzonderlijke review | 105 |
| Video vereist afzonderlijke review | 95 |
| Verschil tussen label- en URI-versnummering | 67 |
| Andere Schriftuur buiten goedgekeurde mapping | 37 |
| Verwijzing naar een heel boek niet ondersteund | 17 |
| BJS is niet de OTB-editie | 11 |
| Samengestelde verwijzing niet ondersteund | 9 |
| Expliciet versbereik groter dan de toegestane limiet | 4 |

Bijvoorbeeld `Jesaja 9:5` heeft in de officiële URI `p6`, en `Psalmen 19:8–12`
verwijst daar naar `p7-p11`. Hiervoor wordt geen offset geraden. Zowel label als
originele URL blijven bewaard; het doel krijgt een onopgeloste diagnose.
Een heel boek wordt evenmin stilzwijgend hoofdstuk 1. Alleen Obadja heeft in de
gecontroleerde bron precies één hoofdstuk. Hoofdstukbereiken en samengestelde
verwijzingen worden niet tot hun eerste deel ingekort.

Afzonderlijke hoofdstukken blijven ondersteund: de preview toont maximaal 40
verzen met afkortingsmelding; Meer lezen opent het volledige hoofdstuk. Expliciete
versbereiken behouden de strikte validatie uit PR #116.

## Import, media en publicatie

`importCfm2026Drafts()` valideert eerst alle bron-enveloppen en de bestaande
persistente opslag. Daarna gebruikt iedere les de gedeelde registratie-, lease-,
fencing-, media- en revisieketen. De gepinde bronhash en bestaande scope-identiteit
maken een herimport idempotent. Een gewijzigde bron kan een nieuwe immutable
conceptrevisie maken; publicatiepointers worden nooit door de importer gewijzigd.

Een eventueel nieuw werk is uitsluitend het bekende studieprogramma
`cfm-old-testament-2026`, editie `church-cfm-ot-2026`, taal `nl`. Een nieuwe collectie
is `DRAFT` en verborgen. Bestaande collectie-ID's, publicatie- en zichtbaarheidsflags
blijven behouden. Geen wijziging van actieve bron, lescontext, cursussen of economie.

Alle 356 afbeeldingen/posters worden via de bestaande veilige download- en
opslagservice op checksum, signatuur, MIME, bytegrootte en afmetingen gecontroleerd.
Ze staan buiten de image in het bestaande persistente studiemediavolume. De runtime
image bevat alleen de gepinde tekst-/metadatabestanden. Ontbrekende of onveilige
opslag blokkeert vóór de eerste databasewrite. Geen nieuwe NAS-mount of stackactie.

De 95 echte video-URL's en hun posters blijven bewaard, maar videobestanden worden
niet gespiegeld en er is geen nieuwe speler. De bron levert bij één herhaald
bannerbestand geen alttekst. Het concept bewaart dit eerlijk als lege alttekst;
publicatie weigert documenten met onbeoordeelde lege altteksten.

**Officiële productiepublicatie blijft gesloten.** Alleen de bestaande strikt
geïsoleerde testomgeving mag de volledige publicatieservice beproeven. De
CFM-importadapter geeft op productie nooit zelfstandig publicatietoestemming.
Onopgeloste referenties en media blijven bovendien onafhankelijke publicatiegates.

## Uitgevoerde controles

De gerichte bron-/adaptertests controleren alle 52 hashes, inhoud, perioden,
deterministische blokken, referenties, ontbrekende media en afwijzing van onbekende
structuren. De geïsoleerde PostgreSQL-run gebruikt alle 144 bestaande migraties,
test herhaalde deployment en bestaande migratie/databehoudcontroles.

De volledige import wordt tweemaal uitgevoerd zonder extra runs, revisies of
media. Alle 52 revisie-ID's blijven gelijk; een bestaande publicatiepointer blijft
staan. Ongeldige mediabytes maken geen extra importrecords. Hashes van 20
persoonlijke, cursus-, spel- en economiemodellen blijven gelijk. Gewone gebruikers
en admins krijgen via de normale reader HTTP 404 voor de verborgen concepten.

Voor de echte browsertrip worden uitsluitend in de wegwerpdatabase expliciete
testpublicatiepointers gezet. Dit is geen geslaagde publicatiegate en is geen
onderdeel van de importservice. De echte publicatieservice weigert de onvolledig
gevalideerde officiële concepten nog steeds.

Browsercases tegen een productiebuild:

- Werkelijk geïmporteerde les 03: preview, Escape/focus, ongewijzigde scrollpositie,
  Meer lezen en Terug naar les op 320px licht/200% tekst, 390px donker en 1280px licht.
- Werkelijke brontabel uit les 41 op 320px/200% tekst, zonder pagina-overflow.
- Genesis 24 (67 verzen) en Psalm 119 (176 verzen): preview exact 40 met melding,
  volledige hoofdstukroute inclusief laatste vers en terugkeer naar dezelfde les.
- Geen nieuwe READ-, activiteit-, XP- of hintmutatie door preview/navigatie.

Geen fysieke iOS-/Androidtoestellen getest. Screenshots en veilige JSON-resultaten
worden als `cfm-2026-import-browser` CI-artifact aangeboden, niet in Git opgeslagen.
Sessietokens blijven uitsluitend in een private tijdelijke fixturemap.

Lokale checks: TypeScript, Prisma generate/validate, i18n, 3 CFM-tests, 57
StudyReader-tests, 33 publicatie-/contenttests en schone productiebuild slagen.
ESLint heeft 0 fouten en 143 bestaande waarschuwingen. De bestaande i18n-check
meldt 3748/4166 vertaald voor en/de/fr/es; geen nieuwe UI-teksten of sleutels.
De operator-CLI weigert zonder expliciete bevestiging en gepinde snapshothash met
exitcode 2, vóór het laden van de databaseclient. Definitieve integratie- en
GitHub Actions-resultaten worden bij oplevering aan de PR toegevoegd.

## Uitrol, rollback en vervolgstap

1. Review de code, bronlicentie-/herkomstmetadata, inhoud en kwaliteitsdiagnoses.
2. Controleer bij een latere toegestane uitrol het bestaande persistente volume.
   Er is geen nieuwe Prisma-migratie en geen import bij containerstart of seed.
3. Alleen na afzonderlijke toestemming kan een beheerder de operator-CLI met
   `--confirm-drafts-only --admin-user-id <id>` en de exact bijbehorende
   `CFM_DRAFT_IMPORT_APPROVED_SNAPSHOT` uitvoeren. Dit maakt uitsluitend concepten.
4. Beoordeel de nummeringsverschillen, ontbrekende ankers, samengestelde bereiken,
   officiële externe resources, video's en altteksten. Pas geen automatische
   versoepeling of gokmapping toe. Controleer ook de werkelijke OTB-beschikbaarheid.
5. Publieke vrijgave vereist een afzonderlijk besluit, geldige publicatiegates en
   expliciete beschikbaarstelling van de collectie. Dit werkpakket doet dat niet.

Rollback naar de vorige image laat alle revisies, media en voortgang staan; er is
geen destructieve downmigratie. De oudere reader ondersteunt de nieuwe tabel- en
lijstblokvormen niet: zolang CFM verborgen is heeft dit geen publieke impact. Na
latere publicatie mag niet zonder compatibiliteitscontrole naar zo'n reader worden
teruggerold. Bewaar alle historische publicaties en media; geen garbage collection.
De eerder geaccepteerde Hyper Backup-restoretestbeperking blijft ongewijzigd;
hier is geen onafhankelijk herstelbewijs of nieuwe backupactie uitgevoerd.

**Beoordeling:** volledige Nederlandse conceptinhoud en controleerbare import zijn
voor review voorbereid. Publieke vrijgave is uitdrukkelijk nog niet gereed door de
genoemde referentie-, media- en toegankelijkheidsvoorwaarden. Latere fasen worden
hiermee niet als afgerond verklaard.
