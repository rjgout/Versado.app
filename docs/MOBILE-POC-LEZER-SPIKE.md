# Lezer-spike: schrift native lezen en selecteren met React Native (Expo)

Status: **spike, draft** (PR #286). Geen merge, deployment of upload zonder aparte toestemming van de eigenaar.
Code: uitsluitend `apps/mobile-poc/` (`src/reader/`, `src/app/(tabs)/lezen.tsx`, `e2e/06…11`, `tests/`). Geen backendwijziging,
geen WebView, geen nieuwe annotatiedatabase en geen gedupliceerde bedrijfsregels.

## 1. Vraag en antwoord in het kort

Kan Versado's schriftlezer met echte native React Native-componenten werken, met behoud van het bestaande vers-/offsetmodel,
annotaties en backendcontracten?

- **Hoofdstuk ophalen, tekst native tonen, markeren, notitie opslaan, herladen:** ja, volledig via de bestaande routes en
  contracten (`courses` → `path` → `read/chapters/{id}` → `annotations`), gevalideerd met de bestaande zod-schema's.
- **Echte platformselectie met bereik:** ja, met een kleine, eenvoudige oplossing: de hoofdstuktekst is één niet-bewerkbare,
  meerregelige `TextInput` (UITextView / EditText) met `onSelectionChange`. Geen eigen native module nodig voor schrift.
- **Belangrijke kanttekening, bevestigd in de code:** het bestaande contract voor **schrift** is **vers-granulair**. Een annotatie
  hangt aan een `verseId` (`annotationsContract.ts`: `target: { type: "verse", verseId }`). Sub-vers-offsets
  (`blockId`/`start`/`end`/`exact`/`prefix`/`suffix`) bestaan alleen voor **studielessen** (`target.type === "lesson"`). Een selectie van
  een woord of een deel van een vers kan dus nu alleen als **markering van het geraakte vers** worden bewaard. De spike levert wel
  exact de offsets in het bestaande offsetmodel (door het contract gevalideerd), maar bewaart ze niet: daarvoor is een
  contractuitbreiding nodig die buiten deze spike valt (zie besluit B1).

## 2. Wat is gebouwd

| Onderdeel | Bestand | Rol |
|---|---|---|
| Hoofdstuk en annotaties | `src/reader/api.ts` | Bestaande native routes en zod-contracten; `expectedVersion` uit de bestaande rij; geen eigen regels |
| Selectielogica (zuiver) | `src/reader/selectionModel.ts` | UTF-16-offsets van de native selectie → bereiken per vers in codepunten van de genormaliseerde tekst (zelfde semantiek als `domSelector.boundary`) |
| Native tekst | `src/reader/SelectableChapter.tsx` | Niet-bewerkbare `TextInput` + geneste `<Text>`-stijlen voor markeringen |
| Scherm | `src/app/(tabs)/lezen.tsx` | Derde native tab "Lezen": selectie-info, Markeren, Markering wissen, Notitie, lettergrootte |
| Proefinhoud | `fixtures/proefboek.json`, `scripts/seed-reader-content.ts` | Eigen, synthetische tekst (geen schrifttekst) via de echte importer (`importBooks` → `syncCourses`) |

Eigen code: 385 regels (`src/reader` + scherm) plus 298 regels tests. Ter vergelijking telt de huidige lezer-/annotatie-UI
(`NativeReaderView`, `ScriptureReaderView`, `useVerseAnnotationMenu`, `AnnotationActions*`, `AnnotationRecovery`, …) 1.185 regels; die bevat
dingen die de spike bewust níet nabouwt (conflict- en herstelstatussen, toegankelijk vers-menu, audio-koppeling, leespositie).

## 3. Onderzochte oplossingen voor selectie

| Optie | Beschrijving | Beoordeling |
|---|---|---|
| **A. `TextInput` niet-bewerkbaar met `onSelectionChange`** (gekozen) | Echte platformselectie (loupe, grepen, systeemmenu, woord/regel/alles), offsets via event | Eenvoudigst; werkt op beide platforms (zie §5). Beperkingen: zie §6 |
| B. Eigen native view (Expo-module met UITextView / TextView) | Volledige controle: markeren in de attributed text, context-menu-items, `UITextInteraction`, grepen | Alleen nodig als A tekortschiet (rijke tekst, eigen menu). Naar schatting 2–4 weken voor Swift + Kotlin, plus onderhoud. **Niet gebouwd**: A volstaat voor schrifttekst |
| C. `<Text selectable>` | Systeemselectie zonder bereik | Onbruikbaar: geeft geen offsets |
| D. Eigen selectie (woord voor woord, tikken/slepen) | Volledig voorspelbaar, eigen UX | Meer werk en geen platformgevoel; niet nodig |
| E. Community-module (bv. selecteerbare tekst) | Kant-en-klaar | Onderhoudsrisico; niet beoordeeld in code |

Platformverschil dat A vereist: iOS `editable={false}` laat de UITextView selecteerbaar; Android schakelt een niet-bewerkbare
`EditText` uit (geen selectie). Daarom is de tekst op Android bewerkbaar maar zonder toetsenbord (`showSoftInputOnFocus={false}`,
`caretHidden`); de tekst komt uit de kinderen en wordt bij elke render teruggezet.

## 4. Offsetmodel en de bestaande contracten

- De hoofdstuktekst is `"<nr> <tekst>\n"` per vers (`buildLayout`). De weergave bouwt exact deze string; een componenttest bewaakt dat,
  want alle offsets berusten erop.
- `selectionToVerseRanges` vertaalt een UTF-16-selectie naar bereiken per vers; nummers en alinea-einden tellen niet mee; een
  grens midden in een surrogaatpaar schuift naar buiten; witruimte wordt samengevouwen zoals `normalizeAnnotationText` doet.
- `rangesToSelector` maakt er een `PassageSelector` van, en **`validatePassageSelector` uit het bestaande contract keurt die goed**
  (eenheidstests, 9 gevallen: woord, deel van vers, over verzen, dubbele spatie/tab, surrogaatpaar). Een onjuiste selector wordt door
  het contract geweigerd; de spike heeft dus geen eigen validatieregels.
- Gedupliceerd (klein, gemarkeerd): `normalizedOffset` herhaalt de semantiek van `boundary` in `domSelector.ts`, omdat dat bestand
  aan het DOM gebonden is. Aanbeveling bij een vervolg: `boundary` verplaatsen naar een zuivere, gedeelde module.
- Vers-id's kunnen met een cijfer beginnen; het contract eist een letter vooraan voor ankers. De spike gebruikt `verse:<id>` als blok-id.

## 5. Resultaten

(zie §5a en §5b; ingevuld na de CI-runs)

## 6. Risico's en beperkingen

(zie §8)
