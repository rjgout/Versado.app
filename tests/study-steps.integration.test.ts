import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports";
import { publishStudyRevision } from "../src/lib/studyContent/publication";
import { applyStepProgress, completedStepCounts, getStepProgress } from "../src/lib/studyContent/stepProgress";
import { PERSONAL_STUDY_STEPS, planPersonalStudy } from "../src/lib/studyContent/personalStudy";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { legacyPersonalPlan } from "../src/lib/studyContent/personalStudyOverrides";

// Eigen geïsoleerde database vereist, zoals de overige integratietests (nooit productie of een gedeelde database).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");

let admin: { id: string; isAdmin: boolean };
let owner: { id: string; isAdmin: boolean };
let other: { id: string; isAdmin: boolean };
let editionId: string, revisionId: string;
const fingerprints = ["a".repeat(16), "b".repeat(16), "c".repeat(16)];

async function account(isAdmin = false) {
  return prisma.user.create({
    data: { email: `${randomUUID()}@study-steps.test.invalid`, passwordHash: "test-only", handle: `T${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin, timeZone: "Europe/Amsterdam" },
  });
}
const step = (n: number) => ({ index: n, fingerprint: fingerprints[n - 1] });
const apply = (user: { id: string }, n: number, action: "OPEN" | "COMPLETE", rev = revisionId) =>
  prisma.$transaction((tx) => applyStepProgress(tx, user.id, { lessonEditionId: editionId, revisionId: rev, step: step(n), action }));

before(async () => {
  admin = await account(true);
  owner = await account();
  other = await account();
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: { id: key, slug: key, name: "Synthetische stapvoortgang", work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: true },
  });
  const run = await createStudyImport(admin, key, "sample");
  await executeStudyImport(admin, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({ where: { runId: run.id }, include: { edition: true } });
  await publishStudyRevision(admin, { editionId: item.lessonEditionId, revisionId: item.revisionId, importRunId: run.id, expectedVersion: item.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
  editionId = item.lessonEditionId;
  revisionId = item.revisionId;
});
after(async () => {
  await prisma.$disconnect();
});

test("een stap openen is 'bezig' en afronden is monotoon en idempotent", async () => {
  assert.equal(await apply(owner, 1, "OPEN"), true);
  assert.equal(await apply(owner, 1, "OPEN"), false);
  assert.equal(await apply(owner, 1, "COMPLETE"), true);
  assert.equal(await apply(owner, 1, "COMPLETE"), false);
  // Heropenen verlaagt de status nooit.
  assert.equal(await apply(owner, 1, "OPEN"), false);
  const row = await prisma.studyStepProgress.findUniqueOrThrow({ where: { userId_lessonEditionId_stepFingerprint: { userId: owner.id, lessonEditionId: editionId, stepFingerprint: fingerprints[0] } } });
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.completedAt);
});

test("gelijktijdige afrondingen van twee apparaten geven één rij en precies één echte wijziging", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => apply(owner, 2, i % 3 === 0 ? "OPEN" : "COMPLETE")));
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: owner.id, lessonEditionId: editionId, stepFingerprint: fingerprints[1] } }), 1);
  const row = await prisma.studyStepProgress.findFirstOrThrow({ where: { userId: owner.id, lessonEditionId: editionId, stepFingerprint: fingerprints[1] } });
  assert.equal(row.status, "COMPLETED");
  // Eén create (OPEN of COMPLETE) en hooguit één overgang naar COMPLETED.
  assert.ok(results.filter(Boolean).length <= 2 && results.filter(Boolean).length >= 1);
});

test("voortgang van een andere gebruiker en een andere vingerafdruk blijft gescheiden", async () => {
  await apply(other, 3, "OPEN");
  const mine = await prisma.studyStepProgress.findMany({ where: { userId: other.id } });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "IN_PROGRESS");
  const ownerRows = await prisma.studyStepProgress.findMany({ where: { userId: owner.id, lessonEditionId: editionId } });
  assert.deepEqual(ownerRows.map((r) => r.stepFingerprint).sort(), [fingerprints[0], fingerprints[1]]);
});

test("de databaseconstraints weigeren een afgeronde stap zonder tijdstip en een ongeldig stapnummer", async () => {
  await assert.rejects(prisma.$executeRaw`INSERT INTO "StudyStepProgress"("userId","lessonEditionId","stepFingerprint","stepIndex","revisionId","status","updatedAt") VALUES (${owner.id},${editionId},${"d".repeat(16)},1,${revisionId},'COMPLETED',now())`);
  await assert.rejects(prisma.$executeRaw`INSERT INTO "StudyStepProgress"("userId","lessonEditionId","stepFingerprint","stepIndex","revisionId","status","updatedAt") VALUES (${owner.id},${editionId},${"e".repeat(16)},8,${revisionId},'IN_PROGRESS',now())`);
});

test("stap afronden schrijft geen leesstatus, reeks of XP", async () => {
  const user = await account();
  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { xpTotal: true } });
  for (const n of [1, 2, 3] as const) await apply(user, n, "COMPLETE");
  assert.equal(await prisma.contentProgress.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.streakDay.count({ where: { userId: user.id } }), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { xpTotal: true } })).xpTotal, before.xpTotal);
});

test("weekkaarten tellen alleen afgeronde stappen van de gepubliceerde revisie", async () => {
  const counts = await completedStepCounts(owner, [{ editionId, revisionId }]);
  assert.equal(counts.get(editionId), 2);
  const stale = await completedStepCounts(owner, [{ editionId, revisionId: "andere-revisie" }]);
  assert.equal(stale.get(editionId) ?? 0, 0);
});

test("de weergave koppelt voortgang aan de inhoudsvingerafdruk, niet aan het stapnummer", async () => {
  const { document } = await loadCfmLesson("10");
  const plan = planPersonalStudy(document);
  assert.ok(plan.supported);
  if (!plan.supported) return;
  const user = await account();
  await prisma.studyStepProgress.create({
    data: { userId: user.id, lessonEditionId: editionId, stepFingerprint: plan.steps[2].fingerprint, stepIndex: 3, revisionId, status: "COMPLETED", completedAt: new Date() },
  });
  const lesson = { editionId, revisionId, workKey: "cfm-old-testament-2026", sourceKey: "10", body: document };
  const state = await getStepProgress(user, lesson, plan);
  assert.equal(state?.steps[2].status, "COMPLETED");
  assert.equal(state?.steps[0].status, "NOT_STARTED");
  assert.equal(state?.completedCount, 1);
  // Een revisie met een andere stap 3 (andere vingerafdruk) toont die stap niet als afgerond.
  const changed = { ...plan, steps: plan.steps.map((s, i) => (i === 2 ? { ...s, fingerprint: "f".repeat(16) } : s)) };
  assert.equal((await getStepProgress(user, lesson, changed))?.steps[2].status, "NOT_STARTED");
});

test("zevenstappenvoortgang wordt alleen bij volledige inhoudelijke dekking naar zes stappen omgezet", async () => {
  const { document } = await loadCfmLesson("10");
  const plan = planPersonalStudy(document);
  const legacy = legacyPersonalPlan({ workKey: "cfm-old-testament-2026", sourceKey: "10", body: document });
  assert.ok(plan.supported && legacy.supported);
  if (!plan.supported || !legacy.supported) return;
  assert.equal(plan.steps.length, PERSONAL_STUDY_STEPS);
  assert.equal(legacy.steps.length, 7);
  const lesson = { editionId, revisionId, workKey: "cfm-old-testament-2026", sourceKey: "10", body: document };
  const user = await account();
  // Oude stappen 1 t/m 3 afgerond (versie 1), de rest niet.
  const done = legacy.steps.slice(0, 3);
  for (const old of done)
    await prisma.studyStepProgress.create({ data: { userId: user.id, lessonEditionId: editionId, stepFingerprint: old.fingerprint, stepIndex: old.index, planVersion: 1, revisionId, status: "COMPLETED", completedAt: new Date() } });
  // Zonder omzetting telt oude voortgang niet mee in de weekkaarten.
  assert.equal((await completedStepCounts(user, [{ editionId, revisionId }])).get(editionId) ?? 0, 0);
  const doneBlocks = new Set(done.flatMap((s) => s.blockIds));
  const expected = plan.steps.map((s) => s.blockIds.every((id) => doneBlocks.has(id)));
  assert.ok(expected.some(Boolean), "er is minstens één nieuwe stap volledig gedekt");
  assert.ok(expected.some((v) => !v), "niet elke stap is gedekt");
  const state = await getStepProgress(user, lesson, plan);
  assert.deepEqual(state?.steps.map((s) => s.status === "COMPLETED"), expected);
  // Idempotent en zonder dubbele rijen; de oude rijen blijven bewaard.
  await getStepProgress(user, lesson, plan);
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user.id, planVersion: 2 } }), expected.filter(Boolean).length);
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user.id, planVersion: 1 } }), 3);
  assert.equal((await completedStepCounts(user, [{ editionId, revisionId }])).get(editionId) ?? 0, expected.filter(Boolean).length);
  // Een gebruiker zonder oude voortgang krijgt nooit afgeronde stappen.
  const fresh = await account();
  assert.equal((await getStepProgress(fresh, lesson, plan))?.completedCount, 0);
});

test("een gebruiker verwijderen ruimt de stapvoortgang op", async () => {
  const user = await account();
  await apply(user, 1, "COMPLETE");
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.studyStepProgress.count({ where: { userId: user.id } }), 0);
});
