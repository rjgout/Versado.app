# Rechten en inhoud van de vaste CFM-testdataset

Dit is uitsluitend een netwerkloze kopie van de exact gepinde CI-bronbestanden.
De bestanden worden niet geïmporteerd in productie, niet als nieuwe lessen
gepubliceerd en niet onder de softwarelicentie heruitgegeven.

- **OTB:** Open Translation Bible, `OpenTranslationBible/open-bible`, commit
  `31d411ac1c2d277242a3bd85697f354eaa11526b`, Nederlandse editie. De 929 bestanden
  zijn ongewijzigd overgenomen en gecontroleerd met hun bestaande Git-blobhashes.
  Copyright/toeschrijving aan de OTB-bijdragers; CC BY-SA 4.0. Zie de ongewijzigde
  [licentietekst](OTB-LICENCE.md), opgehaald op exact die commit, en
  <https://creativecommons.org/licenses/by-sa/4.0/>. Eventuele bewerkingen van
  deze OTB-inhoud moeten dezelfde licentie houden. De andere bestanden in dit
  archief krijgen hierdoor geen CC BY-SA-licentie.
- **CFM-afbeeldingen:** oorspronkelijke rechten bij The Church of Jesus Christ
  of Latter-day Saints en de in de officiële lessen genoemde rechthebbenden.
  Geen nieuwe algemene herdistributielicentie toegekend. Gebruik binnen Versado
  berust op de bestaande expliciete eigenaarverklaring van volledige tekst- en
  mediarechten in `docs/CFM-DOORLOPEND.md` §8; de schriftelijke toestemming wordt
  administratief buiten de repository bewaard en is hier niet zelfstandig
  juridisch geverifieerd. Bronidentiteiten, oorspronkelijke bijschriften en
  rechthebbenden blijven in de bestaande officiële lessnapshots behouden.

De repository is publiek; deze dataset dus ook. Het archief bevat uitsluitend
publieke broninhoud, geen productie-export, accounts, tokens of gebruikersdata.
Archief en pins zijn reviewbare bronbestanden, geen veranderlijke Actions-cache
of anonieme externe mirror. De nieuwe broncontrole accepteert nooit afwijkende
bytes en schrijft geen nieuwe pins.

`pinned-assets.lock.json` bevat de SHA-256 en grootte van het gecomprimeerde
JSON/base64-archief. De consumer controleert daarnaast de volledige ledenlijst
én alle individuele bestaande bronhashes/groottes. Uitpakken is begrensd tot
96 MiB; ieder bestand tot 10 MiB. De officiële import behoudt daarnaast zijn
normale afbeeldingsdecodering, afmetingen-, rechten- en publicatiecontroles.

Opnieuw bevriezen is een expliciete maintaineractie ná bron-/rechtencontrole:

```sh
CFM_TEST_ASSETS=/tmp/eigen-volledig-gevalideerde-cache \
  node scripts/study-content/freeze-cfm-test-assets.mjs
```

Dit commando downloadt niets, herstelt geen verkeerde hashes en weigert een
ontbrekend/beschadigd origineel. Archive- of pinwijzigingen horen altijd in een
gewone reviewbare PR; geen productieactie of stilzwijgende goedkeuring.
