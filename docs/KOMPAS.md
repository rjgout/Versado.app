# Versado Kompas: uitleg, rondleidingen en begeleiding

Versado Kompas is het centrale, meertalige en uitbreidbare systeem waarmee
gebruikers Versado zelfstandig leren begrijpen. Zichtbare naam: **Ontdek
Versado** (vertaald; "Versado Kompas" is de interne productnaam). Het combineert
een permanente plek voor uitleg, korte contextuele uitnodigingen, optionele
rondleidingen over echte interfaceonderdelen en een korte stap in de
onboarding. Er is bewust geen aparte modus voor ouderen of kinderen: één
ervaring die voor iedereen werkt.

Lees dit document voordat je een functie, spel, cursus, schriftbron of taal
toevoegt die voor gebruikers zichtbaar is.

## Structuur van Versado (zo staat het ook in Kompas)

Versado draait om **de Schriften**, niet alleen om het Boek van Mormon. Het
Boek van Mormon is één van de beschikbare schriftbronnen. Er zijn twee
hoofdactiviteiten:

- **Leren**: cursussen en lessen, schriftstudie, vragen en feedback.
- **Spelen**: alle spellen, inclusief het Mysterie, puzzels en uitdagingen.

Daaronder staan ondersteunende onderwerpen: **Samen** (vrienden, groepen),
**Mijn voortgang** (XP, reeks, divisie), **Mijn profiel en instellingen** en
**Aan de slag**. Noem in uitleg het Boek van Mormon alleen als de uitleg
specifiek over die bron gaat; gebruik anders "de Schriften".

## Onderdelen

| Onderdeel | Bestand |
|---|---|
| Register van onderdelen (stabiele ids, hiërarchie, versie, link, rondleiding, routes) | `src/lib/kompas/registry.ts` |
| Uitlegkeuze met fallback en schriftbron | `src/lib/kompas/resolve.ts` |
| Gebruikersstatus, versies, uitnodigingsregels | `src/lib/kompas/state.ts` |
| Rondleidingen (stappen en doelen) | `src/lib/kompas/tours.ts` |
| Plaatsing van markering en kaart (puur, getest) | `src/lib/kompas/tourLayout.ts` |
| Opslag (`KompasProgress`) en API (`/api/kompas/state`) | `src/lib/kompas/store.ts`, `src/app/api/kompas/state/route.ts` |
| Browserhulpen (doel zoeken, vaste balken meten) | `src/lib/kompas/dom.ts` |
| Teksten (nl is de bron) | `src/lib/i18n/messages/kompas/{nl,en,de,fr,es}.ts` |
| Pagina's: Ontdek Versado en uitleg per onderdeel | `src/app/kompas/page.tsx`, `src/app/kompas/[topicId]/page.tsx` |
| Rondleiding, uitnodiging, ingang, onboardingstap | `src/components/kompas/`, `OnboardingClient.tsx` (`KompasStep`) |
| Tests | `tests/kompas.test.ts`, `tests/kompas.integration.test.ts` (`npm run test:kompas`) |

Wat Kompas **hergebruikt** in plaats van dupliceert: de contentidentiteit
(`ContentCollection.work`, `workOf`), de spelcatalogus (`GAME_CATALOG`, incl. de
bestaande speluitleg onder `gamesHub.*`), het vertaalsysteem (`getT`/`useT`,
`fallbackChain`), `MascotSlot`/`PersonalMascot`, de shell-regels
(`shellModeForRoute`, `isActivityRoute`), de terugbalk (`SubpageBackBar`), de
live-data-laag (`useLiveQuery`, `jsonMutation`) en de onboarding
(`OnboardingClient`, `onboardingSeenAt`).

## Uitleg: de vaste structuur

Elke uitleg heeft maximaal deze secties; toon alleen wat relevant is:

1. **Wat is het?** (`what`) korte beschrijving in eenvoudige taal.
2. **Wat kun je ermee?** (`benefit`) waarom het nuttig of leuk is.
3. **Hoe werkt het?** (`step1` … `step6`) een beperkt aantal concrete stappen.
4. **Probeer het zelf**: de echte functie (`href`) en/of een rondleiding (`tour`) uit het register.
5. **Meer weten** (`more` en `faq1` … `faq5` met `q` en `a`): uitzonderingen en spelregels.

Schrijfregels: korte zinnen, geen technische termen, niets verzinnen. Elke
bewering over XP, reeksen, divisies, groepen, spellen of voortgang moet kloppen
met de code of met `docs/LEERVOORTGANG.md`, `docs/SAMEN.md`, `docs/TIJD.md`.
Noem geen getallen die in code staan (XP-bedragen, limieten): die veranderen.

## Fallback en schriftbron

`resolveExplanation(t, topicId, { work, character })` kiest, van specifiek naar
algemeen:

1. het onderdeel voor de schriftbron van de actieve content
   (`kompas.work.<werk>.topics.<id>.*`);
2. het onderdeel algemeen (`kompas.topics.<id>.*`);
3. het bovenliggende onderdeel (en diens ouders), per niveau eerst voor de
   bron, dan algemeen;
4. de algemene Versado-uitleg (`versado`).

Een uitleg voor een schriftbron hoeft niet compleet te zijn: wat ze niet zegt,
komt uit de algemene uitleg van hetzelfde onderdeel. Het resultaat bevat
`level` (`specific` | `activity` | `section` | `versado`) en `scope`: de
schriftbron waarvan een eigen uitleg is gebruikt, anders `""`. `scope` is de
sleutel voor de gebruikersstatus.

`work` is `workOf(active)` (`ContentCollection.work`, bv. `bofm`,
`dc-testament`, `pgp`; zonder werk het collectie-id). Een werk-sleutel wordt in
tekstsleutels camelCase (`dc-testament` → `dcTestament`, zie `keySegment`).
`kompas.work.<werk>.intro` en `.contents` zijn de introductie en
inhoudsbeschrijving op Ontdek Versado.

**Taal.** De uitleg staat in de taal van de app (`User.uiLanguage`, dus `t`);
de schriftbron komt uit de contentkeuze en is daar los van. Een bron heeft in
elke contenttaal dezelfde `work`, dus dezelfde `scope`: van Nederlands naar
Engels wisselen binnen hetzelfde werk activeert nooit opnieuw dezelfde uitleg.
Ontbrekende vertalingen vallen terug via `fallbackChain`.

## Wat er gebeurt bij een wissel van Schriften of taal

De contentkiezer en zijn routering (`contentRouting.ts`, `contentSwitch.ts`)
zijn niet gewijzigd. `/kompas` en `/kompas/*` zijn neutrale routes (blijven
staan, verversen). Omdat de pagina's server-gerenderd zijn en de layout
`active.id:contentLanguage` als key gebruikt, volgt de uitleg de nieuwe keuze
vanzelf. De uitleg van de contentkiezer zelf (`switcher`) beschrijft het echte
gedrag: wat verandert (cursussen, spellen, teksten), wat blijft (account, XP,
reeks, divisie, vrienden, instellingen en leesvoortgang per hoofdstuk), hoe je
een taal kiest, en wat er gebeurt als iets niet beschikbaar is (melding met
"blijf" en "toch wisselen"). Wijzig je het gedrag van de wissel, werk dan die
uitleg bij en verhoog de versie.

## Gebruikersstatus (`KompasProgress`)

Per gebruiker, onderdeel (`topicId`), schriftbron (`scope`) en soort
(`GUIDE` = uitleg/uitnodiging, `TOUR` = rondleiding): `status` (`VIEWED`,
`SKIPPED`, `COMPLETED`; geen rij = nog niet gezien) en `version` (laatst
getoonde versie, altijd door de server bepaald). `mergeStatus` regelt dat een
nieuwere versie voorgaat en dat "afgerond" blijft staan.

`User.kompasOffersEnabled` bepaalt of Kompas zelf uitleg mag aanbieden. Nieuwe
accounts: aan. Bestaande accounts kregen bij de migratie `false` (migratiebeleid:
geen terugwerkend gedrag); de uitleg zelf is voor iedereen altijd bereikbaar.

Uitnodigingen (`ContextOffer`, `shouldOffer`):

- hoogstens één per sessie (sessionStorage met geheugenterugval);
- alleen op overzichtspagina's uit `routes` in het register, in de gewone shell,
  nooit in een activiteit, spel of boven een open dialoog (dus nooit over een
  resultaatkaart of viering; zie `celebrationGate.ts`);
- afwijzen (`SKIPPED`) of openen (`VIEWED`) wordt onthouden; wisselen van
  schriftbron activeert dezelfde uitleg niet opnieuw, tenzij die bron eigen uitleg
  heeft (eigen `scope`, dan één keer);
- een hogere `version` van het onderdeel biedt opnieuw aan;
- "Niet meer vragen" zet `kompasOffersEnabled` uit; het profiel heeft de schakelaar.

**Kompas heeft nooit invloed op XP, reeksen, divisies, scores, groepsvoortgang,
dagelijkse doelen, cursus- of spelresultaten.** Er worden geen XP-, reeks-,
leer- of spelmodules geïmporteerd en alleen `KompasProgress` en
`User.kompasOffersEnabled` worden geschreven (de test `tests/kompas.test.ts`
bewaakt dit). Mutations gebruiken `invalidates: "kompasChanged"`.

## Rondleidingen

Een rondleiding is een rij stappen in `tours.ts`; elke stap wijst een doel aan
via `data-kompas-target="<naam>"` in de interface. Doelen die op meerdere
plekken staan (navigatie: onderbalk op telefoon, header op desktop) worden per
naam gezocht en het **eerste zichtbare** telt.

- Start alleen na een bewuste actie (knop in Ontdek Versado), via
  `useKompas().startTour(id)` of `?kompas=<id>` (wordt direct uit de adresbalk
  gehaald). Een rondleiding hoort bij één pagina (`route`); `route: null` werkt
  op elke gewone pagina.
- Ontbrekende doelen worden overgeslagen; blijft er niets over, dan stopt de
  rondleiding zonder iets vast te leggen. Het eerste doel mag tot 3 seconden
  laden.
- Scrollt het doel in beeld (`scrollDeltaFor`) rekening houdend met de vaste
  bovenbalk (header, terugbalk, spelers: `[data-sticky-header]`), de onderbalk
  (`[data-main-nav]`) en safe areas; vaste doelen scrollen nooit.
- De kaart staat onder of boven het doel, nooit achter een balk of buiten het
  scherm; past het niet, dan als blad onderaan het zichtbare vlak en scrolt de
  kaart zelf (grote letters, lange vertalingen).
- De overlay vangt tikken op (niets eronder wordt per ongeluk bediend), klikt of
  navigeert zelf nooit en wijzigt nooit gegevens. Sluiten kan altijd: knop,
  Escape of Overslaan. Focus gaat naar de kaart en terug; Tab blijft in de kaart;
  stappen worden aangekondigd; geen tijdslimiet.
- Beweging volgt `prefers-reduced-motion` (`vs-motion`); scrollen is direct.

Nieuw doel toevoegen: zet `data-kompas-target="<naam>"` op het interfaceonderdeel
(klein, stabiel, zonder gegevens). De test controleert dat elk doel uit een
rondleiding echt in de code staat.

## Mascottes

Alleen bestaande personages via `PersonalMascot` (de persoonlijk gekozen gids,
nooit een andere) en bestaande states (`guideMascotState` in
`src/lib/kompas/mascot.ts`: Varo `discovery`, Vera `reading`, Novi `greeting`).
Rustig, kort, nooit over een resultaat- of vieringsscherm. Het Kompas-icoon
(`KompasIcon`) is afgeleid van het kompas dat Varo draagt (cirkel met
vierpuntige ster) in de stijl van de lucide-iconen; geen nieuw mascotontwerp.
Animatie of audio is niet nodig; een latere uitbreiding past in `guideMascotState`
en de kaart.

## Een nieuwe functie, schriftbron, activiteit of taal toevoegen

**Checklist bij elke nieuwe of wezenlijk gewijzigde, voor gebruikers zichtbare
functie** (niet bij triviale wijzigingen of bugfixes):

1. Heeft de functie uitleg nodig? (nieuw gedrag dat je niet vanzelf begrijpt)
2. Moet ze in Ontdek Versado verschijnen? Zo ja: onder welk onderdeel (`parent`)?
3. Is een rondleiding nuttig? (zie hieronder)
4. Is de uitleg afhankelijk van de schriftbron? Zo ja: werk-uitleg toevoegen.
5. Zijn alle vertalingen aanwezig? (`npx tsx scripts/i18n/check.ts`; de test
   `tests/kompas.test.ts` eist elke Kompas-sleutel in alle `uiReady`-talen.)
6. Moet een bestaande uitlegversie worden verhoogd? (alleen bij wezenlijke wijziging)
7. Werkt de functie met de bestaande Kompas-architectuur (geen eigen helpsysteem)?
8. Zijn bestaande helpteksten nog correct? (`gamesHub.*`, `xpGuide`, `streakPage.explain`, `kompas.topics.*`)

**Een spel toevoegen.** Voeg het toe aan `GAME_CATALOG` en vul `gamesHub.<textKey>`
(description, rule1..3) in alle talen. Kompas toont het vanzelf onder Spelen
(onderdeel `play.<id>`, link, routes, zichtbaarheid per actieve content en
spelinstelling). Extra uitleg (`benefit`, `more`, `faq`) is optioneel onder
`kompas.topics.play<Id>` (zie `playMystery`).

**Een onderdeel (activiteit/functie) toevoegen.** Voeg een regel toe aan
`STATIC_TOPICS` in `registry.ts` (stabiele `id`, `parent`, `icon`, `version`,
`href`, eventueel `group`, `tour`, `routes`, `requires`), en teksten onder
`kompas.topics.<id>` in `nl.ts` en de andere vier talen. Hernoem nooit een `id`:
die staat in de database.

**Een schriftbron toevoegen.** Er is niets in de code te registreren: het werk
is `ContentCollection.work`. Voeg optioneel in alle talen `kompas.work.<werk>`
toe: `intro`, `contents` en per onderdeel afwijkende uitleg onder
`topics.<id>` (bv. `learn`). Zonder eigen uitleg krijgt de bron automatisch de
algemene uitleg en de gebruiker verder niets nieuws aangeboden. Controleer dat de
bestaande uitleg niets beweert wat voor de nieuwe bron niet klopt.

**Een taal toevoegen.** Voeg `src/lib/i18n/messages/kompas/<taal>.ts` toe, koppel
het in `<taal>.ts` (`kompas: ...`) en voeg het toe aan de lijst in de tests.
Teksten blijven bij langere vertalingen passen (geen vaste hoogtes; de kaart
scrolt zelf).

**Een rondleiding toevoegen.** Een regel in `KOMPAS_TOURS` (stappen met `id` en
`target`), teksten onder `kompas.tours.<rondleiding>.<stap>.title/.text`,
doelen markeren, en `tour: "<id>"` bij het onderdeel in het register. Het
doel moet op een gewone pagina staan (geen focusroute).

**Wijzig je een bestaande functie wezenlijk**: werk de uitleg bij en verhoog de
`version` van het onderdeel; wie de oude versie zag, krijgt dan opnieuw een
uitnodiging.

## Beperkingen en bewust niet gebouwd

- Geen animatie of audio van de gids (de plaats is voorbereid in `guideMascotState`).
- Geen automatische rondleidingen; alleen op verzoek.
- Rondleidingen werken op de gewone shell, niet binnen focus- of immersieve
  routes (spellen, lessen).
- Uitnodigingen staan per overzichtspagina (`routes`), niet per willekeurig element.
- Scripturen-specifieke uitleg is nu voor `bofm`, `dc-testament` en `pgp`
  (Leren); andere bronnen krijgen de algemene uitleg.
