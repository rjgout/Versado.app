# Leespaden: één visuele ervaring voor alle schriftuurlijke leescursussen

Stap voor stap (`READING_LESSONS`), Hoofdstuk voor hoofdstuk (`FRONT_TO_BACK`) en Vrije keuze (`FREE_CHOICE`) delen
één visuele familie en één Focusroute: `/courses/<id>/pad` (zie `src/lib/focusMode.ts`). `/courses/<id>` stuurt alleen
deze drie typen door (`isReadingPathType`); alle andere cursustypen (podcast, kinderen, introductie, FSY) blijven op de
gewone pagina, en `/pad` stuurt die terug. Het overzicht is een navigatiescherm, geen activiteit: geen XP, geen
reeksverlenging, geen uitgestelde viering. De les zelf blijft `/lesson/<id>?cursus=<cursus>` of `/reading-lesson/<id>`.

Alleen presentatie en navigatie. Afronding, vergrendeling, volgorde, vragen, XP en reeks komen uit de bestaande logica
(`contentProgress.ts`, `readingLessons.ts`, `courses.ts`) en worden hier nooit opnieuw bepaald.

| Type | Leesgedrag | Oefeningen | Volgorde | Overzicht |
|---|---|---|---|---|
| READING_LESSONS | gedeelten (stappen) | direct na elk gedeelte | vast | hoofdstukken met stappentegels (`ReadingPath`) |
| FRONT_TO_BACK | volledig hoofdstuk | na het lezen | vast (vergrendeling) | hoofdstukken onder inklapbare boeken (`ChapterPath`), één leesactie |
| FREE_CHOICE | volledig hoofdstuk | optioneel | vrij (geen slot, geen "volgende") | boekenkiezer met vrije hoofdstukkaarten (`ChapterPath`) |

## Gedeelde bouwstenen
- `src/components/reading/pathParts.tsx`: `ActiveChapterCard` (hoge kop met titel/voortgang op het beeld, doorlopend
  accentkader), `LockedChapterCard`, `ChapterLinkCard`, `ChapterThumb` (miniatuur met fade), `Connector`, `Heading`, `DoneMark`.
- `src/components/reading/MyStepNav.tsx`: positionering bij openen en "Naar mijn stap/hoofdstuk" met pijlrichting.
- `src/components/reading/CoursePathHeader.tsx`: titel, voortgang (voltooide hoofdstukken), uitleg gedeelde voortgang.
- `src/lib/readingCourses.ts`: pure regels (vergrendeling, aan de beurt, boekgroepering, standaard geopend boek).
- Gegevens: `readingPathData.ts` (Stap voor stap) en `chapterPathData.ts` (de andere twee).

## Standaard geopend boek
- Hoofdstuk voor hoofdstuk: het boek van het hoofdstuk dat aan de beurt is; een nieuw aan-de-beurt-boek gaat erbij open.
- Vrije keuze: het boek van de huidige positie in de Stap-voor-stapcursus van dezelfde collectie (alleen lezend, via
  `getStepOverview`; het synchroniseert, start of schrijft niets), anders het boek van het laatst gebruikte hoofdstuk
  (`ContentProgress.lastChapterId`), anders alles ingeklapt. Nooit hardcoded boeknamen. Alleen de beginstand: daarna
  beslist de gebruiker, en een refresh klapt niets open of dicht.

## Afbeeldingen
Alleen via het artworkregister (`src/lib/artwork.ts`). Prioriteit per hoofdstuk (`chapterArtworkKeys`): 1) de expliciet
gekoppelde scène (`chapterScenes.ts`), 2) alleen voor het Boek van Mormon (`Book.key` begint met `bofm/`) het bestaande
boekbeeld `book:<Book.key>` (herhaling bij meerdere hoofdstukken is bedoeld), 3) de neutrale Versado-kaart. Andere schriften
behouden alleen hun eigen scènes. Een later toegevoegde hoofdstukscène staat vooraan in de sleutellijst en wint dus vanzelf,
zonder aanpassing van de cursuscomponenten. Het boekbeeld (`bookArtworkKeys`) staat daarnaast op de boekkaart. Miniaturen
zijn decoratief, lui geladen op 120 px en vervallen onder 380 px breed. Ingeklapte boeken renderen niets.

Tests: `npm run test:reading-path` en de browsertests `scripts/reading-path/e2e-path.mjs` en `e2e-courses.mjs`.
