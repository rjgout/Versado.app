import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Backfill van historische records. Alleen met een eigen testdatabase; nooit tegen productie.
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  backfill: await import("../src/lib/puzzle/recordsBackfill"),
  variants: await import("../src/lib/puzzle/variants"),
  engine: await import("../src/lib/puzzle/engine"),
  geometry: await import("../src/lib/puzzle/geometryCache"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => { if (skip) return; await L.db.user.deleteMany({ where: { id: { in: ids } } }); await L.db.$disconnect(); });

async function person() {
  const user = await L.db.user.create({ data: { email: `bf-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Bf${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam", currentStreak: 5, hintBalance: 7 } });
  ids.push(user.id); return user;
}

/** Een historische, beantwoorde Solo-sessie met gekozen tijd, antwoord en hints. */
async function oldSession(userId: string, variantId: string, ms: number, opts: { correct?: boolean | null; hints?: number; extra?: number; snapshot?: string; completed?: boolean } = {}) {
  const variant = await L.db.puzzleVariant.findUniqueOrThrow({ where: { id: variantId }, include: { definition: true } });
  const geometry = L.geometry.cachedPuzzleGeometry(variant.pieceCount as 6, variant.definition.seed, variant.definition.geometryVersion);
  const base = L.engine.newPuzzleSnapshot(geometry, variant.difficulty as "ADVENTURER");
  const hints = Array.from({ length: opts.hints ?? 0 }, (_, i) => ({ source: i < (opts.hints ?? 0) - (opts.extra ?? 0) ? "INCLUDED" : "PERSONAL", type: "PREVIEW", at: new Date().toISOString(), extra: i >= (opts.hints ?? 0) - (opts.extra ?? 0), actionId: randomUUID(), expiresAt: new Date().toISOString(), target: { type: "PREVIEW" } }));
  const started = new Date(Date.now() - 86_400_000 * 5);
  return L.db.puzzleSession.create({ data: {
    ownerId: userId, variantId, mode: "SOLO", status: "ANSWERED", snapshot: opts.snapshot ?? JSON.stringify({ ...base, hints }),
    answerResult: opts.correct === null ? null : JSON.stringify({ correct: opts.correct ?? true, counted: true, streak: null }),
    startedAt: started, completedAt: opts.completed === false ? null : new Date(started.getTime() + ms), answeredAt: new Date(started.getTime() + ms + 1000),
  } });
}
const rows = (userIds: string[]) => L.db.puzzleBestRecord.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: "asc" }, { mode: "asc" }, { hintCategory: "asc" }] });

test("backfill: reconstrueert de beste tijd per categorie uit historische sessies, niet alleen de eerste recordrij", { skip }, async () => {
  const u = await person(); const other = await person();
  const v = (await L.variants.ensureVariant(20, 6, "ADVENTURER")).variant;
  const s1 = await oldSession(u.id, v.id, 300_000);
  await oldSession(u.id, v.id, 210_000, { hints: 2, extra: 1 });
  await oldSession(u.id, v.id, 230_000);
  await oldSession(u.id, v.id, 175_000, { hints: 1 });
  await oldSession(u.id, v.id, 100_000, { correct: false });
  await oldSession(u.id, v.id, 90_000, { correct: null });
  await oldSession(u.id, v.id, 80_000, { snapshot: "{kapot" });
  await oldSession(u.id, v.id, 70_000, { completed: false });
  await oldSession(other.id, v.id, 120_000);
  // De oude eerste-geldige-recordrij bevat de langzaamste tijd.
  await L.db.puzzlePersonalRecord.create({ data: { userId: u.id, variantId: v.id, sessionId: s1.id, elapsedMs: 300_000, hintsUsed: 0, extraHintsUsed: 0, completedAt: s1.completedAt! } });
  const before = { user: await L.db.user.findUniqueOrThrow({ where: { id: u.id } }), notes: await L.db.notification.count({ where: { userId: u.id } }), streakDays: await L.db.streakDay.count({ where: { userId: u.id } }), acts: await L.db.streakActivity.count({ where: { userId: u.id } }) };

  const dry = await L.backfill.backfillBestRecords(L.db, { dryRun: true });
  assert.equal((await rows([u.id, other.id])).length, 0, "dry-run schrijft niets");
  assert.ok(dry.candidates >= 3 && dry.solo.unreliableSessions >= 3 && dry.solo.wrongOrUnanswered >= 1);

  const run = await L.backfill.backfillBestRecords(L.db, { dryRun: false });
  assert.equal(run.dryRun, false);
  const mine = await rows([u.id]);
  assert.deepEqual(mine.map((r) => [r.hintCategory, r.elapsedMs, r.hintsUsed]), [["NO_HINTS", 230_000, 0], ["WITH_HINTS", 175_000, 1]], "zonder hints 03:50, met hints 02:55");
  assert.equal((await rows([other.id]))[0].elapsedMs, 120_000);

  // Idempotent en herhaalbaar; geen enkele bijwerking buiten de records.
  const again = await L.backfill.backfillBestRecords(L.db, { dryRun: false });
  assert.equal(again.created, 0); assert.equal(again.improved, 0);
  assert.equal((await rows([u.id])).length, 2);
  const after = { user: await L.db.user.findUniqueOrThrow({ where: { id: u.id } }), notes: await L.db.notification.count({ where: { userId: u.id } }), streakDays: await L.db.streakDay.count({ where: { userId: u.id } }), acts: await L.db.streakActivity.count({ where: { userId: u.id } }) };
  assert.equal(after.user.currentStreak, before.user.currentStreak); assert.equal(after.user.hintBalance, before.user.hintBalance);
  assert.equal(after.notes, before.notes); assert.equal(after.streakDays, before.streakDays); assert.equal(after.acts, before.acts);
  assert.equal(await L.db.puzzlePersonalRecord.count({ where: { userId: u.id } }), 1, "historische rij blijft ongewijzigd bestaan");
});

test("backfill: een bestaand beter record wordt niet overschreven door een slechtere historische prestatie", { skip }, async () => {
  const u = await person();
  const v = (await L.variants.ensureVariant(21, 6, "ADVENTURER")).variant;
  await oldSession(u.id, v.id, 200_000);
  const s = await oldSession(u.id, v.id, 150_000);
  await L.db.puzzleBestRecord.create({ data: { userId: u.id, variantId: v.id, mode: "SOLO", hintCategory: "NO_HINTS", elapsedMs: 100_000, hintsUsed: 0, extraHintsUsed: 0, completedAt: new Date(), sessionId: `live-${s.id}` } });
  const run = await L.backfill.backfillBestRecords(L.db, { dryRun: false });
  assert.equal((await rows([u.id]))[0].elapsedMs, 100_000);
  assert.ok(run.unchanged >= 1);
});

test("backfill: een legacy recordrij zonder bruikbare sessie wordt overgenomen met zijn eigen hintgegevens", { skip }, async () => {
  const u = await person();
  const v = (await L.variants.ensureVariant(22, 6, "ADVENTURER")).variant;
  await L.db.puzzlePersonalRecord.create({ data: { userId: u.id, variantId: v.id, sessionId: `gone-${randomUUID()}`, elapsedMs: 140_000, hintsUsed: 3, extraHintsUsed: 1, completedAt: new Date() } });
  const run = await L.backfill.backfillBestRecords(L.db, { dryRun: false });
  assert.ok(run.solo.legacyRowsAdopted >= 1);
  const r = (await rows([u.id]))[0];
  assert.equal(r.hintCategory, "WITH_HINTS"); assert.equal(r.hintsUsed, 3);
});

test("backfill: alleen regelversie-2-wedstrijden; versie 1, DNF en ongeldig worden niet overgenomen; winnaars blijven staan", { skip }, async () => {
  const [a, b, c] = [await person(), await person(), await person()];
  for (const f of [b, c]) await L.db.friendship.create({ data: { senderId: a.id, receiverId: f.id, status: "ACCEPTED" } });
  const match = await import("../src/lib/puzzle/match");
  const matchId = await match.createMatch(a.id, 23, 6, "ADVENTURER", [b.id, c.id], "ASYNC");
  for (const p of [b, c]) await match.respondToMatchInvite(p.id, matchId, true);
  for (const p of [a, b, c]) await match.beginMatchAttempt(p.id, matchId);
  const m = await L.db.puzzleMatch.findUniqueOrThrow({ where: { id: matchId } });
  const parts = await L.db.puzzleMatchParticipant.findMany({ where: { matchId } });
  const set = (userId: string, data: Record<string, unknown>) => L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId, userId } }, data });
  await set(a.id, { status: "FINISHED", elapsedMs: 120_000, finishedAt: new Date(), hintsUsed: 0, rank: 1 });
  await set(b.id, { status: "FINISHED", elapsedMs: 150_000, finishedAt: new Date(), hintsUsed: 2, extraHintsUsed: 1, rank: 2 });
  await set(c.id, { status: "DNF", finishedAt: new Date() });
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { status: "FINISHED", winnerId: a.id, finishedAt: new Date() } });
  // Een tweede, oude wedstrijd (regelversie 1) met een FINISHED-tijd die onder de oude regels ontstond.
  const oldId = await match.createMatch(b.id, 24, 6, "ADVENTURER", [a.id], "ASYNC");
  await match.respondToMatchInvite(a.id, oldId, true); await match.beginMatchAttempt(b.id, oldId);
  await L.db.puzzleMatch.update({ where: { id: oldId }, data: { resultRules: 1, status: "FINISHED", winnerId: b.id } });
  await L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId: oldId, userId: b.id } }, data: { status: "FINISHED", elapsedMs: 10_000, finishedAt: new Date(), rank: 1 } });

  const run = await L.backfill.backfillBestRecords(L.db, { dryRun: false });
  assert.ok(run.match.skippedRulesV1 >= 1);
  const all = (await rows([a.id, b.id, c.id])).filter((r) => r.mode === "MATCH");
  assert.deepEqual(all.map((r) => [r.userId === a.id ? "a" : r.userId === b.id ? "b" : "c", r.hintCategory, r.elapsedMs]).sort(), [["a", "NO_HINTS", 120_000], ["b", "WITH_HINTS", 150_000]]);
  const after = await L.db.puzzleMatch.findUniqueOrThrow({ where: { id: matchId } });
  assert.equal(after.winnerId, a.id); assert.equal(m.resultRules, 2);
  const oldAfter = await L.db.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId: oldId, userId: b.id } } });
  assert.equal(oldAfter.elapsedMs, 10_000, "een oude uitslag wordt niet herschreven");
  void parts;
});
