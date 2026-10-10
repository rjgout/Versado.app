# Legpuzzel V2 — tijdelijke sleepprioriteit

Branch: `fix/legpuzzel-v2-drag-priority`, vanaf main `317cdda` (inclusief
fase-2-afwerking PR #77). Alleen de Solo-rendering wordt gecorrigeerd.

## Gelokaliseerde oorzaak

`JigsawV2Client.paint` tekende alle groepen in de opgeslagen arrayvolgorde.
Een eerder opgeslagen groep werd dus door later getekende stukken bedekt,
ook wanneer die groep actief werd versleept. Selectie veranderde alleen de
contourkleur; er was geen tijdelijke renderprioriteit of lift.

Opnieuw oppakken van dezelfde selectie veroorzaakte bovendien niet altijd
een React-statewijziging. Alleen op state-effecten vertrouwen garandeert
geen repaint op pointerdown of bij het starten van pinch.

## Correctie

- `puzzleRenderOrder` tekent andere groepen in hun bestaande volgorde, daarna
  het actieve drag-doel als één gehele groep. De snapshot wordt niet gewijzigd.
- Alleen `drag.current.groupId` bepaalt prioriteit, niet de blijvende selectie.
- De groepscontour, afbeelding en stroke komen tijdens slepen twee CSS-pixels
  hoger te liggen. Dit is uitsluitend een cameragerelateerde rendervertaling,
  vóór rotatie; wereldcoördinaten, servervalidatie en snap blijven gelijk.
- Eén echte buitencontour werpt een subtiele schaduw buiten de beeldclip.
  De afbeelding en interne aansluitingen houden hun bestaande rendering.
- Pointerdown, pointerup en overgang naar pinch vragen expliciet een repaint.
  Loslaten heft prioriteit/lift al vóór de API-response op. Pointercancel
  gebruikt de bestaande herstelroute en heft de visuele lift ook op.

## Verificatie

`tests/puzzle-fit.test.ts` controleert alle groepen, volledige groepsleden,
geen dubbele objecten, stabiele overige volgorde, herstel en onveranderde
snapshot. `tests/puzzle-drag.browser.mjs` gebruikt echte muis/touch en API,
een eigen kleurafbeelding/sessies in de geïsoleerde database, en meet pixels:
los stuk, verbonden groep en 90° geroteerde groep op desktop en mobiel.

De nieuwe browsertest wordt via de bestaande geïsoleerde runner ook in CI
uitgevoerd. Bestaande browserflows bewaken snapping, groepsverplaatsing,
pinch/pan, hervatten, contentkeuze, vraag en beloningen. Resultaten worden
na uitvoering hieronder vastgelegd.

## Uitgevoerde controles

| Controle | Resultaat |
| --- | --- |
| Puzzelengine, geometrie, snapping, catalogus en legacy | 30 geslaagd, geen skips |
| Geïsoleerde PostgreSQL-integratie, alle 132 migraties | 16 geslaagd, geen skips; container na afloop verwijderd |
| Productie-browserflow | Groen: volledige cyclus, hervatten, replay, historie, contentkeuze en beloningsregels |
| Bestaande mobiele productie-browser | Groen: zes schermmaten, exacte naden, safe areas, pinch/pan en groepssnap |
| Nieuwe drag-browser | Alle zes gevallen groen; desktop 1280×900/DPR1, mobiel 390×844/DPR3; daadwerkelijke muis- en touch-events |
| Liftmeting | In alle zes gevallen exact 2 CSS-pixels; geen lift in opgeslagen wereldpositie |
| TypeScript | Groen na implementatie/testwijziging en opnieuw na productiebuild |
| Schone productiebuild | Groen |
| Lint | Geen fouten; 133 bestaande waarschuwingen. Gewijzigde bestanden zonder waarschuwingen |
| i18n | Controle uitgevoerd; geen tekstwijzigingen. Bestaande dekking 3194/3617 per vertaling, 423 ontbrekende keys buiten deze bugfix |

Screenshots en `drag-measurements.json` staan bij lokale uitvoering onder
`/tmp/versado-puzzle-browser` en worden in CI door de bestaande workflow als
artifact bewaard. De test meet volle stukoppervlakken, niet de uitsparingen.
Ook opnieuw oppakken zonder React-statewijziging, wachten op de move-response,
annuleren en pinch-start zonder beweging zijn daadwerkelijk gecontroleerd.

Browsercontrole gebruikt Chromium met desktopmuis en mobiele touch-emulatie.
Een fysieke iPhone/Android-webview of Safari is in deze omgeving niet getest.
Er zijn geen wijzigingen aan server-, snap-, geometry- of beloningsregels en
geen fase-3-werkzaamheden.
