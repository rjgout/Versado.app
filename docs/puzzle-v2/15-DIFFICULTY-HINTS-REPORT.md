# Fase 2 — moeilijkheid, bordplaatsing, hints en bediening

Werkbranch: `feature/puzzle-v2-difficulty-hints`, vanaf main `79636bd`.
Ontwerp vooraf vastgelegd in `14-DIFFICULTY-HINTS-DESIGN.md` (`57484ab`).
Server/engine: `7e76522`; interface, vertalingen en browserbescherming: `4204605`.
Dit verslag is de laatste documentatiecommit. De PR wordt ter review op main
geopend; er wordt niet zelfstandig gemerged. Fase 3 blijft buiten scope.

## Nieuwe regels en veilige overgang

| Niveau | Voorbeeld | Buitencontour | Bordverankering | Rotatie | Inbegrepen hints |
| --- | --- | --- | --- | --- | --- |
| Ontdekker | transparant | ja | ja | nee | onbeperkt |
| Avonturier | nee | ja | ja | nee | 3 |
| Expert | nee | nee | nee | nee | 2 |
| Meester | nee | nee | nee | 90° | 1 |

6/12/24/48/96 stukjes zijn onafhankelijk van moeilijkheid. Alle nieuwe niveaus
gebruiken .36 world-unit voor geldige stuk-/groepverbindingen, onafhankelijk
van zoom. Expert/Meester tonen ook geen leeg wit oplossingsvlak meer.

Nieuwe varianten gebruiken rulesVersion 2. Bestaande rulesVersion 1 hervatten
met hun oude snapafstand en visuele ondersteuning, inclusief de eerdere lege
bordweergave, zonder bordverankering. Het menu licht dit toe. Start vindt de
open poging voor dezelfde eigenaar/content/aantal/moeilijkheid, ook over oude
regels- en geometrieversies heen. Een open vraag blijft open; na afronding
maakt opnieuw spelen een nieuwe regels-2-poging. Geometry 1/2, historische
antwoorden, hints, filters, sessies en persoonlijke records blijven intact.
Geen schemawijziging of datamigratie; bestaande JSON-velden worden additief
uitgebreid. Toekomstige vergelijkingen moeten de variant, geometryVersion,
rulesVersion en extraHintsUsed gebruiken. Er is geen ranglijst gebouwd.

## Bordplaatsing en verankerde groepen

`anchor` is afzonderlijk van `connect`. De server leidt de canonieke positie
zelf af uit werktafel/definitie en het stabiele groepsanker. Een request bevat
alleen het groeps-id, de sessieversie en actionId. Rechten, SOLO-eigenaar,
moeilijkheid, groepsstructuur, oriëntatie, tolerantie en unieke stukdekking
worden gecontroleerd onder de bestaande transactielock.

Iedere groep wordt via acyclische canonieke buurverbindingen bewezen; dubbele
leden, verkeerde buren, cycli en verschoven bordankers zijn ongeldig. Canonieke
unieke stukcellen voorkomen dubbele bordplaatsingen. Verankerde groepen mogen
niet bewegen/draaien. Een vrije groep kan met een bordanker verbinden; dat
anker blijft staan ongeacht de clientvolgorde. Aangrenzende verankerde groepen
worden met geldige boomverbindingen samengevoegd, ook via een nieuw brugstuk.

De drop behoudt eerst bestaande stuk-/groep-snaps en probeert daarna
bordplaatsing van het gegroeide geheel. De bestaande 140ms-snapanimatie wordt
hergebruikt, met reduced-motion-respect en een rustige randkleur voor ankers.
Voltooiing vereist volledige bewezen structuur plus correcte oriëntatie:
één volledige vrije groep of volledige geldige bordverankering. Dezelfde
validator beschermt statusherstel en antwoorden; positie/timestamp/status
alleen zijn onvoldoende. Vraag, felicitatie, centrale activiteitclaims,
kalenderdagregels en geen-XP zijn behouden.

## Vier tijdelijke hints en bediening

Het bestaande ⋯-menu opent een compact hintpaneel. Geen bak, permanente
hintbalk of nieuwe header. PREVIEW toont de hele afbeelding vijf seconden;
LOCATION markeert de canonieke plek van de hele selectie; CONNECTION markeert
een echte externe buur; FILTER benadrukt hoek/rand/midden, inclusief filtering
binnen verbonden groepen. Stukken blijven op hun positie en verbindingen
blijven intact. Bij zes stukjes bestaan geen middenstukken; die optie is
uitgeschakeld en wordt nooit afgeschreven.

De server registreert type, at, expiresAt, target, actionId, sessie en extra
in de bestaande snapshot/actionlog. Budget wordt onder dezelfde lock berekend.
Een lopende hint voorkomt snel dubbel afschrijven; dezelfde request-id blijft
idempotent. Ongeldige targets kosten niets. Het paneel toont het resterende
budget en meldt vooraf wanneer de volgende hint extra is. Herladen herstelt
alleen de resterende tijd. Hintgebruik maakt geen reeksclaim, verandert geen
XP en plaatst/verbindt nooit automatisch. Records bewaren beide hinttellers.
Oude permanente filters blijven auditbaar, maar worden niet permanent getoond.

Menu en contextuele Meester-rotatie zijn minimaal 60×60 CSS-pixels met 26px
iconen en consistente afwerking. Ze blijven in schermcoördinaten, boven de
safe area. Panelen openen boven de echte knophoogte en hebben een begrensde
scrollhoogte; geen overlap bij 200% tekst of landscape. Enter/Spatie selecteren
stukken; pijltjes verplaatsen, R draait bij Meester en nul toont alles passend.
De painter leest de actuele selectie uit een ref, ook na vertraagde hinttimers.

Alle vijf talen hebben de nieuwe uitleg en bediening. Kompas gebruikt de
bijgewerkte spelregels met topicversie 2; de bestaande vraag/reeks/geen-XP-uitleg
blijft staan.

## Gewijzigde bestanden

- Engine/service: `src/lib/puzzle/types.ts`, `engine.ts`, nieuw `hints.ts`,
  `solo.ts`, `src/app/api/jigsaw-v2/route.ts`.
- Interface: `src/components/JigsawV2Client.tsx`, nieuw `PuzzleHintPanel.tsx`.
- Uitleg: `src/lib/i18n/messages/{nl,en,de,fr,es}.ts`,
  `src/lib/kompas/registry.ts`.
- Tests: `tests/puzzle-engine.test.ts`, nieuw `puzzle-rules.test.ts`,
  nieuw `puzzle-copy.test.ts`, uitgebreid `puzzle-solo.integration.test.ts`,
  nieuw `puzzle-difficulty.browser.mjs`.
- Uitvoering: `package.json`, `scripts/puzzle/test-isolated.mjs`,
  `.github/workflows/puzzle-v2.yml`.
- Documentatie: `02`, `03`, `04`, `06`, `07`, nieuw `14` en dit verslag `15`
  onder `docs/puzzle-v2/`. Historische audit/rapporten blijven behouden.

## Uitgevoerde controles

| Controle | Resultaat |
| --- | --- |
| `npm run test:puzzle` | 41 geslaagd, 0 skips; inclusief nieuwe regels/hints/uitleg en alle bordformaten |
| Geïsoleerde database-integratie | 22 geslaagd, 0 skips; tijdelijke PostgreSQL 16, alle 132 migraties, geen externe database |
| Vier productiebrowserreeksen | Geslaagd: bestaande flow, mobiele naad/input/layout, dragprioriteit en nieuwe difficulty/hints |
| `test:focus` | 23 geslaagd |
| Kompas unit/layout | 60 geslaagd |
| `test:live-data` | 51 geslaagd |
| TypeScript | Geslaagd na samenhangende wijzigingen en productiebuild |
| Prisma validate/generate | Geslaagd |
| Schone productiebuild | Geslaagd |
| Lint | 0 fouten, 133 bestaande waarschuwingen; gewijzigde bestanden zonder waarschuwingen |
| i18n | Alle nieuwe keys in vijf talen; 3219/3642 vertaald per overige taal; 423 bestaande ontbrekende keys onveranderd |
| `git diff --check` | Geslaagd |

De DB-tests controleren eigenaren, opslag/hervatting, anchor/autosave-races,
retry-idempotentie, geen voortijdige voltooiing, juiste vraag, hintbudget/extra,
geen hintspecifieke reeks/XP, historische antwoorden/replay, versieovergang en
het starten van alle 216 afbeeldingen. Productiebrowsers testen echte muis en
CDP-touch, elke difficulty, boardpixels, verankering, rotatie, alle vier hints
met echte canvasmarkers en verval, reload zonder afschrijving, budgetmelding,
60px, safe areas, klein/landscape/200%, Duits en strenge API-inputvalidatie.
Bestaande pinch/pan, groepssnaps, naadpixels, navigatie en beloningsflows slagen.

CI voert dezelfde geïsoleerde runner na een productiebuild uit en bewaart
screenshots plus meetgegevens als `puzzle-v2-browser`-artifact (7 dagen).
De uiteindelijke exacte PR-head wordt afzonderlijk in GitHub Actions beoordeeld;
de lokale resultaten hierboven zijn geen claim over een nog lopende CI-run.

## Grenzen van de validatie

Browsercontrole is Chromium desktop en mobiele touch-emulatie. Een fysieke
iPhone/Safari, Android WebView of Capacitor-build is hier niet getest. De
live beoordeling van gevoel/leesbaarheid op die apparaten blijft nodig.
Geen functionele blokkade resteert in de uitgevoerde automatische scenario's.
Bestaande projectbrede lint-/vertaalachterstand is niet in deze feature gewijzigd.
Fase 3 is niet begonnen en wordt door deze oplevering niet goedgekeurd.
