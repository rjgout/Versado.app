# Lofzangen: interface bij de volledige bibliotheek

Fase 4. Bouwt op `08-MOBIELE-UX.md` (werkruimte, instellingenpaneel, bediening) en verandert daar alleen wat de bibliotheek nodig
maakt. Onveranderd en opnieuw gemeten: volledig couplet, karaoke per regel, accentkleur zonder achtergrond, voorspelherkenning,
"Zang begint", één microfoon- en AudioContext-sessie voor herkennen én volgen.

## 1. Schermen

| Scherm | Inhoud |
|---|---|
| **Kiezen** | zoekveld ("Nummer of titel") en de lijst van alle 205 lofzangen met alleen nummer en titel; onderaan "Herken lofzang". Geen technische labels in de lijst. |
| **Geopend** (lofzang gekozen, microfoon uit) | tekst klaar, coupletknoppen, "Andere lofzang" en "Start luisteren" (alleen als er gevalideerde muziek is). |
| **Alleen tekst** | lofzangen zonder gevalideerde muziek (bijv. 86): volledige tekst, een korte rustige melding, geen luisterknop. |
| **Geen tekst** | lofzang 54 en 151: nette melding dat de tekst niet beschikbaar is vanwege rechtenbeperkingen; nummer en titel blijven. |
| **Herkennen** | één rustige status "Luistert naar muziek" met de uitleg "Versado probeert de lofzang te herkennen." en een zachte puls (geen percentage, geen kansen, geen dubbele "Luisteren…"). |
| **Meezingen** | ongewijzigd (zie 08). Onderaan alleen "Opnieuw synchroniseren" en "Stop"; tijdens het voorspel "Zang begint". |

## 2. Herkenscherm

- Titel "Lofzang herkennen" (geen tweede statusregel in de kop; de status staat alleen in het herkenscherm).
- Duurt het herkennen lang (≥ 15 s zonder uitspraak) of wordt er niets herkend, dan verschijnt "Duurt het lang? Zoek de lofzang zelf." met
  een knop **Zoek zelf** die dezelfde lokale zoeklijst opent, zonder de microfoon te stoppen; kiezen start het volgen vanaf het geheugen.
- Bij mogelijke kandidaten (alleen bij duidelijk bewijs, maximaal vier) staan ze als knoppen; er wordt nooit een kans of percentage getoond.
- **Gedeelde melodie**: hoort de melodie bij meerdere lofzangen, dan toont het scherm "Deze melodie hoort bij meerdere lofzangen. Kies de tekst die je
  zingt." met die lofzangen; de engine kiest de tekst niet zelf.
- Automatisch volgen na een stabiele herkenning: ongewijzigd, ook als de tekst nog niet geladen is (de engine meldt `needHymn`, de pagina haalt
  de lofzang op en de engine volgt dan vanaf het geheugen: er gaat geen luistertijd verloren en de microfoon blijft doorlopen).

## 3. Instellingen en voorkeuren

Het instellingenpaneel bevat nu een lofzanglijst met zoekveld (wissel van lofzang, ook midden in een sessie, zonder nieuwe microfoon), tekstweergave
(volledig couplet of karaoke), tekstgrootte, meescrollen, rustige kerkweergave en de uitklapbare privacy-uitleg. Voorkeuren staan lokaal in
`src/lib/hymnPrefs.ts`. Technische gegevens (alleen beheerders) staan in een eigen paneel, standaard dicht, met bovenaan het kwaliteitsoverzicht
van de bibliotheek (`LibraryReportPanel`).

## 4. Lay-out

Ongewijzigd: één werkruimte onder de terugbalk (`.hymns-workspace`), kop, één scrollende leesruimte en de bediening als gewoon flex-kind;
safe areas via `--vs-safe-area-*`, dynamische hoogte, geen `sticky`/`fixed` over tekst. De zoeklijst gebruikt `content-visibility: auto`
en blijft vlot met 205 rijen.

BEWEZEN in Chromium met viewport-emulatie (`scripts/hymns/e2e-browser.mjs`, 320, 375, 390, 430, 768, 1280 en 844x390 liggend, licht en donker,
normale en 200 % tekst, gesimuleerde safe areas, kleinere viewporthoogte): geen horizontale overflow, document scrolt niet, bediening onderaan en niets
achter de balk, laatste regel bereikbaar. **Niet bewezen**: iPhone-Safari, WKWebView, een echte telefoon (geen echt toestel beschikbaar).
