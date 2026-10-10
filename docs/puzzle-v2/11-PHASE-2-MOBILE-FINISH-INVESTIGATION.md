# Fase 2 — onderzoek mobiele afwerking

Baseline: actuele main `9cb9c0b` (PR #76). Branch
`fix/legpuzzel-v2-mobile-finish`. Geen fase 3.

## Aantoonbare oorzaken en gerichte aanpak

1. **Klein speelveld/stukken.** De shell beperkt main tot 5xl met pagina-
   marges, ook bij het spel. FocusLayout voegt een tweede min-hoogte toe.
   Canvas past altijd de hele ruime werktafel in beeld; 320px/24 stukken geeft
   ongeveer 18px per stuk. Ook iedere resize en Image.onload reset naar dit
   overzicht. Alleen de actieve board-layout vult voortaan de viewport onder
   de bestaande gemeten terugbalk. Een aparte startcamera kiest bruikbare
   stukgrootte en nabijgelegen stukken/voortgang; fit-all blijft in het menu.
   Resize behoudt het world-midden en zoom, met dezelfde tafelgrenzen.

2. **Aansluitingen.** De generator deelt inderdaad één descriptor per rand,
   maar tracePuzzlePiece gebruikt position en skew in beide looprichtingen
   ongewijzigd. Alleen het tab-teken omkeren is onvoldoende: het randcentrum
   wordt position versus 1-position en de asymmetrische curves verschillen.
   De oorspronkelijke test vergeleek alleen descriptor-objecten. Eén canoniek
   curvepad wordt voortaan exact omgekeerd, inclusief controlpunten. Seeds,
   descriptors, geometryVersion en snapshots blijven bestaan. Verbonden
   groepen worden als hun echte buitencontour getekend met één doorlopende
   beelduitsnede, zodat individuele clip-antialiasing/dubbele strokes geen
   interne kieren meer veroorzaken. Dit volgt op de geometrische correctie,
   niet op een dikker lijntje of een masker over fout passende stukken.

3. **Snapgevoel.** findSnapConnection geeft het versleepte stuk als a; merge
   behoudt juist groep a. Daardoor springt de stilstaande groep naar de
   versleepte groep. De snapcandidate krijgt voortaan het stilstaande anker
   eerst. De client volgt de groep via zijn stuk-id door opeenvolgende fusies.
   De world-toleranties blijven centraal/server-side; er komt een korte
   aantrekbeweging met reduced-motion-terugval. Geen pixelprecisie-eis of
   zoomafhankelijke servertolerantie. Tests dekken losse/losse, losse/groep
   en groep/groep, behoud van het stilstaande anker en canonieke coördinaten.

4. **Terug.** Alle speelstappen zijn lokale state onder /jigsaw; de centrale
   balk ziet alleen die route en kiest history/Spelen. De bestaande centrale
   backTarget-laag wordt uitgebreid met een contextactie: bord/completion/
   resultaat/replay naar de bestaande catalogus, vraag naar de volledige
   afbeelding. De catalogus is de root van de legpuzzel; alleen vanaf die
   root kan de normale centrale terugnavigatie de activiteit verlaten.
   Late requests mogen de catalogus/een nieuwe sessie niet opnieuw vervangen.

5. **Reekstekst.** Result gebruikt correctAlready als primaire status en
   toont een StreakContinuationCard. Completion vóór de vraag bevat al de
   juiste tekst. Result krijgt positieve puzzel-/antwoordfeedback in vijf
   talen, zonder centrale streakmelding. Centrale antwoord-/reeksafhandeling
   en celebrationGate blijven ongewijzigd.

6. **Oude UI.** /jigsaw importeert uitsluitend JigsawV2Client; er is geen
   difficulty-flag, query-toggle of fallback naar JigsawClient. Die oude
   ongebruikte component bestaat nog en wordt verwijderd. /api/jigsaw blijft
   als niet-visuele tokencompatibiliteit bestaan voor oude pogingen; geen
   productieroute gebruikt die UI. De actuele V2-interface heeft al geen
   locatie/verbindings/randhints, alleen contextueel Meester-draaien. V2 API
   accepteert geen hintactie. public/sw.js cachet geen pagina's of data.
   Oude screenshots bewijzen zonder build-id/productietrace geen tweede pad
   in de actuele build. Browsertests controleren ook hervatten met oude
   snapshot-hints en alle vier moeilijkheden; geen oude bediening zichtbaar.

## Verificatie

Eerst vector-/snapreproducties op baseline. Daarna bestaande engine-, sessie-
en vraag/reeksintegraties op de geïsoleerde gemigreerde database. Browser:
viewportvulling/scroll/safe areas op 320/390/430/landscape/tablet/desktop,
resize/resume, pinch/pan, echte snaps en pixelvergelijking langs verbonden
randen, terug in alle stappen, resultaatteksten, alle difficulty-controls.
TypeScript na samenhangende TS-wijzigingen; lint/i18n en schone build vóór PR.
Fysieke iOS/Android/WebView-acceptatie wordt onderscheiden van browseremulatie.

## Aanvullende browserbevinding

De pixeltest ontdekte tijdens uitvoering een leeg canvas bij de dubbele mount
van de ontwikkelmodus: cleanup annuleerde requestAnimationFrame, maar liet het
frame-id in de ref staan. schedulePaint zag daardoor blijvend een ingepland
frame. Cleanup wist nu ook de ref. De test leest de echte canvaspixels en kan
hierdoor niet groen worden met uitsluitend correcte canvasafmetingen.
Bij een reeks snaps blijft ook na de eerste verbinding het gevonden anker vast;
volgende nabijgelegen buren worden ernaartoe getrokken.
