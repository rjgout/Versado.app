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

Hint A toont vijf seconden voorbeeld; B markeert doelpositie geselecteerd stuk; C een echte complementaire buur; D filtert persoonlijke bak tijdelijk. Extra hints blijven mogelijk en worden geregistreerd. `extraHintsUsed` is zichtbaar in record/ranglijst en staat onder een gelijkwaardige hulpvrije tijd.

## Modes en acceptatie

Mobiel: safe-area-veilige focuskop, groot veld, native horizontaal scrollbare bak, direct drag met vinger-offset, feedback, edge-autopan; twee vingers zonder vast stuk pannen/pinchen. Desktop: centraal veld, zijbak, muisdrag, cursorzoom, trackpad/wiel, pan, +/-/fit/reset. Keyboard biedt dezelfde plaatsactie. Gebruik één shell/focusmodel uit `docs/LAYOUT.md`.

Solo bewaart automatisch, behoudt vraag en huidige regel: alleen correct antwoord verlengt reeks, nooit XP. Samen: rechtstreekse vriendenuitnodiging, maximaal vier, gedeelde voortgang, persoonlijke bak/viewport/hints. Alleen server-gevalideerde nieuwe verbinding is betekenisvolle bijdrage; uitnodiging, openen, presence en lock nooit. Per volgende kalenderdag kan een werkelijke bijdrage opnieuw volgens centrale reeksregels tellen. Vraag is optioneel en nooit voorwaarde in Samen.

Tegen elkaar geeft iedere speler dezelfde variant, eigen bord; server-eindtijd pas na oplossen én correcte verplichte vraag. Live en async delen één matchcontract; alleen start/deadline verschillen. Vriendenranglijst toont uitsluitend zelf en geaccepteerde vrienden: positie, bestaande veilige avatar/handle, beste geldige tijd en hintlabel. Ties: minder extra hints, minder hints, eerdere voltooiing, stabiel id.

Nieuwe zichtbare uitleg loopt via Kompas, met alle vertalingen. Geen groepsstart voor Samen en geen wereld- of groepsranglijsten.

De renderer geeft een rustige magnetische snap, geldige-verbindingfeedback en tijdelijke hintmarkering; bij voltooiing verdwijnen de naden en verschijnt eerst de bestaande resultaat/vraagflow, pas daarna een eventuele secundaire viering via `celebrationGate.ts`. Geluid is opt-in via bestaande instellingen zodra die voor spellen beschikbaar zijn; reduced motion zet beweging om naar directe, leesbare statusfeedback. Er wordt geen zelfstandig designsysteem toegevoegd: `--vs-*`-tokens, Lucide en de bestaande shell blijven leidend.
