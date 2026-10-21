# CFM — technische afronding (cursusidentiteit, weekselectie, collectie-isolatie, voorbereiding 2027)

Dit document hoort bij de draft-PR "CFM technische afronding" en vult `CFM-PERSOONLIJKE-STUDIE.md` (§17) en
`CFM-VALIDATIEVERSLAG.md` aan. Geen officiële tekst, afbeelding of zesstappenindeling is gewijzigd.

## 1. Bevestigde oorzaken

1. **Cursusidentiteit was jaargebonden.** `CFM_COURSES` had twee vaste slugs en `ensureCfmCourses` gebruikte `Course.slug` (wereldwijd
   uniek) als upsert-sleutel met `update: {}`. Een tweede CFM-collectie zou de bestaande rijen van 2026 "terugvinden" in plaats van eigen
   cursussen te krijgen (en dus aan de verkeerde collectie hangen).
2. **Kaart en leerlijn kozen verschillende weken.** `courseSummary.ts`: kalenderweek → eerste onafgeronde (gelezen óf zes stappen) → laatste.
   `pad/page.tsx`: kalenderweek → actieve les uit de studiecontext → eerste niet-gelezen week. Dezelfde gebruiker kon op de kaart, bij
   "Ga verder" en in de leerlijn drie verschillende weken zien; zonder kalenderweek (voor/na het jaar) stond de hervatweek bovendien als
   huidige week in de leerlijn ("Naar mijn week").
3. **Collectie-lek via de actieve collectie.** `getStudyCatalogue` las altijd `User.activeContentCollectionId`, terwijl de cursusroute
   (`/courses/<id>/pad`, `/api/courses`) een eigen `contentCollectionId` heeft. Een directe link naar een cursus uit een andere
   toegankelijke CFM-collectie toonde daardoor de weken, voortgang en afbeeldingen van de *actieve* collectie, onder de titel van de
   gevraagde cursus. Gereproduceerd met de integratietest `tests/cfm-collection-isolation.integration.test.ts`.

## 2. Oplossingen en waarom

* **`src/lib/studyContent/cfmCourses.ts`** — één centrale helper `cfmCourseSlug(collection, type)` en `ensureCfmCourses(db, collection)`.
  Identiteit = (collectie, cursustype); zoeken gebeurt op `contentCollectionId + type`, nooit op naam. CFM 2026 behoudt zijn slugs via een
  kleine legacy-tabel (dezelfde rijen, id's, inschrijvingen en voortgang). Elke andere collectie krijgt
  `kom-dan-en-volg-mij-<collectieslug>-<stap-voor-stap|vrije-studie>`. Een bestaande rij (ook uitgeschakeld of hernoemd) wordt nooit
  aangepast, niemand wordt ingeschreven, en niets wordt zichtbaar: de collectie blijft standaard verborgen. Geen migratie nodig
  (`Course.slug` blijft uniek; per collectie is de afgeleide slug uniek omdat `ContentCollection.slug` uniek is).
* **`src/lib/studyContent/weekSelection.ts`** — pure, geteste resolver. Onderscheid: *kalenderweek* (werkelijk actuele gepubliceerde week
  op de kalenderdag in de tijdzone van de gebruiker), *geselecteerde week* (laatst geopende week uit de bestaande studiecontext) en
  *hervatweek*. Eén terugvalregel: kalenderweek → geselecteerde week → eerste onafgeronde week → laatste week. Gebruikt door
  `courseSummary.ts` (kaart + API + "Ga verder") en `pad/page.tsx` (leerlijn).
* **Eerlijke aanduiding.** Zonder kalenderweek heet de hervatweek niet "Deze week" en de knop niet "Naar mijn week": nieuwe teksten
  `cfmStudy.resumeWeek` ("Verder hier") en `courseView.path.myResumeWeek(Aria)` ("Naar mijn laatste week") in alle vijf talen.
  Scrollcoördinatie (`MyStepNav`/`NavigationScroll`) is ongewijzigd.
* **`getStudyCatalogue(actor, now, { collectionId })`** — optioneel collectiebereik met dezelfde autorisatie als voorheen
  (`canAccessCollection`, `readingAccessWhere`, alleen `STUDY_PROGRAM`). Zonder `collectionId` is het gedrag ongewijzigd (Leren-overzicht,
  FSY). De actieve collectie wordt nooit gewijzigd. `today` (kalenderdag van de gebruiker) is nu deel van het resultaat.

## 3. Gewijzigde bestanden

`src/lib/studyContent/{cfmCourses,weekSelection,courseSummary,catalogue,cfm2026Import}.ts`, `src/app/courses/[courseId]/pad/page.tsx`,
`src/app/api/courses/route.ts`, `src/components/study/{CfmCourseView,CfmWeekPath}.tsx`, `src/components/reading/MyStepNav.tsx`,
i18n (`nl/en/de/fr/es`), tests (`cfm-week-selection.test.ts`, `cfm-courses(.integration).test.ts`,
`cfm-collection-isolation.integration.test.ts`), `package.json` (scripts), `CLAUDE.md` en deze documentatie.

## 4. Migraties

Geen. De bestaande migraties (`20261124120000_study_course_types`, `20261124130000_study_courses_backfill`) zijn onaangeroerd. De
backfill blijft idempotent (`ON CONFLICT ("slug") DO NOTHING`).

## 5. Regressietests

| Test | Dekt |
|---|---|
| `tests/cfm-week-selection.test.ts` (unit) | eerste dag van het jaar, weekovergang, laatste dag van 2026 (week over de jaargrens), na de laatste week, vóór het jaar, alles af, gedeeltelijk af, oudere/toekomstige week gekozen, geen lessen, overlappende perioden, tijdzones (Auckland/Los Angeles), volgend studiejaar |
| `tests/cfm-courses.test.ts` (unit) | slugs 2026 ongewijzigd, afgeleide slugs per collectie, geen botsing |
| `tests/cfm-courses.integration.test.ts` | twee gelijktijdige collecties, idempotent/gelijktijdig, uitgeschakeld blijft uit, niemand ingeschreven, collectie blijft verborgen |
| `tests/cfm-collection-isolation.integration.test.ts` | cursus leest eigen collectie, actieve collectie ongewijzigd, kaart/hervatlink bij juiste collectie, verborgen collectie niet voor gewone gebruiker, onbekende collectie |
| bestaand: `test:cfm-personal`, `test:reading-path`, `test:kompas`, CFM-import- en browserregressies (CI) | zie het eindrapport van de PR |

## 6. Wat al geschikt is voor CFM 2027

* Cursussen per collectie (Stap voor stap en Vrije studie), zonder botsing met 2026.
* Weekselectie en kaart/leerlijn per collectie, tijdzone-bewust.
* Collectie-isolatie van cursusgegevens met de bestaande autorisatie.
* De zesstappenplanner (`personalStudy.ts`) is programma-onafhankelijk; overrides staan per `workKey` (`personalStudyOverrides.ts`) en zijn
  gebonden aan de brontekst (`text8`), dus per programma en bronversie geïsoleerd.
* Voortgang (`ContentProgress`, `StudyStepProgress`) en annotaties hangen aan lesidentiteit/edition/revisie, niet aan het jaartal.

## 7. Wat nog nodig is voor een echte CFM 2027-import (bewust nog niet gedaan)

Een echte import is een apart, goedgekeurd werkpakket. Checklist (verwijzingen naar de plekken die nu aan `cfm-2026-nl-v1` /
`cfm2026Manifest` hangen):

1. **Gegevens**: `data/study-content/cfm-<jaar>-<taal>/` met `source/`, `source-lock.json`, `media-lock.json`,
   `personal-study-overrides.json`, referentiereviews en kwaliteitsrapport (zoals `cfm-2026-nl`).
2. **Manifest en adapter**: `cfm<jaar>Manifest.ts` (workKey, editionKey, taal, lesidentiteiten, weekperiodes) en een eigen adapternaam
   (`cfm-<jaar>-nl-v1`). De werksleutel moet met `cfm-` beginnen (`isPersonalStudyWork`).
3. **Registratie van de adapter**: `policy.ts` (release/preview), `publication.ts`, `admin.ts`, `programReview.ts`,
   `collectionRelease.ts`, `sourceApproval.ts`, `reseedJob.ts`/`ReseedClient.tsx` (label). Generaliseer deze plekken pas bij die import
   (nu 2026-specifiek); geen groot importframework.
4. **Collectie**: een `ensureCfmDraftCollection`-variant met eigen collectie-id/slug, `visibleToUsers: false`, `DRAFT`; roept
   `ensureCfmCourses(db, collection)` aan (cursussen ontstaan automatisch, uitgeschakeld/verborgen).
5. **Overrides**: een eigen entry in `REGISTRY` van `personalStudyOverrides.ts` (alleen het nieuwe bestand; 2026 blijft apart).
6. **Controles**: `scripts/study-content/cfm-personal-study-report.ts`, `npm run test:cfm-personal`, de CFM-importtests met synthetische
   fixtures, en de publicatiestappen hieronder.
7. **Publicatie** (altijd via Adminbackend → Content, nooit automatisch): Content opnieuw laden → snapshotgoedkeuring → revisie-audit/
   bulkpublicatie → collectievrijgave → pas daarna `visibleToUsers` aanzetten. Een beheerder test eerst zelf via de normale kiezer.

## 8. Resterende risico's

* De import- en publicatiecode is nog 2026-specifiek (zie §7.3); dit is bewust niet voorbewerkt.
* `StudyContext` (laatst geopende week) is per werk; twee collecties van hetzelfde werk (bv. twee talen) delen hem. De resolver negeert een
  geselecteerde week die niet in de gevraagde collectie bestaat.
* Een gelijktijdige `ensureCfmCourses` binnen een transactie leunt op de bestaande importlock (`lockStudyImportScope`); buiten een
  transactie vangt de code een unieke-sleutelfout af.
* Fysieke iPhone-tests zijn bewust niet uitgevoerd.

## 9. Checklist voor de iPhone-test (eigenaar)

1. Leren → CFM Stap voor stap openen: de huidige kalenderweek staat open onder de vaste kop; "Naar mijn week" verschijnt alleen als de
   week buiten beeld is.
2. Terug vanuit een stap: dezelfde scrollpositie, geen opnieuw scrollen.
3. Cursuskaart "Ga verder" opent dezelfde week als de open weekkaart in de leerlijn (beide leeswijzen).
4. Buiten een CFM-jaar (of met een andere collectie): geen kaart/week heet "Deze week"; de knop heet "Naar mijn laatste week".
5. Verbergen en opnieuw toevoegen van beide cursussen; sorteren.
6. Annotaties (alinea aantikken, kleuren, bladwijzer, notitie), regelafstand en schriftverwijzingen leesbaar (PR #156 intact).
7. Een stap afronden verandert reeks/XP niet; "Markeren als gelezen" blijft de enige leesafronding.

## 10. Latere read-only productiecontroles

* Bestaan en uniekheid van de twee 2026-cursussen: `SELECT slug, type, "contentCollectionId", enabled FROM "Course" WHERE type IN ('STUDY_STEPS','STUDY_FREE')`.
* Geen automatische inschrijvingen: aantal `UserCourseProgress` voor deze cursussen vóór/na uitrol vergelijken.
* Geen wijziging van `ContentCollection.visibleToUsers` voor CFM door de uitrol.


> **Bijgewerkt (zie `docs/CFM-PERSOONLIJKE-STUDIE.md` §18):** de terugval "eerste onafgeronde week → laatste week" hierboven is vervangen door "laatst bestudeerde week → geen hervatweek" (CFM is deelname, geen inhaalprogramma); sinds de correctieronde telt daarbij alleen echte activiteit met een tijdstempel (`lastStudiedAt`) en heet een gekozen week "Laatst gekozen week" in plaats van "Laatst bestudeerd".
