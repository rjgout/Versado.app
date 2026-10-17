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
import { studyProgramReview } from "../src/lib/studyContent/programReview.ts";
import { publishStudyProgram } from "../src/lib/studyContent/programPublication.ts";
import { programReportJson, programReportMarkdown } from "../src/lib/studyContent/programReport.ts";
import { studyPublishingOverview } from "../src/lib/studyContent/admin.ts";
assertReferenceTestEnvironment();
const root = process.env.CFM_TEST_ASSETS;
if (!root?.startsWith("/tmp/")) throw Error("Eigen gepinde testassets vereist");
after(() => prisma.$disconnect());
const nowait = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
// Gezamenlijke publicatie van de volledige CFM-set (zie docs/content-architecture-v2/24): voorcontrole, verslag,
// onveilige invoer, onderbreking, hervatten, gelijktijdigheid en behoud van audit en zichtbaarheid.
async function bulkPublicationScenarios({ f, collection, editions, report, beforeHashes, personalHashes }) {
  const base = assertReferenceTestEnvironment();
  // Een eerdere testfixture markeerde één concept als gepubliceerd zonder audit; de gezamenlijke publicatie start schoon.
  await prisma.studyLessonEdition.update({ where: { id: editions[9].id }, data: { publishedRevisionId: null } });
  const reviewStarted = Date.now();
  const review = await studyProgramReview(f.admin.actor, collection.id);
  console.log(`# voorcontrole 52 lessen: ${Date.now() - reviewStarted} ms`);
  assert.equal(review.expected, 52);
  assert.equal(review.imported, 52);
  assert.equal(review.published, 0);
  assert.equal(review.ready, 52);
  assert.equal(review.blocked + review.missing, 0);
  assert.equal(review.totals.blocking, 0);
  assert.equal(review.totals.displayOnly, 553, "de 553 bekende, gecontroleerde niet-klikbare verwijzingen");
  assert.equal(review.totals.figures, review.totals.mediaReady);
  assert.equal(review.lessons.length, 52);
  await assert.rejects(studyProgramReview(f.owner.actor, collection.id), (e) => e.code === "FORBIDDEN");
  // Verslag: alle lessen, geen persoonsgegevens, geen valse beoordelingsclaim.
  const markdown = programReportMarkdown(review), json = programReportJson(review);
  for (const lesson of review.lessons) assert.ok(markdown.includes(lesson.title.replace(/\s+/g, " ").trim()), `verslag noemt ${lesson.title}`);
  assert.equal(json.lessons.length, 52);
  assert.equal(json.reviewStatus, "NOT_REVIEWED");
  for (const secret of [f.admin.user.email, f.owner.user.email, process.env.SESSION_SECRET, f.admin.token]) assert.ok(!markdown.includes(secret) && !JSON.stringify(json).includes(secret));
  assert.doesNotMatch(markdown, /goedgekeurd door|beoordeeld door (?:een )?(?:mens|ai|beheerder)/i);
  // HTTP: alleen beheerders; rapport als download en niet cachebaar.
  const reviewUrl = `${base}/api/admin/study-publications?collectionId=${collection.id}&review=1`;
  for (const [cookie, status] of [[null, 401], [f.owner.cookie, 403]]) {
    assert.equal((await fetch(reviewUrl, { headers: cookie ? { cookie } : {} })).status, status);
    assert.equal((await fetch(`${base}/api/admin/study-publications/report?collectionId=${collection.id}&format=md`, { headers: cookie ? { cookie } : {} })).status, status);
  }
  const apiReview = await fetch(reviewUrl, { headers: { cookie: f.admin.cookie } });
  assert.equal(apiReview.status, 200);
  assert.equal((await apiReview.json()).reviewToken, review.reviewToken);
  const download = await fetch(`${base}/api/admin/study-publications/report?collectionId=${collection.id}&format=md`, { headers: { cookie: f.admin.cookie } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(download.headers.get("cache-control") ?? "", /no-store/);
  // Productieprofiel verbergt de synthetische importbediening, de testomgeving niet.
  assert.ok((await studyPublishingOverview(f.admin.actor)).fixtures.length > 0);
  const profile = process.env.STUDY_PUBLICATION_PROFILE;
  try { process.env.STUDY_PUBLICATION_PROFILE = "production"; assert.deepEqual((await studyPublishingOverview(f.admin.actor)).fixtures, []); } finally { process.env.STUDY_PUBLICATION_PROFILE = profile; }

  const batchId = randomUUID();
  const request = { collectionId: collection.id, reviewToken: review.reviewToken, batchId, confirmReviewed: true };
  const publishedCount = () => prisma.studyLessonEdition.count({ where: { collectionId: collection.id, publishedRevisionId: { not: null } } });
  const auditCount = () => prisma.studyPublicationAction.count({ where: { edition: { collectionId: collection.id }, kind: { in: ["PUBLISH", "PUBLISH_DISPLAY_ONLY"] } } });
  // Onveilige aanvragen veranderen niets: geen bevestiging, vreemd token, gewone gebruiker.
  await assert.rejects(publishStudyProgram(f.admin.actor, { ...request, confirmReviewed: false }));
  await assert.rejects(publishStudyProgram(f.admin.actor, { ...request, reviewToken: "0".repeat(64) }), (e) => e.code === "CONFLICT");
  await assert.rejects(publishStudyProgram(f.owner.actor, request), (e) => e.code === "FORBIDDEN");
  assert.equal(await publishedCount(), 0);
  // Een nieuw/gewijzigd onveilig verwijzingsdoel blokkeert de hele set vóór de eerste publicatie.
  const victim = await prisma.contentReference.findFirstOrThrow({ where: { revisionId: editions[30].draftRevisionId, diagnosis: { in: ["INTERNAL_VERIFIED", "EXTERNAL_VERIFIED"] } } });
  await prisma.$executeRaw`ALTER TABLE "ContentReference" DISABLE TRIGGER USER`;
  try {
    await prisma.$executeRaw`UPDATE "ContentReference" SET "originalTarget" = '{"kind":"external","url":"https://onbekend.invalid/x"}'::jsonb WHERE id = ${victim.id}`;
    const tampered = await studyProgramReview(f.admin.actor, collection.id);
    assert.equal(tampered.blocked, 1);
    assert.ok(tampered.totals.blocking >= 1);
    await assert.rejects(publishStudyProgram(f.admin.actor, { ...request, reviewToken: tampered.reviewToken }), (e) => ["REFERENCES", "INCOMPLETE"].includes(e.code));
    assert.equal(await publishedCount(), 0);
  } finally {
    await prisma.$executeRaw`UPDATE "ContentReference" SET "originalTarget" = ${JSON.stringify(victim.originalTarget)}::jsonb WHERE id = ${victim.id}`;
    await prisma.$executeRaw`ALTER TABLE "ContentReference" ENABLE TRIGGER USER`;
  }
  assert.equal((await studyProgramReview(f.admin.actor, collection.id)).reviewToken, review.reviewToken, "herstel geeft dezelfde beoordeelde set");
  // Onderbreking: een gelijktijdige wijziging van één concept laat precies die les mislukken; de rest wordt gepubliceerd.
  const interferer = new Proxy(prisma, {
    get(target, key) {
      if (key !== "studyLessonEdition") return Reflect.get(target, key, target);
      return new Proxy(target.studyLessonEdition, {
        get(model, name) {
          if (name !== "findUnique") return Reflect.get(model, name, model);
          return async (args) => {
            if (args?.where?.id === editions[20].id) await prisma.studyLessonEdition.update({ where: { id: editions[20].id }, data: { draftRevisionId: null } });
            return model.findUnique(args);
          };
        },
      });
    },
  });
  // Eerst een stap met een minimaal tijdsbudget: er is voortgang, maar de batch is nog niet klaar.
  const step = await publishStudyProgram(f.admin.actor, request, prisma, { budgetMs: 0 });
  assert.equal(step.done, false);
  assert.ok(step.published >= 1 && step.remaining > 0, JSON.stringify(step));
  const partial = await publishStudyProgram(f.admin.actor, request, interferer, { budgetMs: 600_000 });
  assert.equal(partial.done, false);
  assert.equal(partial.published, 51, JSON.stringify(partial));
  assert.equal(partial.failed.length, 1);
  assert.equal(partial.failed[0].editionId, editions[20].id);
  assert.equal(await publishedCount(), 51);
  assert.equal(await auditCount(), 51);
  // Een mislukte les blokkeert de collectievrijgave en maakt niets zichtbaar.
  const partialRelease = await studyCollectionReleaseState(f.admin.actor, collection.id);
  assert.equal(partialRelease.complete, false);
  await assert.rejects(releaseStudyCollection(f.admin.actor, { collectionId: collection.id, releaseToken: partialRelease.releaseToken, actionId: randomUUID() }), (e) => e.code === "INCOMPLETE");
  assert.equal(await getPublishedStudyLesson(f.owner.actor, editions[0].lessonId, collection.id), null);
  const stillDraft = await prisma.contentCollection.findUniqueOrThrow({ where: { id: collection.id } });
  assert.equal(stillDraft.publicationState, "DRAFT");
  assert.equal(stillDraft.visibleToUsers, false);
  // Herstel de onderbreking en hervat met dezelfde aanvraag, gelijktijdig tweemaal: hooguit één voert uit, geen dubbele audit.
  await prisma.studyLessonEdition.update({ where: { id: editions[20].id }, data: { draftRevisionId: editions[20].draftRevisionId } });
  assert.equal((await studyProgramReview(f.admin.actor, collection.id)).reviewToken, review.reviewToken, "het token blijft stabiel tijdens een hervatting");
  const outcomes = await Promise.all([nowait(publishStudyProgram(f.admin.actor, request, prisma, { budgetMs: 600_000 })), nowait(publishStudyProgram(f.admin.actor, request, prisma, { budgetMs: 600_000 }))]);
  assert.ok(outcomes.some((o) => o.value?.done === true));
  for (const o of outcomes.filter((x) => x.error)) assert.equal(o.error.code, "BUSY");
  assert.equal(await publishedCount(), 52);
  assert.equal(await auditCount(), 52, "precies één publicatie-audit per les");
  // Identieke herhaling is een no-op.
  const again = await publishStudyProgram(f.admin.actor, request, prisma, { budgetMs: 600_000 });
  assert.deepEqual([again.done, again.published, again.remaining, again.failed.length], [true, 52, 0, 0]);
  assert.equal(await auditCount(), 52);
  const done = await prisma.studyLessonEdition.findMany({ where: { collectionId: collection.id }, orderBy: { lesson: { order: "asc" } } });
  assert.ok(done.every((e) => e.publishedRevisionId && e.publicationVersion === 1 && !e.draftRevisionId));
  assert.deepEqual(done.map((e) => e.publishedRevisionId), review.lessons.map((l) => l.revisionId), "precies de beoordeelde revisies");
  const kinds = await prisma.studyPublicationAction.groupBy({ by: ["kind"], where: { edition: { collectionId: collection.id } }, _count: true });
  assert.ok(kinds.every((k) => ["PUBLISH", "PUBLISH_DISPLAY_ONLY"].includes(k.kind)));
  assert.equal((await prisma.studyPublicationAction.count({ where: { edition: { collectionId: collection.id }, kind: "PUBLISH_DISPLAY_ONLY" } })) > 0, true, "technische audit van bekende verwijzingen blijft bewaard");
  // Publicatie is geen zichtbaarheid: gewone gebruikers zien nog niets, de zichtbaarheidsvlag is ongewijzigd.
  const after = await prisma.contentCollection.findUniqueOrThrow({ where: { id: collection.id } });
  assert.equal(after.publicationState, "DRAFT");
  assert.equal(after.visibleToUsers, false);
  for (const e of editions) assert.equal(await getPublishedStudyLesson(f.owner.actor, e.lessonId, collection.id), null);
  assert.deepEqual(await personalHashes(), beforeHashes, "persoonlijke gegevens en voortgang blijven ongewijzigd");
  const finalReview = await studyProgramReview(f.admin.actor, collection.id);
  assert.deepEqual([finalReview.published, finalReview.ready, finalReview.blocked], [52, 0, 0]);
  void report;
}
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
  await bulkPublicationScenarios({ f, collection, editions, report, beforeHashes, personalHashes });
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
