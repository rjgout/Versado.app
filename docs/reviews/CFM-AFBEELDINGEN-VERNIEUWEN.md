# Review: actuele CFM-afbeeldingen zonder historische byteblokkade

Basis: develop `0ac6e1e0b2b19e82cfff86fa284082ebd3dc5563`. Uitsluitend PR B;
het native studiemaptransport staat onafhankelijk in PR #302.

## Oorzaak en besluit

De officiële beeldendienst levert andere JPEG-bytes dan de oude media-locks.
De eerdere audit vond dezelfde veertien afwijkingen lokaal en in CI; zeven oude
originelen ontbraken. De eigenaar heeft het verplichte terugzoeken en pinnen van
historische afbeeldingsbytes expliciet vervangen door gecontroleerd opnieuw
 downloaden. De les- en OTB-tekstpins blijven ongewijzigd.

De echte databaseproef wees daarnaast uit dat `ContentMedia_immutable` en
`StudyRevisionMedia_immutable` alle veranderingen aan bronmetadata/koppelingen
verbieden. Alleen applicatiecode wijzigen zou hierdoor iedere vervanging terugrollen.
Daarom is één nieuwe, beperkte migratie noodzakelijk. Geen historische migratie is
gewijzigd; er zijn geen nieuwe tabellen, kolommen of opslagdiensten.

## Implementatie en grenzen

- De bestaande downloader doet HTTPS, publieke DNS/IP-controle tegen SSRF, beperkte
  redirects/hosts, HTTP 200, timeout, 10 MiB, MIME/magic bytes en volledige decode.
  Alleen exact geregistreerde CFM-bron-URL’s mogen zonder historische downloadhash.
- Quarantaine en de bestaande atomische installatie blijven leidend. Vervolgens
  wisselt een transactie uitsluitend CFM-mediakoppelingen naar de gevalideerde
  READY-versie. Oudere bestanden/records blijven behouden. Een corrupte huidige
  file kan via de bestaande atomische reparatie worden hersteld.
- De huidige opgeslagen checksum blijft verplicht tegen opslagcorruptie. Zij wordt
  niet met de historische CDN-bytepin vergeleken. Bestaande revisies krijgen geen
  nieuw lichaam of hash; een begrensde checksumhistorie in bestaande bronmetadata
  bewaart de automatische bronkoppeling bij latere vervangingen.
- Databaseguards staan alleen CFM 2026/2027, dezelfde officiële bron, dezelfde
  rechten en hetzelfde volume toe. Revisie-ID/mediaKey kunnen niet veranderen.
  Niet-CFM, teksten, oorspronkelijke media-identiteit, rechten en verwijderingen
  blijven beschermd. Rasterresolutie mag binnen veilige grenzen wijzigen; de
  bestaande documentlayout verandert niet.
- Beheerrechten worden na download opnieuw gecontroleerd. Per bron/hash wordt
  onder bestaande advisory locks gecommitteerd. Fouten behouden de oude koppeling;
  gedeeltelijke vernieuwing wordt expliciet gerapporteerd. Geen onzeker schrijfretry.
- De bestaande content-invalidatie ververst web/native-caches na gewijzigde media.
- De bestaande aparte beheeractie vernieuwt alleen afbeeldingen; geen seed,
  lesimport, herpublicatie, zichtbaarheid, XP of voortgang. De gewone contentupdate
  vernieuwt beelden en behoudt haar bestaande append-only les-/publicatieregels.
- Oude kandidaat-/snapshotbediening is vervangen. De bijbehorende historische-
  bytevoorwaarden in de integratietest zijn vervangen door echte vervangings-,
  rechten-, rollback-, concurrency- en overige-programma-immutabiliteitsproeven.

## CI en bestaande PR’s

`prepare-cfm-test-assets.mjs` genereert 723 deterministische synthetische
 afbeeldingsinputs; geen externe beeldendienst in gewone CI. De 929 OTB-hoofdstukken
blijven exact op hun gepinde Git-blobhash gecontroleerd. Media-locks en OTB-/CFM-
bronbestanden worden niet aangepast. De echte downloader wordt afzonderlijk getest.

De nieuwe migratie wordt in de gefaseerde contentrunner pas na de bestaande
studie-/publicatietabellen toegepast. De Audio V2-runner bevat deze tabellen al in
zijn eerste fase; zijn volledige schone/gefaseerde verificatie blijft verplicht.
De bestaande Native Foundation-stap voert de vernieuwde mediaproeven uit; geen
nieuwe matrix, extra workflow of dubbel testjob toegevoegd.

#237 heeft als belangrijkste doel vaste, historisch gepinde afbeeldingen en is
hierdoor niet meer de te mergen oplossing voor dit probleem. #293 blijft nuttige
historische diagnose. Beide PR’s blijven ongemoeid; geen hashes of archief uit
#237 overgenomen. Gecontroleerde fixtures worden nu zonder nieuwe binaire dataset
gegenereerd. OTB-integriteit is niet ingeruild voor synthetische tekst.

## Uitgevoerd bewijs en resterende acceptatie

Exacte resultaten, definitieve head en GitHub-status staan in de PR-beschrijving.
De verificatie gebruikt eigen tijdelijke PostgreSQL-databases/volumes, echte
serverhandlers en browserproeven; geen NAS, productie-import of bronpublicatie.
De finale keten bevat productiebuild/TypeScript/lint, CFM-2026/2027, bron-/persoonlijke-
studie/publicatie-units, nieuwe vervanging/rollback/rechtenproeven, beveiliging en
Audio V2 inclusief gelijke migratiechecksums op een schone en gefaseerde installatie.

Alle veertien eerder officieel gedownloade actuele JPEG-monsters worden geaccepteerd;
ook hercompressie, beschadigde data, HTTP/netwerkfouten en veilige opslag zijn getest.
Deze cloudmachine geeft bij directe HTTPS naar de bron `ECONNREFUSED`, met publieke
DNS-adressen. Veertien nieuwe live pogingen zijn dus **geen** groene netwerkproef.
De HTTPS-transportimplementatie is niet gewijzigd. Geen proxy-/SSRF-/TLS-omweg
geïntroduceerd om dat omgevingsprobleem te verbergen.

De eigenaar voert na review en goedgekeurde uitrol de echte backenddownload uit.
Voor de code-PR zijn geen oude NAS-originelen meer nodig. Fysieke iPhone/Android-
acceptatie en uitrol blijven afzonderlijk; er is geen signingbuild, upload of merge
uitgevoerd. Zie [bediening en rollbackgrens](../CFM-VEILIG-HERSTEL.md).
