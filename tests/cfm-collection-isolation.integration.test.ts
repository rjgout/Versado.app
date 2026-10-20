import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports";
import { publishStudyRevision } from "../src/lib/studyContent/publication";
import { getStudyCatalogue } from "../src/lib/studyContent/catalogue";
import { getStudyCourseSummary } from "../src/lib/studyContent/courseSummary";
import { ensureCfmCourses } from "../src/lib/studyContent/cfmCourses";

// Eigen geïsoleerde database vereist, zoals de overige integratietests (nooit productie of een gedeelde database).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");

type Fx = { id: string; slug: string; lessonIds: string[]; stepsCourseId: string; freeCourseId: string };
let admin: { id: string; isAdmin: boolean }, member: { id: string; isAdmin: boolean }, a: Fx, b: Fx;

async function user(isAdmin: boolean, collectionId: string) {
  const row = await prisma.user.create({
    data: { email: `${randomUUID()}@cfm-isolation.test.invalid`, passwordHash: "test-only", handle: `I${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "UTC", isAdmin, activeContentCollectionId: collectionId },
  });
  return { id: row.id, isAdmin };
}

/** Een synthetische CFM-collectie (eigen werk) met twee gepubliceerde weken: vorige en huidige week. */
async function collection(label: string, visible: boolean): Promise<Fx> {
  const key = `synthetic-study-cfm-${label}-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: { id: key, slug: key, name: `Synthetische CFM ${label}`, work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: visible },
  });
  const actor = { id: (await prisma.user.create({ data: { email: `${randomUUID()}@cfm-isolation.test.invalid`, passwordHash: "test-only", handle: `P${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin: true } })).id, isAdmin: true };
  const run = await createStudyImport(actor, key, "cfm-personal");
  await executeStudyImport(actor, run.id);
  const items = await prisma.contentImportItem.findMany({ where: { runId: run.id }, include: { edition: true } });
  for (const item of items)
    await publishStudyRevision(actor, { editionId: item.lessonEditionId, revisionId: item.revisionId, importRunId: run.id, expectedVersion: item.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
  await ensureCfmCourses(prisma, { id: key, slug: key });
  const courses = await prisma.course.findMany({ where: { contentCollectionId: key } });
  return {
    id: key, slug: key, lessonIds: items.map((i) => i.edition.lessonId),
    stepsCourseId: courses.find((c) => c.type === "STUDY_STEPS")!.id, freeCourseId: courses.find((c) => c.type === "STUDY_FREE")!.id,
  };
}

before(async () => {
  a = await collection("jaar-a", true);
  b = await collection("jaar-b", false); // een tweede, nog verborgen collectie
  admin = await user(true, a.id);
  member = await user(false, a.id);
});
after(async () => {
  await prisma.$disconnect();
});

test("een cursus leest zijn weken uit de eigen collectie, niet uit de actieve collectie van de gebruiker", async () => {
  const forB = await getStudyCatalogue(admin, new Date(), { collectionId: b.id });
  assert.equal(forB.collectionId, b.id);
  assert.deepEqual(forB.lessons.map((l) => l.lessonId).sort(), [...b.lessonIds].sort());
  assert.ok(forB.lessons.every((l) => l.collectionId === b.id), "geen les van een andere collectie");
  const forA = await getStudyCatalogue(admin, new Date(), { collectionId: a.id });
  assert.deepEqual(forA.lessons.map((l) => l.lessonId).sort(), [...a.lessonIds].sort());
  // Zonder collectionId blijft het gedrag het oude: de actieve collectie.
  assert.equal((await getStudyCatalogue(admin)).collectionId, a.id);
  // De actieve collectie is nergens stilzwijgend gewijzigd.
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).activeContentCollectionId, a.id);
});

test("cursuskaart en hervatlink horen bij de collectie van de cursus", async () => {
  const stepsB = await getStudyCourseSummary(admin, { type: "STUDY_STEPS", contentCollectionId: b.id });
  assert.ok(stepsB);
  assert.match(stepsB.resumeHref, new RegExp(`/${b.id}/stappen$`));
  assert.equal(stepsB.totalWeeks, 2);
  const freeA = await getStudyCourseSummary(admin, { type: "STUDY_FREE", contentCollectionId: a.id });
  assert.ok(freeA);
  assert.match(freeA.resumeHref, new RegExp(`/${a.id}$`));
  assert.equal(stepsB.resumeReason, "calendar", "de fixture-week is de actuele kalenderweek");
});

test("autorisatie blijft gelden: een gewone gebruiker krijgt niets uit een verborgen collectie", async () => {
  const hidden = await getStudyCatalogue(member, new Date(), { collectionId: b.id });
  assert.deepEqual(hidden.lessons, []);
  assert.equal(hidden.collectionId, null);
  assert.equal(await getStudyCourseSummary(member, { type: "STUDY_STEPS", contentCollectionId: b.id }), null);
  // Zichtbaar maken (de bestaande beheerschakelaar) geeft toegang, nog steeds zonder de actieve collectie te raken.
  await prisma.contentCollection.update({ where: { id: b.id }, data: { visibleToUsers: true } });
  const visible = await getStudyCatalogue(member, new Date(), { collectionId: b.id });
  assert.equal(visible.collectionId, b.id);
  assert.ok(visible.lessons.length === 2 && visible.lessons.every((l) => l.collectionId === b.id));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).activeContentCollectionId, a.id);
  await prisma.contentCollection.update({ where: { id: b.id }, data: { visibleToUsers: false } });
  assert.deepEqual((await getStudyCatalogue(member, new Date(), { collectionId: b.id })).lessons, []);
});

test("een onbekende collectie levert niets op", async () => {
  const none = await getStudyCatalogue(admin, new Date(), { collectionId: "bestaat-niet" });
  assert.deepEqual(none.lessons, []);
});
