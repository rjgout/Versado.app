# Fase 2D — Verwijzingen, preview en gecontroleerde uitstap

## Beginsituatie en voorafgaande bronvalidatie

Branch `codex/content-architecture-v2-2d-reference-preview`, basis
`a4497bb95ccde0312ec9cac77c3b86e2d9b0c549` (gemergede PR #98).
Tijdens uitvoering veilig gesynchroniseerd met `619a366` (PR #99), zonder conflicten of verlies van de puzzelrecord-/privacywijzigingen.
De leesbezoekbewijzen uit de definitieve 2C-review zijn leidend: een
publicatiehistorie alleen verleent geen historische leesrechten.

Voor implementatie zijn de bestaande schema's, import-/publicatiediensten,
StudyReader, queue, bronrechten en navigatiecontracten onderzocht.
ContentReference heeft al oorspronkelijke/normaliseerde targets, diagnose en
evidenceKey. Voor de resolver zelf is geen Prisma-wijziging nodig. De strengere
terugkeerconcurrency vereist het afzonderlijke voorstel hieronder; dat is
afzonderlijk goedgekeurd en additief geïmplementeerd.

### Gecontroleerde Nederlandse Schrifturen

| Werk | Editiefamilie | Repositorybron | Boeken / hoofdstukken / verzen |
|---|---|---|---|
| bofm | bofm | prisma/bomContent.json | 15 / 239 / 6604 |
| dc-testament | dc-testament | prisma/dcContent.json | 1 / 138 / 3654 |
| pgp | pgp | prisma/pgpContent.json | 5 / 16 / 635 |
| old-testament / new-testament | otb | scripts/otb/source-lock.json | Gepinde OTB; géén bewezen equivalentie met de kerk-Bijbel |

De identiteit volgt `prisma/bookKeys.ts`, de expliciete officiële herkomst in
`prisma/content.ts` en `scripts/church-text/fetch_dc_pgp.py` /
`fetch_scripture.py`. Lokale boeknamen zijn geen equivalentiebewijs. De oude
Nederlandse BOM-PDF-vertaling wordt niet als de huidige editie behandeld.

Op 14 oktober 2026 is uitsluitend de openbare officiële content-API gelezen:
`https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content`
met `lang=nld` en respectievelijk `uri=/scriptures/bofm/1-ne/1`,
`/scriptures/dc-testament/dc/1`, `/scriptures/pgp/moses/1`.
Geen redirects gevolgd, geen productie-/NAS-verzoeken of imports uitgevoerd.
De drie volledige hoofdstukken kwamen exact overeen met de bestaande
repositorytekst én aaneengesloten versnummers (20, 39 en 42 verzen).
SHA-256 van de UTF-8 JSON-array met teksten:

- 1 Nephi 1: `48456b733bfd045f3b20e0fc1d57b99378fc5e4fb40f8151b485b11a25d2d472`.
- LV 1: `d4164f0543c03be33a2d6af16459af8ee273ff1a71f3cac8cfeacecb7cf6a93b`.
- Mozes 1: `bfa1377412161b5f2e0a332e8ae109c350d584806e8c900a8e495ac663fcb76d`.

Dit is representatieve primaire broncontrole, geen claim dat alle upstream-
hoofdstukken opnieuw opgehaald zijn. De runtime zal exacte taal/editiemetadata,
canonieke boeksleutel, bereik én het volledige hoofdstukhash van de gecontroleerde
repositorysnapshot controleren. Afwijkende database-inhoud faalt gesloten.
Geen vergelijking van slechts namen, aantallen of ongeveer gelijke tekst.

Ondersteuning begint conservatief met deze Nederlandse editiefamilies.
Andere talen, nummeringen, ontbrekende editie-identiteiten en OTB tegenover
kerkverwijzingen krijgen uitsluitend een bestaande, veilige officiële externe
URL of een unavailable-uitkomst. De OTB-lock bewijst de eigen importidentiteit,
niet equivalentie met een andere Bijbelvertaling. Geen natuurlijke-taal-gokken.

## Hergebruik en ontwerp

- Bestaande normale contentrechten en published DTO; geen adminverruiming.
- ContentReference is de serveridentiteit; de client kiest geen doel-URL/bron.
- Negen bloktypen blijven onveranderd; refs worden pas bij openen opgehaald.
- Native dialog in bodyportal, volgens bestaande hint-/publicatiedialogs.
- Bestaande ReadingPosition-queue wordt vóór Meer lezen gecontroleerd geflusht.
- Centrale bronselectie blijft compare-and-set; tijdelijke tabcontext is geen
  UserStudyContext en overschrijft geen nieuwere keuze.
- De bestaande `/lesson`-route maakt oefensessies aan. Die is daarom géén
  geschikte readonly Meer-lezen-bestemming. Een beperkte readonly passagepagina
  hergebruikt de bestaande ReaderView-previewstand zonder sessie-/rewardservice.
- De officiële publicatiegate blijft gesloten; resolverbewijs versoepelt die niet.

## Implementatie-, test- en uitrolstatus

De implementatie is gereed op de werkbranch; definitieve regressies en CI worden op de PR-head gecontroleerd. Geen merge, deployment of productiemutatie uitgevoerd.

## Noodzakelijk aanvullend schema-akkoord: bronselectieversie

De huidige compare-and-set vergelijkt uitsluitend collectie-ID en taal. Dat
beschermt tegen een verschillende recente keuze, maar kan een A→B→A-wissel op
een ander toestel niet onderscheiden van de oude A. Een nog geldig getekend
returntoken zou daardoor een nieuwere keuze kunnen overschrijven. TTL, HMAC of
een clientnonce lossen deze database-ABA niet op. UserStudyContext.version is
voor lessen; User.updatedAt/lastSeen of beloningsvelden hiervoor gebruiken zou
onverwante acties onterecht als bronwissel behandelen.

Exact afzonderlijk goedgekeurd schema:

```prisma
model User {
  // Alle bestaande velden/relaties behouden.
  contentSelectionVersion Int @default(0)
}
```

- Eén additieve INTEGER NOT NULL DEFAULT 0-kolom; geen backfill of herschrijving
  van bestaande collectie-, taal-, cursus-, context- of voortgangsgegevens.
- CHECK >= 0 en één BEFORE INSERT/UPDATE-trigger op User. Alleen een werkelijke
  wijziging van activeContentCollectionId of contentLanguage verhoogt de teller
  precies eenmaal. No-ops en andere profiel-/economievelden verhogen hem niet.
- De trigger beschermt ook legacysetters/directe ORM-writes. Een client of
  willekeurige ORM-payload kan de teller niet terugzetten; overflow faalt gesloten.
- Terugkeer vergelijkt de getekende afterVersion onder dezelfde User-lock als
  de bronselectiecommit. Een veranderd studielescontextversienummer wordt eveneens
  atomair gecontroleerd, met de bestaande gebruiker/werk-advisorylock vóór User.
- Geen nieuwe tabel, index, valuta, generic eventlog of autorisatieframework.
- Oude API-clients blijven werken; versiegegevens zijn additief. Een oude client
  mag de nieuwe returnbeveiliging niet omzeilen.
- Een geïsoleerde migratieproef controleert oude velden/rijen/objecten, no-op,
  legacywrites, A→B→A en rollback bij fouten. Productie-uitrol blijft afzonderlijk.

De migratie `20261101120000_content_selection_version` is na het hieronder vastgelegde akkoord gemaakt. Alleen geïsoleerde databases worden gemigreerd. Productie-uitrol vereist nog afzonderlijke review en toestemming.

### Aanvullende externe broncontrole

De officiële API geeft met `lang=nld` voor Genesis 1, Psalm 23 en Johannes 1
HTTP 404. Er wordt daarvoor geen Nederlandse fallback of andere vertaling
verzonnen. De uit de bestaande FSY-scraperstructuur afgeleide openbare URL
`https://www.churchofjesuschrist.org/study/ftsoy/2026/10/fsy-lessons/00-intro?lang=nld`
is wel via de officiële API gevalideerd (titel: “Je lichaam is heilig”). Deze
specifieke URL wordt als externe resource gepind, zonder FSY-conversie of import.

### Afzonderlijk schema-akkoord

De eigenaar heeft het hierboven beschreven minimale schema expliciet goedgekeurd met “Akkoord met dit schema”. Dit akkoord geldt voor implementatie, geïsoleerde tests en de concept-PR; productie-uitrol blijft niet toegestaan.


## Geïmplementeerde contracten

### Resolver en publicatiereview

`src/lib/references/` bevat de gedeelde URL-/editiebewijzen, resolver, referentie-audit,
HMAC-uitstap en tabcontext. De endpoint is `POST /api/study-references` met uitsluitend
`lessonEditionId`, `revisionId`, `occurrenceKey` en eventueel het eigen getekende
leesbezoekbewijs; geen client-URL, actor, collectie of previewbevoegdheid.
Uitkomsten zijn `internal`, `external` of `unavailable` met diagnostische identiteit.

- Intern Schriftuurdoel: expliciete werk-/editie-/taalmetadata, gepinde canonieke
  boekidentiteit en hash van het **hele** DB-hoofdstuk. De verslijst is oplopend,
  volledig en identiek aan het gepinde repositorybewijs; geen fuzzy matching.
- Nederlands BOM, Leer en Verbonden en Parel van Grote Waarde zijn ondersteund.
  De 393 hoofdstukbewijzen worden in tests tegen de bestaande bronbestanden gecontroleerd.
- Andere vertalingen krijgen geen intern equivalent. Een bekende, oorspronkelijke
  officiële URL kan extern worden geopend. OTB en kerk-Bijbel worden niet gelijkgesteld.
  De daadwerkelijk ontbrekende Nederlandse Bible-API-doelen krijgen geen verzonnen URL.
- `study:<sourceKey>#<sectionAnchor>` gebruikt exact werk, editie en taal, uitsluitend
  normaal toegankelijke actuele publicatie. Een bronkey die over meerdere perioden
  ambigu is wordt geweigerd. Zonder expliciete andere editie blijft de huidige familie leidend.
- Officiële resource-URL's moeten exact in de gecontroleerde registry staan. Alleen
  een verwante oorspronkelijke URL/alias is fallback; een ongerelateerde bekende URL
  bewijst geen verwijzing. Onbekende bronnen blijven zichtbaar als `UNRESOLVED`.

De bestaande import- en publicatieservice hergebruikt dezelfde analyse. Beheerreview
heeft een expliciete actie **Verwijzingen controleren**; die verandert uitsluitend
diagnostiek. Publicatie hercontroleert immutable hash, oorspronkelijk doel, werkelijk
beschikbare mapping en opgeslagen bewijs/normalisatie in de bestaande transactie.
Er is geen nieuwe referentietabel, resolverdatamodel of openbare concept-API.
De bestaande `synthetic-reviewed-reference-v1`-fixture-uitzondering blijft uitsluitend
binnen de oorspronkelijke lokale synthetische publicatiegate bestaan.

### Preview

`ReferenceLink` activeert een lazy preview in `ReferencePreview`: native `<dialog>`
in een bodyportal, native modal-inertness/focustrap, Escape, gelabelde titel,
focusherstel met `preventScroll`, begrensde interne scrollruimte en expliciete
fout-/herstelstatus. De StudyReader blijft gemonteerd. Fetches worden bij sluiten
geannuleerd; late responses mogen een nieuwe preview niet overschrijven.

Een afbeelding of passage wordt via bestaande `RichContentBlocks`/mediarechten
weergegeven. Referenties binnen die preview openen geen geneste dialogen. Langere
koppen worden visueel tot drie regels begrensd, terwijl de volledige toegankelijkheidsnaam
beschikbaar blijft. Het sluitvlak is 48×48 CSS-pixels, ook bij 200% tekst; bij beperkte tekstbreedte wijkt de titel naar een volledige eigen regel uit.
Alle teksten gebruiken de vijf bestaande UI-talen en Versado-tokens.

### Meer lezen en terugkeer

1. De bestaande ReadingPosition-savequeue meet de actuele positie en flusht gecontroleerd.
   De actuele queue-uitkomst is leidend, niet een nog verouderde React-render.
2. Bij een onbekende of mislukte opslaguitkomst wordt geen bronuitstap uitgevoerd.
3. Tabopslag wordt vooraf gecontroleerd. Het initiële voorkeur-/versiecontract blijft
   bij een onbekende netwerkuitkomst bewaard; de client raadt geen geslaagde mutatie.
4. De server hercontroleert de verwijzing, leespositieversie en normale rechten.
5. Centrale `commitContentSelection` zet bron en taal onder User-lock atomair om.
   Uitstappen gebruiken de aanvullende bronselectieteller; bestaande clients blijven
   met hun oorspronkelijke contract functioneren.
6. Een doel krijgt alleen `returnKey=<opaque UUID>` in de URL. Het HMAC-bewijs en
   noodzakelijke oorsprong-/revisie-/ankergegevens staan uitsluitend in sessionStorage,
   gebonden aan eigenaar, aanmeldsessie en maximaal 30 minuten geldigheid.
7. **Terug naar les** controleert bronrechten, oorspronkelijke leseditie,
   UserStudyContext-versies van oorsprong én eventuele doelstudieprogramma en `afterVersion` voordat de oude bron wordt hersteld.
   De bestaande reader hervat de laatste toegestane serverpositie volgens 2C-regels;
   de uitstap schrijft zelf geen oude leespositie terug.

Lockvolgorde: editie → bestaande gebruiker/werk-advisorylocks in gesorteerde werkvolgorde → leespositie-advisorylock
(alleen Meer lezen) → User. Return controleert context en bronvoorkeur in dezelfde
transactie. Bron-ABA en een nieuwere actieve les geven herstelbaar HTTP 409.
Een identieke returnretry na verloren response kan alleen een **no-op** opleveren
bij exact `afterVersion + 1` en de reeds herstelde oorspronkelijke tuple. Latere
keuzes worden niet overschreven. Een onzekere Meer-lezen-response wordt niet
achteraf als geslaagd verzonnen: een stale retry geeft conflict en bewaart de actuele bron.

De centrale NavigationScroll beheert alle scrollherstel en prunet de tijdelijke
uitstap bij een bewuste andere route/contentkeuze. Browser back/forward binnen
originele les en doel behoudt die; logout/nieuwe sessie kan het bewijs niet hergebruiken.
Een extern doel wisselt de bron niet. Geen tweede scroll-, focus- of pollingmanager.

### Readonly Schriftuurpagina

`/scripture/[chapterId]` hergebruikt `ReaderView` in preview-/focusstand en de bestaande
Focus-shell/terugbalk. De bestaande `/lesson` maakt oefensessies aan en is daarom
niet gebruikt voor deze readonly uitstap. De nieuwe route maakt geen ReadingSession,
ExerciseSession, READ, annotatie, XP of reeksactiviteit aan. Audio-autoscroll van een
elders spelende passage beïnvloedt deze previewstand niet. Gewone Schriftuurleesroutes
blijven bestaan en behouden hun oorspronkelijke gedrag.

## Beveiliging en performance

- Geldige serverauthenticatie, normale bronrechten ook voor admins, Origin-controle,
  sessiegebonden `X-Reading-Session`, strikte Zod-union en maximaal 8 KiB requestbody.
- `Cache-Control: no-store, private`, `Vary: Cookie`, `nosniff`; geen gedeelde bodycache.
- Historische oorsprongsrevisies vereisen **beide** publicatieaudit en het eigen,
  nog geldige 2C-leesbezoekbewijs. Actuele rechten worden opnieuw gecontroleerd.
- Preview draait in een PostgreSQL READ ONLY / Repeatable Read-transactie.
  Geen mutable HTML, willekeurige SQL, externe redirect of privéannotatiequery.
- Maximaal 40 verzen en 48.000 bytes previewresponse. Maximaal 200 referenties per
  reviewbatch en 20 unieke studielesdoelen; ambiguïteit/overschrijding faalt gesloten.
- Schriftuurreview doet één hoofdstukbatch; studiereview twee batches. Prisma haalt
  relaties gericht op, niet per afzonderlijke referentie. Geen filesystemcontrole
  of netwerkverzoek naar de officiële provider per gebruikersrequest.
- Resolver statement timeout 5 seconden, transaction timeout 10 seconden;
  muterende uitstap daarnaast lock timeout 3 seconden. Events/invalidation alleen na commit.
- Locale warme PostgreSQL-metingen: 10 SELECTs, één hoofdstukquery, 13 totale
  statements, 1.031 responsebytes, 7,93–9,31 ms (drie monsters). Dit is geen
  productiebenchmark of belofte voor NAS/netwerkvertraging.

## Testbewijs

De bestaande geïsoleerde runner is uitgebreid; er is geen parallel testframework.
Elke run gebruikt eigen PostgreSQL op localhost, synthetische accounts/content en
het bestaande tijdelijke testmediavolume. De nieuwe migration proof vergelijkt
**alle** oude rijinhoud, kolommen, constraints, indexen en triggers en controleert
no-op, legacywrites, ABA, directe teller-manipulatie, herhaald deploy en foutrollback.
De migraties 1A–2C worden eveneens opnieuw met hun bestaande behoudtests uitgevoerd.

| Controle | Resultaat / bewijs |
|---|---|
| Gerichte unit-/architectuurregressies | 207 geslaagd, nul failures/skips; resolver, 2A–2C, toegang/context/selectie, shell/focus/live-data en bestaande puzzelrecords |
| Reference API / PostgreSQL | 14 gerichte tests, nul skips; normale/adminrechten, Origin/sessie/strict payloads, historische rechten, CAS/ABA, parallelle uitstappen, DB-foutrollback, publicatiereview, studieadapter, querybudget |
| Chromium productiebuild | Matrix 320×844, 390×844, 1280×900, 844×390; licht/donker, 100/200%; vijf UI-talen op 320px/200%; touch, native focus/Escape, geen overflow/previewscrollverschil, refresh, back/forward, Return-conflict, save-failure en responseverlies |
| Prisma validate/generate, TypeScript | Geslaagd; daadwerkelijke additieve migratie op eigen PostgreSQL |
| ESLint | Geen fouten; 134 bestaande waarschuwingen, ook vastgesteld op actuele main in een afzonderlijke auditworktree |
| i18n | Nieuwe sleutels in alle vijf talen; 3716/4134 bestaande vertalingen per extra taal, 418 reeds bestaande ontbrekende sleutels |
| Productiebuild | Schone Next.js-build met onbruikbare localhost-build-DB; geen productieverbinding |
| CI / verdere integratieregressies | Toepasselijke checks en exacte SHA zichtbaar bij de concept-PR; alleen werkelijk uitgevoerde uitkomsten worden als geslaagd gerapporteerd |

Browserbewijs: `/tmp/versado-reference-preview-browser`, als GitHub Actions-artifact
`reference-preview-browser` (screenshots per viewport/thema/tekstgrootte en resultaat-JSON).
Geen screenshots, credentials of privédata in Git. Geen fysieke iOS-/Android-/Capacitor-
toestellen, Safari of echte screenreader getest; native focus/ARIA en toetsenbord zijn
wel in Chromium gecontroleerd. De huidige pg/Prisma-adapter meldt in integratietests
ook een niet-fatale deprecatiewaarschuwing over gelijktijdige clientqueries.

## Uitrol, rollback en resterende grenzen

1. Review deze concept-PR, de afzonderlijk goedgekeurde countermigratie en definitieve
   CI-head. Niet mergen/deployen zonder afzonderlijk besluit.
2. Synology voert `prisma migrate deploy` bij containerstart uit. De additieve migratie
   moet daarom vóór image-uitrol expliciet worden beoordeeld; lock/conflict-fouten
   laten de transactie terugrollen en de oude data staan. Geen handmatige productie-DDL.
3. Bestaande Hyper Backup wordt door de eigenaar beheerd. Een onafhankelijke restoretest
   is niet uitgevoerd; dit eerder geaccepteerde restrisico blijft ongewijzigd.
4. Geen nieuwe media-/NAS-configuratie, import, collectiepublicatie of backfill door 2D.
   Officiële publicatie blijft achter de bestaande release-, bron-, media- en referentiegates.
5. Na afzonderlijk toegestane uitrol: normaal-account preview/Meer lezen/Return controleren
   op bestaande toegankelijke bron; geen synthetische productiepublicatie gebruiken.
6. Bij rollback: vorige appimage terugzetten; behoud nieuwe kolom/check/trigger en alle
   eerdere publicaties, revisies, media, context, annotaties en ReadingPosition-data.
   Oude code gebruikt de teller niet, maar blijft compatibel. Geen destructieve downmigratie.

Buiten scope en niet afgerond: 2E READ/studieactiviteit, nieuwe officiële CFM/FSY-imports,
nieuwe editie-equivalenties, algemene Schriftuurreader-/annotatieherbouw en publicatievrijgave.
De gerichte readonly route en de aanvullende bronselectieteller zijn de noodzakelijke
2D-afhankelijkheden; geen nieuw navigatie- of contentsysteem.

De bestaande contentkiezer-databehoudtest controleert de vier bewuste bronwissels nu inclusief exact vier tellerverhogingen. Het fingerprint sluit alleen de drie beheerde voorkeurvelden van de betreffende gebruiker uit; alle andere gebruikers en velden blijven volledig gecontroleerd.

Bij versiegebonden uitstappen wordt ook de volledige verwachte voorkeur vóór de no-op vergeleken. Een client kan daardoor geen verzonnen oude keuze in een geldig terugkeerbewijs laten opnemen wanneer de huidige bron al gelijk is aan het verwijzingsdoel. Legacy-clients behouden hun oorspronkelijke no-op-contract.

De 2C-browsercontrole blijft alle formulier-/afrondingscontrols in officiële tekst verbieden. Alleen expliciete `data-reference-key`-knoppen zijn nu toegestaan, met `type=button`; deze nieuwe 2D-bediening is read-only en geen oefening.

Ook de bestaande 2C-browsertest controleert de ene expliciete bron-/taalwissel met exact één tellerverhoging, terwijl alle overige User-velden gelijk blijven. Bij een onzekere uitstap of geblokkeerde terugkeer biedt de UI een veilige, expliciete link naar de bestaande contentkiezer; die verandert niets zonder nieuwe selectie. Die keuze of logout ruimt ook oude pending-reference-intenties op.

Meer-lezen-requests hebben een clientdeadline van 15 seconden en worden bij reader-/sessiewissel afgebroken. Ook na een succesvolle response controleert de callback de oorspronkelijke centrale history-entry en sessie, voordat tokenopslag of navigatie gebeurt. Een later antwoord mag dus geen nieuwe geschiedeniskeuze overschrijven; een reeds gecommitte serverkeuze wordt niet onveilig teruggedraaid.
