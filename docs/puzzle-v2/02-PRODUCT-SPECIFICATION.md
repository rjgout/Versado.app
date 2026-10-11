# Legpuzzel 2.0 — productspecificatie

## Vastgelegd

**Fase 2, rulesVersion 2:** één fullscreen Solo-ervaring met losse stukken,
geldige verbindingen en verplaatsbare groepen. Vrij puzzelen voltooit met één
bewezen verbonden groep. Op eenvoudige niveaus geldt ook volledige geldige
bordverankering, onafhankelijk van de volgorde van plaatsingen. Zoom en pan
blijven op ieder niveau beschikbaar en kosten geen hint.

Een variant is minimaal `(puzzleContentId, pieceCount, difficulty, geometryVersion, rulesVersion)`.
Stukaantal (6/12/24/48/96) is onafhankelijk van moeilijkheid. Alleen dezelfde
variant is vergelijkbaar voor toekomstige records en wedstrijden.

| Niveau | Permanent | Stukken / bord | Rotatie / inbegrepen hints |
| --- | --- | --- | --- |
| Ontdekker | transparant voorbeeld, buitencontour | onderling + bordverankering | geen / onbeperkt |
| Avonturier | buitencontour | onderling + bordverankering | geen / 3 |
| Expert | geen oplossingsvlak of contour | uitsluitend onderling | geen / 2 |
| Meester | geen oplossingsvlak of contour | uitsluitend onderling | vereist / 1 |

Alle nieuwe niveaus gebruiken dezelfde stuk-snapafstand (.36 world-unit).
Verankerde groepen blijven liggen, maar kunnen via passende buren groeien.

## Fase-2-interface en hints

Onder de vaste terugbalk vult één begrensd Canvas de beschikbare focusruimte.
Geen permanente toolbar of stukjesbak. Het menu rechtsonder bevat `Hint
gebruiken`, `alles passend tonen` en `andere puzzel kiezen`. Contextueel draaien
staat linksonder bij Meester. Beide knoppen zijn minimaal 60×60 CSS-pixels met
26px-iconen; veilige randen, text scaling en reduced motion blijven behouden.

Het hintpaneel is een modal sheet in de bestaande Versado-stijl, met beide
budgetten bovenaan: Inbegrepen en Mijn voorraad. PREVIEW toont vijf seconden
de volledige afbeelding; LOCATION markeert de canonieke plek van de selectie;
CONNECTION markeert één echte externe buur; FILTER benadrukt hoek-, rand- of
middenstukken op hun huidige positie. Alle hulp is vijf seconden tijdelijk en
maakt geen plaatsing/verbinding aan. Eerst geldt het inbegrepen sessiebudget.
Daarna kost iedere hint, na bevestiging, exact één persoonlijke hint uit
`User.hintBalance`. Zonder voorraad wordt geen hint gegeven en biedt de sheet
de bestaande winkel aan. Ontdekker gebruikt nooit persoonlijke hints.
Sorteerhulp openen kost niets; uitsluitend Hoek/Rand/Midden is een hintactie.
Historische hints blijven ongewijzigd en veroorzaken geen afschrijving achteraf.
Extra hints blijven herkenbaar voor latere records; er wordt nu geen ranglijst
gebouwd. Locatie- en verbindingshints behouden zoom en pannen alleen minimaal
naar een onzichtbaar doel. De sheet sluit met Escape, houdt focus binnen en
maakt het bord tijdelijk inert; sluiten herstelt focus naar de vaste menuknop.
Primaire Solo-CTA’s zijn lokaal volle breedte, maximaal 440px en minimaal 48px.
Hints hebben geen invloed op de reeks of XP. Tijdelijke targets en hun absolute
vervaltijd zijn opgeslagen; herladen speelt uitsluitend de resterende tijd.

Bestaande rulesVersion-1-sessies hervatten met hun eerdere ondersteuning en
snapafstand, zonder bordverankering. Het menu vermeldt dit. Historische hints,
filters, antwoorden en records worden niet herschreven; oude filters zijn geen
permanente UI meer. Een nieuwe poging na afronding gebruikt rulesVersion 2.

Nieuwe sessies gebruiken geometryVersion 2 met traditionele afgeronde
tab-/slotverbindingen. Sessies met geometryVersion 1 behouden hun bestaande
golvende definitie; de nieuwe definition-key voorkomt stille vormwijziging.

Na de laatste verbinding toont de activiteit eerst een volledige, naadloze
afbeelding en een knop `Verder`. Pas daarna staat de inhoudelijke vraag op
een afzonderlijke focusstap. Een eerdere antwoordclaim voor dezelfde speelsessie
geeft de opgeslagen uitslag terug, zonder opnieuw te belonen. Een nieuwe poging
mag dezelfde vraagcontent opnieuw beantwoorden; haar geldige voltooiing loopt
door de centrale activiteit- en kalenderdagregels. Puzzelen geeft geen XP.

## Modes en acceptatie

Mobiel en desktop gebruiken één eindige werktafel: een centrale puzzelzone (alleen op de eenvoudige niveaus zichtbaar) met daaromheen vrije, directe ruimte voor losse stukken en
groepen. Er is geen tweede permanente stukjesbak en geen dubbele representatie
van stukken. De startverdeling is deterministisch, niet-overlappend en schaalt
tot 96 stukken. Het speelviewport vult het scherm onder de gemeten terugbalk,
met veilige randen. De startcamera toont bruikbare stukken en bestaande groepen;
alle stukken tegelijk zien kan via het bordmenu. Viewportwijzigingen behouden
zoom en wereldmidden. De camera kan niet buiten de bruikbare wereld raken. Direct drag gebruikt een vinger-offset; twee vingers
schakelen veilig naar pan/pinch. Muisdrag, cursorzoom, trackpad/wiel,
het bordmenu en een toetsenbordpad gebruiken dezelfde world-coördinaten.
Gebruik één shell/focusmodel uit `docs/LAYOUT.md`.

Solo bewaart automatisch, behoudt vraag en huidige regel: alleen correct antwoord verlengt reeks, nooit XP. Samen: rechtstreekse vriendenuitnodiging, maximaal vier, gedeelde voortgang, persoonlijke bak/viewport/hints. Alleen server-gevalideerde nieuwe verbinding is betekenisvolle bijdrage; uitnodiging, openen, presence en lock nooit. Per volgende kalenderdag kan een werkelijke bijdrage opnieuw volgens centrale reeksregels tellen. Vraag is optioneel en nooit voorwaarde in Samen.

Tegen elkaar geeft iedere speler dezelfde variant, eigen bord; server-eindtijd pas na oplossen én correcte verplichte vraag. Live en async delen één matchcontract; alleen start/deadline verschillen. Vriendenranglijst toont uitsluitend zelf en geaccepteerde vrienden: positie, bestaande veilige avatar/handle, beste geldige tijd en hintlabel. Ties: minder extra hints, minder hints, eerdere voltooiing, stabiel id.

Nieuwe zichtbare uitleg loopt via Kompas, met alle vertalingen. Geen groepsstart voor Samen en geen wereld- of groepsranglijsten.

De renderer geeft een rustige magnetische snap, geldige-verbindingfeedback en contextueel draaien uitsluitend bij Meester; bij voltooiing verdwijnen de contouren en verschijnt eerst de bestaande resultaat/vraagflow, pas daarna een eventuele secundaire viering via `celebrationGate.ts`. Geluid is opt-in via bestaande instellingen zodra die voor spellen beschikbaar zijn; reduced motion zet beweging om naar directe, leesbare statusfeedback. Er wordt geen zelfstandig designsysteem toegevoegd: `--vs-*`-tokens, Lucide en de bestaande shell blijven leidend.

Binnen Solo gaat de centrale terugbalk vanuit bord, voltooiing, resultaat en
opnieuw spelen naar de puzzelkeuze. Vanuit de vraag gaat hij naar de volledige
afbeelding met Verder. Alleen de catalogus is de uitgang naar de bovenliggende
appcontext. Resultaatteksten vieren de puzzel en vraag; reeksafhandeling blijft
server-side en krijgt geen prominente melding op deze stap.
