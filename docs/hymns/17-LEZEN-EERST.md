# 17. Lezen heeft altijd voorrang

Lofzangen is in de eerste plaats een digitaal zangboek met optionele, intelligente synchronisatie. Een gebruiker mag
nooit afhankelijk zijn van muziekherkenning of synchronisatie om de tekst comfortabel te lezen. Als de synchronisatie
volledig faalt, moet de hele lofzang nog steeds zonder frustratie te lezen en te zingen zijn.

## Gedrag

| Situatie | Wat er gebeurt |
|---|---|
| Lofzang zelf gekozen | De volledige tekst staat er direct; coupletknoppen werken meteen; er wordt nergens op herkenning of "Zang begint" gewacht. |
| "Start luisteren" op een gekozen lofzang | De lofzang is al bekend: geen herkenning, de engine volgt direct de muzikale positie (ook in het voorspel). Er wordt pas een woord gemarkeerd bij een betrouwbaar zangbegin of na "Zang begint". |
| Voorspel | De tekst is leesbaar en bladerbaar; er wordt geen gezongen woord gemarkeerd; het voorspel telt niet als couplet. |
| "Herken lofzang" | De microfoon start meteen. De herkenningsgegevens komen er tijdens het luisteren bij en de engine loopt dan het geheugen door: het begin van het voorspel gaat niet verloren aan het laden. "Zoek zelf op nummer of titel" staat vanaf de eerste seconde in beeld. |

## Twee onafhankelijke posities

- **MusicalPosition**: waar de muziekengine is (`snapshot.cursor`, `snapshot.stanza`). Alleen de engine zet die.
- **ReadingPosition**: welk couplet en welke regel de gebruiker leest (`src/components/hymns-poc/reading.ts`).

In de stand **auto** volgt de leesplek de muziek (couplet, actieve regel, meescrollen). Zodra de gebruiker zelf scrolt
(aanraking, wiel, toetsen), een regel aantikt, vorige/volgende regel kiest of tijdens het meeluisteren een couplet kiest,
staat de stand op **manual** ("Zelf bladeren"). Dan pauzeert alleen de automatische tekstnavigatie (couplet tonen en
scrollen). De microfoon, de engine, de status en de muzikale positie lopen ongestoord door; de muziek overschrijft de
leesplek nooit en er is nooit een automatische terugscroll.

Een coupletkeuze tijdens handmatig lezen verandert alleen de leesplek (de strook toont "Muziek: couplet N" als de muziek
elders is). Buiten handmatig lezen blijft een coupletkeuze een correctie voor de engine, zoals voorheen.

## Hervatten

"Automatisch volgen hervatten" vraagt `resumeVerdict` (reading.ts): alleen bij `locked`/`recovered`, in de zang met een
stabiele, niet vastgezette regel (en in voorspel of tussenspel, waar niets te springen valt), en niet bij een mogelijk
gemiste ronde terwijl de gebruiker in een ander couplet leest dan de engine. Dan sluit de weergave rustig aan op de
actuele muziekregel (zacht scrollen, tenzij de rustige kerkweergave of verminderde beweging aan staat). Bij onzekerheid,
verlies of "nog aan het zoeken" blijft de leesplek staan, komt er een korte melding ("lees gerust zelf verder") en gebeurt
er niets anders.

Verliest de engine tijdelijk zijn regel (onzeker, tussenspel, opnieuw synchroniseren), dan blijft in karaoke de laatst
bekende regel de focus (`nextSticky`): geen sprong terug naar het begin.

## Weergaven

- **Volledig couplet**: alle regels onder elkaar, de muziekregel subtiel gemarkeerd, de leesregel (aangetikt) met een lichte achtergrond.
- **Karaoke per regel**: hetzelfde verticale zangboek met één grote regel (de muziekregel of tijdens bladeren de leesregel) op ongeveer 40% van de hoogte; alle regels blijven leesbaar, scrolbaar en aantikbaar. Dit werkt zonder luisteren en zonder werkende synchronisatie.
- De weergavewissel is altijd mogelijk, ook zonder microfoon, en bewaart de leesregel en de stand.
- Bediening: vorige/volgende regel en, tijdens bladeren, "Zelf bladeren" + "Automatisch volgen hervatten" staan in dezelfde bedieningszone als Start/Stop (nooit over de tekst heen). Alle aanraakdoelen zijn minstens 44 px.

## Herkenningssnelheid

De drempels zijn ongewijzigd (docs 12). Wat sneller werd, is de ruimte eromheen: de microfoon wacht niet meer op het laden van de
herkenningsgegevens (de engine speelt het geheugen daarna af; gemeten: hetzelfde herkenningsmoment als wanneer de gegevens er vooraf waren,
`tests/hymns-reading.test.ts`), de tekst van de waarschijnlijkste lofzang wordt alvast in het lokale geheugen geladen, en zelf zoeken staat
altijd klaar. Een zeer kort voorspel bevat soms te weinig muziek voor een zekere herkenning; dan blijft dat zo en staat zoeken op nummer of titel voorop.

## Tests

- `tests/hymns-reading.test.ts`: de leesstand, de hervattoets, de selectors, de echte engine (muziek loopt door tijdens handmatig lezen, verloren synchronisatie, hervatten) en het uitgestelde laden van herkenningsgegevens.
- `scripts/hymns/e2e-reading.mjs` (Chromium met aanraakemulatie, nep-microfoon): lezen zonder microfoon, voorspel, aanraakgebaar en wiel, geen terugscroll, aantikken, vorige/volgende, couplet- en weergavewissel tijdens bladeren, hervatten, onzekere synchronisatie, 390x844, 320x568 en landscape 844x390 met grote tekst. Dit is GEEN bewijs voor iPhone-Safari of een WKWebView.
- De bestaande muziek-, privacy- en layouttests blijven ongewijzigd gelden.

## Beperkingen

- Aanrakingen zijn in Chromium geëmuleerd; echt gedrag van iOS-Safari (momentumscroll, adresbalk) en Android-systeemgebaren is niet gemeten.
- Een scrollgebaar met de scrollbalk van een desktopbrowser (slepen) is niet te onderscheiden van een programmatische scroll; wiel, toetsen en aanraking wel.
- De hervattoets gebruikt de status van de volger; of die status in een echte kerk even betrouwbaar is als in de tests, is onbekend.
