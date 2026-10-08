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
daaronder de spelers, en dan pas `<main>`. De kiezer heeft dus geen eigen
offset: hij volgt de header. Zijn menu (`absolute top-full`) is begrensd op de
zichtbare hoogte min `--header-height` en `--nav-height` en scrolt zelf, zodat
de onderste taalknoppen op een lage viewport of bij grote tekst bereikbaar
blijven (de wrapper is vast, dus de pagina eronder kan dat niet opvangen).

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

**Toetsenbord.** Zodra je in een tekstveld typt en het zichtbare gebied
duidelijk kleiner wordt, krijgt `<html>` `data-keyboard` en verdwijnt de
onderbalk. Plaats geen eigen vaste balk onderaan zonder dat ook te
respecteren.

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

`scripts/layout-audit/switcher.mjs` meet in een echte browser (licht en donker,
meerdere breedtes) de volgorde header → contentkiezer → terugbalk → inhoud, dat de
kiezer zichtbaar en niet bedekt is, scrollen, terugnavigeren (scrollpositie), het
menu, content wisselen, de onderbalk onderaan, en de staat vóór hydratie met een
inkeping:

```bash
PLAYWRIGHT_MODULE=/pad/naar/playwright AUDIT_IDENTIFIER=mail AUDIT_PASSWORD=wachtwoord \
  node scripts/layout-audit/switcher.mjs '{"widths":[320,390,768,1200]}'
```

## Native (Capacitor)

De WebView gebruikt dezelfde CSS: safe areas via `--vs-safe-area-*`
(`SystemBars.insetsHandling: "css"` op Android, `env()` op iOS met
`viewport-fit=cover`) en het toetsenbord via `data-keyboard`
(`Keyboard.resize: "body"` blijft staan). Echte iOS- en Android-simulatoren of
-toestellen zijn niet getest; zie het eindrapport van de layoutwijziging.
