# Audiopakket v1

De externe generator heeft geen databaseverbinding nodig. De eigenaar levert een export van
de exacte tekst met bestaande collectie/Verse.id's en hashes aan; deze worden ongewijzigd teruggeleverd.
Het ontvangende JSON-schema staat in `src/lib/audio/contract.ts` (strikt; onbekende velden worden geweigerd).

```
/data/audio/staging/<tijdelijke-naam>/
  manifest.json
  audio.mp3
  segments.json
  quality-report.json  # optioneel; alleen indien manifest het benoemt
  READY                # inhoud "1\n", als laatste schrijven
```

Schrijf eerst buiten `incoming`, sluit/synchroniseer alle bestanden en verplaats de complete map
atomair naar `/data/audio/incoming/<packageId>`. Zelfde filesystem/mount. Nooit gedeeltelijk
zichtbare bestanden overschrijven. Een bestaand pakket-ID mag niet van inhoud veranderen.
Geen zipbestanden, symlinks, URL-downloadopdrachten of zelfgekozen opslagpaden in het pakket.

Voorbeeld (`<64 hex>` is een placeholder, geen werkelijke checksum):

```json
{
  "schemaVersion": 1,
  "packageId": "voorbeeld-nl-hoofdstuk-versie1",
  "collectionId": "content_bom",
  "work": "bofm",
  "editionKey": "bofm",
  "language": "nl",
  "target": {"kind": "CHAPTER", "bookKey": "bofm/1-ne", "chapterNumber": 1},
  "sourceHash": "<64 hex>",
  "sourceKind": "OFFICIAL",
  "source": {
    "name": "The Church of Jesus Christ of Latter-day Saints",
    "url": "https://assets.churchofjesuschrist.org/voorbeeld.mp3",
    "checkedAt": "2026-10-23T12:00:00.000Z",
    "rights": "Herkomst en toepasselijke bronvoorwaarden"
  },
  "voice": {"name": "officieel"},
  "audio": {"file": "audio.mp3", "sha256": "<64 hex>", "bytes": 123456,
            "duration": 123.4, "format": "mp3"},
  "segments": {"file": "segments.json", "sha256": "<64 hex>"},
  "quality": "VALIDATED",
  "qualityReport": {"file": "quality-report.json", "sha256": "<64 hex>"}
}
```

`segments.json`:

```json
{"schemaVersion":1,"segments":[
  {"id":"bestaande-Verse.id","kind":"VERSE","sourceHash":"<sha256 exacte verstekst>","start":1.2,"end":8.5}
]}
```

Voor VALIDATED: alle verzen precies eenmaal, in bestaande versvolgorde.
NEEDS_REVIEW mag uitsluitend een geheel lege segmentlijst aanleveren als veilige verstijden ontbreken;
die opname is alleen als volledige beheerpreview beluisterbaar en kan niet worden gepubliceerd.
Een gedeeltelijke of onjuiste niet-lege lijst wordt ook voor NEEDS_REVIEW geweigerd. `0 <= start < end <= duur`;
geen overlap of ontbrekende/verkeerde ID's. Bestandstijd en manifestduur mogen maximaal 0,15s
verschillen. Precies één MP3-audiostream; maximaal vier als attached_pic gemarkeerde PNG/JPEG-covers
van maximaal 4096×4096 pixels zijn toegestaan, geen gewone videostreams. MP3 maximaal 256 MiB/4 uur, manifest 64 KiB, segmentbestand 2 MiB/10.000 segmenten,
kwaliteitsrapport 1 MiB. Hashes zijn SHA-256 van de exacte UTF-8/binaire bestandsbytes.
De officiële bestaande uitgavefamilie is `bofm`, `dc-testament` of `pgp`, zoals de huidige collecties;
het Prisma-velddefault `default` is geen aanname voor bestaande uitgaven.
Tekstbronhash gebruikt bestaande `canonicalJson`, niet gewone JSON-keyvolgorde of genormaliseerde tekst.

Voor toekomstige generatie: `sourceKind: GENERATED`, `voice.name` en optioneel `engine`/`version`.
Voor bestaande studiecontentidentiteiten is `target: {kind: STUDY_REVISION, revisionId}` met
`STUDY_BLOCK`-segmenten gereserveerd. Gebruik dan de bestaande revisiehash en block-ID's;
**ontvangst/activering voor studiecontent is in deze fase expliciet geblokkeerd**. Geen tweede
contentdocument, block-ID-ruimte of publicatiemechanisme ontwerpen in de generator.

De generator schrijft alleen staging/incoming. Alleen de app mag objects beheren. Admin publiceert;
een ontvangstbevestiging of bestand in objects maakt audio niet zichtbaar. De app importeert geen
URL uit een pakket: bron-URL is herkomstmetadata; alleen lokaal aangeleverde gecontroleerde bytes tellen.
