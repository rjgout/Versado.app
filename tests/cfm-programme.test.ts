import test from "node:test";
import assert from "node:assert/strict";
import { cfmOldTestament2026NlManifest as manifest } from "../src/lib/studyContent/cfm2026Manifest";
import { CFM_COLLECTION_ID, CFM_COURSES, cfmCourseSlug } from "../src/lib/studyContent/cfmCourses";
import { CFM_VOLUMES } from "../src/lib/studyContent/cfmVolumes";
import {
  CFM_PROGRAMME_NAME, addMonthsToDay, archiveStartsOn, cfmAnchorCollectionId, cfmAnchorOfCollectionId, cfmProgrammeCollectionIds,
  cfmProgrammeVolumes, cfmVolumeOfCollection, groupArchiveByYear, isCfmVolumeCollection, isWeekArchived, splitByArchive,
} from "../src/lib/studyContent/cfmProgramme";
import { calendarWeekOf, resolveWeekSelection } from "../src/lib/studyContent/weekSelection";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const exclusive = (endsOn: string) => new Date(day(endsOn).getTime() + 86_400_000).toISOString().slice(0, 10);

test("baseline CFM 2026: collectie-ID, cursus-ID's (slugs) en werkidentiteit blijven exact zoals in productie", () => {
  assert.equal(CFM_COLLECTION_ID, "content_cfm_ot_2026_nl");
  assert.deepEqual(CFM_COURSES.map((c) => [c.type, c.slug]), [
    ["STUDY_STEPS", "kom-dan-en-volg-mij-stap-voor-stap"],
    ["STUDY_FREE", "kom-dan-en-volg-mij-vrije-studie"],
  ]);
  assert.equal(cfmCourseSlug({ id: CFM_COLLECTION_ID, slug: "cfm-ot-2026-nl" }, "STUDY_STEPS"), "kom-dan-en-volg-mij-stap-voor-stap");
  const v = CFM_VOLUMES[0];
  assert.deepEqual([v.year, v.workKey, v.editionKey, v.language, v.collectionId, v.collectionSlug],
    [2026, manifest.workKey, manifest.editionKey, manifest.language, CFM_COLLECTION_ID, "cfm-ot-2026-nl"]);
  assert.equal(manifest.lessons.length, 52);
});

test("programma-identiteit: één naam zonder jaartal of schriftuuronderdeel", () => {
  assert.equal(CFM_PROGRAMME_NAME, "Kom dan en volg Mij");
  assert.doesNotMatch(CFM_PROGRAMME_NAME, /\d|Testament|Mormon/);
});

test("het anker is de eerste jaargang van de taal; elke jaargang wijst naar hetzelfde anker", () => {
  const years = cfmProgrammeVolumes("nl").map((v) => v.year);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
  assert.equal(new Set(CFM_VOLUMES.map((v) => `${v.collectionId}`)).size, CFM_VOLUMES.length, "geen dubbele collectie");
  assert.equal(new Set(CFM_VOLUMES.map((v) => `${v.workKey}`)).size, CFM_VOLUMES.length, "geen dubbel werk");
  for (const v of cfmProgrammeVolumes("nl")) assert.equal(cfmAnchorOfCollectionId(v.collectionId), CFM_COLLECTION_ID);
  assert.deepEqual(cfmProgrammeCollectionIds({ id: CFM_COLLECTION_ID }), cfmProgrammeVolumes("nl").map((v) => v.collectionId));
});

test("een collectie buiten het programma blijft zichzelf (leescursussen, synthetische testcollecties)", () => {
  for (const c of [{ id: "content_bom", work: "bofm" }, { id: "synthetic-study-cfm-x", work: "synthetic-study-cfm-x" }]) {
    assert.equal(isCfmVolumeCollection(c), false);
    assert.equal(cfmAnchorCollectionId(c), c.id);
    assert.deepEqual(cfmProgrammeCollectionIds(c), [c.id]);
    assert.equal(cfmVolumeOfCollection(c), undefined);
  }
});

test("maandrekenen: korte maanden en schrikkeljaar", () => {
  assert.equal(addMonthsToDay("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToDay("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsToDay("2026-12-28", 1), "2027-01-28");
  assert.equal(addMonthsToDay("2026-03-31", 1), "2026-04-30");
  assert.equal(addMonthsToDay("2026-01-05", 1), "2026-02-05");
  assert.throws(() => addMonthsToDay("2026-1-5", 1));
});

test("archiefgrens: een week eindigend op 4 januari blijft t/m 4 februari zichtbaar en is vanaf 5 februari gearchiveerd", () => {
  const week = { endsOnExclusive: "2026-01-05" };
  assert.equal(archiveStartsOn(week.endsOnExclusive), "2026-02-05");
  assert.equal(isWeekArchived(week, "2026-01-04"), false, "tijdens de week");
  assert.equal(isWeekArchived(week, "2026-01-05"), false, "de dag erna");
  assert.equal(isWeekArchived(week, "2026-02-04"), false, "laatste dag in het actuele overzicht");
  assert.equal(isWeekArchived(week, "2026-02-05"), true, "eerste archiefdag");
  assert.equal(isWeekArchived(week, "2027-01-01"), true);
  assert.equal(isWeekArchived({ endsOnExclusive: null }, "2099-01-01"), false, "zonder officiële einddatum nooit archiveren");
});

test("archiefgrens bij een week die op de 30e eindigt (korte maand)", () => {
  const week = { endsOnExclusive: "2026-01-31" }; // laatste lesdag 30 januari
  assert.equal(isWeekArchived(week, "2026-02-27"), false);
  assert.equal(isWeekArchived(week, "2026-02-28"), true, "31 jan + 1 maand klemt op 28 feb");
});

test("alle 52 weken van 2026: precies de officiële einddatum + één kalendermaand bepaalt het archief", () => {
  for (const lesson of manifest.lessons) {
    const end = exclusive(lesson.endsOn);
    const start = archiveStartsOn(end)!;
    assert.equal(isWeekArchived({ endsOnExclusive: end }, start), true, `${lesson.sourceKey} op ${start}`);
    const before = new Date(day(start).getTime() - 86_400_000).toISOString().slice(0, 10);
    assert.equal(isWeekArchived({ endsOnExclusive: end }, before), false, `${lesson.sourceKey} op ${before}`);
  }
});

test("jaarwisseling: de laatste week van 2026 gaat zonder handeling over naar de eerste week van het volgende jaar", () => {
  const weeks = [
    ...manifest.lessons.slice(-3).map((l) => ({ lessonKey: `s:${l.sourceKey}`, startsOn: l.startsOn, endsOnExclusive: exclusive(l.endsOn), read: false, stepsDone: 0 })),
    // De eerste officiële week van een volgende jaargang begint direct na de laatste week van 2026 en loopt over de jaargrens.
    { lessonKey: "s:next-01", startsOn: "2026-12-28", endsOnExclusive: "2027-01-04", read: false, stepsDone: 0 },
    { lessonKey: "s:next-02", startsOn: "2027-01-04", endsOnExclusive: "2027-01-11", read: false, stepsDone: 0 },
  ];
  assert.equal(calendarWeekOf(weeks, "2026-12-27")?.lessonKey, "s:52");
  assert.equal(calendarWeekOf(weeks, "2026-12-28")?.lessonKey, "s:next-01");
  assert.equal(calendarWeekOf(weeks, "2027-01-01")?.lessonKey, "s:next-01", "week over twee kalenderjaren");
  assert.equal(calendarWeekOf(weeks, "2027-01-04")?.lessonKey, "s:next-02");
  const sel = resolveWeekSelection(weeks, { today: "2026-12-29", selectedLessonKey: "s:50" });
  assert.equal(sel.resume?.lessonKey, "s:next-01", "de kalenderweek wint van de eerder gekozen week");
  assert.equal(sel.resumeReason, "calendar");
});

test("het actuele overzicht: actuele, recente (< 1 maand) en toekomstige weken; de rest in het archief", () => {
  const weeks = manifest.lessons.map((l) => ({ key: l.sourceKey, startsOn: l.startsOn, endsOnExclusive: exclusive(l.endsOn) }));
  const { current, archived } = splitByArchive(weeks, "2026-10-14");
  assert.equal(current.length + archived.length, 52, "niets verdwijnt");
  assert.ok(current.some((w) => w.key === "42"), "de actuele week");
  assert.ok(current.some((w) => w.key === "52"), "toekomstige weken");
  assert.ok(current.some((w) => w.key === "38"), "week 38 eindigde 20 september: nog geen maand");
  assert.ok(archived.some((w) => w.key === "36"), "week 36 eindigde 6 september: langer dan een maand");
  assert.ok(archived.every((w) => isWeekArchived(w, "2026-10-14")));
  assert.ok(current.every((w) => !isWeekArchived(w, "2026-10-14")));
});

test("archiefgroepen: per officiële jaargang, recentste eerst, chronologisch binnen de jaargang, alleen jaargangen met lessen", () => {
  const weeks = [
    { workKey: "cfm-old-testament-2026", startsOn: "2026-02-02", order: 6, id: "b" },
    { workKey: "cfm-old-testament-2026", startsOn: "2025-12-29", order: 1, id: "a" },
    { workKey: "onbekend", startsOn: "2026-01-01", order: 1, id: "x" },
  ];
  const groups = groupArchiveByYear(weeks);
  assert.equal(groups.length, 1, "een onbekend werk verschijnt niet als jaargang");
  assert.deepEqual(groups[0].weeks.map((w) => w.id), ["a", "b"]);
  assert.equal(groups[0].year, 2026);
  assert.equal(groups[0].scripture, "old-testament");
  assert.deepEqual(groupArchiveByYear([]), [], "een jaargang zonder gearchiveerde lessen wordt niet getoond");
});
