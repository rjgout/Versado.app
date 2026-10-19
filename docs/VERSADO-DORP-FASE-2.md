# Versado Dorp — fase 2

## Deel A: interactie en wereldkaart

Basis: main `dfb611cf` (PR #147), Canvas2D en de bestaande Work Fix-01-assets.
Geen nieuwe engine of afbeeldingen. Eigendom/levels en plaatsingen blijven gescheiden.

- Paden: gratis penseel met tikken/slepen en aparte wisstand. Vierverbonden interpolatie voorkomt gaten bij snelle bewegingen. Alleen geldige cirkelcellen; geen inventarislimiet. Eén burenindex per render en één padindex per commit. Paden blijven onder objecten en blokkeren geen footprints.
- Direct verplaatsen: selectie, bewegingsdrempel en anker-offset; loslaten valideert de bestaande collisionregels. Cancel, verloren pointercapture, pinch of ongeldige bestemming behouden het oorspronkelijke object. De aparte plaatsingsknoppen blijven als alternatief.
- De vijf bestaande bewoners zijn echte inventarisobjecten met één cel. Ze beginnen opgeborgen: de oude vaste bewonerposities overlapten bestaande gebouwen. Geen willekeurige herplaatsing.
- Lokale opslag v3 leest v2 compatibel: oude object-ID's, levels, plaatsingen en paden blijven; uitsluitend de vijf nieuwe bewonerrechten worden toegevoegd. v1 blijft expliciet ongeschikt. Deze lokale proefrechten worden niet geïmporteerd in toekomstige serverinventaris.
- Pan verbergt secundaire bediening; de expliciete bedieningsknop brengt haar terug. Weergaven staan in een compacte uitklapper. De normale startzoom is 0,36. Het geselecteerde grondvlak wordt vóór de gevel getekend.
- Het overzicht gebruikt dezelfde cirkelcellen, paden, objecten en bosrand; geen fictieve plattegrond.

### Feitelijke verificatie deel A

- `npm run test:dorp`: 48 geslaagd, 0 overgeslagen.
- TypeScript en gerichte ESLint: geslaagd.
- i18n-controle: geslaagd; bestaande vertaalachterstand 3992/4410 in en/de/fr/es, geen nieuwe ontbrekende dorpteksten.
- Schone productiebuild geslaagd; gepushte CI wordt op de exacte head gecontroleerd.
- Echte Chromium-productiebuild op eigen PostgreSQL: 8 combinaties (320×844, 390×844, 844×390, 1280×900; licht/donker). Padstreek en bewonersplaatsing, geen horizontale overflow of browserexceptions.
- Browserbewijs in `/tmp/versado-dorp-browser`, tevens CI-artifact. Geen fysieke iPhone/Android-test geclaimd.

### Grenzen

Dit eerste deel behoudt de admin-only devroute en lokale prototypeopslag. Serverwerelden, groepsrechten en sociale economie volgen in de afhankelijke wijziging. Geen productie- of NAS-actie, merge of deployment. De wereldgroei in deze devroute blijft een testfixture, geen werkelijk verdiende voortgang.
