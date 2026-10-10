# Legpuzzel 2.0 — productspecificatie

## Vastgelegd

**VOORGESTELD:** één vrije legpuzzelervaring met losse stukken, geldige verbindingen en verplaatsbare groepen. Voltooid betekent één groep in canonieke geometrie; een geldige verbinding blijft vast. Zoom en pan zijn altijd beschikbaar en persoonlijk, nooit een hint.

Een variant is minimaal `(puzzleContentId, pieceCount, difficulty, geometryVersion, rulesVersion)`. Alleen dezelfde variant is vergelijkbaar voor records en wedstrijden.

| Niveau | Permanent | Snapping/hulp | Rotatie/hints |
| --- | --- | --- | --- |
| Ontdekker | transparant voorbeeld, contouren | ruim, randfilter | geen / onbeperkt |
| Avonturier | buitencontour | normaal, voorbeeld op verzoek, randfilter | geen / 3 |
| Expert | buitencontour | nauw, voorbeeld/filter via hint | alleen na UX-validatie / 2 |
| Meester | geen | nauw, beperkt | vereist / 1 |

Hint A toont vijf seconden voorbeeld; B markeert doelpositie geselecteerd stuk; C een echte complementaire buur; D filtert persoonlijke bak tijdelijk. Extra hints blijven mogelijk en worden geregistreerd. `extraHintsUsed` is zichtbaar in record/ranglijst en staat onder een gelijkwaardige hulpvrije tijd. **Deze paragraaf beschrijft de toekomstige herintroductie; hints zijn in de actieve fase-2 Solo-interface bewust uitgeschakeld.**

## Fase-2-correctie: huidige solo-ervaring

**BEVESTIGD (correctieronde):** de actieve Solo-interface heeft geen hints,
filters, permanente zoomknoppen of losse stukjesbak. Onder de vaste
terugbalk vult één begrensd Canvas-bord de beschikbare focusruimte. Een
discreet bordmenu bevat alleen `alles passend tonen` en `andere puzzel
kiezen`; bij Meester verschijnt draaien uitsluitend contextueel na selectie.
Hints blijven als geïsoleerd toekomstig datacontract bestaan, maar de v2 API
accepteert geen hintactie zolang ze niet opnieuw productmatig zijn ingevoerd.

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

Mobiel en desktop gebruiken één eindige werktafel: een herkenbaar centraal
puzzelgebied met daaromheen vrije, directe ruimte voor losse stukken en
groepen. Er is geen tweede permanente stukjesbak en geen dubbele representatie
van stukken. De startverdeling is deterministisch, niet-overlappend en schaalt
tot 96 stukken. De camera past de volledige tafel in beeld en kan niet buiten
de bruikbare wereld raken. Direct drag gebruikt een vinger-offset; twee vingers
schakelen veilig naar pan/pinch. Muisdrag, cursorzoom, trackpad/wiel,
plus/min/fit/reset en een toetsenbordpad gebruiken dezelfde world-coördinaten.
Gebruik één shell/focusmodel uit `docs/LAYOUT.md`.

Solo bewaart automatisch, behoudt vraag en huidige regel: alleen correct antwoord verlengt reeks, nooit XP. Samen: rechtstreekse vriendenuitnodiging, maximaal vier, gedeelde voortgang, persoonlijke bak/viewport/hints. Alleen server-gevalideerde nieuwe verbinding is betekenisvolle bijdrage; uitnodiging, openen, presence en lock nooit. Per volgende kalenderdag kan een werkelijke bijdrage opnieuw volgens centrale reeksregels tellen. Vraag is optioneel en nooit voorwaarde in Samen.

Tegen elkaar geeft iedere speler dezelfde variant, eigen bord; server-eindtijd pas na oplossen én correcte verplichte vraag. Live en async delen één matchcontract; alleen start/deadline verschillen. Vriendenranglijst toont uitsluitend zelf en geaccepteerde vrienden: positie, bestaande veilige avatar/handle, beste geldige tijd en hintlabel. Ties: minder extra hints, minder hints, eerdere voltooiing, stabiel id.

Nieuwe zichtbare uitleg loopt via Kompas, met alle vertalingen. Geen groepsstart voor Samen en geen wereld- of groepsranglijsten.

De renderer geeft een rustige magnetische snap, geldige-verbindingfeedback en tijdelijke hintmarkering; bij voltooiing verdwijnen de naden en verschijnt eerst de bestaande resultaat/vraagflow, pas daarna een eventuele secundaire viering via `celebrationGate.ts`. Geluid is opt-in via bestaande instellingen zodra die voor spellen beschikbaar zijn; reduced motion zet beweging om naar directe, leesbare statusfeedback. Er wordt geen zelfstandig designsysteem toegevoegd: `--vs-*`-tokens, Lucide en de bestaande shell blijven leidend.
