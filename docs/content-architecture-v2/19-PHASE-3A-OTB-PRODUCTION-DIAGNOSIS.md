# Fase 3A.3 — OTB-productiediagnose (alleen lezen)

## Doel en grens

`scripts/content-architecture/diagnose-otb-production-readonly.mjs` beschrijft
de daadwerkelijk aanwezige Nederlandse OTB (`old-testament` / `otb`) zonder
inhoud, persoonsgegevens, credentials of wijzigingen uit te lezen. Het is
geen import-, migratie-, reparatie- of publicatiepad.

## Uitvoeren

De beheerder voert uitsluitend in de productieomgeving uit waar `DATABASE_URL`
al volgens de gewone Versado-conventie beschikbaar is:

```bash
node scripts/content-architecture/diagnose-otb-production-readonly.mjs --confirm-readonly
```

Voor een lokaal, niet-publiek rapport kan een absoluut pad worden opgegeven:

```bash
node scripts/content-architecture/diagnose-otb-production-readonly.mjs --confirm-readonly --output=/veilig/pad/otb-diagnose.json
```

Het bestand wordt uitsluitend met exclusieve creatie en permissie `0600`
geschreven. Deel alleen de technische aantallen, statussen en boekcodes uit het
rapport; nooit de omgeving of databaseverbinding.

## Veiligheid

Zonder `--confirm-readonly` of zonder `DATABASE_URL` stopt het script vóór een
databasequery. Na verbinding opent het één `BEGIN TRANSACTION READ ONLY`,
bevestigt `transaction_read_only`, zet statement- en lock-timeouts en voert
alle catalogus- en inhoudstellingen binnen die transactie uit. Gebruik daarnaast
een databasegebruiker met uitsluitend SELECT-rechten.

Het script leest uitsluitend schema-informatie, migratietabel-aanwezigheid,
collectieconfiguratie, canonieke boekcodes en geaggregeerde aantallen voor
boeken, hoofdstukken en verzen. Het leest geen gebruikersgegevens en geen
Bijbelteksten.

## Interpretatie

`COLLECTION_MISSING`, `COLLECTION_DRAFT`, `COLLECTION_HIDDEN` en
`COLLECTION_DISABLED` blokkeren normale interne verwijzingen. Alleen een
complete, gepubliceerde en zichtbare collectie kan content beschikbaar maken;
de diagnose publiceert zelf niets. `NOT_VERIFIED` bij verzen betekent dat
aanwezigheid is vastgesteld, maar dat nog geen vergelijking met de gepinde
OTB-bron is gedaan. `CONTENT_PRESENT_BUT_RESOLVER_MAPPING_MISSING` betekent
dat de resterende stap de bestaande resolver-evidence is, niet een tweede
Bijbelreader.
