import test from "node:test";
import assert from "node:assert/strict";
import { CFM_SOURCE_2026, CFM_SOURCE_2027 } from "../src/lib/studyContent/cfmSources";
import { CFM_VOLUMES } from "../src/lib/studyContent/cfmVolumes";
import { validateStudyManifest } from "../src/lib/studyContent/manifest";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { cfmSourceHash } from "../src/lib/studyContent/cfm2026Adapter";
import { classifyUnresolvedCfmReference } from "../src/lib/studyContent/cfmReferencePolicy";
import { studyObjectHash } from "../src/lib/studyContent/policy";
import { archiveStartsOn, cfmProgrammeVolumes, isWeekArchived } from "../src/lib/studyContent/cfmProgramme";
import { calendarWeekOf } from "../src/lib/studyContent/weekSelection";

const manifest = CFM_SOURCE_2027.manifest;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

test("2027: manifest met 52 officiële weken die dag na dag aansluiten op elkaar en op CFM 2026", () => {
  assert.equal(manifest.lessons.length, 52);
  assert.equal(manifest.lessons[0].sourceKey, "01");
  assert.equal(manifest.lessons[0].startsOn, "2026-12-28", "een week die over de jaargrens loopt");
  assert.equal(manifest.lessons[0].endsOn, "2027-01-03");
  const last2026 = CFM_SOURCE_2026.manifest.lessons.at(-1)!;
  assert.equal((day(manifest.lessons[0].startsOn) - day(last2026.endsOn)) / 86_400_000, 1, "geen gat en geen overlap met 2026");
  for (let i = 1; i < manifest.lessons.length; i++) {
    assert.equal((day(manifest.lessons[i].startsOn) - day(manifest.lessons[i - 1].endsOn)) / 86_400_000, 1, `${manifest.lessons[i].sourceKey} sluit aan`);
    assert.equal(manifest.lessons[i].order, i + 1);
  }
  // Paasweek (14) staat chronologisch vóór les 13; de volgorde volgt de kalender, niet het nummer.
  const keys = manifest.lessons.map((l) => l.sourceKey);
  assert.ok(keys.indexOf("14") < keys.indexOf("13"));
  assert.equal(validateStudyManifest(manifest).filter((d) => d.status === "BLOCKED").length, 0);
});

test("2027: eigen stabiele bronidentiteit, geregistreerd naast 2026, zonder iets van 2026 te raken", () => {
  assert.equal(CFM_SOURCE_2027.adapter, "cfm-2027-nl-v1");
  assert.equal(manifest.workKey, "cfm-new-testament-2027");
  assert.equal(manifest.editionKey, "church-cfm-nt-2027");
  assert.notEqual(CFM_SOURCE_2027.volume.collectionId, CFM_SOURCE_2026.volume.collectionId);
  assert.equal(CFM_SOURCE_2027.dataDir, "data/study-content/cfm-2027-nl");
  assert.deepEqual(cfmProgrammeVolumes("nl").map((v) => v.year), [2026, 2027]);
  assert.equal(CFM_VOLUMES.some((v) => v.year === 2028), false, "2028 is niet geregistreerd en dus onzichtbaar (geen Nederlandse bron)");
});

test("2027: elke les is gepind, parseerbaar en herhaalbaar identiek (idempotent)", async () => {
  for (const lesson of manifest.lessons) {
    const a = await loadCfmLesson(lesson.sourceKey, CFM_SOURCE_2027);
    const b = await loadCfmLesson(lesson.sourceKey, CFM_SOURCE_2027);
    assert.equal(studyObjectHash(a.document), studyObjectHash(b.document), `${lesson.sourceKey} deterministisch`);
    assert.equal(a.inventory.blockCount > 20, true);
    assert.ok(a.title.length > 0 && a.lesson.sourceUrl.startsWith("https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-new-testament-2027/"));
  }
});

test("2027: een gewijzigd bronbestand wordt geweigerd (hashpin)", async () => {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile("data/study-content/cfm-2027-nl/source/03.json", "utf8");
  assert.equal(cfmSourceHash(raw), CFM_SOURCE_2027.sourceLock.lessons["03"]);
  assert.notEqual(cfmSourceHash(raw + " "), CFM_SOURCE_2027.sourceLock.lessons["03"]);
  await assert.rejects(loadCfmLesson("99", CFM_SOURCE_2027), /CFM_LESSON_KEY/);
});

test("2027: geen interne schriftlinks, alleen bron-URL's; geen onveilige verwijzing; video's herkend", async () => {
  let references = 0, videos = 0, figures = 0;
  for (const lesson of manifest.lessons) {
    const parsed = await loadCfmLesson(lesson.sourceKey, CFM_SOURCE_2027);
    figures += parsed.inventory.figures.length;
    videos += parsed.diagnostics.filter((d) => d.code === "VIDEO_EMBEDDED").length;
    for (const reference of parsed.inventory.references) {
      references += 1;
      const target = reference.target as { sourceKey: string; externalUrl?: string; workKey?: string };
      assert.equal(target.workKey, undefined, `${lesson.sourceKey}: geen interne schrifteditie zonder bewijs`);
      assert.notEqual(classifyUnresolvedCfmReference(target), "UNSAFE_URL", `${lesson.sourceKey}: ${target.sourceKey}`);
      assert.notEqual(classifyUnresolvedCfmReference(target), "UNKNOWN", `${lesson.sourceKey}: ${target.sourceKey}`);
    }
    for (const asset of parsed.assets) assert.ok(CFM_SOURCE_2027.mediaLock.some((m) => m.checksum === asset.checksum), "afbeelding is gepind");
  }
  assert.ok(references > 2000 && figures > 300 && videos > 50, JSON.stringify({ references, figures, videos }));
});

test("2027: jaarwisseling en archief met de echte officiële weken", () => {
  const weeks = [...CFM_SOURCE_2026.manifest.lessons.slice(-2), ...manifest.lessons.slice(0, 2)].map((l) => ({
    lessonKey: l.sourceKey + l.year, startsOn: l.startsOn, endsOnExclusive: new Date(day(l.endsOn) + 86_400_000).toISOString().slice(0, 10), read: false, stepsDone: 0,
  }));
  assert.equal(calendarWeekOf(weeks, "2026-12-27")?.lessonKey, "522026");
  assert.equal(calendarWeekOf(weeks, "2026-12-28")?.lessonKey, "012027", "de eerste week van 2027 neemt vanzelf over");
  assert.equal(calendarWeekOf(weeks, "2027-01-03")?.lessonKey, "012027");
  assert.equal(calendarWeekOf(weeks, "2027-01-04")?.lessonKey, "022027");
  // Laatste week van 2026 (eindigt 27 december): archief vanaf 28 januari 2027.
  const w52 = weeks[1];
  assert.equal(archiveStartsOn(w52.endsOnExclusive), "2027-01-28");
  assert.equal(isWeekArchived(w52, "2027-01-27"), false);
  assert.equal(isWeekArchived(w52, "2027-01-28"), true);
  assert.equal(isWeekArchived(weeks[2], "2027-02-03"), false, "week 1 van 2027 eindigt op 3 januari: nog zichtbaar t/m 3 februari");
  assert.equal(isWeekArchived(weeks[2], "2027-02-04"), true);
});
