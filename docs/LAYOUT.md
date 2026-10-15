# Shell-layout: vaste balken, safe areas, tekstschaling en scrollen

Eén architectuur voor alles wat vastzit aan het scherm. Lees dit vóór je iets
aan header, terugbalk, onderbalk, `<main>`, een fixed/sticky element of een
vaste hoogte verandert, en vóór je een nieuwe pagina of overlay bouwt.

## Waarom dit bestaat (gevonden oorzaken)

1. **Vaste maten in de header.** De header had een vaste hoogte (`h-14`) en
   rem-brede, niet-krimpende onderdelen. Bij 200% tekst werd de rij breder dan
   het scherm. Een mobiele browser laat de pagina dan uitzoomen (de
   *layout viewport* wordt breder dan het scherm) en een `fixed bottom-0`
   onderbalk staat daardoor deels of helemaal buiten beeld.
2. **Niet-breekbare inhoud.** Een kop als "Goedemiddag, naam" op 56 px
   (200% × 1,75 rem) past niet in 320 px en maakte de pagina zelf breder, met
   hetzelfde uitzoomeffect. Ook decoratieve mascottes met een rem-minimum
   (`clamp(5.5rem, …)`) groeiden mee met de tekst en persten de tekst weg.
3. **Twee positioneringsmodellen.** Gewone pagina's gebruikten een `fixed`
   bovenbalk met gemeten ruimte, focus mode een `sticky` terugbalk in de
   normale flow. Omdat `body` `height: 100%` had, was het omvattende blok van
   die sticky balk maar één schermhoogte: bij een lange les scrolde de
   terugbalk na ongeveer een scherm weg.
4. **Verspreide metingen.** `--header-height` werd gemeten, de onderbalk niet
   (vaste `6rem`), en sticky/fixed-elementen gebruikten de headerhoogte ook als
   die niet meer vastzat.
5. **Toetsenbord.** Met het schermtoetsenbord open stond de onderbalk midden in
   beeld (iOS) of boven het toetsenbord (Android).

## De regels

**Eén model.** De bovenbalk (header, terugbalk, spelers) is altijd dezelfde
`position: fixed` wrapper `[data-sticky-header]` (`StickyHeader.tsx`), in elke
shellmodus. Nooit `sticky` voor de wrapper. De onderbalk is `fixed bottom-0`
(`[data-main-nav]`, alleen onder `lg`). `<main>` houdt er ruimte voor vrij met
`--main-pad-top` en `--main-pad-bottom`.

**Eén meetplek.** `src/components/shell/ShellMetrics.tsx` meet de balken en
zet op `<html>`:

| Variabele / attribuut | Betekenis | Gebruik |
|---|---|---|
| `--header-height` | hoogte van de vaste bovenbalk | ruimte vrijhouden (`<main>`, min-hoogtes) |
| `--header-offset` | waar iets tegen de bovenbalk begint | `sticky`/`fixed` top; gelijk aan de hoogte, 0 als de balk meescrolt |
| `--nav-height` | hoogte van de onderbalk (0 op desktop, in focus mode en bij open toetsenbord) | ruimte vrijhouden |
| `data-header-tall` | de balk is bij zeer grote tekst > 34% van het scherm en scrolt mee | CSS in `globals.css` |
| `data-keyboard` | schermtoetsenbord open: onderbalk verdwijnt | CSS in `globals.css` |

Vóór de eerste meting gelden `--header-default` en `--nav-default` (in
`globals.css`, per shellmodus), zodat de inhoud niet verspringt. Pure regels
staan in `src/lib/shellMetrics.ts` (getest). Geen component meet of zet deze
variabelen zelf (`tests/shell-layout.test.ts` controleert dat).

**Volgorde bovenin.** Van boven naar beneden, altijd binnen de ene vaste wrapper:
de header (met de contentkiezer links in de headerrij, nooit als eigen
`fixed`/`sticky` element), daaronder de terugbalk als de pagina er een heeft,
daaronder de spelers, en dan pas `<main>`. De kiezer zelf heeft dus geen eigen
offset: hij volgt de header.

**Lagen (z-index).** Een dropdown of popover hoort nooit *in* de vaste bovenbalk
te hangen. Die balk heeft `overflow-x: clip` en vormt één stackinglaag (z-30):
alles erin wordt op de rand van de balk afgekapt en schildert effectief op
laag 30. Kaartmenu's op laag 20 en de sleepkaart op laag 25 blijven eronder,
ongeacht DOM-volgorde of tijdelijke FLIP-transforms. Gelijke lagen voor balken
en kaartmenu's lieten het later gerenderde kaartmenu juist boven de header komen.
De standaardlaag 999 van `DragOverlay` wordt daarom expliciet begrensd. De schaal:

| Laag | Wat | z |
|---|---|---|
| pagina | gewone inhoud en lokale knoppen | ≤ 20, binnen `<main>` |
| sleepkaart | `SortableList` / `DragOverlay`, boven andere kaarten | 25 |
| balken | `[data-sticky-header]`, `[data-main-nav]` | 30 |
| popovers en menu's | overige body-portals | 40 |
| dialogen en sheets | `ChapterPopup` | 50 |
| volledige overlays | `FriendPicker`, `NotificationCenter` | 75–80 |

Een nieuw menu of popover gaat met `createPortal` naar `document.body`,
`position: fixed`, een eigen `z-40`, een onzichtbare achterlaag (`fixed inset-0
z-40`) zodat een tik erbuiten alleen het menu sluit, en meet zijn plek aan het
anker (`getBoundingClientRect`). Zijn maximale hoogte is de ruimte tot de
onderbalk (`[data-main-nav]`, alleen als die zichtbaar is) of de viewport, met
`overflow-y: auto`. Zo is het menu een echte overlay: het wordt niet afgekapt
door de balk, niet bedekt door de pagina en nooit door de pagina weggedrukt.
De publieke `ContentSwitcher.tsx` gebruikt geen overlay meer: hij linkt naar `/content`.
Die route gebruikt de bestaande Focus-shell: uitsluitend de vaste terugbalk,
zonder globale header of ondernavigatie. `.page-fill` volgt de gemeten
`--main-pad-top` en safe areas; er is geen eigen offset of scrollcontainer.
`tests/shell-layout.test.ts` en de productie-browsertest bewaken dit.

**Standaard vóór de meting.** Tot `ShellMetrics` gemeten heeft (server-HTML,
eerste paint) rekent `<main>` met `--header-default`. Die is
`--header-row-default` (3,5625 rem, vanaf sm 4,0625 rem) +
`--header-back-default` + de safe area bovenin. De terugbalk telt mee via
`:root:has([data-subpage-back-bar])`: het DOM bepaalt zelf of die er is, er is
geen paginalijst of vaste offset per route. Een vaste `4.5rem` (de oude
waarde) liet op een iPhone met notch en terugbalk 53 px inhoud onder de balken
vallen tot na hydratie. Wijzig je de hoogte van de headerrij of de terugbalk,
pas dan ook deze standaarden aan; `tests/shell-layout.test.ts` bewaakt de
vorm en `scripts/layout-audit/switcher.mjs` meet het verschil met de
gemeten waarde.

**Safe areas.** Altijd via `--vs-safe-area-top/right/bottom/left` (web, PWA en
Capacitor/Android), nooit rechtstreeks `env(...)` in een component. De vaste
balken en `<main>` houden links en rechts rekening met een inkeping (landscape).

**Tekstschaling en reflow.**
- Maten van tekst, knoppen en balken in `rem`; geen vaste hoogtes voor iets met
  tekst (`min-h-*` in plaats van `h-*`). De header en de onderbalk mogen over
  meerdere regels lopen (`flex-wrap`).
- Tekst mag nooit kleiner worden gemaakt of het zoomen beperkt: geen
  `maximum-scale`/`user-scalable`, geen `text-[…px]` voor leesbare tekst in de
  shell. Zoom en tekstgrootte van de gebruiker blijven altijd werken.
- Decoratieve beelden naast tekst (mascottes) krijgen een **px-minimum**:
  `w-[clamp(96px,28vw,7.5rem)]`, zodat ze niet met de tekst meegroeien en de
  tekst niet wegpersen.
- `body` heeft `overflow-wrap: anywhere` als vangnet: een woord dat niet past
  breekt af in plaats van de pagina breder te maken. De vaste delen hebben
  `overflow-x: clip` zodat ze nooit zelf de viewport kunnen laten uitzoomen.
- Knoppen (`primaryButton`, `secondaryButton`) hebben een `min-h` en mogen
  afbreken. Geef een knop met tekst nooit een vaste hoogte (`h-*`).
- Lange labels in smalle vakken: `vs-wrap` (breken + afbreken volgens `lang`).

**Scrollen.**
- Het venster is de enige scrollcontainer van een gewone pagina (bewuste uitzondering: de woordenlijst van het woordenboek, `max-h-[60vh]`, omdat die duizenden regels kan hebben). Geen
  `overflow` op `html`/`body` (behalve het bestaande `overflow-x` vangnet), geen
  geneste scrollcontainers tenzij de inhoud dat echt vraagt (een lijst in een
  dialoog, het personagepaneel van een Mysterie).
- `NavigationScroll.tsx` regelt voor de hele app dat een nieuwe pagina bovenaan
  begint en terug/vooruit de oude positie herstelt. Geen `scrollTo(0, 0)` per pagina.
- `html` heeft `overscroll-behavior-y: none`: geen rubberband-effect waarmee de
  onderbalk op iOS mee kan bewegen.

**Focus mode en immersive.** Zie `src/lib/focusMode.ts`. Focus: terugbalk
bovenaan (zelfde fixed wrapper, andere standaardmaat), geen header en geen
onderbalk. Immersive: niets van de shell. Een wijziging aan de shell mag deze
modi niet veranderen; `tests/focus-mode.test.ts` en `tests/shell-layout.test.ts`
bewaken dat. Zet nooit eigen `hide`-klassen op shelldelen.

**Immersive per stap binnen een Focus-route.** Een route met meerdere interne stappen
(Legpuzzel: catalogus, speelbord, resultaat) blijft in `focusMode.ts` een Focus-route.
Alleen het actieve speelbord vraagt, zolang het gemonteerd is, om Immersive via
`useImmersiveShell()` (`src/lib/shellModeOverride.ts`, gebruikt door
`components/puzzle/PuzzleBoardLayout.tsx`). `resolveShellMode()` laat die aanvraag
uitsluitend een Focus-route naar Immersive verheffen; normale en al-immersive
routes veranderen nooit. De aanvraag verdwijnt bij unmount, dus een stapwissel,
navigatie of sluiten zet de shell vanzelf terug. `FocusModeController` zet de modus
in dezelfde commit op het element (een layout-effect), zodat de werktafel haar
eerste afmeting en camera op de uiteindelijke layout bepaalt. Het bord is
`.vs-immersive-layout.puzzle-workspace` (`100dvh` met de veilige randen als
padding, geen vrijgehouden ruimte voor een terugbalk); terug staat in het
zwevende bordmenu. Browserterug, Android-systeemterug en iOS-gebaren gebruiken de
browsergeschiedenis en zijn niet van de terugbalk afhankelijk.

**Toetsenbord.** Zodra je in een tekstveld typt en het zichtbare gebied
duidelijk kleiner wordt, krijgt `<html>` `data-keyboard` en verdwijnt de
onderbalk. Plaats geen eigen vaste balk onderaan zonder dat ook te
respecteren.

Het betaalde Woord-van-de-Dag-woordenboek gebruikt een begrensde woordenlijst
onder het raadveld (maximaal 45svh/24rem), zodat 716 kandidaten niet de hele
pagina verlengen. De bevestiging volgt het PuzzleHintPanel-patroon: een native
`dialog.showModal()` in een bodyportal, met safe areas, intern scrollen en
focusherstel. De browser-toplaag maakt de achtergrond inert en houdt de
bevestiging boven de terugbalk, ook binnen stacking contexts. Er is geen eigen
header, navigatie of shell-offset toegevoegd. De echte browsercontrole staat
in `tests/word-game-hints.browser.mjs`.

**Werkruimte in focus mode (Lofzangen).** Een activiteit die de tekst centraal zet en een eigen bedieningszone
heeft gebruikt dezelfde aanpak als het legpuzzelbord: `[data-shell-mode="focus"] main:has(.hymns-workspace)`
haalt de padding van `<main>` weg en de werkruimte is `calc(100dvh - var(--header-height))` hoog, met de
safe areas als padding. Binnenin een flex-kolom met één scrollende leesruimte en een bediening als gewone
flex-kind (geen sticky of fixed). Zie `docs/hymns/08-MOBIELE-UX.md`.

## Een nieuwe pagina of component bouwen

- Plaats inhoud in `<main>` (de layout geeft de ruimte); nooit eigen
  `padding-top` voor de header.
- Een pagina die het scherm moet vullen: `.page-fill` (rekent met dezelfde variabelen).
- Iets vasts (toast, balk, popover): bovenaan `top-[calc(var(--header-offset,var(--header-default))+…)]`,
  onderaan boven de onderbalk `bottom-[calc(var(--nav-height,0px)+…)]`, met
  `--vs-safe-area-*` voor de randen. Geen eigen `top-14`/`h-16`-aannames.
- Een overlay over het hele scherm (`fixed inset-0`) houdt zijn inhoud binnen
  de safe areas en scrolt zelf als de inhoud te groot wordt (`max-h`, `overflow-y-auto`).
- Een activiteit zonder globale balken hoort in `focusMode.ts`, niet in een eigen layout.
- Test op 320 px en 200% tekst (zie hieronder) en met een lange vertaling.

## Controleren

`npm run test:focus` (inclusief `tests/shell-layout.test.ts`) bewaakt de
broncontracten. De echte weergave meet `scripts/layout-audit/audit.mjs` met
Playwright (niet in CI; draait tegen een lopende server):

```bash
PLAYWRIGHT_MODULE=/pad/naar/node_modules/playwright \
  node scripts/layout-audit/audit.mjs '{"widths":[320,390],"fonts":[100,200],"langs":["nl","de"]}'
```

Het script meldt per pagina, breedte, tekstgrootte en taal: horizontale
overflow, uitgezoomde viewport, positie van header en onderbalk (ook na
scrollen), inhoud onder de header of onder de onderbalk, en een terugbalk die
bij scrollen wegloopt.

`scripts/layout-audit/switcher.mjs` is een wrapper voor de fullscreen
contentkiezer-browsertest met een eigen wegwerpdatabase. De suite meet
terugbalk → inhoud, safe areas, touch, toetsenbord, selectie, taal,
terug/vooruit en scrollherstel. Zij gebruikt geen productieaccount:

```bash
PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chromium \
  node scripts/layout-audit/switcher.mjs
```

`npm run test:layout:browser` test de daadwerkelijk gerenderde productie-interface
van Vandaag, Leren, Spelen en Woordzoeker op een eigen tijdelijke PostgreSQL 16-
database met alle migraties. Vooraf: `npm run build`; Playwright staat buiten de
app-dependencies en wordt opgegeven met `PLAYWRIGHT_MODULE`. De workflow
`header-wordsearch.yml` voert dezelfde controle uit en bewaart screenshots.
Geen productieaccounts of externe database nodig.

De suite vergelijkt hit-tests en computed layers tijdens scrollen, FLIP en
slepen; controleert contentkiezer en kaartacties; en meet echte tekstregels,
knopbreedtes en overflow op 320/375/390/430px, tablet, desktop en landscape,
licht/donker, 100/200% tekst en de vijf UI-talen. Alle drie Woordzoeker-niveaus
worden via de echte API gestart, gespeeld en afgerond, inclusief touchselectie,
terugnavigatie en belonings-idempotentie. Er wordt niets aan spelregels veranderd.

Woordzoeker gebruikt lokaal `auto-fit` met een rem-minimum dat maximaal de volle
beschikbare breedte is: één, twee of drie gelijkwaardige kolommen. De korte
moeilijkheidslabels blijven op één regel. Het globale `overflow-wrap: anywhere`
vangnet blijft voor gewone paginainhoud behouden.

## Native (Capacitor)

De WebView gebruikt dezelfde CSS: safe areas via `--vs-safe-area-*`
(`SystemBars.insetsHandling: "css"` op Android, `env()` op iOS met
`viewport-fit=cover`) en het toetsenbord via `data-keyboard`
(`Keyboard.resize: "body"` blijft staan). Echte iOS- en Android-simulatoren of
-toestellen zijn niet getest; zie het eindrapport van de layoutwijziging.
