# Kaartstandaard: Leren en Spelen

Hoe cursus- en spelkaarten werken, en hoe een nieuwe cursus of een nieuw spel
erbij komt zonder opnieuw te ontwerpen. Code: `src/components/versado/ContentCard.tsx`
(kaart, statuslabel, voortgang, beheermenu, toevoegpaneel) en
`src/components/SortableList.tsx` (slepen). Gebruikt door `CoursesClient`
(Leren, `/courses`) en `LiveLobbyForm` (Spelen, `/live`).

## De kaart (`ContentCard`)

```
┌─────────────────────────────┐
│        AFBEELDING        ⋯ │  afbeelding → openen, ⋯ → beheren
├─────────────────────────────┤
│ ⠿  LABEL  [status]          │  greep links → verplaatsen
│    Titel                 ⓘ │  titel → openen, ⓘ → uitleg
│    omschrijving (2 regels)  │
│    voortgang / hervatten    │
└─────────────────────────────┘
```

- Elke interactie heeft een eigen zone; de kaart als geheel is geen link.
  Afbeelding en titel openen dezelfde bestemming. Voor toetsenbord en
  schermlezer is alleen de titel een tabstop (de afbeeldinglink is
  `aria-hidden`); bij focus krijgt de hele kaart een rand.
- Geen pijl- of openknop en geen "Kies deze cursus": openen gaat via
  afbeelding of titel.
- ⓘ (`info`) alleen bij unieke uitleg die niet al op de kaart staat (nu de
  speluitleg). Cursussen hebben er geen.
- ⋯ (`actions`, meestal `cardActions`): Eerder in de lijst, Later in de
  lijst (toegankelijk alternatief voor slepen) en Verbergen uit overzicht.
  Geen losse ✕ op de kaart.
- Statuslabels via `StatusChip` (Speel nu, Voltooid, Uitgeschakeld voor
  gebruikers), voortgang via `CardProgress`. Omschrijving maximaal twee
  regels.
- Beeld: `MediaArtwork` (register in `src/lib/artwork.ts`), 21:9 op een
  telefoon, 16:9 vanaf `sm`, vaste verhouding (geen verschuiving tijdens
  laden). `priority` alleen voor de eerste kaart bovenaan.
- `wide`: de huidige cursus, met de afbeelding links op desktop en een
  compacte knop "Ga verder" (hervat bij de volgende les of stap,
  `resumeHref` uit `/api/courses`); afbeelding en titel openen het
  cursusoverzicht.
- Alleen `vs`-tokens: licht en donker gaan vanzelf goed.

## Slepen (`SortableList`)

- Alleen de greep (links, `touch-none`) start slepen; de rest van de kaart
  scrolt en tikt gewoon. Touch heeft een korte vertraging.
- Tijdens slepen: de oude plek blijft staan als grijze gestippelde
  plaatshouder, de doelplek is een gestippeld vlak in de accentkleur, de
  kaart zweeft los erboven (`DragOverlay`). Andere kaarten schuiven
  vloeiend op (FLIP, niet onder `prefers-reduced-motion`).
- Toetsenbord: spatie/enter op de greep, pijltoetsen (één plek per
  toets), spatie/enter neerzetten, escape annuleren. Aankondigingen voor
  schermlezers staan onder `cards.*` in de vertalingen.

## Toevoegen, verbergen en volgorde

- De ingang "Cursus toevoegen" / "Spel toevoegen" (`CardPicker`, gesloten) is een
  kaart in dezelfde taal als de cursus- en spelkaarten: afgeronde rand, vlak en
  schaduw uit `interactiveCard`, een icoon in een accenttegel, het label en één
  regel uitleg (`addHint`), minimaal 4 rem hoog en als geheel aantikbaar. De
  gestippelde rand is voorbehouden aan de plek waar je een kaart neerzet (slepen),
  niet aan een knop. De gesloten kaart is er voor Leren en Spelen hetzelfde;
  alleen het label en de uitleg verschillen. Getest in `tests/cards.test.ts`.

- Verbergen haalt een kaart alleen uit het eigen overzicht; er gaat nooit
  voortgang, score of geschiedenis verloren. Toevoegen (`CardPicker`)
  toont alleen wat nu verborgen is en zet het achteraan.
- Cursussen: zichtbaar = `UserCourseProgress.subscribed`
  (`/api/courses/[id]/subscribe` en `.../unsubscribe`). Toevoegen maakt een
  cursus niet actief; dat gebeurt pas als je er een les of stap van opent
  (`markCourseStarted` in `src/lib/courses.ts`, vanuit de lespagina's).
- Spellen: verborgen = `UserListOrder.hidden`. Wat beschikbaar is bepalen
  de content en `/adminbackend` (`isGameVisible`); personaliseren kan een
  uitgeschakeld spel nooit zichtbaar maken.
- Volgorde: `UserListOrder` per account (`/api/list-order`, `listKey`
  `courses` of `games`). Zonder `hiddenKeys` laat opslaan de verborgen set
  ongemoeid.

## Een nieuwe cursus of een nieuw spel

- Spel: een regel in `GAME_CATALOG` (`src/lib/gameCatalog.ts`), teksten
  onder `gamesHub.<textKey>` (omschrijving, regels), een cover in
  `GAME_COVERS` (`src/lib/artwork.ts`). Kaart, slepen, verbergen en
  toevoegen werken dan vanzelf.
- Cursus: komt uit de database (`syncCourses`); beeld via
  `courseArtworkKeys`. Een nieuw cursustype krijgt een label in
  `TYPE_LABELS` (`CoursesClient`) en, als het een eigen lespagina heeft,
  een aanroep van `markCourseStarted` daar.
- Getest met `npm run test:cards`.
