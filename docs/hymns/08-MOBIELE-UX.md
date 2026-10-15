# Lofzangen: mobiele indeling, focuslayout en bediening (fase 3)

Termen **BEWEZEN** (gemeten of getest in deze repository), **AANNEMELIJK** en **ONBEKEND**: zie
`01-SOURCE-AUDIT.md`. De muziekengine (herkenning, volger, fase-laag, `HymnLiveEngine`) is in deze fase
**niet** gewijzigd; alles hieronder is interface en lay-out.

> **Niet gemeten op echte hardware.** Alle lay-outmetingen zijn gedaan in Chromium (Linux) met
> viewport-emulatie en gesimuleerde safe areas (CSS-variabelen). Dat is **geen bewijs** dat het op een iPhone
> (Safari, PWA, WKWebView) of Android-toestel precies zo werkt. Het gedrag van de Safari-adresbalk is
> gesimuleerd met een kleinere viewporthoogte. Een controle op een echt toestel staat nog open.

## 1. De gemelde iPhone-bugs: oorzaak, oplossing, test, resultaat

| # | Bug | Werkelijke oorzaak | Oplossing | Test | Resultaat |
|---|---|---|---|---|---|
| 1 | Dubbele titel en veel informatie boven de tekst | De pagina had een eigen `h1` "Lofzangen" naast de terugbalk, plus een introtekst, een privacyblok, een lofzangselector en de instellingen, allemaal in de documentstroom boven de tekst | Drie schermtoestanden. Kiezen: titel "Kies een lofzang", drie opties, een regel privacy met "Privacy"-knop. Meezingen: een kop met nummer en titel, status, coupletnummers. De uitleg staat alleen in het instellingenpaneel | `e2e-browser.mjs` (geen intro of privacyblok zichtbaar, één `h1`), `tests/hymns-ui.test.ts` ("beginscherm en kop") | Geslaagd |
| 2 | Instellingen duwen de tekst naar beneden | De instellingen klapten inline uit in dezelfde kolom als de tekst | Instellingen, coupletvolgorde en technische gegevens openen als paneel (`Sheet.tsx`): bottom sheet op mobiel, dialoog vanaf `sm` | `e2e-browser.mjs` (paneel opent, tekst blijft staan, binnen het scherm op alle maten, laatste knop bereikbaar), `tests/hymns-ui.test.ts` | Geslaagd |
| 3 | Onderste bedieningsbalk bedekt de tekst | De balk was `sticky bottom-0` binnen de documentscroll: hij blijft aan de viewport plakken en ligt dan over de tekst, zonder gereserveerde ruimte | Eén werkruimte ter hoogte van het scherm onder de terugbalk (`.hymns-workspace`): flex-kolom met een kop, een leesruimte die zelf scrolt en een bedieningszone als gewone flex-kind. Het document scrolt niet; de safe area onderaan zit in de padding van de werkruimte | `e2e-browser.mjs`: leesruimte en bediening overlappen nooit, de laatste regel is bereikbaar, de bediening blijft op dezelfde plek na scrollen en na een kleinere viewporthoogte; `tests/hymns-ui.test.ts` (geen `sticky`/`fixed` in de componenten) | Geslaagd |
| 4 | Karaoke: te veel lege ruimte, slechte positionering | De karaokegrid had `min-h-[16rem] flex-1` in een documentstroom waarvan de hoogte afhing van het hele document en de vaste balk: het midden was niet het midden van de leesruimte | De karaokegrid is `min-h-full` binnen de leesruimte met rijen `1fr / auto / 1fr`: de actieve regel staat altijd in het midden van de ruimte tussen kop en bediening. Buren staan er met een vaste afstand (`gap-3`) tegenaan en worden bij lange regels op twee regels afgekapt | `e2e-browser.mjs`: de actieve regel wijkt maximaal 3 px af van het midden van de leesruimte, op elke maat en elk thema | Geslaagd |
| 5 | Technische gegevens verstoren de leesweergave | Een inklapbaar blok met testbestand stond onder de tekst in de documentstroom | Een eigen paneel ("Technische gegevens") dat alleen via het instellingenpaneel te openen is, alleen voor beheerders; niets staat standaard in beeld | `e2e-browser.mjs` (standaard geen `data-hymns-technical`, paneel binnen het scherm) | Geslaagd |
| 6 | Volledig couplet: grote witruimtes en onhandige regelverdeling | Een kaart met padding, `space-y-1.5`, `leading-snug`, grote kopmarges en een volledig scherm-overschrijdend blok | Geen kaart; `space-y-0.5`, `leading-normal`, een klein label per sectie (COUPLET n, REFREIN), links uitgelijnd, natuurlijke regelafbreking | Screenshots in `SHOTS_DIR`; `e2e-browser.mjs` (geen overflow, laatste regel bereikbaar) | Geslaagd |

## 2. Architectuur van de indeling

- **Eén werkruimte.** In focus mode staat alleen de centrale terugbalk bovenaan. `main` krijgt via
  `[data-shell-mode="focus"] main:has(.hymns-workspace)` geen eigen padding meer (zelfde aanpak als het
  legpuzzelbord); `.hymns-workspace` is `calc(100dvh - var(--header-height))` hoog en houdt links, rechts en onder
  de safe areas vrij (`--vs-safe-area-*`, nooit `env()`). `--header-height` komt alleen uit `ShellMetrics`.
- **Drie delen in een flex-kolom.** (1) kop: titel, statusregel, coupletnummers; (2) leesruimte: de enige
  scrollcontainer van de tekst (`role="region"`, `tabIndex=0`, met naam); (3) bedieningszone: een gewone
  flex-kind onderaan. Omdat de bediening in de stroom zit en niet over de tekst ligt, kan er niets achter
  verdwijnen, ook niet als de hoogte van de bediening verandert (bijvoorbeeld bij tekstschaling).
- **Geen magische padding, geen z-index-wedloop.** Er is geen `sticky`, `fixed` of `absolute` voor de
  bediening; de leesbediening ("Zelf bladeren", "Automatisch volgen hervatten") staat sinds docs 17 in de bedieningszone, niet meer in de leesruimte.
- **Vangnet voor zeer grote tekst.** Passen kop, leesruimte (minimaal 7 rem) en bediening niet (200% tekst op een
  scherm van 320x700 of een landscape-telefoon), dan scrolt de werkruimte zelf (`overflow-y: auto`). Het
  document scrolt nooit en alles blijft bereikbaar; de bediening is dan na scrollen onderaan bereikbaar
  in plaats van altijd vast zichtbaar. Dat is bewust gekozen boven een leesruimte van nul hoogte.
- **Scrollen.** Geen `scrollIntoView`, geen `window.scrollBy`: het meescrollen (`useReadingScroll`, zie 17) scrolt alleen de
  leesruimte, en alleen als het couplet niet past en de actieve regel buiten beeld valt. Eigen scrollen
  (wiel, vinger, toetsen in de leesruimte) pauzeert het meescrollen tot "Automatisch volgen hervatten" (docs 17). Reduced motion
  geeft geen vloeiende beweging.
- **Aanraakdoelen** van coupletnummers en icoonknoppen zijn minimaal 44 x 44 px (px-minimum, ook bij grote tekst).

## 3. De drie schermtoestanden

- **A. Lofzang kiezen** (beginscherm): titel "Kies een lofzang", de drie proeflofzangen als keuzelijst
  (`radiogroup`), een regel "Het geluid blijft op dit toestel. Alleen voor beheerders, in ontwikkeling.
  Privacy" en de bediening: *Start luisteren* (volgt de gekozen lofzang) en de enige primaire actie
  *Herken lofzang*.
- **B. Live meezingen**: kop met nummer en titel, de snelle weergavewissel en de instellingenknop; een
  statusregel ("Luisteren…", "Voorspel", "Volgt muziek", "Even onzeker", "Handmatig volgen", "Tussenspel",
  "Synchronisatie verloren") met de microfoonindicator; de coupletnummers met een menu "⋯"; de tekst; de
  bediening. Tijdens herkennen toont de leesruimte de kandidaten.
- **C. Instellingen**: een paneel over de weergave (tekstweergave, tekstgrootte, meescrollen, rustige
  kerkweergave, de lofzang, de uitleg en privacy, en voor beheerders de knop naar de technische gegevens). Het
  paneel is puur interface: het raakt de engine niet.

## 4. Bediening per toestand (maximaal één primaire actie)

| Toestand | Bediening |
|---|---|
| Kiezen | *Start luisteren* (secundair), **Herken lofzang** (primair) |
| Herkennen | "Luistert…" en *Stop* |
| Voorspel | **Zang begint** (primair), *Stop* |
| Zingen of tussenspel | *Opnieuw synchroniseren*, *Stop* |
| Gestopt (na een sessie) | *Andere lofzang* (terug naar kiezen), **Start luisteren** (primair) |
| Eigen scrollen | strook "Zelf bladeren" + "Automatisch volgen hervatten" in de bedieningszone |

De microfoon is altijd met *Stop* uit te zetten, met de terugbalk, door de pagina te verlaten of door naar de
achtergrond te gaan. De indicator "Microfoon is actief" (met punt) staat bij de status.

## 5. Het instellingenpaneel (`Sheet.tsx`)

- Native `<dialog>` in een bodyportal (zelfde patroon als de hintbevestiging van Woord van de dag): de rest van
  de pagina is inert, de focus blijft in het paneel, Escape sluit, een tik op de achtergrond sluit, de focus
  gaat terug naar de knop die het opende. Bottom sheet op mobiel, compacte dialoog vanaf `sm`; scrolt zelf; houdt
  `--vs-safe-area-bottom` vrij.
- **Terugknop:** een modaal `<dialog>` sluit in Chrome op Android met het terug-gebaar (CloseWatcher). Op iOS
  Safari is er geen terug-gebaar voor een dialoog; daar sluit de gebruiker met de sluitknop. Het paneel voegt
  bewust **geen** geschiedenisitem toe, omdat de gedeelde terugnavigatie en scrollherstel
  (`navigationHistory.ts`, `NavigationScroll`) per item werken. **Niet getest op echte toestellen.**
- Openen, sluiten en alle keuzes in het paneel herstarten niets: dezelfde microfoon (1x `getUserMedia`, 1x
  `AudioContext`), dezelfde positie, dezelfde lofzang en hetzelfde couplet (bewezen in de browsertest, ook met
  de status "begonnen" in de technische gegevens vóór en na).

## 6. Coupletnummers en volgorde

Coupletnummers staan compact in de kop (bij een heel smal scherm lopen ze over twee regels; alle nummers
blijven binnen het scherm). Het menu "⋯" opent het paneel "Coupletvolgorde" met dezelfde `StanzaPlan`-logica
als voorheen. Een afwijkende volgorde staat subtiel naast de nummers ("1 → 4").

## 7. Volledig couplet en karaoke

Zie `07-VOORSPEL-EN-ZANGBEGIN.md`, 7, voor het gedrag van de markering. Nieuw: het couplet staat zonder kaart
direct op de achtergrond; karaoke centreert de actieve regel in de leesruimte (zie 1, bug 4), ook bij
"Extra groot". Het actieve woord blijft accentkleur zonder achtergrond.

## 8. Toegankelijkheid

- Knoppen hebben namen ("Couplet 3", "Instellingen", "Wissel naar karaoke per regel", "Meer opties voor
  coupletten", "Sluiten"); het paneel heeft `aria-labelledby` en een zichtbare sluitknop.
- De status is één `role="status"`-regio die alleen verandert bij een echte statuswissel; de woordmarkering
  staat niet in een live-regio, dus schermlezers lezen de tekst niet bij elk woord opnieuw voor
  (`aria-current` alleen op de actieve regel).
- De leesruimte is een benoemde, met het toetsenbord focusbare scrollregio.
- Aanraakdoelen 44 px; rem-maten voor tekst; reduced motion respecteert `prefers-reduced-motion`.
- **ONBEKEND:** een echte VoiceOver- of TalkBack-test is niet gedaan.

## 9. Tests

| Wat | Waar |
|---|---|
| Browser: geen dubbele titel, geen intro of privacyblok, focus mode, terugknop, microfoon stopt | `scripts/hymns/e2e-browser.mjs` |
| Browser: instellingen/weergave/tekstgrootte tijdens luisteren herstarten niets; eigen scrollen | idem |
| Browser: 6 schermmaten (320x700, 375x812, 390x844, 430x932, 768x1024, 1280x800) plus landscape 844x390, licht en donker, 100% en 200% tekst, beide weergaven, gesimuleerde safe areas, kleinere viewporthoogte | idem |
| Pure afleidingen en ontwerpregels (werkruimte, panelen, bediening, aanraakdoelen) | `tests/hymns-ui.test.ts` |
| Engine-regressie | `npm run test:hymns` (ongewijzigd, plus de bestaande fase-2-suites) |
| Contentkiezer ongewijzigd | `npm run test:content-picker` en `tests/content-picker.browser.mjs` (48 combinaties) |

Opstarten van de browsertest: zie de kop van `e2e-browser.mjs`; `--quick` draait een kleine matrix,
`ONLY_SIZES=1280x800,844x390` beperkt de maten. Screenshots komen in `SHOTS_DIR`.

## 10. Beperkingen

- Geen echte iPhone, iPad of Android getest; alleen Chromium met emulatie (zie de waarschuwing bovenaan).
- Het gedrag van Safari-balken (verdwijnen en verschijnen) is gesimuleerd; dynamische viewporteenheden
  (`dvh`) en `--header-height` zijn de aannames. Omdat het document niet scrolt, hoort Safari zijn balken niet
  in en uit te schuiven; dat is **AANNEMELIJK**, niet bewezen.
- Zeer grote tekst op een klein scherm: de werkruimte scrolt (zie 2); de bediening is dan niet altijd
  vast in beeld.
- Het terug-gebaar sluit een paneel alleen in browsers met CloseWatcher (Chrome op Android).
- De teksten van de pagina zijn nog niet vertaald (alleen voor beheerders); bij openstelling voor gewone
  gebruikers gaan ze via i18n.
