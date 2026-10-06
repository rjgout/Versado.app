# Open Translation Bible

De OTB-bron is bewust gepind in `source-lock.json`. Deze map bevat alleen de
validator, de canonieke boekmapping en de beperkte proefimport; de upstream
JSON-bestanden blijven buiten de repository.

## Volledige structurele controle

```sh
npm run otb:validate -- --source /pad/naar/open-bible
```

De validator leest uitsluitend `lang/<locale>/**/json/*.json`, gebruikt geen
PDF en schrijft niets naar de database. Een update begint met een nieuwe
upstream-SHA in een nieuwe review; eerst wordt de volledige skeleton opnieuw
vergeleken. Verschillen worden niet automatisch gerepareerd.

## Beperkte proefimport

Pas na een geslaagde validator-gate:

```sh
npm run otb:import-trial -- --source /pad/naar/open-bible
```

De importer valideert nogmaals vóór de eerste databasewrite en importeert
alleen Genesis 1, Psalm 23 en Johannes 1 in vijf verborgen collecties. Er
worden geen audio-, oefen-, cursus- of spelrecords gemaakt. De tien verborgen
collecties zijn vijf talen voor `old-testament` (boeken 01–39) en vijf talen
voor `new-testament` (boeken 40–66); er wordt geen `work=bible`-collectie
gemaakt.

Dezelfde importer draait ook vanuit de bestaande beheeractie **Nieuwe content
laden**. Zonder `--source` haalt die flow de archive-URL van exact de SHA uit
`source-lock.json` op en cachet de uitgepakte snapshot onder
`OTB_CACHE_DIR/<SHA>` (standaard `/tmp/versado-otb/<SHA>`). Eerst worden de
bronmarker en de volledige skeleton gevalideerd; pas daarna volgen de
idempotente upserts. Een download- of validatiefout verwijdert geen bestaande
OTB-data.

`text[]` wordt centraal naar `Verse.text` genormaliseerd: array-elementen
blijven afzonderlijke regels, één voorloop-`> ` uit Markdown wordt verwijderd
en de regels worden met `\n` verbonden. Het separatorobject `text: ["---"]`
zonder versnummer is opmaak en wordt niet geïmporteerd.

Een latere update mag bestaande records niet vervangen op basis van vertaalde
boeknamen. De stabiele koppeling blijft `work + editionKey + Book.key +
Chapter.number + Verse.number`; daardoor kunnen voortgang, bladwijzers,
markeringen, notities en cursusvoortgang blijven verwijzen zolang de
canonieke locatie bestaat.
