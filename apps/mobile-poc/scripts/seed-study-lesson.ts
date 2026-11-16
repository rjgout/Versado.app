/* Synthetische rijke studieles voor de architectuurproef "rijke studielessen" — uitsluitend voor een geïsoleerde test-database.
 * Gebruikt de echte importketen (registerStudySnapshotImport → executeStudyImport → publishStudyRevision → ensureCfmCourses),
 * dus de les ontstaat via dezelfde revisie-/publicatie-/mediaregels als officiële lessen. Geen officiële tekst.
 * Draaien vanuit de repo-root: DATABASE_URL=... npx tsx apps/mobile-poc/scripts/seed-study-lesson.ts */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../src/lib/db";
import { hashPassword } from "../../../src/lib/auth";
import { registerStudySnapshotImport, executeStudyImport } from "../../../src/lib/studyContent/imports";
import { publishStudyRevision } from "../../../src/lib/studyContent/publication";
import { ensureCfmCourses } from "../../../src/lib/studyContent/cfmCourses";
import { cfmPersonalFixtureItem } from "../../../src/lib/studyContent/cfmPersonalFixture";
import { richLessonBody, REF_URL } from "../fixtures/rijkeles";
import { studyDocumentInventory, type StudySnapshot } from "../../../src/lib/studyContent/fixtureAdapter";
import { referenceEvidenceVersion } from "../../../src/lib/references/evidence";

const url = process.env.DATABASE_URL ?? "";
if (!/(127\.0\.0\.1|localhost|postgres)(:\d+)?\/[a-z_]*(test|poc)[a-z_]*/i.test(url) && process.env.POC_ALLOW_SEED !== "1") {
  console.error("Weigert te seeden: DATABASE_URL lijkt geen geïsoleerde test-/poc-database (zet POC_ALLOW_SEED=1 om te forceren).");
  process.exit(1);
}
const KEY = "synthetic-study-cfm-poc-rijk";
(async () => {
  const prisma = createPrismaClient();
  if (!await prisma.contentCollection.findUnique({ where: { id: KEY } })) {
    await prisma.contentWork.create({ data: { key: KEY, kind: "STUDY_PROGRAM" } });
    await prisma.contentCollection.create({ data: { id: KEY, slug: KEY, name: "Synthetische studie (proef)", work: KEY, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: true } });
    const admin = await prisma.user.create({ data: { email: `${randomUUID()}@poc-study.invalid`, passwordHash: "test-only", handle: `Pa${randomUUID().slice(0, 6)}`, discriminator: "90", isAdmin: true } });
    const actor = { id: admin.id, isAdmin: true };
    const item = cfmPersonalFixtureItem("current");
    const doc = richLessonBody();
    const inventory = studyDocumentInventory(doc);
    const evidence = ["ref-inline", "ref-block"].map(occurrenceKey => ({ occurrenceKey, url: REF_URL, evidenceKey: referenceEvidenceVersion }));
    const snapshot: StudySnapshot = {
      workKey: KEY, editionKey: "fixture-v1", language: "nl", adapterName: "synthetic-v1", adapterVersion: "1", sourceVersion: "poc-rijk-v1", synthetic: true,
      period: { sourceKey: "fixture:period-poc", label: "Synthetische testperiode", year: 2026 },
      items: [{ ...item, title: "Synthetische rijke proeflezing", body: doc, expectedAnchors: inventory.anchors, media: item.media.filter(m => m.mediaKey === "media-painting"), expectedMedia: ["media-painting"], expectedReferences: ["ref-inline", "ref-block"], evidence }],
    };
    const run = await registerStudySnapshotImport(actor, KEY, snapshot);
    await executeStudyImport(actor, run.id);
    const items = await prisma.contentImportItem.findMany({ where: { runId: run.id }, include: { edition: true } });
    if (items.length !== 1) throw new Error(`import leverde ${items.length} items (verwacht 1)`);
    for (const it of items)
      await publishStudyRevision(actor, { editionId: it.lessonEditionId, revisionId: it.revisionId, importRunId: run.id, expectedVersion: it.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
    await ensureCfmCourses(prisma, { id: KEY, slug: KEY });
  }
  const password = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
  const passwordHash = await hashPassword(password);
  const base = { passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), activeContentCollectionId: KEY };
  for (const [name, disc] of [["Gerda", "07"], ["Hans", "08"]] as const)
    await prisma.user.upsert({ where: { email: `${name.toLowerCase()}@example.invalid` }, update: { passwordHash, activeContentCollectionId: KEY }, create: { ...base, email: `${name.toLowerCase()}@example.invalid`, handle: name, discriminator: disc } });
  const edition = await prisma.studyLessonEdition.findFirst({ where: { collectionId: KEY, publishedRevisionId: { not: null } }, select: { id: true } });
  const course = await prisma.course.findFirst({ where: { contentCollectionId: KEY, type: "STUDY_FREE" }, select: { id: true } });
  console.log(`synthetische studieles: collectie ${KEY}, editie ${edition?.id}, cursus ${course?.id}; accounts gerda/hans @example.invalid`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
