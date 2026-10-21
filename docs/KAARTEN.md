# Kaartstandaard: Leren en Spelen

Hoe cursus- en spelkaarten werken, en hoe een nieuwe cursus of een nieuw spel
erbij komt zonder opnieuw te ontwerpen. Code: `src/components/versado/ContentCard.tsx`
(kaart, statuslabel, voortgang, beheermenu, toevoegpaneel). Gebruikt door `CoursesClient`
(Leren, `/courses`) en `LiveLobbyForm` (Spelen, `/live`).

## De kaart (`ContentCard`)

```
┌─────────────────────────────┐
│        AFBEELDING        ⋯ │  afbeelding → openen, ⋯ → beheren
├─────────────────────────────┤
│ LABEL  [status]             │
│ Titel                    ⓘ │  titel → openen, ⓘ → uitleg
│ omschrijving (2 regels)     │
│ voortgang / hervatten       │
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
  lijst en Verbergen uit overzicht. Dit is de enige handmatige bediening
  voor positie en zichtbaarheid op Leren en Spelen.
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

## Bediening en toegankelijkheid

- Leren en Spelen hebben geen sleepgreep, draglisteners, sensoren of overlay.
  De kaartinhoud gebruikt de volledige binnenbreedte. Tikken en scrollen op
  de inhoud starten geen sleepactie.
- Het kaartmenu heeft een aanraakvlak van minimaal 44 px. Enter/spatie of
  pijl omhoog/omlaag opent het; pijlen, Home en End kiezen een beschikbare
  actie. Escape sluit en herstelt focus. Tab verlaat het menu. Na verplaatsen
  blijft focus op het menu van dezelfde kaart, zonder bewust scrollen.
- **iPhone Safari**: een tik geeft een knop daar geen focus. Het menu-item dat bij openen
  programmatisch focus kreeg, verliest die dan met `relatedTarget = null`, nog vóór de click.
  Het menu mag daarom nooit sluiten op een blur zonder `relatedTarget` (dat haalde het menu weg
  vóór de gekozen actie liep); alleen focus die aantoonbaar naar een element buiten het menu gaat
  (toetsenbord, schermlezer) of een pointerdown buiten het menu sluit. De browsertest emuleert
  dit gedrag met `touchscreen.tap()`; Chromium-emulatie vervangt geen test op een echte iPhone.
  Nog handmatig op een toestel te doen: ⋯ tikken op Leren en Spelen, Eerder/Later/Verbergen
  kiezen, buiten het menu tikken, scrollen met open menu, en dit met grotere tekst en
  VoiceOver aan.
- Eerste/laatste positie begrenzen de verplaatsacties. De actieve cursus
  staat los van deze lijst en heeft uitsluitend Verbergen in haar menu.
- De menuafmetingen en positie blijven binnen het venster, tussen de shellbalken;
  lange vertalingen en 200% tekst kunnen afbreken en zo nodig binnen het menu scrollen.
- Andere onderdelen, waaronder uitgelichte prestaties op het profiel, behouden
  `SortableList` en `DragHandle`, inclusief sleep- en toetsenbordbediening.

## Toevoegen, verbergen en volgorde

- De ingang "Cursus toevoegen" / "Spel toevoegen" (`CardPicker`, gesloten) is een
  kaart in dezelfde taal als de cursus- en spelkaarten: afgeronde rand, vlak en
  schaduw uit `interactiveCard`, een icoon in een accenttegel, het label en één
  regel uitleg (`addHint`), minimaal 4 rem hoog en als geheel aantikbaar. De
  toevoegkaart gebruikt geen gestippelde rand. De gesloten kaart is er voor Leren en Spelen hetzelfde;
  alleen het label en de uitleg verschillen. Getest in `tests/cards.test.ts`.

- Verbergen haalt een kaart alleen uit het eigen overzicht; er gaat nooit
  voortgang, score of geschiedenis verloren. Toevoegen (`CardPicker`)
  toont alleen wat nu verborgen is en zet het achteraan.
- Studiecursussen (CFM: Stap voor stap en Vrije studie) gebruiken dezelfde kaart en hetzelfde toevoegen/verbergen; de kaart toont
  voortgang in weken en het lesbeeld van de huidige week (`artwork.asset`). Zie `docs/CFM-PERSOONLIJKE-STUDIE.md` §16.
- Cursussen: zichtbaar = `UserCourseProgress.subscribed`
  (`/api/courses/[id]/subscribe` en `.../unsubscribe`). Toevoegen maakt een
  cursus niet actief; dat gebeurt pas als je er een les of stap van opent
  (`markCourseStarted` in `src/lib/courses.ts`, vanuit de lespagina's).
- Spellen: verborgen = `UserListOrder.hidden`. Wat beschikbaar is bepalen
  de content en `/adminbackend` (`isGameVisible`); personaliseren kan een
  uitgeschakeld spel nooit zichtbaar maken.
- Volgorde: `UserListOrder` per account (`/api/list-order`, `listKey`
  `courses` of `games`). Zonder `hiddenKeys` laat opslaan de verborgen set
  ongemoeid. Geen wijziging aan database of API-contract.
- Beide overzichten gebruiken `useCardListSave` voor één schrijfactie tegelijk.
  Verplaatsen en spelzichtbaarheid worden optimistisch bijgewerkt; bij fouten
  keert de eerdere weergave terug en verschijnt een vertaalde foutmelding.
  Cursustoevoeging/verberging blijft de bestaande subscribe-API gebruiken.
  Een herlaadactie leest de opgeslagen servervoorkeuren. Verschillende tabs
  hebben geen versieconflictdetectie: de laatste geslaagde opslag geldt.

## Een nieuwe cursus of een nieuw spel

- Spel: een regel in `GAME_CATALOG` (`src/lib/gameCatalog.ts`), teksten
  onder `gamesHub.<textKey>` (omschrijving, regels), een cover in
  `GAME_COVERS` (`src/lib/artwork.ts`). Kaart, verplaatsen via het menu, verbergen en
  toevoegen werken dan vanzelf.
- Cursus: komt uit de database (`syncCourses`); beeld via
  `courseArtworkKeys`. Een nieuw cursustype krijgt een label in
  `TYPE_LABELS` (`CoursesClient`) en, als het een eigen lespagina heeft,
  een aanroep van `markCourseStarted` daar.
- Getest met `npm run test:cards` en `npm run test:layout:browser -- --cards-only`.
  De volledige layout-runner voert de kaartbrowsertest ook uit; mobiele screenshots
  verschijnen bij de bestaande GitHub-browserartifacts.
