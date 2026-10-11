# Contentarchitectuur V2 — fase 0

Auditdatum: 11 oktober 2026. Bron: main `b5aafbf843939f362ae0240b0b95f4540d5dcfa6`.
Werkbranch: `audit/content-architecture-v2-phase-0`.

Dit is een ontwerp en implementatieplan. Alleen deze documentatiemap is
gewijzigd. Er zijn geen migraties, imports of wijzigingen in applicatielogica
uitgevoerd. De zeven genummerde documenten vormen samen de oplevering.

## Wat bestaat al?

Versado heeft een bruikbaar fundament: `ContentCollection` onderscheidt werk,
editie-familie en taal. De actieve collectie en contenttaal staan op `User`.
Een centrale contentwissel zoekt passende routes. Boek, hoofdstuk en vers,
cursussen, oefeningen, persoonlijke annotaties, reeks en XP hebben bestaande
modellen. De app heeft één shell, focusmodus, navigatiegeschiedenis en een
centrale live-data-laag.

FSY heeft een eigen collectie, maand-/categorie-indeling, scraper,
conceptinhoud, gepubliceerde tekstkopie en adminpreview. De OTB-importer
importeert inmiddels de volledige gepinde Bijbelbron in vijf talen in
verborgen OT/NT-collecties; de README beschrijft nog de vroegere proefimport.
Dit zegt iets over de code, niet over de daadwerkelijk geïmporteerde
productiedatabase.

## Wat ontbreekt?

- Een expliciet bronsoortmodel en een betrouwbare publicatie-/toegangspoort
  die ook voor directe API-verzoeken geldt.
- Een persistente leskeuze per studieprogramma, onafhankelijk van cursuskeuze
  en kalenderweek. CFM heeft nog geen aangetroffen implementatie.
- Volledige semantische lesinhoud met stabiele ankers, media, verwijzingen,
  onveranderlijke publicatieversies en veilige updates.
- Een leespositie die losstaat van expliciet gelezen en cursus-/oefenafronding.
- Passagemarkeringen en een centrale studiemap voor alle bronnen.
- Een spelresolver die daadwerkelijke inhoud controleert. Een
  `GameContentScope`-rij is momenteel vooral een aanbodinstelling.

## Aanbevolen architectuur

Behoud `ContentCollection` als concrete editie in een taal. Voeg een kleine
`ContentWork`-catalogus toe voor logische werken/programmatypen. Gebruik voor
CFM en FSY één nieuwe lesfamilie: `StudyPeriod`, `StudyLesson`,
`StudyLessonEdition` en onveranderlijke `StudyRevision`. Secties en tekstblokken
staan als gevalideerde, versiegebonden JSON in die revisie; geen eigen
databasetabel voor ieder tekstfragment.

Hergebruik `ContentProgress` voor algemene leesstatus, maar houd precieze
leespositie in `ReadingPosition` en actieve leskeuze in `UserStudyContext`.
Cursusvoortgang blijft in de bestaande cursusmodellen. Eén persoonlijke
annotatieservice breidt `Bookmark`, `Highlight` en `Note` uit met lestargets;
bestaande versrecords blijven op hun plaats. Eén verwijzingsresolver en één
spelresolver passen boven de huidige services, zonder nieuwe frameworks.

De bronkiezer wordt een echte route in de bestaande shell, met de twee
vastgelegde groepen en geïntegreerde taalkeuze. Bronkeuze werkt met één tik;
een ontbrekend route-equivalent leidt na de wissel naar het passende onderdeel
van de gekozen bron, zonder bevestigingsdialoog of terugval op andere inhoud.

## Grootste risico’s

1. **Toegang is niet overal afgedwongen.** Onder meer de hoofdstuk-API en
   leesmutaties controleren login/bestaan maar niet de collectiezichtbaarheid.
2. **Identiteit is niet overal gelijk.** Nieuwe editie-families mogen niet
   stilzwijgend dezelfde voortgang, posities of tekstannotaties delen.
   Bestaande voortgangsleutels mogen evenmin zomaar veranderen.
3. **Imports kunnen gebruikershistorie beschadigen.** `importBooks` vervangt
   oefeningen en verwijdert verdwenen verzen; cascades raken annotaties en
   oefenhistorie. Dit patroon mag niet naar studielessen worden gekopieerd.
4. **Publicatie en ankermigratie moeten atomair en herleidbaar zijn.** Nieuwe
   broncontent mag betaalde/voltooide sessies of privépassages niet vervormen.
5. **Productie-inventaris ontbreekt in deze audit.** Aantallen FSY-lessen,
   publicaties en bestaande persoonlijke records zijn niet live opgevraagd.
   Een toegestane, alleen-lezen inventaris en herstelproef zijn uitrolgates.

## Ontwikkelvolgorde

| Fase | Resultaat | Vrijgavevoorwaarde |
|---|---|---|
| 1 | Bronsoorten, toegangsregels, context en fullscreen kiezer | Geen verborgen bron via UI/API; bestaande routes blijven bruikbaar |
| 2 | Gedeelde lezer, versies, importbasis, media, verwijzingen en positie | Geen automatische afronding; publicatie/rollback en ankers getest |
| 3 | CFM 2026 en gemigreerde FSY | Officiële kalender/identiteiten gecontroleerd; oude FSY-links behouden |
| 4 | Contextuele annotaties en Mijn studiemap | Alle oude annotaties intact; privacy en updateherstel aangetoond |
| 5 | Werkelijke spelcontentresolutie en later Het Verborgen Woord | Geen bronvermenging; spelontwerp afzonderlijk goedgekeurd |

Fase 1 legt alleen de actieve-lesopslag en resolvercontracten klaar. De
volledige lesrevisies volgen in fase 2. Minimale speltoegang/afwijzing hoort
al bij fase 1; de daadwerkelijke nieuwe speladapters horen bij fase 5.

## Onderbouwing en beoordeling

- [01 — Audit](01-CURRENT-STATE-AUDIT.md): feiten, codepaden en beperkingen.
- [02 — Doelarchitectuur](02-TARGET-ARCHITECTURE.md): modellen en contracten.
- [03 — Migratie](03-MIGRATION-STRATEGY.md): gegevensbehoud en rollback.
- [04 — Roadmap](04-IMPLEMENTATION-ROADMAP.md): kleine werkpakketten per fase.
- [05 — Test- en risicoplan](05-TEST-AND-RISK-PLAN.md): huidige controles en uitrolgates.
- [06 — Besluiten](06-DECISIONS-AND-OPEN-QUESTIONS.md): vastgelegde UX, advies en echte onzekerheden.

De uitgevoerde databasevrije controles slagen: 53 content/leer/import/studie-
tests, 23 focus/shell-tests, 51 live-data-tests en TypeScript. De i18n-check
meldt de bestaande vertaalachterstand; ESLint heeft geen fouten en 132
bestaande waarschuwingen. Prisma-validatie slaagt zonder databaseverbinding.
Er is geen nieuwe browser-, database-
of productievalidatie geclaimd. Details staan in document 05.
