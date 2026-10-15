import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import {
  referenceFixture,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
import { parseOtbChapter } from "../scripts/otb/chapterParser.ts";
import { importCfm2026Drafts } from "../src/lib/studyContent/cfm2026Import.ts";
import { publishStudyRevision } from "../src/lib/studyContent/publication.ts";
import { getPublishedStudyLesson } from "../src/lib/studyContent/revisions.ts";
assertReferenceTestEnvironment();
const root = process.env.CFM_TEST_ASSETS;
if (!root?.startsWith("/tmp/")) throw Error("Eigen gepinde testassets vereist");
after(() => prisma.$disconnect());
test("52 officiële CFM-concepten: echte OTB-doelen, persistente media, idempotentie en behoud van publicaties/economie", async () => {
  const f = await referenceFixture();
  const index = JSON.parse(
    await fs.readFile("data/study-content/cfm-2026-nl/otb-index.json", "utf8"),
  );
  const otb = await prisma.contentCollection.findFirstOrThrow({
    where: { work: "old-testament", editionKey: "otb", language: "nl" },
  });
  await prisma.contentCollection.update({
    where: { id: otb.id },
    data: {
      enabled: true,
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  for (const row of index.chapters) {
    const bytes = await fs.readFile(path.join(root, "otb", row.sourceFile));
    assert.equal(
      createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex"),
      row.sourceBlob,
    );
    const parsed = parseOtbChapter(
      JSON.parse(bytes.toString("utf8")),
      row.sourceFile,
    );
    assert.equal(parsed.issues.length, 0);
    const book = await prisma.book.upsert({
      where: {
        contentCollectionId_key: {
          contentCollectionId: otb.id,
          key: row.bookKey,
        },
      },
      update: {},
      create: {
        slug: `cfm-otb-${row.bookKey}`,
        key: row.bookKey,
        name: parsed.book,
        order: Number(row.sourceFile.slice(0, 2)),
        contentCollectionId: otb.id,
      },
    });
    const chapter = await prisma.chapter.create({
      data: { bookId: book.id, number: parsed.chapter, order: parsed.chapter },
    });
    await prisma.verse.createMany({
      data: [...parsed.verses].map(([number, text]) => ({
        chapterId: chapter.id,
        number,
        text,
      })),
    });
  }
  const personalModels = [
    prisma.user,
    prisma.userStudyContext,
    prisma.contentProgress,
    prisma.userCourseProgress,
    prisma.userCourseLessonProgress,
    prisma.podcastPlaybackProgress,
    prisma.contentExerciseCredit,
    prisma.exerciseSession,
    prisma.readingSession,
    prisma.note,
    prisma.highlight,
    prisma.bookmark,
    prisma.activityFeedItem,
    prisma.mysteryProgress,
    prisma.puzzleSession,
    prisma.quickMissionaryRun,
    prisma.quickMissionaryReviveProgress,
    prisma.gameSettings,
    prisma.gameContentScope,
    prisma.course,
  ];
  const personalHashes = () =>
    Promise.all(
      personalModels.map(async (model) =>
        createHash("sha256")
          .update(
            JSON.stringify(
              (await model.findMany()).map((row) => JSON.stringify(row)).sort(),
            ),
          )
          .digest("hex"),
      ),
    );
  const beforeHashes = await personalHashes();
  const beforeUser = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  const beforeCounts = await Promise.all([
    prisma.contentProgress.count(),
    prisma.userCourseProgress.count(),
    prisma.activityFeedItem.count(),
    prisma.readingSession.count(),
    prisma.note.count(),
    prisma.highlight.count(),
    prisma.bookmark.count(),
  ]);
  const options = {
    mediaBytes: (a) => fs.readFile(path.join(root, "media", a.file)),
  };
  await assert.rejects(
    importCfm2026Drafts(f.owner.actor, options),
    (e) => e.code === "FORBIDDEN",
  );
  const report = await importCfm2026Drafts(f.admin.actor, options);
  assert.equal(report.importedLessons, 52);
  assert.equal(
    report.lessons.reduce((n, l) => n + l.blocks, 0),
    3200,
  );
  const collection = await prisma.contentCollection.findUniqueOrThrow({
    where: { id: report.collectionId },
  });
  assert.equal(collection.publicationState, "DRAFT");
  assert.equal(collection.visibleToUsers, false);
  const editions = await prisma.studyLessonEdition.findMany({
    where: { collectionId: collection.id },
    orderBy: { lesson: { order: "asc" } },
    include: { lesson: true },
  });
  assert.equal(editions.length, 52);
  assert.ok(editions.every((e) => e.draftRevisionId && !e.publishedRevisionId));
  assert.equal(
    editions[0].lesson.startsOn.toISOString().slice(0, 10),
    "2025-12-29",
  );
  assert.equal(
    editions[51].lesson.endsOnExclusive.toISOString().slice(0, 10),
    "2026-12-28",
  );
  assert.equal(
    await getPublishedStudyLesson(
      f.owner.actor,
      editions[0].lessonId,
      collection.id,
    ),
    null,
  );
  assert.equal(
    await getPublishedStudyLesson(
      f.admin.actor,
      editions[0].lessonId,
      collection.id,
    ),
    null,
  );
  for (const account of [f.owner, f.admin]) {
    const denied = await fetch(
      `${assertReferenceTestEnvironment()}/study-lesson/${editions[0].lessonId}/${collection.id}`,
      { headers: { cookie: account.cookie }, redirect: "manual" },
    );
    assert.equal(denied.status, 404);
  }
  const refs = report.lessons.flatMap((l) => l.references),
    internal = refs.filter((r) => r.diagnosis === "INTERNAL_VERIFIED");
  assert.equal(internal.length, 1679);
  assert.equal(
    refs.filter((r) => r.diagnosis === "EXTERNAL_VERIFIED").length,
    449,
  );
  assert.ok(
    internal.every(
      (r) =>
        r.normalized.work === "old-testament" &&
        r.normalized.editionKey === "otb" &&
        r.normalized.language === "nl",
    ),
  );
  const counts = {
    runs: await prisma.contentImportRun.count({
      where: { collectionId: collection.id },
    }),
    revisions: await prisma.studyRevision.count({
      where: { edition: { collectionId: collection.id } },
    }),
    media: await prisma.contentMedia.count(),
  };
  // Simuleer een bestaande publicatie uitsluitend als eigen testfixture.
  const previous = editions[9].draftRevisionId;
  await prisma.studyLessonEdition.update({
    where: { id: editions[9].id },
    data: { publishedRevisionId: previous },
  });
  const again = await importCfm2026Drafts(f.admin.actor, options);
  assert.deepEqual(
    again.lessons.map((l) => l.revisionId),
    report.lessons.map((l) => l.revisionId),
  );
  await assert.rejects(
    importCfm2026Drafts(f.admin.actor, {
      mediaBytes: async () => Buffer.from("corrupt"),
    }),
    (e) => e.code === "MEDIA",
  );
  assert.equal(
    (
      await prisma.studyLessonEdition.findUniqueOrThrow({
        where: { id: editions[9].id },
      })
    ).publishedRevisionId,
    previous,
  );
  assert.equal(
    await prisma.contentImportRun.count({
      where: { collectionId: collection.id },
    }),
    counts.runs,
  );
  assert.equal(
    await prisma.studyRevision.count({
      where: { edition: { collectionId: collection.id } },
    }),
    counts.revisions,
  );
  assert.equal(await prisma.contentMedia.count(), counts.media);
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
    beforeUser,
  );
  assert.deepEqual(
    await Promise.all([
      prisma.contentProgress.count(),
      prisma.userCourseProgress.count(),
      prisma.activityFeedItem.count(),
      prisma.readingSession.count(),
      prisma.note.count(),
      prisma.highlight.count(),
      prisma.bookmark.count(),
    ]),
    beforeCounts,
  );
  assert.deepEqual(
    await personalHashes(),
    beforeHashes,
    "20 persoonlijke, cursus-, spel- en economietabellen blijven bytegelijk",
  );
  // Publicatie faalt nog steeds op echte onopgeloste verwijzingen.
  await prisma.contentCollection.update({
    where: { id: collection.id },
    data: { publicationState: "PUBLISHED", visibleToUsers: true },
  });
  const chosen = editions[2],
    chosenRun = report.lessons[2];
  await assert.rejects(
    publishStudyRevision(f.admin.actor, {
      editionId: chosen.id,
      revisionId: chosen.draftRevisionId,
      importRunId: chosenRun.runId,
      kind: "PUBLISH",
      expectedVersion: 0,
      actionId: randomUUID(),
    }),
    (e) => ["REFERENCES", "MEDIA"].includes(e.code),
  );
  assert.equal(
    (
      await prisma.studyLessonEdition.findUniqueOrThrow({
        where: { id: chosen.id },
      })
    ).publishedRevisionId,
    null,
  );
  // Alleen de wegwerpdatabase stelt één pointer in om de echte readertrip te testen.
  // Dit is geen geslaagde publicatiegate en wordt nooit uitgevoerd door importcode.
  await prisma.studyLessonEdition.update({
    where: { id: chosen.id },
    data: { publishedRevisionId: chosen.draftRevisionId },
  });
  await prisma.user.update({
    where: { id: f.owner.user.id },
    data: { activeContentCollectionId: collection.id, contentLanguage: "nl" },
  });
  for (const e of [editions[9], editions[35], editions[40]])
    await prisma.studyLessonEdition.update({
      where: { id: e.id },
      data: { publishedRevisionId: e.draftRevisionId },
    });
  const longLessons = [
    { edition: editions[9], reference: "ref-b-scripture_title1-0", verses: 67 },
    {
      edition: editions[35],
      reference: "ref-b-scripture_title3-0",
      verses: 176,
    },
  ].map((x) => ({
    href: `/study-lesson/${x.edition.lessonId}/${collection.id}`,
    reference: x.reference,
    verses: x.verses,
  }));
  const flow = {
    tableHref: `/study-lesson/${editions[40].lessonId}/${collection.id}`,
    longLessons,
    userId: f.owner.user.id,
    token: f.owner.token,
    collectionId: collection.id,
    href: `/study-lesson/${chosen.lessonId}/${collection.id}`,
  };
  await fs.writeFile(
    path.join(
      path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE),
      "cfm-flow.json",
    ),
    JSON.stringify(flow),
    { mode: 0o600 },
  );
  const summary = {
    expectedLessons: 52,
    importedLessons: 52,
    blocks: 3200,
    references: refs.length,
    internallyResolved: internal.length,
    externalVerified: refs.filter((r) => r.diagnosis === "EXTERNAL_VERIFIED")
      .length,
    blockedReferences: refs.filter(
      (r) => !["INTERNAL_VERIFIED", "EXTERNAL_VERIFIED"].includes(r.diagnosis),
    ).length,
    otbBooks: 39,
    otbChapters: 929,
    otbVerses: 23145,
    idempotentReimport: true,
    existingPublicationPreserved: true,
    userAndEconomyPreserved: true,
    preservedPersonalTables: personalModels.length,
    draftHttpAccessBlocked: true,
    productionTouched: false,
  };
  await fs.mkdir("/tmp/versado-cfm-import-browser", { recursive: true });
  await fs.writeFile(
    "/tmp/versado-cfm-import-browser/import-results.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
});
