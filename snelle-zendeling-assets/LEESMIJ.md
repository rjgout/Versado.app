# Snelle Zendeling — losse assetbibliotheek

## Productiebestanden

- Zes mascottesprites in assets/mascots: ieder 1254 × 1254 pixels met echte transparantie, naar rechts gericht. Glide en boost gebruiken per personage dezelfde schaal. De alfagewogen middelpunten zijn op (627, 627) uitgelijnd, binnen één pixel afronding. masters bevat de onbewerkte hoge-resolutie generatiebestanden.
- Twee losse obstakels in assets/obstacles: beide exact 384 pixels effectieve breedte. De muur begint bij de bovenrand (onderste obstakel), de rots eindigt bij de onderrand (bovenste obstakel). Hoogtes verschillen; schaal proportioneel op de vaste gameplaybreedte. De twee aanvullende stem-texturen zijn uitsluitend bedoeld om het rechte gedeelte buiten het zicht te verlengen, zonder het uiteinde of de openingsrand te rekken.
- Vier onafhankelijke achtergrondlagen: lucht, verre heuvels, verre stad, landschap. Zelfde canvas 2172 × 724. Alleen de lucht is volledig ondoorzichtig; de andere lagen hebben echte transparantie.
- Een afzonderlijke lage voorgrondstrook in assets/foreground. Plaats hem uitsluitend langs de onderste schermrand en onder de obstakels in de tekenvolgorde, zodat de muur zichtbaar blijft. Beperk zichtbare hoogte tot circa 8% van het scherm.

## Plaatsing en gameplay

Gebruik voor beide poses hetzelfde middelpunt en dezelfde renderschaal. Het manifest bevat pivots, afmetingen, gemeten middelpunten en zichtbare grenzen. Novi is bewust wat kleiner geëxporteerd; zijn jonge lichaamsverhoudingen blijven behouden.

Gebruik één vaste obstakelbreedte, één vaste openingshoogte en één vaste afstand tussen obstakelparen. Alleen de verticale positie van de opening verandert. Positioneer muur-top bij de onderrand van de opening; rots-onderkant bij de bovenrand. De opening zit nooit in een afbeelding. De twee obstakels mogen niet onafhankelijk in breedte worden geschaald. Collision gebruikt de vaste rechthoekige gameplaybreedte; decoratieve afronding is geen aparte hitbox.

Zorg dat de lange delen tot voorbij de schermrand doorlopen; verleng indien nodig met de losse stem-texturen. Teken de muur/rotsuiteinden zonder verticale vervorming. De engine bepaalt de uiteindelijke hitbox en moet die bij integratie in-game controleren.

## Scrolling

De vijf wereldlagen zijn visueel vrijwel naadloos horizontaal herhaalbaar. Dit is geen pixel-exact naadloosheidsgarantie: de gemeten gemiddelde randverschillen staan in manifest.json. Voor helemaal onzichtbare rasterovergangen kan de renderer 8–16 pixels tussen herhalingen overlappen met een zachte alpha-overgang. De stad heeft transparante zijranden en sluit daar exact aan. Geen samengestelde wereld of gameplay-screenshot wordt geleverd.

Tekenvolgorde: lucht → heuvels → verre stad → landschap → optionele lage voorgrond → obstakels → mascotte. Voorgestelde parallaxfactoren staan in het manifest, de spel-engine mag deze aanpassen.

## Herkomst en controle

Beeldcreatie en pose-aanpassingen: ingebouwde imagegen, met officiële Varo-, Vera- en Novi-character sheets als primaire visuele bron. Geen zendelingenkleding of vlieguitrusting toegevoegd; Varo's rugzak is op verzoek weggelaten. Technische export: proportioneel schalen, transparant canvas en uitlijning; geen hertekening van het personage. Promptset is inbegrepen, inclusief boost-prompts.

Gecontroleerd: identiteit en silhouet, kleine weergave, poseparen naast elkaar en als snelle wissel, echte alpha, gelijke effectieve obstakelbreedte en rustige losse wereldlagen. De bibliotheek bevat uitsluitend losse beelden en plaatsingsgegevens, geen UI of game-implementatie.
