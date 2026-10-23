import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { importCfmDrafts } from "../src/lib/studyContent/cfm2026Import";
import { autoPublishCfmVolume } from "../src/lib/studyContent/cfmAutoPublish";
import { CFM_SOURCE_2026 } from "../src/lib/studyContent/cfmSources";
import { getStudyCatalogue } from "../src/lib/studyContent/catalogue";
import { getPublishedStudyLesson } from "../src/lib/studyContent/revisions";
import { studyDocumentInventory, type SnapshotItem } from "../src/lib/studyContent/fixtureAdapter";
import { mutateAnnotation, readerAnnotations } from "../src/lib/annotations/service";
import { passageBlocks, validatePassageSelector } from "../src/lib/annotations/contract";

// Bewijs voor de overgang "revisie zonder video's" -> "revisie met video's" (95 video's in 2026) en voor archivering:
// gebruikersgegevens, abonnementen, annotaties en deeplinks blijven onaangetast, er wordt niets verwijderd.
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");
const assets = process.env.CFM_TEST_ASSETS;
if (!assets?.startsWith("/tmp/")) throw new Error("Eigen gepinde testassets vereist (CFM_TEST_ASSETS)");
const options = { mediaBytes: (a: { file: string }) => fs.readFile(path.join(assets, "media", a.file)) };
const collectionId = CFM_SOURCE_2026.volume.collectionId;
after(() => prisma.$disconnect());

function stripVideos(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => !(v && typeof v === "object" && (v as { type?: string }).type === "video")).map(stripVideos);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripVideos(v)]));
  return value;
}
const countVideos = (value: unknown): number => Array.isArray(value) ? value.reduce<number>((n, v) => n + countVideos(v), 0)
  : value && typeof value === "object" ? ((value as { type?: string }).type === "video" ? 1 : 0) + Object.values(value).reduce<number>((n, v) => n + countVideos(v), 0) : 0;
// Een eerdere revisie van dezelfde les, zoals productie die vandaag heeft: dezelfde tekst, anchors en beelden, nog zonder video's.
const legacy = (item: SnapshotItem): SnapshotItem => {
  const body = stripVideos(item.body) as SnapshotItem["body"];
  return { ...item, body, expectedAnchors: studyDocumentInventory(body as never).anchors };
};
const digest = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

test("95 video-revisies en archivering raken voortgang, abonnement, annotaties en deeplinks niet; er wordt niets verwijderd", async () => {
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}@cfm-video.test.invalid`, passwordHash: "test-only", handle: `A${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin: true } });
  const actor = { id: admin.id, isAdmin: true };

  // 1. Voorheen: gepubliceerde revisies zonder video's.
  await importCfmDrafts(actor, CFM_SOURCE_2026, { ...options, transformItem: legacy });
  // De oude adapteruitvoer valt buiten de gepinde bronvergrendeling (SOURCE) en kan dus niet via de automatische publicatie;
  // lessen zonder video's zijn identiek en worden wel gepubliceerd. De rest wijzen we aan zoals beheer eerder publiceerde.
  const first = await autoPublishCfmVolume(actor, CFM_SOURCE_2026);
  assert.equal(first.publishedNow, 10, "de 10 lessen zonder video's");
  assert.equal(first.blocked.length, 42, "de lessen met video's wijken af van de bronvergrendeling");
  for (const e of await prisma.studyLessonEdition.findMany({ where: { collectionId, publishedRevisionId: null } }))
    await prisma.studyLessonEdition.update({ where: { id: e.id }, data: { publishedRevisionId: e.draftRevisionId, publicationVersion: { increment: 1 } } });
  await prisma.contentCollection.update({ where: { id: collectionId }, data: { publicationState: "PUBLISHED", visibleToUsers: true, enabled: true } });
  const before = await prisma.studyLessonEdition.findMany({ where: { collectionId }, include: { lesson: true, publishedRevision: true }, orderBy: { lesson: { order: "asc" } } });
  assert.equal(before.length, 52);
  assert.equal(before.reduce((n, e) => n + countVideos(e.publishedRevision!.body), 0), 0, "uitgangspunt: geen video's");

  // 2. Een gebruiker met alles wat aan een les kan hangen.
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@cfm-video.test.invalid`, passwordHash: "test-only", handle: `U${randomUUID().slice(0, 8)}`, discriminator: "01", timeZone: "UTC", contentLanguage: "nl", activeContentCollectionId: collectionId } });
  const member = { id: user.id, isAdmin: false };
  const courses = await prisma.course.findMany({ where: { contentCollectionId: collectionId } });
  assert.ok(courses.length >= 1);
  for (const c of courses) await prisma.userCourseProgress.create({ data: { userId: user.id, courseId: c.id, subscribed: true } });
  const withVideo = (await import("../src/lib/studyContent/cfm2026Import")).loadCfmLesson;
  const targets: typeof before = [];
  for (const e of before) if (countVideos((await withVideo(e.lesson.sourceKey)).document) > 0) targets.push(e);
  assert.ok(targets.length > 0, "er zijn lessen met video's");
  const totalVideos = (await Promise.all(before.map(async (e) => countVideos((await withVideo(e.lesson.sourceKey)).document)))).reduce((a, b) => a + b, 0);
  assert.equal(totalVideos, 95);
  const e0 = targets[0];
  const body = e0.publishedRevision!.body as { sections: { id: string }[] };
  const section = body.sections[0];
  const block = passageBlocks(body as never, section.id)[0];
  const quote = [...block.text].slice(0, Math.min(18, [...block.text].length));
  const selector = validatePassageSelector(body as never, { normalizationVersion: 1, originalRevisionId: e0.publishedRevisionId!, sectionAnchor: section.id,
    ranges: [{ blockId: block.id, start: 0, end: quote.length }], exact: quote.join(""), prefix: "", suffix: [...block.text].slice(quote.length, quote.length + 32).join("") });
  const target = { type: "lesson", lessonEditionId: e0.id, revisionId: e0.publishedRevisionId!, selector };
  const annotations = [];
  for (const kind of ["bookmark", "highlight", "note"] as const)
    annotations.push((await mutateAnnotation(member, { kind, target, expectedVersion: 0, actionId: randomUUID(), ...(kind === "note" ? { text: "Mijn notitie" } : {}), ...(kind === "highlight" ? { color: "green" } : {}) })).annotation);
  for (const e of targets) {
    await prisma.studyStepProgress.create({ data: { userId: user.id, lessonEditionId: e.id, stepFingerprint: createHash("md5").update(e.id).digest("hex"), stepIndex: 1, planVersion: 2, revisionId: e.publishedRevisionId!, status: "COMPLETED", completedAt: new Date() } });
    const firstSection = (e.publishedRevision!.body as { sections: { id: string; blocks: { id: string }[] }[] }).sections[0];
    await prisma.readingPosition.create({ data: { userId: user.id, lessonEditionId: e.id, revisionId: e.publishedRevisionId!, sectionAnchor: firstSection.id, blockAnchor: firstSection.blocks[0].id, sectionFraction: 0.5, lastActionId: randomUUID(), lastActionHash: "a".repeat(64) } });
  }
  await prisma.userStudyContext.upsert({ where: { userId_workKey: { userId: user.id, workKey: e0.workKey } }, create: { userId: user.id, workKey: e0.workKey, activeLessonKey: e0.lesson.sourceKey, lastActionId: randomUUID() }, update: {} });
  const personal = async () => digest({
    progress: await prisma.userCourseProgress.findMany({ where: { userId: user.id }, orderBy: { courseId: "asc" } }),
    steps: await prisma.studyStepProgress.findMany({ where: { userId: user.id }, orderBy: { lessonEditionId: "asc" } }),
    positions: await prisma.readingPosition.findMany({ where: { userId: user.id }, orderBy: { lessonEditionId: "asc" } }),
    context: await prisma.userStudyContext.findMany({ where: { userId: user.id } }),
    bookmark: await prisma.bookmark.findMany({ where: { userId: user.id } }),
    highlight: await prisma.highlight.findMany({ where: { userId: user.id } }),
    note: await prisma.note.findMany({ where: { userId: user.id } }),
    userRow: await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { xpTotal: true, currentStreak: true, activeContentCollectionId: true } }),
  });
  const userData = await personal();
  const tableCounts = async () => ({
    editions: await prisma.studyLessonEdition.count({ where: { collectionId } }),
    lessons: await prisma.studyLesson.count({ where: { editions: { some: { collectionId } } } }),
    revisions: await prisma.studyRevision.count({ where: { edition: { collectionId } } }),
    courses: await prisma.course.count({ where: { contentCollectionId: collectionId } }),
    media: await prisma.contentMedia.count(),
  });
  const counts = await tableCounts();
  const deeplinkBefore = await Promise.all(before.map(async (e) => (await getPublishedStudyLesson(member, e.lessonId, collectionId))?.lessonId));

  // 3. Nu: de nieuwe revisies met video's worden ingeladen en automatisch gepubliceerd.
  await importCfmDrafts(actor, CFM_SOURCE_2026, options);
  const second = await autoPublishCfmVolume(actor, CFM_SOURCE_2026);
  assert.equal(second.status, "done", JSON.stringify({ blocked: second.blocked, failed: second.failed, publishedNow: second.publishedNow }).slice(0, 900));
  assert.equal(second.publishedNow, targets.length, "alleen lessen met video's krijgen een nieuwe revisie");
  const after = await prisma.studyLessonEdition.findMany({ where: { collectionId }, include: { publishedRevision: true }, orderBy: { lesson: { order: "asc" } } });
  assert.deepEqual(after.map((e) => e.id), before.map((e) => e.id), "dezelfde edities (lesidentiteit)");
  assert.equal(after.reduce((n, e) => n + countVideos(e.publishedRevision!.body), 0), 95, "alle 95 video's staan nu in de gepubliceerde revisies");
  for (const e of targets) assert.notEqual(after.find((x) => x.id === e.id)!.publishedRevisionId, e.publishedRevisionId);

  // 4. Niets van de gebruiker is veranderd; de oude revisies blijven bestaan (alleen erbij).
  assert.equal(await personal(), userData, "voortgang, abonnement, annotaties, leespositie en studiecontext byte-identiek");
  const counts2 = await tableCounts();
  assert.deepEqual({ ...counts2, revisions: 0, media: 0 }, { ...counts, revisions: 0, media: 0 });
  assert.equal(counts2.revisions, counts.revisions + targets.length, "revisies komen erbij, geen enkele verdwijnt");
  const deeplinkAfter = await Promise.all(before.map(async (e) => (await getPublishedStudyLesson(member, e.lessonId, collectionId))?.lessonId));
  assert.deepEqual(deeplinkAfter, deeplinkBefore, "/study-lesson/<lessonId>/<collectionId> wijst naar dezelfde les");
  const reader = await readerAnnotations(member, { lessonEditionId: e0.id, revisionId: after.find((x) => x.id === e0.id)!.publishedRevisionId! });
  assert.equal(reader.annotations.length, 3, "annotaties zijn op de nieuwe revisie nog zichtbaar");

  // 5. Archivering: ruim na het einde van het jaar staan alle weken in het archief; alles blijft leesbaar en niets verdwijnt.
  const later = new Date("2027-06-01T12:00:00Z");
  const archive = await getStudyCatalogue(member, later, { scope: "archive" });
  assert.equal(archive.lessons.length, 52, "alle 52 weken gearchiveerd");
  for (const l of archive.lessons) assert.ok(await getPublishedStudyLesson(member, l.lessonId, collectionId), `gearchiveerde les ${l.lessonKey} blijft te openen`);
  assert.equal(await personal(), userData, "archiveren raakt persoonlijke gegevens niet");
  assert.deepEqual(await tableCounts(), counts2, "archiveren verwijdert geen inhoud");
});
