# Fase 3A.4 — Nederlandse OTB-verwijzingen

## Afbakening en bronbewijs

Deze aanvulling gebruikt uitsluitend de centrale `ReferenceResolver`, de
bestaande OTB-canonieke boeksleutels uit `scripts/otb/bookMapping.ts` en de
bestaande Schrifturenreader. De productie-inventarisatie van 2026-10-11 meldt
voor `old-testament` / `otb` / `nl`: 39 boeken, 929 hoofdstukken en 23.145
verzen. Er is geen productiequery, import, publicatie of databasewijziging
uitgevoerd.

De resolver accepteert uitsluitend deze exacte combinatie. Nederlandse namen,
afkortingen en de reeds bestaande sleutels (`gen` t/m `mal`) worden server-side
naar dezelfde canonieke sleutel genormaliseerd. Boeken, hoofdstukken en
versbereiken worden daarna in de toegankelijke lokale collectie opgezocht.
Een andere taal, editie of onbekend bereik krijgt geen interne preview en
wordt nooit stilzwijgend vervangen.

## Gedrag

Een bewezen doel levert het bestaande interne contract op: een begrensde
preview, `/scripture/<chapterId>#vers-<nummer>` voor **Meer lezen** en de
bestaande tabgebonden terugkeer naar de les. `ReferencePreview` krijgt alleen
een melding bij afkorting; `ReadingPosition` en de terugkeerflow blijven intact. Openen,
sluiten en navigeren registreren geen READ, XP, reeks, cursusvoortgang of
andere beloning.

Een verwijzing zonder versbereik is een hoofdstukverwijzing. Lange hoofdstukken
blijven daarom geldig: de preview toont hoogstens veertig verzen met een
duidelijke melding dat dit een voorproef is, terwijl **Meer lezen** het volledige
hoofdstuk opent. Een expliciet versbereik blijft exact; een te groot expliciet
bereik wordt veilig afgewezen. De resolver controleert bovendien dezelfde
readerlimieten van vijfhonderd verzen en 500.000 bytes, zodat een geldige link nooit
naar een door de reader geweigerde pagina wijst.

De query gebruikt dezelfde `readingAccessWhere`-voorwaarden als de gewone
reader. Verborgen, uitgeschakelde, concept- of ontbrekende OTB-collecties
geven geen tekst terug. Beheerders krijgen daarbij geen impliciet normaal
leesrecht.

## Grenzen

De CFM-2026-bronvoorbereiding bevat nog geen gecontroleerde concrete
schriftuurpassage-inventaris. Deze uitbreiding publiceert of verzint daarom
geen CFM-verwijzingen; die inventaris volgt pas met de goedgekeurde
importinhoud in fase 3B. Voor niet-OTB-edities blijft het bestaande
resolverbeleid gelden: alleen bewezen interne equivalentie, anders een
geverifieerde officiële externe bron of een veilige melding.

## Meertalige regel voor toekomstige CFM-lessen

Voor een toekomstige CFM-editie is de **taal van de lesinhoud** leidend voor
een schriftuurpreview, nooit alleen de interfacetaal. De resolver gebruikt
dezelfde canonieke passage uitsluitend in een expliciet gecontroleerde editie
van die inhoudstaal. Als meerdere edities bestaan, moet de editie bewust en
controleerbaar zijn vastgelegd; ontbreekt die, dan volgt een duidelijke
onbeschikbare uitkomst zonder stille vertaal- of editiefallback. Deze regel
voegt nog geen andere mapping, taal, import of spelmodus toe.

## Validatie en uitrol

De unit- en geïsoleerde PostgreSQL-tests controleren Nederlandse labels,
genummerde boeken, versbereiken, exacte collectie/edition-binding, verborgen
toegang en het hoofdstukanker. Bestaande preview- en terugkeertests bewaken
de generieke dialoog- en navigatieflow.

De afrondingscontrole slaagt met 18 resolver-unittests, 15 geïsoleerde
PostgreSQL-integratietests en 28 Chromium-browsergevallen. Genesis 24 (67
verzen) en Psalm 119 (176 verzen) zijn synthetisch getest op een preview van
veertig verzen én een HTTP-200-leesroute met het laatste vers. De browsermatrix
bestrijkt 320, 390 en 1280 px, landscape, licht/donker, 100/200% tekst en vijf
UI-talen. Echte mobiele toestellen zijn niet getest. Screenshots worden door de
bestaande CI als `reference-preview-browser`-artifact bewaard.

De aanvankelijk vastgelopen browserassertie draaide tegen een oudere
productiebuild zonder de afkortingsmelding. Na een schone build slaagt exact
dezelfde assertie; `--long-chapter-only` maakt dit geval afzonderlijk uitvoerbaar
via de bestaande geïsoleerde runner. TypeScript, i18n, Prisma-validatie, lint en
de schone productiebuild slagen. Lint meldt 143 bestaande waarschuwingen en
geen fouten. De bestaande PostgreSQL-client geeft een deprecatiewaarschuwing;
de foutinjectietest logt bewust een databasefout en controleert de rollback.

Er is geen Prisma-migratie. Uitrol is een gewone applicatiedeploy; rollback is
terug naar de vorige appimage. Omdat de wijziging geen persistente data
schrijft, blijven bestaande content, voortgang en annotaties onaangetast.
