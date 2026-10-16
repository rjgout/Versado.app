import {setTimeout as delay} from "node:timers/promises";
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
import { releaseStudyCollection, studyCollectionReleaseState } from "../src/lib/studyContent/collectionRelease.ts";
import { cfmApprovedSnapshot,requireCfmApproval } from "../src/lib/studyContent/sourceApproval.ts";
import { getPublishedStudyLesson } from "../src/lib/studyContent/revisions.ts";
assertReferenceTestEnvironment();
const root = process.env.CFM_TEST_ASSETS;
if (!root?.startsWith("/tmp/")) throw Error("Eigen gepinde testassets vereist");
after(() => prisma.$disconnect());
test("auditmigratie is uitsluitend een atomaire constraintuitbreiding, herhaalbaar en terugrolbaar bij conflict", async () => {
  const sql = await fs.readFile("prisma/migrations/20261103120000_study_publication_audit_actions/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:CREATE\s+TABLE|DROP\s+(?:TABLE|COLUMN)|UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
  const constraints = () => prisma.$queryRaw`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"StudyPublicationAction"'::regclass ORDER BY conname`;
  const before = await constraints();
  const check = before.find(row => row.conname === "StudyPublicationAction_version_check").definition;
  for (const kind of ["PUBLISH", "ROLLBACK", "PUBLISH_DISPLAY_ONLY", "RELEASE_COLLECTION"]) assert.ok(check.includes(kind));
  // De DROP en ADD zitten in één SQL-statement: ook een fout ná DROP behoudt de oude constraint.
  await assert.rejects(prisma.$executeRawUnsafe(sql.replace('ADD CONSTRAINT "StudyPublicationAction_version_check"', 'ADD CONSTRAINT "StudyPublicationAction_pkey"')));
  assert.deepEqual(await constraints(), before);
  await prisma.$executeRawUnsafe(sql);
  await prisma.$executeRawUnsafe(sql);
  assert.deepEqual(await constraints(), before);
});
test("52 officiële CFM-concepten: echte OTB-doelen, persistente media, idempotentie en behoud van publicaties/economie", async (t) => {
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
    prisma.readingPosition,
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
  const unrelatedPublications = await prisma.studyLessonEdition.findMany({select:{id:true,publishedRevisionId:true,draftRevisionId:true,publicationVersion:true},orderBy:{id:"asc"}});
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
  const storageDir=process.env.STUDY_MEDIA_DIR;
  try{process.env.STUDY_MEDIA_DIR="/tmp/versado-missing-study-media";await assert.rejects(importCfm2026Drafts(f.admin.actor,options),e=>e.code === "STORAGE");}finally{process.env.STUDY_MEDIA_DIR=storageDir;}
  t.mock.method(fs,"statfs",async()=>({bavail:0,bsize:4096}));
  await assert.rejects(importCfm2026Drafts(f.admin.actor,options),e=>e.code === "STORAGE");t.mock.restoreAll();
  await assert.rejects(importCfm2026Drafts(f.admin.actor,{...options,progress:n=>{if(n===9)throw Error("synthetic-interruption");}}),/synthetic-interruption/);
  assert.equal(await prisma.contentImportRun.count({where:{adapterName:"cfm-2026-nl-v1"}}),9);
  const base=assertReferenceTestEnvironment();const proposal=await fetch(base+"/api/admin/reseed",{headers:{cookie:f.admin.cookie}});assert.equal(proposal.status,200);assert.equal((await proposal.json()).studySource.snapshot,await cfmApprovedSnapshot());
  for(const who of [null,f.owner])assert.equal((await fetch(base+"/api/admin/reseed",{headers:who?{cookie:who.cookie}:{}})).status,who?403:401);
  for(const who of [null,f.owner])assert.equal((await fetch(base+"/api/admin/reseed",{method:"POST",headers:{...(who?{cookie:who.cookie}:{}),Origin:base,"Content-Type":"application/json"},body:JSON.stringify({approvedSnapshot:await cfmApprovedSnapshot(),confirmDraftsOnly:true})})).status,who?403:401);
  for(const payload of [{approvedSnapshot:await cfmApprovedSnapshot(),confirmDraftsOnly:false},{approvedSnapshot:await cfmApprovedSnapshot(),confirmDraftsOnly:true,userId:f.owner.user.id}])assert.equal((await fetch(base+"/api/admin/reseed",{method:"POST",headers:{cookie:f.admin.cookie,Origin:base,"Content-Type":"application/json"},body:JSON.stringify(payload)})).status,400);
  const csrf=await fetch(base+"/api/admin/reseed",{method:"POST",headers:{cookie:f.admin.cookie,Origin:"https://untrusted.invalid","Content-Type":"application/json"},body:"{}"});assert.equal(csrf.status,403);
  const rejected=await fetch(base+"/api/admin/reseed",{method:"POST",headers:{cookie:f.admin.cookie,Origin:base,"Content-Type":"application/json"},body:JSON.stringify({approvedSnapshot:"0".repeat(64),confirmDraftsOnly:true})});assert.equal(rejected.status,409);
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
  assert.equal(internal.length, 1960);
  assert.equal(
    refs.filter((r) => r.diagnosis === "EXTERNAL_VERIFIED").length,
    1096,
  );
  assert.equal(refs.filter((r) => r.diagnosis === "UNRESOLVED").length, 553);
  const adminOverview = await fetch(`${assertReferenceTestEnvironment()}/api/admin/study-publications`, { headers: { cookie: f.admin.cookie } });
  assert.equal(adminOverview.status, 200);
  const overview = await adminOverview.json();
  assert.equal(overview.editions.filter((e) => e.collectionId === collection.id).length, 52);
  const previewResponse = await fetch(`${assertReferenceTestEnvironment()}/api/admin/study-publications?editionId=${editions[0].id}&revisionId=${editions[0].draftRevisionId}`, { headers: { cookie: f.admin.cookie } });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.references.some((r) => r.diagnosis === "UNRESOLVED" && r.originalTarget));
  assert.ok(preview.references.some((r) => r.approvedExternalUrl));
  assert.ok(preview.media.every((m) => m.ready));
  for (const cookie of [null, f.owner.cookie]) {
    const denied = await fetch(`${assertReferenceTestEnvironment()}/api/admin/study-publications?editionId=${editions[0].id}&revisionId=${editions[0].draftRevisionId}`, { headers: cookie ? { cookie } : {} });
    assert.equal(denied.status, cookie ? 403 : 401);
  }
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
  // Echte API → achtergrondjob → runSeed → CFM. Stop de legacyfase vóór iedere boekwrite/netwerkimport.
  const orderBefore=collection.order;
  await prisma.contentCollection.update({where:{id:collection.id},data:{order:-1000}});
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "testCfmSeedBoundary"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."contentCollectionId" <> 'content_bom' THEN RAISE EXCEPTION 'WRONG_CANONICAL_SOURCE'; END IF; RAISE EXCEPTION 'SYNTHETIC_LEGACY_BOUNDARY'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "testCfmSeedBoundary" BEFORE INSERT OR UPDATE ON "Book" FOR EACH ROW EXECUTE FUNCTION "testCfmSeedBoundary"()`);
  try {
    const start=async()=>fetch(base+"/api/admin/reseed",{method:"POST",headers:{cookie:f.admin.cookie,Origin:base,"Content-Type":"application/json"},body:JSON.stringify({approvedSnapshot:await cfmApprovedSnapshot(),confirmDraftsOnly:true})});
    const response=await start();assert.equal(response.status,200);assert.equal((await response.json()).started,true);
    const duplicate=await start();assert.equal((await duplicate.json()).started,false);
    let status;
    for(let n=0;n<180;n++){status=(await (await fetch(base+"/api/admin/reseed",{headers:{cookie:f.admin.cookie}})).json()).job;if(status.status!=="running")break;await delay(500);}
    assert.equal(status.status,"error");assert.match(status.error,/SYNTHETIC_LEGACY_BOUNDARY/);assert.ok(!status.error.includes("WRONG_CANONICAL_SOURCE"));assert.equal(status.progress.current,52);assert.equal(status.progress.work,"cfm-old-testament-2026");
  } finally {await prisma.$executeRawUnsafe(`DROP TRIGGER "testCfmSeedBoundary" ON "Book"`);await prisma.$executeRawUnsafe(`DROP FUNCTION "testCfmSeedBoundary"()`);await prisma.contentCollection.update({where:{id:collection.id},data:{order:orderBefore}});}
  for (const flags of [
    { visibleToUsers: true, publicationState: "DRAFT" },
    { visibleToUsers: false, publicationState: "LEGACY" },
    { visibleToUsers: false, publicationState: "PUBLISHED" },
  ]) {
    await prisma.contentCollection.update({ where: { id: collection.id }, data: flags });
    await importCfm2026Drafts(f.admin.actor, options);
    const unchanged = await prisma.contentCollection.findUniqueOrThrow({ where: { id: collection.id } });
    assert.equal(unchanged.visibleToUsers, flags.visibleToUsers);
    assert.equal(unchanged.publicationState, flags.publicationState);
    assert.equal(await prisma.contentImportRun.count({ where: { collectionId: collection.id } }), counts.runs);
    assert.equal(await prisma.studyRevision.count({ where: { edition: { collectionId: collection.id } } }), counts.revisions);
  }
  await prisma.contentCollection.update({ where: { id: collection.id }, data: { visibleToUsers: false, publicationState: "DRAFT" } });
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
  await importCfm2026Drafts(f.admin.actor, {mediaBytes:async()=>{throw Error("Bestaande gevalideerde media mogen niet opnieuw downloaden");}});
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
    "21 persoonlijke, cursus-, spel- en economietabellen blijven bytegelijk",
  );
  assert.deepEqual(await prisma.studyLessonEdition.findMany({where:{id:{in:unrelatedPublications.map(e=>e.id)}},select:{id:true,publishedRevisionId:true,draftRevisionId:true,publicationVersion:true},orderBy:{id:"asc"}}),unrelatedPublications);
  // Zonder expliciete inhoudelijke beoordeling blijven deze verwijzingen blokkeren.
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
  await prisma.contentCollection.update({where:{id:collection.id},data:{publicationState:"DRAFT",visibleToUsers:false}});
  await assert.rejects(releaseStudyCollection(f.admin.actor,{collectionId:collection.id,releaseToken:"0".repeat(64),actionId:randomUUID()}));
  for(const [i,e] of editions.entries()){
    await publishStudyRevision(f.admin.actor,{editionId:e.id,revisionId:e.draftRevisionId,importRunId:report.lessons[i].runId,kind:"PUBLISH",expectedVersion:0,actionId:randomUUID(),allowReviewedDisplayOnly:true});
    assert.equal(await getPublishedStudyLesson(f.admin.actor,e.lessonId,collection.id),null,"Collectie blijft DRAFT tot afzonderlijke vrijgave");
  }
  const release=await studyCollectionReleaseState(f.admin.actor,collection.id);
  assert.equal(release.complete,true);assert.equal(release.published,52);
  // Een intrekking tussen preflight en de schrijftransactie mag geen collectie vrijgeven.
  const releaseAuditsBefore = await prisma.studyPublicationAction.count({ where: { kind: "RELEASE_COLLECTION" } });
  const retiringClient = new Proxy(prisma, {
    get(target, key) {
      if (key === "$transaction") return async (...args) => {
        await prisma.studyLesson.update({ where: { id: editions[0].lessonId }, data: { retiredAt: new Date() } });
        return target.$transaction(...args);
      };
      return Reflect.get(target, key, target);
    },
  });
  try {
    await assert.rejects(releaseStudyCollection(f.admin.actor, {
      collectionId: collection.id, releaseToken: release.releaseToken, actionId: randomUUID(),
    }, retiringClient), error => ["INCOMPLETE", "CONFLICT"].includes(error.code));
    assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: collection.id } })).publicationState, "DRAFT");
    assert.equal(await prisma.studyPublicationAction.count({ where: { kind: "RELEASE_COLLECTION" } }), releaseAuditsBefore);
  } finally {
    await prisma.studyLesson.update({ where: { id: editions[0].lessonId }, data: { retiredAt: null } });
  }
  await assert.rejects(releaseStudyCollection(f.owner.actor,{collectionId:collection.id,releaseToken:release.releaseToken,actionId:randomUUID()}),e=>e.code==="FORBIDDEN");
  const releaseAction={collectionId:collection.id,releaseToken:release.releaseToken,actionId:randomUUID()};
  const outcomes=await Promise.all([releaseStudyCollection(f.admin.actor,releaseAction),releaseStudyCollection(f.admin.actor,releaseAction)]);
  assert.equal(outcomes.filter(r=>r.changed).length,1);
  assert.equal((await prisma.contentCollection.findUniqueOrThrow({where:{id:collection.id}})).visibleToUsers,false);
  for(const e of editions){assert.ok(await getPublishedStudyLesson(f.admin.actor,e.lessonId,collection.id));assert.equal(await getPublishedStudyLesson(f.owner.actor,e.lessonId,collection.id),null);}
  const adminReader=await fetch(`${assertReferenceTestEnvironment()}/study-lesson/${chosen.lessonId}/${collection.id}`,{headers:{cookie:f.admin.cookie}});assert.equal(adminReader.status,200);
  const unselected=await fetch(`${assertReferenceTestEnvironment()}/study-lesson/${chosen.lessonId}/${collection.id}`,{headers:{cookie:f.owner.cookie}});assert.equal(unselected.status,404);
  await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:true}});
  for(const e of editions)assert.ok(await getPublishedStudyLesson(f.owner.actor,e.lessonId,collection.id));
  const publishedBefore=await prisma.studyLessonEdition.findMany({where:{collectionId:collection.id},select:{id:true,publishedRevisionId:true,publicationVersion:true},orderBy:{id:"asc"}});
  await importCfm2026Drafts(f.admin.actor,options);
  assert.deepEqual(await prisma.studyLessonEdition.findMany({where:{collectionId:collection.id},select:{id:true,publishedRevisionId:true,publicationVersion:true},orderBy:{id:"asc"}}),publishedBefore);
  await requireCfmApproval(await cfmApprovedSnapshot());await assert.rejects(requireCfmApproval("0".repeat(64)));
  await prisma.user.update({where:{id:f.owner.user.id},data:{activeContentCollectionId:collection.id,contentLanguage:"nl"}});
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
  const scriptureChapter = async (book, number) =>
    prisma.chapter.findFirstOrThrow({
      where: { number, book: { key: book, contentCollectionId: otb.id } },
      select: { id: true },
    });
  const selectedCases = [
    {
      edition: editions[22],
      reference: "ref-b-title1-0",
      index: 3,
      choices: 4,
      book: "rut",
      chapter: 4,
      verses: 22,
    },
    {
      edition: editions[10],
      reference: "ref-b-scripture_title4-0",
      index: 1,
      choices: 2,
      book: "gen",
      chapter: 41,
      verses: 57,
      previewNumbers: [55, 56, 57],
    },
  ];
  const selections = [];
  for (const c of selectedCases)
    selections.push({
      ...c,
      edition: undefined,
      href: `/study-lesson/${c.edition.lessonId}/${collection.id}`,
      chapterId: (await scriptureChapter(c.book, c.chapter)).id,
    });
  const externalPdf = report.lessons[2].references.find(
    (r) =>
      r.diagnosis === "EXTERNAL_VERIFIED" && r.normalized.url?.endsWith(".pdf"),
  );
  const externalVideo = report.lessons[0].references.find(
    (r) =>
      r.diagnosis === "EXTERNAL_VERIFIED" &&
      r.normalized.url?.endsWith("-nl.mp4"),
  );
  const externalEnglish = report.lessons[2].references.find(
    (r) =>
      r.diagnosis === "EXTERNAL_VERIFIED" &&
      r.normalized.url?.endsWith("-en.mp4"),
  );
  assert.ok(externalEnglish);
  assert.ok(externalPdf);
  assert.ok(externalVideo);
  const flow = {
    adminToken: f.admin.token,
    adminId: f.admin.user.id,
    selections,
    secondChapterId: (await scriptureChapter("gen", 2)).id,
    externals: [
      {
        href: `/study-lesson/${chosen.lessonId}/${collection.id}`,
        anchor: externalEnglish.anchor,
        url: externalEnglish.normalized.url,
        language: "en",
        label: externalEnglish.label,
      },
      {
        href: `/study-lesson/${chosen.lessonId}/${collection.id}`,
        anchor: externalPdf.anchor,
        url: externalPdf.normalized.url,
      },
      {
        href: `/study-lesson/${editions[0].lessonId}/${collection.id}`,
        anchor: externalVideo.anchor,
        url: externalVideo.normalized.url,
        label: externalVideo.label,
      },
    ],
    ntHref: `/study-lesson/${editions[0].lessonId}/${collection.id}`,
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
    legitimatelyPublishedLessons: 52,
    concurrentCollectionRelease: "one-change",
    adminHiddenReader: true,
    publicVisibilitySeparate: true,
    interruptedImportResumed: true,
    actualBackendReloadCfmPhase: true,
    legacyBookSourcePinned: true,
    duplicateReloadBlocked: true,
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
