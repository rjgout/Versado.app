# Kom dan en volg Mij — doorlopend programma (CFM Doorlopend v1)

Dit document beschrijft hoe "Kom dan en volg Mij" één permanent studieprogramma is boven meerdere officiële
jaargangen (2026 Oude Testament, 2027 Nieuwe Testament, 2028 Boek van Mormon, …). Het bouwt voort op
`CFM-PERSOONLIJKE-STUDIE.md`, `CFM-TECHNICAL-FINALIZATION.md` en
`content-architecture-v2/24-CFM-MANAGED-IMPORT-AND-RELEASE.md`; er is geen tweede CFM-systeem.

## 1. Programma, jaargang en les

| Laag | Wat | Waar |
|---|---|---|
| **Programma** | "Kom dan en volg Mij": de enige naam die gebruikers zien (kiezer, kaarten, Vandaag, profiel). Geen jaartal of schriftuuronderdeel. | `src/lib/studyContent/cfmProgramme.ts` (`CFM_PROGRAMME_NAME`) |
| **Jaargang** (volume) | Eén officiële programmajaargang = één studiecollectie met eigen `ContentWork`, `editionKey`, `ContentCollection.id`, lessen en revisies. | register `src/lib/studyContent/cfmVolumes.ts` |
| **Les** | `StudyLesson` + `StudyLessonEdition` + onveranderlijke `StudyRevision`, ongewijzigd. | bestaande studiecontentlaag |

Het programma is uitsluitend een **presentatielaag**. Er is geen datamodelmigratie: een jaargang toevoegen is een regel
in `cfmVolumes.ts` plus het bronmanifest en de brondata (zie §6). Bestaande collectie-ID's (`content_cfm_ot_2026_nl`),
cursus-ID's (slugs `kom-dan-en-volg-mij-stap-voor-stap` en `…-vrije-studie`), lesidentiteiten, voortgang, annotaties,
inschrijvingen en deeplinks (`/study-lesson/<lessonId>/<collectionId>`) veranderen nooit.

### Het anker

De eerste jaargang van een taal (de laagste `year`) is het **anker** van het programma. Alleen de collectie van het anker
draagt de programmacursussen Stap voor stap en Vrije studie (`ensureCfmCourses` maakt voor latere jaargangen niets aan).
Daardoor:

- blijft er één kaart per leeswijze in Leren, ook na de jaarwisseling;
- blijven inschrijving, actieve cursus, gekozen leeswijze en hervatpositie dezelfde rijen: niemand wordt opnieuw
  ingeschreven;
- verwijzen `markCfmCourseStarted`, `cfmCoursePathHref` en `cfmCoursePathTarget` altijd naar de ankercursus, ook als de les
  uit een latere jaargang komt (`cfmAnchorOfCollectionId`).

**Beperking:** het anker (nu CFM 2026) moet voor gebruikers beschikbaar blijven zolang het programma bestaat; het draagt de
cursussen. Verbergt een beheerder de ankercollectie, dan verdwijnt het hele programma. Een latere jaargang verbergen
verbergt alleen die jaargang.

### Kiezer, Leren en Vandaag

- De contentkiezer en de contentcontext (`contentCollections.ts`, `presentProgramme`) tonen alleen het anker, onder de
  programmanaam. Een latere jaargang is geen aparte keuze. Een gebruiker die toch op een latere jaargang staat, wordt als
  het programma gepresenteerd (`cfmAnchorOfCollectionId`). Beheer (`listContentCollectionsForAdmin`) toont de volledige
  collecties met jaartal.
- `getStudyCatalogue` leest voor een programmacollectie alle jaargangscollecties van het programma in dezelfde taal. De
  toegangsregel (`readingAccessWhere`) geldt per jaargang: een verborgen of ingetrokken jaargang levert geen weken.
- De weekregel is ongewijzigd (`weekSelection.ts`): kalenderweek → laatst bewust gekozen week → recentste echte
  studieactiviteit → neutraal overzicht. Het is dezelfde resolver voor Vandaag, kaart, API en leerlijn.
- De studiecontext (`UserStudyContext`) blijft per `workKey` (jaargang). Het programma gebruikt de recentst gewijzigde
  keuze (`catalogue.context`); `catalogue.contexts` bevat alle keuzes voor het bewaren per jaargang.
  `studyContext.lessonHref` zoekt een les ook in de andere jaargangen van het programma van de actieve collectie.

## 2. Actuele weken en jaarwisseling

De officiële begin- en einddatums staan in het manifest per jaargang (`cfm2026Manifest.ts`) en worden **niet** berekend uit
een weeknummer. `calendarWeekOf` gebruikt `[startsOn, endsOnExclusive)` en de kalenderdag van de gebruiker (`userDayKey`,
`User.timeZone`, standaard `Europe/Amsterdam`; zie `docs/TIJD.md`).

- Een lesweek mag over twee kalenderjaren lopen (week 1 van 2026 begint op 29 december 2025).
- De laatste week van 2026 (21–27 december 2026) gaat vanzelf over in de eerste officiële week van de volgende jaargang
  zodra die gepubliceerd is. De gebruiker hoeft niets te selecteren; actieve cursus, leeswijze en hervatpositie blijven.
- Overlappende weken zijn nooit een willekeurige keuze: dan bestaat er geen kalenderweek en geldt de bewust gekozen week.
  Officiële jaargangen overlappen niet.

## 3. Archiefbeleid

Een les verhuist naar het archief **één kalendermaand na het einde van de officiële lesweek**:

```
archiefstart = endsOnExclusive + 1 kalendermaand      (laatste dag van de doelmaand als de dag niet bestaat)
gearchiveerd  ⇔  vandaag (kalenderdag van de gebruiker) ≥ archiefstart
```

Voorbeeld: week 1 eindigt op 4 januari 2026 (`endsOnExclusive` 5 januari). Ze blijft t/m 4 februari zichtbaar en is vanaf
5 februari gearchiveerd. Een les zonder officiële einddatum wordt nooit gearchiveerd. De regel staat op één plek
(`archiveStartsOn`/`isWeekArchived`/`splitByArchive` in `cfmProgramme.ts`) en is getest op de grensdagen
(`tests/cfm-programme.test.ts`, alle 52 weken van 2026).

- Archiveren is **uitsluitend een weergavegrens**: het is datumgestuurd bij het lezen, er is geen nachtelijke taak en er
  wordt niets verwijderd of gekopieerd. Lesinhoud, revisies, voortgang, annotaties en leesposities blijven ongewijzigd en
  de les houdt dezelfde identiteit en deeplink.
- Het gewone overzicht (kaart in Leren, leerpad, Vandaag) bevat de actuele week, weken die maximaal één maand geleden zijn
  afgelopen en alle gepubliceerde toekomstige weken.
- **Cursusarchief**: `/courses/<cursus-id>/archief` (Focusroute, terugbalk naar het leerpad; link "Eerdere lessen" onderaan
  het leerpad). Gearchiveerde lessen staan per officiële jaargang (jaar + schriftuuronderdeel, recentste jaargang eerst,
  binnen een jaargang chronologisch). Alleen jaargangen met echt gearchiveerde lessen verschijnen. Een les openen volgt de
  leeswijze van de cursus (Stap voor stap of Vrije studie) en toont bestaande aantekeningen en markeringen.
- Zijn alle weken gearchiveerd (bijvoorbeeld tussen twee jaargangen), dan blijft de kaart de ingang en verwijst het
  leerpad naar het archief.

## 4. Behoud van gebruikersgegevens

Er is geen migratie van bestaande rijen. Wat blijft: cursus-ID's en inschrijvingen (`UserCourseProgress`), `User.activeCourseId`,
`personalStudyMode`, `UserStudyContext`, stapvoortgang, leesposities, notities/markeringen/bladwijzers (aan de
lesedities), kaartvolgorde en zichtbaarheid van de cursuskaarten. `tests/cfm-programme.integration.test.ts` bewaakt dat het
verschijnen of verdwijnen van een jaargang en het archief deze rijen niet wijzigen.

## 5. Tests

- `npm run test:cfm-personal` (unit; incl. `tests/cfm-programme.test.ts`: baseline 2026-identiteit, archiefgrenzen, jaarwisseling,
  archiefgroepering).
- `npm run test:cfm-personal:integration` (geïsoleerde database; incl. `tests/cfm-programme.integration.test.ts`: één set
  cursussen, toegang per jaargang, kiezer, bewaren per jaargang, archief, behoud van gebruikersgegevens).
- `npm run test:kompas`, `npm run test:focus`, `npx tsx scripts/i18n/check.ts`.

## 6. Een nieuwe jaargang toevoegen (fase A: register)

1. Voeg een regel toe aan `CFM_VOLUMES` (`cfmVolumes.ts`): jaar, schriftuuronderdeel, `workKey`, `editionKey`, taal,
   `collectionId`, `collectionSlug` (vast, nooit afgeleid van volgorde of naam).
2. Het bronmanifest en de import volgen in de generieke importroute (zie de latere paragrafen van dit document).
3. Er is geen datamodelmigratie, geen nieuwe cursus en geen nieuwe kiezerkeuze nodig; de collectie blijft standaard
   verborgen (`visibleToUsers=false`, `DRAFT`) tot beheer haar vrijgeeft (docs/CONTENT-AVAILABILITY.md).
