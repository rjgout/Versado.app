# Versado Schriftillustraties

216 afzonderlijke scènes vervangen de bestaande `public/kids/images/story-N-K.jpg`-bestanden. De 54 verhalen, vier beelden per verhaal en alle bestaande afbeeldingsadressen blijven behouden. `kidsManifest.json`, puzzelindices, antwoordwaarden, oefenings-ID’s en gebruikersvoortgang veranderen niet. Er is geen database-aanpassing of herimport nodig.

De nieuwe JPEG-bestanden zijn 1200 × 800, kwaliteit 88, zonder transparantie. Native PNG-masters (1536 × 1024), compacte WebP-exports, volledige prompts en brononderzoek worden afzonderlijk geleverd; grote productiemasters staan niet in Git. Elk puzzelbeeld is één doorlopende scène. Puzzels 53–56 zijn vier afzonderlijke gebeurtenissen, geen collage.

`scene-manifest.json` bevat de bestaande index, URL, bestandscontrolewaarde, scènebron en gebruikte personageversies. Gebruik `character-registry.json` voor vervolgillustraties: dezelfde persoon behoudt dezelfde master. Front-, driekwart- en zijaanzichten en uitdrukkingen zijn aanvullende referenties; de primaire master blijft leidend. Leeftijdsvarianten zijn expliciet geregistreerd. Naamloze personen behouden een rolnaam. Het uiterlijk is een artistieke Versado-keuze en geen historische claim.

De negen bestaande personagemasters blijven byte voor byte behouden en worden via hun bestaande repositorypad hergebruikt. Nieuwe masters en referentiebladen zijn als WebP opgenomen onder `public/scripture/characters/`. Alleen assets waarvan `transparentBackground` waar is, zijn losse cutouts met echte transparantie.

Controle: alle 216 bronbeelden, gekozen scènes, kleine weergaven en 48-stukkenrasters zijn bekeken; alle scènebestanden zijn uniek. De referentiebladen mogen meerdere aanzichten bevatten, puzzelbeelden niet. Bron: de klassieke officiële verhalenreeks van het Boek van Mormon, aangevuld met het officiële PDF voor de vier geselecteerde scènes uit hoofdstuk 22. De illustraties zijn nieuwe composities; bestaande verhaaltekst is niet gewijzigd.

De productiearchieven bevatten ook overzichtsbladen. Samenvoegen en uitrollen gebeuren via de gebruikelijke repositoryprocedure nadat de controles op de pull request zijn geslaagd.
