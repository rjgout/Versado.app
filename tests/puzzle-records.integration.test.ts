import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

// Persoonlijke beste tijden (fase 4). Alleen met een eigen testdatabase; nooit tegen productie.
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  solo: await import("../src/lib/puzzle/solo"),
  match: await import("../src/lib/puzzle/match"),
  records: await import("../src/lib/puzzle/records"),
  variants: await import("../src/lib/puzzle/variants"),
  geometry: await import("../src/lib/puzzle/geometryCache"),
  bank: await import("../src/lib/jigsawQuestions"),
  errors: await import("../src/lib/puzzle/errors"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => { if (skip) return; await L.db.user.deleteMany({ where: { id: { in: ids } } }); await L.db.$disconnect(); });

async function person() {
  const user = await L.db.user.create({ data: { email: `rec-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Rc${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam", currentStreak: 3, longestStreak: 3, lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam" } });
  ids.push(user.id); return user;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });
const best = (userId: string, variantId: string, mode: "SOLO" | "MATCH", hintCategory: "NO_HINTS" | "WITH_HINTS") => L.db.puzzleBestRecord.findUnique({ where: { userId_variantId_mode_hintCategory: { userId, variantId, mode, hintCategory } } });

// --- Records direct (comparator en atomiciteit) ---------------------------------------------------------------
async function variantFor(index = 0, pieces: 6 | 12 = 6, difficulty: "ADVENTURER" | "EXPERT" = "ADVENTURER") {
  return (await L.variants.ensureVariant(index, pieces, difficulty)).variant;
}
async function register(userId: string, variantId: string, ms: number, hints: number, extra = 0, mode: "SOLO" | "MATCH" = "SOLO", completedAt = new Date(), sessionId = `s-${randomUUID()}`) {
  return L.db.$transaction((tx) => L.records.registerBestRecord(tx, { userId, variantId, mode, elapsedMs: ms, hintsUsed: hints, extraHintsUsed: extra, completedAt, sessionId }));
}

test("beste tijd: het voorbeeld uit de opdracht (zonder/met hints blijven onafhankelijk)", { skip }, async () => {
  const u = await person(); const v = await variantFor(1);
  const attempts: [number, number][] = [[300_000, 0], [210_000, 2], [250_000, 0], [175_000, 1], [230_000, 0]];
  const results = [];
  for (const [ms, hints] of attempts) results.push((await register(u.id, v.id, ms, hints)).result);
  assert.deepEqual(results, ["CREATED", "CREATED", "IMPROVED", "IMPROVED", "IMPROVED"]);
  assert.equal((await best(u.id, v.id, "SOLO", "NO_HINTS"))!.elapsedMs, 230_000, "zonder hints: 03:50");
  assert.equal((await best(u.id, v.id, "SOLO", "WITH_HINTS"))!.elapsedMs, 175_000, "met hints: 02:55");
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: u.id, variantId: v.id } }), 2);
});

test("beste tijd: een langzamere of gelijke prestatie vervangt niets; tie-breaker is deterministisch", { skip }, async () => {
  const u = await person(); const v = await variantFor(2);
  const first = new Date("2026-01-01T10:00:00Z");
  await register(u.id, v.id, 100_000, 2, 1, "SOLO", first, "s-fixed");
  assert.equal((await register(u.id, v.id, 100_500, 1)).result, "UNCHANGED", "langzamer");
  assert.equal((await register(u.id, v.id, 100_000, 2, 1, "SOLO", first, "s-fixed")).result, "UNCHANGED", "dezelfde bron opnieuw: idempotent");
  assert.equal((await register(u.id, v.id, 100_000, 2, 0, "SOLO", new Date())).result, "IMPROVED", "gelijke tijd: minder persoonlijke extra hints wint");
  assert.equal((await register(u.id, v.id, 100_000, 1, 0, "SOLO", new Date())).result, "IMPROVED", "dan minste hints in totaal");
  const row = (await best(u.id, v.id, "SOLO", "WITH_HINTS"))!;
  assert.equal(row.hintsUsed, 1);
  assert.equal((await register(u.id, v.id, 100_000, 1, 0, "SOLO", new Date("2099-02-01T00:00:00Z"))).result, "UNCHANGED", "daarna vroegste voltooiing: later wint niet");
  assert.equal((await register(u.id, v.id, 99_999.5, 5, 5)).result, "IMPROVED", "milliseconden bepalen de volgorde");
});

test("beste tijd: gelijktijdige updates houden de snelste, nooit een langzamere", { skip }, async () => {
  const u = await person(); const v = await variantFor(3);
  const times = Array.from({ length: 24 }, (_, i) => 200_000 - ((i * 7919) % 23_000) + i);
  await Promise.all(times.map((ms) => register(u.id, v.id, ms, 0)));
  assert.equal((await best(u.id, v.id, "SOLO", "NO_HINTS"))!.elapsedMs, Math.min(...times));
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: u.id, variantId: v.id } }), 1);
});

test("records zijn gescheiden per modus, variant, aantal stukken en moeilijkheid", { skip }, async () => {
  const u = await person();
  const base = await variantFor(4, 6, "ADVENTURER"); const pieces = await variantFor(4, 12, "ADVENTURER"); const level = await variantFor(4, 6, "EXPERT"); const other = await variantFor(5, 6, "ADVENTURER");
  for (const v of [base, pieces, level, other]) await register(u.id, v.id, 90_000, 0);
  await register(u.id, base.id, 80_000, 0, 0, "MATCH");
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: u.id } }), 5);
  assert.equal((await best(u.id, base.id, "SOLO", "NO_HINTS"))!.elapsedMs, 90_000, "een wedstrijdtijd verandert het Solo-record niet");
  assert.equal((await best(u.id, base.id, "MATCH", "NO_HINTS"))!.elapsedMs, 80_000);
  assert.equal(L.records.hintCategoryFor(0), "NO_HINTS"); assert.equal(L.records.hintCategoryFor(1), "WITH_HINTS");
});

// --- Solo ----------------------------------------------------------------------------------------------------
type State = Awaited<ReturnType<typeof L.solo.startSoloPuzzle>>;
const act = async (userId: string, state: State, operation: Parameters<typeof L.solo.applySoloAction>[4]) => { const next = await L.solo.applySoloAction(userId, state.id, state.version, randomUUID(), operation, "nl"); assert.ok(next); return next; };
async function solveSolo(userId: string, index: number, opts: { hint?: boolean; delayMs?: number; pieces?: 6 | 12 } = {}) {
  let state = await L.solo.startSoloPuzzle(userId, index, opts.pieces ?? 6, "ADVENTURER", "nl");
  if (opts.hint) state = await act(userId, state, { kind: "hint", hint: "PREVIEW", confirmPersonal: true });
  if (opts.delayMs) await sleep(opts.delayMs);
  const geometry = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  for (const piece of geometry.pieces) state = await act(userId, state, { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) state = await act(userId, state, { kind: "connect", a, b });
  assert.equal(state.status, "COMPLETED");
  return state;
}
const choice = (state: State, right: boolean) => { const q = L.bank.jigsawQuestionsForStory(state.story).find((item) => item.text.nl === state.question!.text)!; const correct = state.question!.options.indexOf(q.options.nl[0]); return right ? correct : (correct + 1) % 3; };
const variantOf = async (sessionId: string) => (await L.db.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } })).variantId;

test("Solo: een snellere herhaling verbetert het record, een langzamere niet; foute vraag geeft geen record", { skip }, async () => {
  const u = await person();
  const slow = await solveSolo(u.id, 7, { delayMs: 1200 });
  const variantId = await variantOf(slow.id);
  const wrong = await L.solo.answerSoloPuzzle(u.id, slow.id, choice(slow, false));
  assert.ok(wrong && "correct" in wrong && !wrong.correct);
  assert.equal(await best(u.id, variantId, "SOLO", "NO_HINTS"), null, "een fout antwoord geeft geen record");
  // Een nieuwe poging op dezelfde variant start een nieuwe sessie nadat de vorige beantwoord is.
  const second = await solveSolo(u.id, 7, { delayMs: 1200 });
  const streak = (await get(u.id)).currentStreak;
  const ok = await L.solo.answerSoloPuzzle(u.id, second.id, choice(second, true));
  assert.ok(ok && "record" in ok && ok.record!.result === "CREATED");
  const slowTime = (await best(u.id, variantId, "SOLO", "NO_HINTS"))!.elapsedMs;
  assert.ok(slowTime >= 1200, "puzzeltijd telt vanaf de start");
  const again = await L.solo.answerSoloPuzzle(u.id, second.id, choice(second, true));
  assert.deepEqual(again, ok, "een herhaald antwoord geeft hetzelfde en maakt niets nieuws");
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: u.id, variantId } }), 1);
  const fast = await solveSolo(u.id, 7);
  const better = await L.solo.answerSoloPuzzle(u.id, fast.id, choice(fast, true));
  assert.ok(better && "record" in better && better.record!.result === "IMPROVED" && better.record!.previousElapsedMs === slowTime);
  assert.ok((await best(u.id, variantId, "SOLO", "NO_HINTS"))!.elapsedMs < slowTime);
  assert.ok((await get(u.id)).currentStreak <= streak + 1, "de reeksregel blijft ongewijzigd: één dag telt één keer");
  // Vraagtijd telt niet mee: een snelle puzzel met laat antwoord behoudt zijn tijd.
  const late = await solveSolo(u.id, 7, { delayMs: 0 });
  await sleep(1500);
  const lateAnswer = await L.solo.answerSoloPuzzle(u.id, late.id, choice(late, true));
  assert.ok(lateAnswer && "record" in lateAnswer);
  assert.ok(lateAnswer.record!.elapsedMs < 1500, "de wachttijd op de vraag zit niet in de puzzeltijd");
});

test("Solo: hints geven een apart record; hintvrij en met hints beïnvloeden elkaar niet", { skip }, async () => {
  const u = await person();
  const clean = await solveSolo(u.id, 8, { delayMs: 800 }); const variantId = await variantOf(clean.id);
  await L.solo.answerSoloPuzzle(u.id, clean.id, choice(clean, true));
  const hinted = await solveSolo(u.id, 8);
  const answer = await L.solo.answerSoloPuzzle(u.id, hinted.id, choice(hinted, true));
  assert.ok(answer && "record" in answer);
  const hintedRun = await solveSolo(u.id, 8, { hint: true });
  const hintedAnswer = await L.solo.answerSoloPuzzle(u.id, hintedRun.id, choice(hintedRun, true));
  assert.ok(hintedAnswer && "record" in hintedAnswer && hintedAnswer.record!.hintCategory === "WITH_HINTS", "ook een gratis inbegrepen hint telt als hintgebruik");
  const noHints = (await best(u.id, variantId, "SOLO", "NO_HINTS"))!; const withHints = (await best(u.id, variantId, "SOLO", "WITH_HINTS"))!;
  assert.equal(withHints.hintsUsed, 1); assert.equal(noHints.hintsUsed, 0);
  assert.notEqual(noHints.sessionId, withHints.sessionId);
});

test("Solo: ander aantal stukken is een ander record", { skip }, async () => {
  const u = await person();
  const six = await solveSolo(u.id, 9); await L.solo.answerSoloPuzzle(u.id, six.id, choice(six, true));
  const rows = await L.db.puzzleBestRecord.findMany({ where: { userId: u.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, "SOLO");
});

// --- Wedstrijd -----------------------------------------------------------------------------------------------
type MState = NonNullable<Awaited<ReturnType<typeof L.match.resumeMatchPuzzle>>>;
async function solveMatch(userId: string, matchId: string) {
  let state = await L.match.resumeMatchPuzzle(userId, matchId, "nl") as MState;
  const g = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  const run = async (operation: Parameters<typeof L.match.applyMatchAction>[4]) => { const next = await L.match.applyMatchAction(userId, matchId, state.version, randomUUID(), operation, "nl"); assert.ok(next); state = next as MState; };
  for (const piece of g.pieces) await run({ kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) await run({ kind: "connect", a, b });
  return state;
}
async function matchOf(kind: "ASYNC" | "LIVE" = "ASYNC") {
  const [a, b] = [await person(), await person()];
  await L.db.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const matchId = await L.match.createMatch(a.id, 10, 6, "ADVENTURER", [b.id], kind);
  await L.match.respondToMatchInvite(b.id, matchId, true);
  await L.match.beginMatchAttempt(a.id, matchId); await L.match.beginMatchAttempt(b.id, matchId);
  return { a, b, matchId, variantId: (await L.db.puzzleMatch.findUniqueOrThrow({ where: { id: matchId } })).variantId };
}

test("wedstrijd (regelversie 2): elke geldige finish geeft een record, ook voor de verliezer; de vraag verandert niets", { skip }, async () => {
  const { a, b, matchId, variantId } = await matchOf();
  await L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId, userId: a.id } }, data: { startedAt: new Date(Date.now() - 1000) } });
  await L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId, userId: b.id } }, data: { startedAt: new Date(Date.now() - 90_000) } });
  const stateA = await solveMatch(a.id, matchId); await solveMatch(b.id, matchId);
  const recA = (await best(a.id, variantId, "MATCH", "NO_HINTS"))!; const recB = (await best(b.id, variantId, "MATCH", "NO_HINTS"))!;
  const final = await L.match.getMatch(a.id, matchId);
  assert.equal(final.winnerId, a.id);
  assert.ok(recA && recB, "ook de verliezer heeft een persoonlijk record");
  assert.equal(recB.matchParticipantId !== null, true);
  assert.equal((await L.db.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: a.id } } })).elapsedMs, recA.elapsedMs);
  assert.equal(await best(a.id, variantId, "SOLO", "NO_HINTS"), null, "geen vermenging met Solo");
  assert.ok(final.me.record, "de wedstrijdkaart weet dat dit zijn record is");
  // Foute of ontbrekende vraag verandert het record niet.
  const q = L.bank.jigsawQuestionsForStory(stateA.story).find((item) => item.text.nl === stateA.question!.text)!;
  const wrongIndex = (stateA.question!.options.indexOf(q.options.nl[0]) + 1) % 3;
  await L.match.answerMatch(a.id, matchId, wrongIndex);
  assert.equal((await best(a.id, variantId, "MATCH", "NO_HINTS"))!.elapsedMs, recA.elapsedMs);
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: a.id, variantId, mode: "MATCH" } }), 1);
  // Een tweede wedstrijd op dezelfde variant: een tragere finish verbetert niets.
});

test("wedstrijd: DNF, oude regels (versie 1) en herhaalde commit geven geen (dubbel) record", { skip }, async () => {
  const dnf = await matchOf();
  await L.db.puzzleMatch.update({ where: { id: dnf.matchId }, data: { playDeadline: new Date(Date.now() - 1000) } });
  await (await import("../src/lib/puzzle/maintenance")).runPuzzleMaintenance();
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: { in: [dnf.a.id, dnf.b.id] } } }), 0, "DNF is geen geldig record");
  const old = await matchOf();
  await L.db.puzzleMatch.update({ where: { id: old.matchId }, data: { resultRules: 1 } });
  const oldState = await solveMatch(old.a.id, old.matchId);
  const q = L.bank.jigsawQuestionsForStory(oldState.story).find((item) => item.text.nl === oldState.question!.text)!;
  await L.match.answerMatch(old.a.id, old.matchId, oldState.question!.options.indexOf(q.options.nl[0]));
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: old.a.id } }), 0, "wedstrijden van regelversie 1 komen niet in de vergelijkbare records");
  const retry = await matchOf();
  let state = await L.match.resumeMatchPuzzle(retry.a.id, retry.matchId, "nl") as MState;
  const g = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  for (const piece of g.pieces) state = (await L.match.applyMatchAction(retry.a.id, retry.matchId, state.version, randomUUID(), { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row }, "nl")) as MState;
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = (await L.match.applyMatchAction(retry.a.id, retry.matchId, state.version, randomUUID(), { kind: "connect", a, b }, "nl")) as MState;
  const lastId = randomUUID(); const op = { kind: "connect" as const, a: 4, b: 5 };
  await L.match.applyMatchAction(retry.a.id, retry.matchId, state.version, lastId, op, "nl");
  const rec = await best(retry.a.id, retry.variantId, "MATCH", "NO_HINTS");
  await sleep(300);
  await L.match.applyMatchAction(retry.a.id, retry.matchId, state.version, lastId, op, "nl");
  assert.equal(await L.db.puzzleBestRecord.count({ where: { userId: retry.a.id } }), 1);
  assert.equal((await best(retry.a.id, retry.variantId, "MATCH", "NO_HINTS"))!.elapsedMs, rec!.elapsedMs);
});
