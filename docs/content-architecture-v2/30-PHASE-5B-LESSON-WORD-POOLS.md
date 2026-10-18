# Fase 5B — gepinde leswoordpools, zonder gameplay

Stacked op fase 5A. Geen nieuwe tabel, migratie, API, spelmodus, beloningsactie of contentimport. Alleen interne serverinfrastructuur en zuivere extractie.

## Bron- en selectiecontract

`resolveLessonWordPool` vereist een exacte lessonEditionId én revisionId. De bestaande `getPublishedStudyLesson` valideert normale bronrechten, werk/collectie/editierelaties, immutable inhoudshash en publicatie. Een nieuwe publicatie maakt een oude aanvraag herstelbaar onbeschikbaar; er wordt nooit stilzwijgend naar de nieuwe revisie overgeschakeld. Historische leesbezoektokens verruimen dit nieuwe-poolcontract niet. Ontbrekende, retired, DRAFT, disabled of ontoegankelijke bronnen leveren geen kandidaatwoorden. Beheerders gebruiken gewone leesrechten, dus wel verborgen vrijgegeven inhoud, geen conceptpreview.

Een READ ONLY-transactie gebruikt een korte statement-timeout. Er is geen globale cache of polling. De pool bevat geen gebruikers-ID, annotaties, privétekst, leespositie of voortgang. De context is een inhoudsidentiteit, geen bearer-token/toegangsbewijs. Iedere nieuwe resolutie controleert rechten opnieuw.

## Extractie v1

De caller geeft expliciet minimum-/maximumlengte, minimum-/maximumaantal kandidaten, gewenste semantische bloktypen en optionele uitsluitwoorden op. Er worden geen spelregels voor Het Verborgen Woord ingevuld.

- Hergebruik van het rich-content-schema en de bestaande NFC-/witruimtenormalisatie.
- Directe concatenatie van zichtbare inline-tekst en linktekst, met behoud van blok-/sectiegrenzen.
- Ondersteuning van paragrafen, koppen indien gevraagd, citaten, lijsten inclusief kinderen/geneste blokken, tabellen, officiële vragen en opdrachten.
- Geen URL-doelen, referentielabels, auteurstoeschrijvingen, afbeeldingen, bijschriften, bronmetadata of privéannotaties als woordbron. Een verwijzing midden in een tekenreeks mag geen nieuwe woordfragmenten maken.
- Alleen Latin-lettertokens in werkelijk beschikbare nl/en/de/fr/es-inhoud; geen vertaling, stemming, transliteratie of taal-fallback. Diakritische tekens blijven behouden. Unicode-codepunten bepalen de lengte.
- Cijferwoorden en apostrof-/koppeltekencombinaties worden geheel geweigerd, niet tot gegokte delen geknipt. Gewone aaneengeschreven samenstellingen blijven intact.
- Deduplicatie met taalbewuste lowercase/NFC, deterministische sortering, maximaal 16 echte ankerverwijzingen per kandidaat. Tekstbudget 250.000 codepunten en maximaal 5.000 uitgegeven kandidaten; truncatie is expliciet. Onvoldoende inhoud geeft geen gedeeltelijke speelbare pool.

Dit is orthografische extractie uit gecontroleerde brontekst, geen woordenboekgarantie of definitieve spelwoordenlijst. Een toekomstige speladapter moet zijn eigen goedgekeurde filters en eventuele lexiconcontrole toepassen.

## Bevroren identiteit

CollectionId, workKey, editie, logische les, lessonEditionId, revisionId, contenttaal, revisionHash en normalizationVersion vormen de bronidentiteit. SHA-256 bindt die identiteit, genormaliseerde filteropties en kandidaten/ankers. Dezelfde revisie met dezelfde opties geeft dezelfde hash. Een nieuwe revisie krijgt een nieuwe identiteit; een rollback naar de oorspronkelijke revisie herstelt de oorspronkelijke hash.

Een toekomstige spelstart moet dit server-side resultaat na zijn eigen availability-/scopecontrole opslaan en bij commit de benodigde context opnieuw valideren. Hervatten gebruikt de bewaarde spelpool; deze resolver mag geen lopende sessie opnieuw uit een inmiddels nieuwe publicatie opbouwen. De volledige kandidatenlijst hoort nooit in publieke previewresponses. Deze PR stelt geen publieke endpoint beschikbaar.

## Testbewijs

- Acht pure tests: Unicode/NFC, duplicaten, inline-concatenatie, links/verwijzingen, geneste lijsten, tabellen/citaten, expliciete filters, truncatie, onbekende taal, lege/ongeldige inhoud, tekstbudget en geen gegokte woordfragmenten.
- Acht geïsoleerde DB-tests: gepubliceerde Nederlandse synthetische CFM-les; reproduceerbaarheid; fingerprints over alle bestaande tabellen ongewijzigd; publicatieverandering en revisie-rollback; gewone/adminrechten en ingetrokken bronnen; vervalste payload/verkeerde editie/revisie; gepubliceerde FSY-copy via de echte 3C-adapter en een afzonderlijke echte Engelse testeditie.
- Gemeten querykosten: 8 inclusief transactiestatements, budget maximaal 12; geen N+1 per blok/kandidaat.
- TypeScript, gerichte ESLint, i18n en productiebuild geslaagd. Geen nieuwe UI, dus geen fictieve game-browsertest; bestaande reader-/referentie-/programma-/spelregressies lopen in de bestaande CI op de exacte head. Geen echte iOS-/Android- of productiecontrole.

## Uitrol en rollback

Na onafhankelijke review van de gestapelde PR's en expliciet mergebesluit verzorgt de eigenaar de uitrol. Deze fase voegt geen eigen migratie toe; onderliggende 3C/5A-migraties worden op Synology wel bij containerstart uitgevoerd en vereisen afzonderlijke uitrolreview. Terug naar de vorige appimage verwijdert geen poolrecords, want deze fase maakt er geen aan. Geen productie/NAS benaderd, geen les gepubliceerd of zichtbaar gemaakt.

De verdere spelmodus, scores, hints en multiplayerregels vallen buiten scope en vereisen productgoedkeuring. Er is niet gestart aan 5C/5D of Het Verborgen Woord.
