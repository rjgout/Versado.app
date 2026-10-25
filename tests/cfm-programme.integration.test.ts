import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports";
import { publishStudyRevision } from "../src/lib/studyContent/publication";
import { getStudyCatalogue } from "../src/lib/studyContent/catalogue";
import { getStudyCourseSummary } from "../src/lib/studyContent/courseSummary";
import { cfmCoursePathHref, ensureCfmCourses } from "../src/lib/studyContent/cfmCourses";
import { CFM_PROGRAMME_NAME, groupArchiveByYear } from "../src/lib/studyContent/cfmProgramme";
import { CFM_VOLUMES, type CfmVolume } from "../src/lib/studyContent/cfmVolumes";
import { getContentContext, getContentPickerContext } from "../src/lib/contentCollections";
import { setStudyContext } from "../src/lib/studyContext";
import { subscribeUserToCourse } from "../src/lib/courses";

// Eigen geïsoleerde database vereist, zoals de overige integratietests (nooit productie of een gedeelde database).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");

// Twee synthetische jaargangen van het programma (de fixture-import vereist taal "nl"). Ze krijgen jaren vóór de echte
// registratie, zodat de eerste synthetische jaargang het anker is. De registratie wordt alleen voor deze test uitgebreid en daarna hersteld.
const registry = CFM_VOLUMES as unknown as CfmVolume[];
// De echte jaargangen worden voor deze test tijdelijk uit het register gehaald: andere tests in dezelfde database mogen hun
// collecties (met echte ID's) hebben, maar horen hier niet bij het programma onder test.
const saved = registry.splice(0, registry.length);
const registered: CfmVolume[] = [];
const stamp = randomUUID().slice(0, 8);
type Fx = { volume: CfmVolume; lessonIds: string[]; editionIds: string[] };
let a: Fx, b: Fx, admin: { id: string; isAdmin: boolean }, member: { id: string; isAdmin: boolean };

async function volume(year: number, visible: boolean): Promise<Fx> {
  const key = `synthetic-study-cfm-prog-${year}-${stamp}`;
  const vol: CfmVolume = { year, scripture: "old-testament", workKey: key, editionKey: "fixture-v1", language: "nl", collectionId: key, collectionSlug: key };
  registry.push(vol);
  registered.push(vol);
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: { id: key, slug: key, name: `Synthetische jaargang ${year}`, work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: visible },
  });
  const publisher = { id: (await prisma.user.create({ data: { email: `${randomUUID()}@cfm-programme.test.invalid`, passwordHash: "test-only", handle: `P${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin: true } })).id, isAdmin: true };
  const run = await createStudyImport(publisher, key, "cfm-personal");
  await executeStudyImport(publisher, run.id);
  const items = await prisma.contentImportItem.findMany({ where: { runId: run.id }, include: { edition: true } });
  for (const item of items)
    await publishStudyRevision(publisher, { editionId: item.lessonEditionId, revisionId: item.revisionId, importRunId: run.id, expectedVersion: item.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
  await ensureCfmCourses(prisma, { id: key, slug: key });
  return { volume: vol, lessonIds: items.map((i) => i.edition.lessonId), editionIds: items.map((i) => i.lessonEditionId) };
}
async function user(isAdmin: boolean, collectionId: string) {
  const row = await prisma.user.create({
    data: { email: `${randomUUID()}@cfm-programme.test.invalid`, passwordHash: "test-only", handle: `U${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "UTC", isAdmin, contentLanguage: "nl", activeContentCollectionId: collectionId },
  });
  return { id: row.id, isAdmin };
}
const months = (n: number) => new Date(Date.now() + n * 31 * 86_400_000);

before(async () => {
  a = await volume(2001, true); // het anker: de eerste jaargang van de taal (vóór de echte registratie, dus nooit een bestaand jaar)
  b = await volume(2002, false); // een latere jaargang die nog verborgen is
  admin = await user(true, a.volume.collectionId);
  member = await user(false, a.volume.collectionId);
});
after(async () => {
  registry.splice(0, registry.length, ...saved);
  await prisma.$disconnect();
});

test("het anker draagt de cursussen; een latere jaargang krijgt nooit eigen cursuskaarten en niets wordt dubbel aangemaakt", async () => {
  const courses = await prisma.course.findMany({ where: { contentCollectionId: { in: [a.volume.collectionId, b.volume.collectionId] } } });
  assert.deepEqual(courses.map((c) => c.contentCollectionId), [a.volume.collectionId, a.volume.collectionId]);
  assert.deepEqual(courses.map((c) => c.type).sort(), ["STUDY_FREE", "STUDY_STEPS"]);
  await ensureCfmCourses(prisma, { id: a.volume.collectionId, slug: a.volume.collectionSlug });
  await ensureCfmCourses(prisma, { id: b.volume.collectionId, slug: b.volume.collectionSlug });
  assert.equal(await prisma.course.count({ where: { contentCollectionId: { in: [a.volume.collectionId, b.volume.collectionId] } } }), 2, "herhaald aanroepen maakt niets bij");
  const stepsA = courses.find((c) => c.type === "STUDY_STEPS")!;
  assert.equal(await cfmCoursePathHref(prisma, b.volume.collectionId, "STEPS"), `/courses/${stepsA.id}/pad`, "de week van de latere jaargang leidt terug naar de ene programmacursus");
});

test("een verborgen jaargang telt niet mee voor gewone gebruikers, wel voor beheer; zichtbaar maken voegt zijn weken toe", async () => {
  const before_ = await getStudyCatalogue(member, new Date());
  assert.deepEqual(before_.lessons.map((l) => l.lessonId).sort(), [...a.lessonIds].sort());
  const adminView = await getStudyCatalogue(admin, new Date());
  assert.deepEqual(adminView.lessons.map((l) => l.lessonId).sort(), [...a.lessonIds, ...b.lessonIds].sort());
  assert.equal(before_.programName, CFM_PROGRAMME_NAME);
  await prisma.contentCollection.update({ where: { id: b.volume.collectionId }, data: { visibleToUsers: true } });
  const after_ = await getStudyCatalogue(member, new Date());
  assert.deepEqual(after_.lessons.map((l) => l.lessonId).sort(), [...a.lessonIds, ...b.lessonIds].sort());
  assert.equal(new Set(after_.lessons.map((l) => l.id)).size, after_.lessons.length, "geen dubbele lessen");
  assert.equal(after_.collectionId, a.volume.collectionId, "de identiteit van het resultaat blijft die van het programma-anker");
  assert.deepEqual(new Set(after_.lessons.map((l) => l.workKey)), new Set([a.volume.workKey, b.volume.workKey]));
});

test("de kiezer toont één programma onder de programmanaam; de latere jaargang is geen aparte keuze", async () => {
  const picker = await getContentPickerContext(member.id);
  const programmeWorks = picker.works.filter((w) => [a.volume.workKey, b.volume.workKey].includes(w.key));
  assert.deepEqual(programmeWorks.map((w) => w.key), [a.volume.workKey]);
  assert.equal(programmeWorks[0].editions[0].name, CFM_PROGRAMME_NAME);
  assert.doesNotMatch(programmeWorks[0].editions[0].name, /\d/);
  const context = await getContentContext(member.id);
  assert.ok(!context.collections.some((c) => c.id === b.volume.collectionId));
  assert.equal(context.active.id, a.volume.collectionId);
  // Een gebruiker die per ongeluk op de latere jaargang staat, wordt als het programma gepresenteerd.
  await prisma.user.update({ where: { id: member.id }, data: { activeContentCollectionId: b.volume.collectionId } });
  assert.equal((await getContentContext(member.id)).active.id, a.volume.collectionId);
  await prisma.user.update({ where: { id: member.id }, data: { activeContentCollectionId: a.volume.collectionId } });
});

test("een keuze voor een week van de andere jaargang wordt bij die jaargang bewaard; de actieve collectie verandert niet", async () => {
  const lessonKey = `study:${b.lessonIds[1]}`;
  const result = await setStudyContext(member, { workKey: b.volume.workKey, activeLessonKey: lessonKey, expectedVersion: 0, actionId: randomUUID() });
  assert.equal(result.context.activeLessonKey, lessonKey);
  assert.equal(result.context.available, true);
  const catalogue = await getStudyCatalogue(member, new Date());
  assert.equal(catalogue.context?.activeLessonKey, lessonKey, "het programma neemt de recentste keuze over");
  assert.ok(catalogue.contexts[b.volume.workKey]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).activeContentCollectionId, a.volume.collectionId);
  const summary = await getStudyCourseSummary(member, { type: "STUDY_FREE", contentCollectionId: a.volume.collectionId });
  assert.ok(summary);
  // De fixture-jaargangen hebben beide een week die vandaag omvat; echte jaargangen overlappen niet. Een overlap is nooit een
  // willekeurige keuze: er is dan geen kalenderweek en de bewust gekozen week geldt (weekSelection.ts).
  assert.equal(summary.resumeReason, "selected");
});

test("archief: na één kalendermaand verdwijnen lessen uit het overzicht, per jaargang gegroepeerd en nog steeds te openen", async () => {
  const now = new Date();
  const current = await getStudyCatalogue(member, now);
  assert.equal(current.lessons.length, 4);
  assert.equal(current.archivedCount, 0);
  const later = months(2);
  const overview = await getStudyCatalogue(member, later);
  assert.equal(overview.lessons.length, 0, "alles is langer dan een maand geleden afgelopen");
  assert.equal(overview.archivedCount, 4);
  const archive = await getStudyCatalogue(member, later, { scope: "archive" });
  assert.equal(archive.lessons.length, 4);
  const groups = groupArchiveByYear(archive.lessons);
  assert.deepEqual(groups.map((g) => g.year), [2002, 2001], "recentste jaargang eerst");
  assert.ok(groups.every((g) => g.weeks.length === 2));
  // Dezelfde lesidentiteit: niets is gekopieerd of verwijderd.
  assert.deepEqual(archive.lessons.map((l) => l.id).sort(), [...a.editionIds, ...b.editionIds].sort());
  assert.equal(await prisma.studyLessonEdition.count({ where: { id: { in: [...a.editionIds, ...b.editionIds] }, publishedRevisionId: { not: null } } }), 4);
});

test("een jaargang zonder gearchiveerde lessen verschijnt niet in het archief", async () => {
  const archive = await getStudyCatalogue(member, new Date(), { scope: "archive" });
  assert.deepEqual(archive.lessons, []);
  assert.deepEqual(groupArchiveByYear(archive.lessons), []);
});

test("bestaande gebruikersgegevens blijven ongemoeid wanneer een jaargang verschijnt of verdwijnt", async () => {
  const steps = await prisma.course.findFirstOrThrow({ where: { contentCollectionId: a.volume.collectionId, type: "STUDY_STEPS" } });
  await subscribeUserToCourse(prisma, member.id, steps.id);
  await prisma.user.update({ where: { id: member.id }, data: { activeCourseId: steps.id } });
  const snapshot = async () => ({
    progress: await prisma.userCourseProgress.findMany({ where: { userId: member.id }, orderBy: { id: "asc" } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: member.id }, select: { activeCourseId: true, activeContentCollectionId: true, personalStudyMode: true } }),
    context: await prisma.userStudyContext.findMany({ where: { userId: member.id }, orderBy: { workKey: "asc" } }),
  });
  const first = await snapshot();
  await prisma.contentCollection.update({ where: { id: b.volume.collectionId }, data: { visibleToUsers: false } });
  await getStudyCatalogue(member, new Date());
  await prisma.contentCollection.update({ where: { id: b.volume.collectionId }, data: { visibleToUsers: true } });
  await getStudyCatalogue(member, months(3), { scope: "archive" });
  assert.deepEqual(await snapshot(), first);
  assert.equal(first.user.activeCourseId, steps.id);
});

test("CFM-cursussen staan uitsluitend bij hun eigen bron, met gewone publicatie- en zichtbaarheidsrechten", async () => {
  const { cfmCourseListWhere } = await import("../src/lib/studyContent/cfmCourses");
  const courses = await prisma.course.findMany({ where: cfmCourseListWhere(member, "content_bom") });
  assert.equal(courses.filter(c => c.contentCollectionId === a.volume.collectionId).length, 0);
  assert.equal(await prisma.course.count({ where: cfmCourseListWhere(member, a.volume.collectionId) }), 2);
  const original = await prisma.contentCollection.findUniqueOrThrow({ where: { id: a.volume.collectionId } });
  try {
    await prisma.contentCollection.update({ where: { id: original.id }, data: { visibleToUsers: false } });
    assert.equal(await prisma.course.count({ where: { AND: [cfmCourseListWhere(member, a.volume.collectionId), { contentCollectionId: a.volume.collectionId }] } }), 0);
    assert.equal(await prisma.course.count({ where: { AND: [cfmCourseListWhere(admin, a.volume.collectionId), { contentCollectionId: a.volume.collectionId }] } }), 2);
    await prisma.contentCollection.update({ where: { id: original.id }, data: { publicationState: "DRAFT" } });
    assert.equal(await prisma.course.count({ where: { AND: [cfmCourseListWhere(admin, a.volume.collectionId), { contentCollectionId: a.volume.collectionId }] } }), 0);
  } finally {
    await prisma.contentCollection.update({ where: { id: original.id }, data: { visibleToUsers: original.visibleToUsers, publicationState: original.publicationState } });
  }
});

test("de opgeschoonde 2027-route behoudt afgeronde en begonnen inhoud uit de oorspronkelijke zes stappen", async () => {
  const { getStepProgress } = await import("../src/lib/studyContent/stepProgress");
  const { loadCfmLesson } = await import("../src/lib/studyContent/cfm2026Import");
  const editionId = a.editionIds[0];
  const revisionId = (await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: editionId } })).publishedRevisionId!;
  const { CFM_SOURCE_2027 } = await import("../src/lib/studyContent/cfmSources");
  const { personalStudyFor, previousPersonalPlan } = await import("../src/lib/studyContent/personalStudyOverrides");
  const parsed = await loadCfmLesson("15", CFM_SOURCE_2027);
  const lesson = { editionId, revisionId, workKey: CFM_SOURCE_2027.manifest.workKey, sourceKey: "15", body: parsed.document };
  const current = personalStudyFor(lesson), previous = previousPersonalPlan(lesson);
  assert.ok(current.supported && previous.supported);
  if (!current.supported || !previous.supported) return;
  const user_ = await user(false, a.volume.collectionId);
  for (const step of previous.steps) await prisma.studyStepProgress.create({ data: { userId: user_.id, lessonEditionId: editionId, revisionId, stepFingerprint: step.fingerprint, stepIndex: step.index, planVersion: 2, status: "COMPLETED", openedAt: new Date(), completedAt: new Date() } });
  const state = await getStepProgress({ id: user_.id, isAdmin: false }, lesson, current);
  assert.equal(state!.completedCount, 6);
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user_.id, planVersion: 2 } }), 6, "oude rijen blijven behouden");
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user_.id, planVersion: 3 } }), 6);
  await getStepProgress({ id: user_.id, isAdmin: false }, lesson, current);
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user_.id } }), 12, "idempotent");
  const started = await user(false, a.volume.collectionId);
  const old = previous.steps[0];
  await prisma.studyStepProgress.create({ data: { userId: started.id, lessonEditionId: editionId, revisionId, stepFingerprint: old.fingerprint, stepIndex: old.index, planVersion: 2, status: "IN_PROGRESS" } });
  const partial = await getStepProgress({ id: started.id, isAdmin: false }, lesson, current);
  assert.ok(partial!.steps.some(step => step.status === "IN_PROGRESS"));
  assert.equal(partial!.completedCount, 0, "beginnen is nooit afronden");
  const partlyDone = await user(false, a.volume.collectionId);
  for (const step of previous.steps.slice(0, 3)) await prisma.studyStepProgress.create({ data: { userId: partlyDone.id, lessonEditionId: editionId, revisionId, stepFingerprint: step.fingerprint, stepIndex: step.index, planVersion: 2, status: "COMPLETED", completedAt: new Date() } });
  const mapped = await getStepProgress(partlyDone, lesson, current);
  const oldOwner = new Map(previous.steps.flatMap(step => step.blockIds.map(id => [id, step.index] as const)));
  assert.deepEqual(mapped!.steps.map(step => step.status === "COMPLETED"), current.steps.map(step => step.blockIds.every(id => (oldOwner.get(id) ?? 99) <= 3)), "alleen volledig gedekte inhoud telt als afgerond");
});
