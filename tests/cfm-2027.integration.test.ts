import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { importAllCfmDrafts } from "../src/lib/studyContent/cfm2026Import";
import { autoPublishCfmVolume } from "../src/lib/studyContent/cfmAutoPublish";
import { CFM_SOURCES, CFM_SOURCE_2026, CFM_SOURCE_2027 } from "../src/lib/studyContent/cfmSources";
import { getStudyCatalogue } from "../src/lib/studyContent/catalogue";
import { getContentPickerContext } from "../src/lib/contentCollections";
import { CFM_PROGRAMME_NAME } from "../src/lib/studyContent/cfmProgramme";

// Eigen geïsoleerde database en eigen gepinde testassets vereist (CFM_TEST_ASSETS, zie prepare-cfm-test-assets.mjs).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");
const assets = process.env.CFM_TEST_ASSETS;
if (!assets?.startsWith("/tmp/")) throw new Error("Eigen gepinde testassets vereist (CFM_TEST_ASSETS)");
const options = { mediaBytes: (a: { file: string }) => fs.readFile(path.join(assets, "media", a.file)) };

after(() => prisma.$disconnect());
const admin = async () => ({ id: (await prisma.user.create({ data: { email: `${randomUUID()}@cfm-2027.test.invalid`, passwordHash: "test-only", handle: `A${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin: true } })).id, isAdmin: true });
const c26 = CFM_SOURCE_2026.volume.collectionId, c27 = CFM_SOURCE_2027.volume.collectionId;

test("beide jaargangen worden geïmporteerd en automatisch gepubliceerd; geen dubbele cursussen of collecties", async () => {
  const actor = await admin();
  const results = await importAllCfmDrafts(actor, options);
  assert.deepEqual(results.map((r) => [r.year, r.ok]), CFM_SOURCES.map((s) => [s.volume.year, true]));
  for (const source of CFM_SOURCES) {
    const report = await autoPublishCfmVolume(actor, source);
    assert.equal(report.status, "done", JSON.stringify({ year: report.year, blocked: report.blocked, failed: report.failed }));
    assert.equal(report.total, source.manifest.lessons.length);
    assert.equal(report.references.blocking, 0);
    assert.equal(report.released, true);
  }
  const collections = await prisma.contentCollection.findMany({ where: { id: { in: [c26, c27] } } });
  assert.equal(collections.length, 2);
  assert.ok(collections.every((c) => c.publicationState === "PUBLISHED" && c.visibleToUsers === false), "inhoudelijk vrijgegeven, nog niet zichtbaar");
  // Alleen het anker (2026) draagt de programmacursussen.
  assert.deepEqual((await prisma.course.findMany({ where: { contentCollectionId: { in: [c26, c27] } }, select: { contentCollectionId: true } })).map((c) => c.contentCollectionId), [c26, c26]);
});

test("een tweede import en publicatie veranderen niets (idempotent, geen herimport bij herstart)", async () => {
  const actor = await admin();
  const count = async () => ({
    editions: await prisma.studyLessonEdition.count({ where: { collectionId: { in: [c26, c27] } } }),
    revisions: await prisma.studyRevision.count({ where: { edition: { collectionId: { in: [c26, c27] } } } }),
    actions: await prisma.studyPublicationAction.count({ where: { edition: { collectionId: { in: [c26, c27] } } } }),
    media: await prisma.contentMedia.count(),
    courses: await prisma.course.count({ where: { contentCollectionId: { in: [c26, c27] } } }),
  });
  const before = await count();
  const noDownload = { mediaBytes: async () => { throw new Error("bestaande gevalideerde media worden niet opnieuw gedownload"); } };
  assert.ok((await importAllCfmDrafts(actor, noDownload)).every((r) => r.ok));
  for (const source of CFM_SOURCES) assert.equal((await autoPublishCfmVolume(actor, source)).publishedNow, 0);
  assert.deepEqual(await count(), before);
});

test("verborgen 2027 verschijnt niet voor gewone gebruikers; zichtbaar gemaakt neemt het programma de weken over en gaat de jaarwisseling vanzelf", async () => {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@cfm-2027.test.invalid`, passwordHash: "test-only", handle: `U${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "UTC", contentLanguage: "nl", activeContentCollectionId: c26 } });
  const member = { id: user.id, isAdmin: false };
  await prisma.contentCollection.update({ where: { id: c26 }, data: { visibleToUsers: true } });
  const only26 = await getStudyCatalogue(member, new Date("2026-12-28T12:00:00Z"));
  assert.equal(only26.lessons.length > 0 && only26.lessons.every((l) => l.collectionId === c26), true, "zolang 2027 verborgen is, alleen 2026");
  await prisma.contentCollection.update({ where: { id: c27 }, data: { visibleToUsers: true } });
  const eve = await getStudyCatalogue(member, new Date("2026-12-27T12:00:00Z"));
  const newYear = await getStudyCatalogue(member, new Date("2026-12-28T12:00:00Z"));
  const key = (c: typeof eve) => c.lessons.find((l) => l.lessonKey === c.currentLessonKey);
  assert.equal(key(eve)?.collectionId, c26, "27 december: nog de laatste week van 2026");
  assert.equal(key(newYear)?.collectionId, c27, "28 december: vanzelf de eerste week van 2027");
  assert.equal(newYear.collectionId, c26, "de identiteit (collectie, cursussen, actieve keuze) blijft die van het programma");
  assert.equal(newYear.programName, CFM_PROGRAMME_NAME);
  // Vroege 2027: de eerste weken van 2026 zijn al gearchiveerd, het 2027-aanbod is volledig toegankelijk.
  const spring = await getStudyCatalogue(member, new Date("2027-03-01T12:00:00Z"));
  assert.ok(spring.archivedCount >= 40 && spring.lessons.some((l) => l.collectionId === c27 && l.order === manifestCount(CFM_SOURCE_2027)), "toekomstige lessen blijven bereikbaar");
  const archive = await getStudyCatalogue(member, new Date("2027-03-01T12:00:00Z"), { scope: "archive" });
  assert.ok(archive.lessons.every((l) => l.collectionId === c26 || l.collectionId === c27));
  // De kiezer toont één programma.
  const picker = await getContentPickerContext(user.id);
  const cfmWorks = picker.works.filter((w) => w.key.startsWith("cfm-"));
  assert.deepEqual(cfmWorks.map((w) => w.key), [CFM_SOURCE_2026.manifest.workKey]);
  assert.equal(cfmWorks[0].editions[0].name, CFM_PROGRAMME_NAME);
});

function manifestCount(source: typeof CFM_SOURCE_2027) {
  return source.manifest.lessons.length;
}
