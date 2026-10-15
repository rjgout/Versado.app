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
bestaande tabgebonden terugkeer naar de les. `ReferencePreview`,
`ReadingPosition` en de bestaande terugkeerflow zijn ongewijzigd. Openen,
sluiten en navigeren registreren geen READ, XP, reeks, cursusvoortgang of
andere beloning.

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

## Validatie en uitrol

De unit- en geïsoleerde PostgreSQL-tests controleren Nederlandse labels,
genummerde boeken, versbereiken, exacte collectie/edition-binding, verborgen
toegang en het hoofdstukanker. Bestaande preview- en terugkeertests bewaken
de generieke dialoog- en navigatieflow.

Er is geen Prisma-migratie. Uitrol is een gewone applicatiedeploy; rollback is
terug naar de vorige appimage. Omdat de wijziging geen persistente data
schrijft, blijven bestaande content, voortgang en annotaties onaangetast.
