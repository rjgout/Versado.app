# Legpuzzel V2 — Immersive speelbord, compacte afgeronde lijst en grotere draaiknop

Branch `feature/puzzle-immersive-history`, vanaf `origin/main` inclusief PR #117. Geen wijziging aan de puzzelengine, botsingsdetectie,
parkeren, multiplayerregels, locks, XP, reeks, hints, moeilijkheden, afbeeldingen of historische gegevens; geen migratie.

## 1. Bestaande shellmodi hergebruikt

Er is geen vierde modus en geen eigen fullscreen- of navigatieshell: het bestaande **Focus** (terugbalk) en **Immersive** (niets van de
shell) uit `src/lib/focusMode.ts`, `FocusModeController`, `FocusLayout` en `ImmersiveLayout`, met de bestaande CSS in `globals.css`.

## 2. Alleen het actieve bord is Immersive

`/jigsaw`, `/jigsaw/samen/[id]` en `/jigsaw/wedstrijd/[id]` zijn routes met meerdere interne stappen. Ze blijven **Focus-routes**
(`FOCUS_ROUTES` ongewijzigd, deeplinks, hervatten, uitnodigingen en sessiestatus idem). De kleinste architectonisch correcte oplossing is een
centrale, lifecycle-veilige uitbreiding van de modusselectie:

- `src/lib/shellModeOverride.ts`: een kleine store (zelfde patroon als `backTarget.ts`). Een scherm roept `useImmersiveShell()` aan en
  vraagt zo, zolang het gemonteerd is, om Immersive. Aanvragen tellen als stapel; opruiming bij unmount.
- `resolveShellMode(routeMode, requested)` (puur, in `focusMode.ts`): de aanvraag kan **alleen een Focus-route naar Immersive verheffen**.
  Normale routes (records, geschiedenis) en routes die al Immersive zijn veranderen er nooit door.
- `FocusModeController` leest de store (`useSyncExternalStore`) en zet de modus daarnaast in dezelfde commit direct op het element
  (layout-effect). Zonder dat rendert React de wissel pas na de passieve effecten van het bord, waar de werktafel haar eerste afmeting en
  camera bepaalt; het startbeeld werd dan voor de verkeerde (kleinere) layout berekend. Met de directe wissel is de layout bij de eerste
  meting al de uiteindelijke.
- `src/components/puzzle/PuzzleBoardLayout.tsx` is het canvas van het actieve bord (Solo, Samen en Tegen elkaar): `ImmersiveLayout` met
  `puzzle-workspace` plus `useImmersiveShell()`. Alleen de bordtak van `JigsawV2Client` (ook gebruikt voor wedstrijden) en `CoopClient`
  rendert dit. Catalogus, lobby, voltooiingskaart, vraag, uitslag, records en ranglijsten blijven `FocusLayout`/normaal.
- Layout: `.vs-immersive-layout.puzzle-workspace` is `100dvh` met de veilige randen (`--vs-safe-area-*`) als padding. Er is geen
  vrijgehouden ruimte meer voor een terugbalk, dus geen lege strook; de werktafel krijgt die hoogte. De verouderde Focus-regels voor
  `.puzzle-workspace` zijn verwijderd. Geen feature-specifieke CSS-hacks op shelldelen.
- Bij de eerste laad van een bordroute (server-HTML in Focus, daarna hydration) is de wissel in dezelfde commit als de eerste mount; er is dan
  hooguit het ogenblik van de server-HTML zelf in Focus.

## 3. Terugnavigatie blijft veilig

- De navigatiecontracten in `src/lib/puzzle/navigation.ts` zijn ongewijzigd (plus `history`): Solo → catalogus, Samen en Tegen elkaar →
  overzicht, zonder de sessie of wedstrijd te verlaten of te annuleren. "Puzzel verlaten" blijft een aparte, bevestigde handeling.
- De zichtbare terugweg op het bord is het bestaande zwevende bordmenu ("Andere puzzel kiezen" in Solo en Tegen elkaar, "Terug naar puzzels"
  in Samen). De terugbalk is op het bord verborgen (geen dubbele terugknop); `useSetBackTarget` blijft geregistreerd voor het moment dat een stap
  weer Focus is (voltooiingskaart, vraag).
- Browserterug, iOS-gebaren en de Android-systeemterug (`NativeAppBridge`: `history.back()`) gebruiken de browsergeschiedenis en zijn niet van
  de terugbalk afhankelijk; getest met `page.goBack()` en `goForward()` op het Samen-bord.
- De overgang BOARD → COMPLETE: de bordtak unmount, de aanvraag verdwijnt en de kaart staat weer in Focus met de gewone terugbalk
  (`celebrationGate`/`isActivityRoute` zijn routegebonden en dus ongewijzigd; geen secundaire viering verdringt de kaart).
- Het menu opent boven de knop; de maximale hoogte rekent met `--vs-safe-area-top/bottom` (geen `--header-height` meer: er is geen header).

## 4. Afgeronde puzzels: hub en geschiedenis

**Oorzaak van het verdringen.** `listCoopOverview` nam maximaal 20 sessies (actief en afgerond samen, op laatste activiteit) en
`listMatchOverview` maximaal 20 wedstrijden; veel recent afgeronde puzzels konden een lopende puzzel uit de lijst duwen. Alleen
`slice(0, 3)` in de UI had dat niet opgelost.

**Oplossing.**

- Lopend en afgerond hebben nu elk hun eigen limiet in beide overzichtsfuncties (lopend maximaal 20, afgerond maximaal 3). Een lopende
  puzzel of wedstrijd verdwijnt dus nooit meer doordat afgeronde de serverlimiet vullen. De semantiek (en de gate van `/jigsaw`) is
  verder gelijk; de 14-dagenregel voor wedstrijden op de hub is behouden.
- `src/lib/puzzle/history.ts` (alleen lezen): één gemeenschappelijke, deterministische volgorde voor Samen én Tegen elkaar op werkelijke
  afronding (`completedAt` resp. `finishedAt`), dan soort (wedstrijd vóór samen), dan id, allemaal aflopend. Die drie samen zijn uniek, dus
  keyset-paginatie sluit exact aan, ook bij gelijke tijden en terwijl er tijdens het bladeren iets bijkomt.
- Hub: `/api/puzzle/overview` levert `finished` (precies de drie laatst afgeronde, Samen en wedstrijden samen) en `hasHistory`; de hub toont die drie
  en daaronder de actie "Bekijk alle afgeronde puzzels". Lopend en wachtend zijn ongewijzigd.
- Geschiedenisweergave `/jigsaw/afgerond` (normale shell, zelfde terugbalkpatroon als records; `classifyPuzzleRoute` kent `history`) met
  `GET /api/puzzle/history?limit&cursor`: standaard 20 per pagina, maximaal 50, ongeldige cursor of limiet geeft 400. De eerste pagina komt uit
  de live-datalaag; "Meer laden" haalt de volgende met de servercursor en bewaart wat al getoond is (een verversing laat nooit iets verdwijnen).
  De bestaande acties "Bekijk resultaat" en "Vraag beantwoorden" zijn behouden (één gedeelde rij, `FinishedPuzzleRow`).
- Toegangscontrole: de queries filteren altijd op deelname van de ingelogde gebruiker (Samen: deelnemer; wedstrijd: niet afgewezen); een cursor
  geeft nooit toegang tot gegevens van een ander (getest). Er wordt niets verwijderd of gewijzigd. Oudere wedstrijden staan alleen op de
  geschiedenispagina, op dezelfde autorisatie als hun resultaatpagina.
- i18n: `puzzleTogether.overview.*` in alle vijf talen (nl, en, de, fr, es).

## 5. Draaiknop

`src/components/puzzle/RotateButton.tsx` is de gedeelde knop voor Solo, Samen en Tegen elkaar (`JigsawV2Client` en `PuzzleTable`): **76 × 76 CSS-px**
(was 60 × 60; px, net als het bordmenu, dus onafhankelijk van de tekstgrootte) met een icoon van **34 px** (was 26), zelfde `btn-primary`-stijl, drukfeedback
(`active:scale-95`, uit bij verminderde beweging), nog steeds linksonder (spiegelbeeld van het menu rechtsonder) en binnen de veilige randen van de
Immersive-werktafel. De knop verschijnt alleen wanneer draaien is toegestaan (Master, geselecteerde niet-vastgezette groep). De Samen-hintmelding
staat nu boven de knop in plaats van eronder. Rotatielogica, geometrie en snapregels zijn ongewijzigd.

## 6. Tests

| Bestand | Dekking |
| --- | --- |
| `tests/focus-mode.test.ts` | `shellModeForRoute` (routes blijven Focus), `resolveShellMode` (alleen Focus → Immersive), lifecycle van de aanvraag, bord gebruikt `PuzzleBoardLayout` en de rest `FocusLayout` |
| `tests/puzzle-history.test.ts` | volgorde, pagina's, cursor (geldig en geknoeid), route en shellmodus van de geschiedenis |
| `tests/puzzle-history.integration.test.ts` | hub = precies drie, 14-dagenregel, paginering zonder dubbelen of gaten (limiet 1/2/3/5, gelijke tijden), toegangscontrole, afgewezen/lopende wedstrijden, lopende puzzels niet verdrongen |
| `tests/puzzle-immersive.browser.mjs` | hub (precies drie, "Bekijk alle", lopende blijft), geschiedenis (20 + "Meer laden", 26 zonder dubbelen, API-grenzen, vreemde gebruiker), Solo-bord in Immersive op 320 × 568, 360 × 740, 390 × 844, 200% tekst, veilige randen, landscape 844 × 390 en desktop (geen header/terugbalk, geen lege strook, geen overflow, menu en draaiknop bereikbaar, 76 × 76 / icoon 34, niet over het menu, draaien werkt, terug via menu naar Focus), Samen met browserterug en vooruit |
| `tests/puzzle-navigation.browser.mjs`, `puzzle-flow`, `puzzle-mobile` | bijgewerkt naar het Immersive-bord (terug via het bordmenu; veilige randen, 6 maten) |
| Bestaand ongewijzigd | slim parkeren en uitwijken (`puzzle-parking`, `puzzle-visibility`), drag, difficulty, hint-inventory, feedback, multiplayer, records, integratie (solo, samen, wedstrijd, records, ranglijst, settle) |

## 7. Resterende risico's en beperkingen

- Alleen de allereerste serverrender van een bordroute is nog Focus (de server kent de stap niet); daarna wisselt de shell in dezelfde commit.
- iOS/PWA-safe areas zijn met CSS-variabelen en emulatie getest, niet op een echt apparaat; ook de Android-systeemterug en Capacitor zijn alleen
  via de browsergeschiedenis gecontroleerd. Echte iOS/Android-apparaten blijven nodig.
- Bij een zeer lage landscape-hoogte (390 px) ligt de draaiknop (76 px) op een groot deel van de linkerrand; hij blijft binnen het scherm en
  bedekt het menu niet, maar neemt werktafel in beslag zolang een stuk geselecteerd is.
- De geschiedenis toont een afgeronde wedstrijd ook na 14 dagen; de resultaatpagina van een oude wedstrijd valt onder dezelfde bestaande
  autorisatie.
