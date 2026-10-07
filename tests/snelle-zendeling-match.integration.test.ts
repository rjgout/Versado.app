// Integratietests voor de gezamenlijke run (Samen spelen met Vliegende gids):
// levenscyclus, eliminatie, einde van de run, laatste twee (Duo), samenloop,
// herverbinding en de uitsluiting van de solo-ranking. Draait alleen met
// LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:snelle-zendeling-match
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-gezamenlijke-run-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  runs: await import("../src/lib/snelleZendeling/runs"),
  match: await import("../src/lib/snelleZendeling/match"),
  duo: await import("../src/lib/snelleZendeling/duoLeaderboard"),
  duoRules: await import("../src/lib/snelleZendeling/duoRanking"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
const emails: string[] = [];
let seq = 0;
let collectionId = "";

async function makeUser(options: { xp?: number; stock?: number } = {}): Promise<string> {
  const email = `qmmatch-${stamp}-${++seq}@test.invalid`;
  emails.push(email);
  const user = await L.db.user.create({
    data: { email, passwordHash: "x", handle: `Duo${seq}`, discriminator: "11", activeContentCollectionId: collectionId, xpTotal: options.xp ?? 0, geneesBalance: options.stock ?? 0 },
  });
  return user.id;
}

before(async () => {
  if (skip) return;
  L = await load();
  collectionId = `qmmatch-${stamp}`;
  await L.db.contentCollection.create({ data: { id: collectionId, slug: collectionId, name: collectionId, icon: "book", work: collectionId, language: "nl", order: 902 } });
  const book = await L.db.book.create({ data: { slug: `${collectionId}-b`, name: "Boek", order: 0, contentCollectionId: collectionId } });
  const chapter = await L.db.chapter.create({ data: { bookId: book.id, number: 1, order: 0 } });
  for (let v = 1; v <= 12; v++) {
    await L.db.quickMissionaryReviveQuestion.create({
      data: {
        contentKey: `qmm-${stamp}:${v}`,
        chapterId: chapter.id,
        variant: v,
        prompt: `Vraag ${v} voor de wedstrijdtest van Genees?`,
        options: { create: [{ label: "Het goede antwoord", isCorrect: true, order: 0 }, { label: "Een foute keuze A", order: 1 }, { label: "Een foute keuze B", order: 2 }] },
      },
    });
  }
});

after(async () => {
  if (skip) return;
  await L.db.liveGame.deleteMany({ where: { host: { email: { in: emails } } } });
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.contentCollection.deleteMany({ where: { id: collectionId } });
  await L.db.$disconnect();
});

/** Een lobby met n spelers, gestart; de tijdlijn begon 120 s geleden zodat scores plausibel zijn. */
async function startedMatch(n: number, options: { stock?: number; xp?: number; ageSeconds?: number; players?: string[] } = {}) {
  const userIds: string[] = options.players ?? [];
  for (let i = userIds.length; i < n; i++) userIds.push(await makeUser(options));
  const game = await L.db.liveGame.create({
    data: { code: `Q${stamp.slice(-4)}${seq}${Math.floor(Math.random() * 1e6)}`.slice(0, 12), hostId: userIds[0], mode: "QUICK_MISSIONARY", status: "LOBBY", players: { create: userIds.map((userId) => ({ userId })) } },
  });
  const started = await L.match.startMatch(game.id, userIds[0]);
  assert.ok(started.ok, "wedstrijd hoort te starten");
  if (!started.ok) throw new Error("niet gestart");
  await L.db.quickMissionaryMatch.update({ where: { id: started.matchId }, data: { startsAt: new Date(Date.now() - (options.ageSeconds ?? 120) * 1_000) } });
  await L.db.quickMissionaryRun.updateMany({ where: { matchId: started.matchId }, data: { lastSeenAt: new Date() } });
  const runs = await L.db.quickMissionaryRun.findMany({ where: { matchId: started.matchId } });
  const runOf = (userId: string) => runs.find((run) => run.userId === userId)!.id;
  return { matchId: started.matchId, gameId: game.id, userIds, runOf };
}

const matchRow = (matchId: string) => L.db.quickMissionaryMatch.findUniqueOrThrow({ where: { id: matchId } });
const runRow = (runId: string) => L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } });

async function reviveAndAnswer(userId: string, runId: string, correct: boolean) {
  const view = await L.runs.requestReviveQuestion(runId, userId);
  assert.ok(view.reviveQuestion, "er hoort een vraag te zijn");
  const question = await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: view.reviveQuestion.exerciseId }, select: { options: true } });
  const option = question.options.find((o) => o.isCorrect === correct && view.reviveQuestion!.options.some((shown) => shown.id === o.id))!;
  return L.runs.answerReviveQuestion(runId, userId, view.reviveQuestion.exerciseId, option.id);
}

// --- Starten ---------------------------------------------------------------------

test("start: één wereld voor iedereen, een run per speler, alleen de host start, niet dubbel", { skip }, async () => {
  const userIds = [await makeUser(), await makeUser(), await makeUser()];
  const game = await L.db.liveGame.create({ data: { code: `S${stamp.slice(-5)}`, hostId: userIds[0], mode: "QUICK_MISSIONARY", players: { create: userIds.map((userId) => ({ userId })) } } });
  assert.deepEqual(await L.match.startMatch(game.id, userIds[1]), { ok: false, error: "NOT_HOST" });
  const started = await L.match.startMatch(game.id, userIds[0]);
  assert.ok(started.ok);
  if (!started.ok) return;
  assert.deepEqual(await L.match.startMatch(game.id, userIds[0]), { ok: false, error: "INVALID_STATE" });
  const runs = await L.db.quickMissionaryRun.findMany({ where: { matchId: started.matchId } });
  assert.equal(runs.length, 3);
  assert.deepEqual(new Set(runs.map((run) => run.userId)), new Set(userIds));
  assert.ok(runs.every((run) => run.status === "IN_PROGRESS" && run.score === 0 && !run.reviveUsed));
  const match = await matchRow(started.matchId);
  assert.equal(match.participantCount, 3);
  assert.ok(match.seed.length >= 16);
  assert.equal((await L.db.liveGame.findUniqueOrThrow({ where: { id: game.id } })).status, "IN_PROGRESS");
});

test("start: één speler is geen wedstrijd; geen beperking naar boven (12 spelers)", { skip }, async () => {
  const solo = await makeUser();
  const lobby = await L.db.liveGame.create({ data: { code: `T${stamp.slice(-5)}`, hostId: solo, mode: "QUICK_MISSIONARY", players: { create: { userId: solo } } } });
  assert.deepEqual(await L.match.startMatch(lobby.id, solo), { ok: false, error: "TOO_FEW_PLAYERS" });
  const many = await startedMatch(12);
  assert.equal((await matchRow(many.matchId)).participantCount, 12);
});

// --- Einde van de run en laatste twee -----------------------------------------------

test("twee spelers: één valt definitief af, de run stopt met de scores zoals ze waren, duo = beiden", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.match.recordBeat(m.matchId, b, 40);
  await L.runs.reportDeath(m.runOf(a), a, 12);
  assert.equal((await matchRow(m.matchId)).status, "RUNNING", "A wacht nog op een Genees-keuze: de run loopt door");
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 12);

  const match = await matchRow(m.matchId);
  assert.equal(match.status, "ENDED");
  assert.equal(match.endReason, "LAST_STANDING");
  const ra = await runRow(m.runOf(a));
  const rb = await runRow(m.runOf(b));
  assert.deepEqual([ra.status, ra.eliminatedSeq, ra.score], ["FINISHED", 1, 12]);
  assert.deepEqual([rb.status, rb.eliminatedSeq, rb.score], ["FINISHED", null, 40], "geen bonuspunten voor de overlevende");
  const duo = await L.db.quickMissionaryDuoResult.findUniqueOrThrow({ where: { matchId: m.matchId } });
  assert.deepEqual(new Set([duo.userAId, duo.userBId]), new Set([a, b]));
  assert.deepEqual(new Set([duo.scoreA, duo.scoreB]), new Set([12, 40]));
  assert.equal(duo.participantCount, 2);
});

test("drie spelers: het duo is de laatste twee; wie als eerste afviel zit er niet in", { skip }, async () => {
  const m = await startedMatch(3);
  const [a, b, c] = m.userIds;
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  assert.equal((await matchRow(m.matchId)).status, "RUNNING");
  await L.match.recordBeat(m.matchId, c, 30);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  assert.equal((await matchRow(m.matchId)).status, "ENDED");
  const duo = await L.db.quickMissionaryDuoResult.findUniqueOrThrow({ where: { matchId: m.matchId } });
  assert.deepEqual(new Set([duo.userAId, duo.userBId]), new Set([b, c]));
  assert.equal(duo.participantCount, 3);
  assert.equal((await runRow(m.runOf(a))).eliminatedSeq, 1);
  assert.equal((await runRow(m.runOf(b))).eliminatedSeq, 2);
  assert.equal((await runRow(m.runOf(c))).eliminatedSeq, null);
});

test("niemand vliegt meer: de laatste die nog op een Genees wacht kan niet meer terugkomen (geen resurrectie)", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await L.runs.reportDeath(m.runOf(b), b, 0);
  assert.equal((await matchRow(m.matchId)).status, "RUNNING", "beide wachten op Genees: nog geen einde");
  // A heeft zijn vraag al, B nog niet.
  await L.runs.requestReviveQuestion(m.runOf(a), a);
  const wrong = await reviveAndAnswer(a, m.runOf(a), false);
  assert.equal(wrong.correct, false);

  const match = await matchRow(m.matchId);
  assert.equal(match.status, "ENDED");
  assert.equal(match.endReason, "NOBODY_FLYING");
  const rb = await runRow(m.runOf(b));
  assert.deepEqual([rb.status, rb.eliminatedSeq, rb.eliminatedHow], ["FINISHED", 2, "RUN_ENDED"]);

  // Alles wat B nog zou kunnen proberen faalt: de run is afgesloten.
  await assert.rejects(() => L.runs.requestReviveQuestion(m.runOf(b), b), /INVALID_STATE/);
  await assert.rejects(() => L.runs.answerReviveQuestion(m.runOf(b), b, "x", "y"), /INVALID_STATE/);
  await L.runs.resumeAfterRevive(m.runOf(b), b);
  assert.equal((await runRow(m.runOf(b))).status, "FINISHED");
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
});

test("race: een correct Genees-antwoord en de val van de laatste tegenstander mogen nooit resurrecten na afsluiting", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await L.runs.reportDeath(m.runOf(b), b, 0);
  await L.runs.requestReviveQuestion(m.runOf(a), a);
  await L.runs.requestReviveQuestion(m.runOf(b), b);
  // A antwoordt fout en B antwoordt goed, tegelijk. Wat er ook eerst binnenkomt:
  // er is hooguit één winnaar en nooit een run die na het einde nog doorloopt.
  const results = await Promise.allSettled([reviveAndAnswer(a, m.runOf(a), false), reviveAndAnswer(b, m.runOf(b), true)]);
  assert.ok(results.length === 2);
  const match = await matchRow(m.matchId);
  assert.equal(match.status, "ENDED");
  const runs = await L.db.quickMissionaryRun.findMany({ where: { matchId: m.matchId } });
  assert.ok(runs.every((run) => run.status === "FINISHED"), "na afsluiting is niemand nog bezig");
  assert.equal(runs.filter((run) => run.eliminatedSeq === null).length <= 1, true);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
});

test("een verdiend Genees-antwoord (klaar om door te gaan) telt: de laatste tegenstander valt, jij wint", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await L.runs.reportDeath(m.runOf(b), b, 0);
  const right = await reviveAndAnswer(a, m.runOf(a), true);
  assert.equal(right.correct, true);
  assert.equal((await runRow(m.runOf(a))).status, "REVIVE_READY");
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  const match = await matchRow(m.matchId);
  assert.equal(match.status, "ENDED");
  assert.equal(match.endReason, "LAST_STANDING");
  assert.equal((await runRow(m.runOf(a))).eliminatedSeq, null);
});

test("hervatten na een goed antwoord in een lopende wedstrijd", { skip }, async () => {
  const m = await startedMatch(3);
  const [a] = m.userIds;
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await reviveAndAnswer(a, m.runOf(a), true);
  await L.runs.resumeAfterRevive(m.runOf(a), a);
  assert.equal((await runRow(m.runOf(a))).status, "IN_PROGRESS");
  assert.equal((await matchRow(m.matchId)).status, "RUNNING");
});

// --- Samenloop ------------------------------------------------------------------------

test("samenloop: zes spelers vallen tegelijk af, precies één duo, unieke volgnummers, één overlevende", { skip }, async () => {
  const m = await startedMatch(6);
  await Promise.all(m.userIds.map((userId) => L.runs.finishQuickMissionaryRun(m.runOf(userId), userId, 0).catch(() => {})));
  const match = await matchRow(m.matchId);
  assert.equal(match.status, "ENDED");
  const runs = await L.db.quickMissionaryRun.findMany({ where: { matchId: m.matchId } });
  const seqs = runs.flatMap((run) => (run.eliminatedSeq === null ? [] : [run.eliminatedSeq])).sort((x, y) => x - y);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  assert.equal(runs.filter((run) => run.eliminatedSeq === null).length, 1);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
});

test("afsluiten is idempotent: nogmaals afsluiten maakt geen tweede duo en verandert niets", { skip }, async () => {
  const m = await startedMatch(2);
  const [a] = m.userIds;
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  const before = await matchRow(m.matchId);
  await L.db.$transaction(async (tx) => {
    await L.match.lockMatch(tx, m.matchId);
    await L.match.settleMatch(tx, m.matchId, new Date());
    await L.match.settleMatch(tx, m.matchId, new Date());
  });
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  const after = await matchRow(m.matchId);
  assert.equal(after.endedAt?.getTime(), before.endedAt?.getTime());
  assert.equal(after.eliminationCount, before.eliminationCount);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
});

// --- Hartslag, herverbinding en wegvallen --------------------------------------------------

test("hartslag: score alleen omhoog en alleen als hij op de gezamenlijke tijdlijn past", { skip }, async () => {
  const m = await startedMatch(2);
  const [a] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 30);
  assert.equal((await runRow(m.runOf(a))).score, 30);
  await L.match.recordBeat(m.matchId, a, 20);
  assert.equal((await runRow(m.runOf(a))).score, 30, "geen daling");
  await L.match.recordBeat(m.matchId, a, 9000);
  assert.equal((await runRow(m.runOf(a))).score, 30, "onmogelijk snel wordt genegeerd");
});

test("wegvallen: wie te lang stil is valt af, wie terugkomt binnen de wachttijd niet (herverbinding reset niets)", { skip }, async () => {
  const m = await startedMatch(3);
  const [a, b, c] = m.userIds;
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await reviveAndAnswer(a, m.runOf(a), true); // A: Genees verdiend, nog niet hervat
  await L.match.recordBeat(m.matchId, c, 25);
  assert.equal(await L.match.sweepStalePlayers(m.matchId), null, "iedereen is vers");

  // B verdwijnt langer dan de wachttijd, A (REVIVE_READY) en C blijven.
  await L.db.quickMissionaryRun.update({ where: { id: m.runOf(b) }, data: { lastSeenAt: new Date(Date.now() - L.match.ACTIVE_GRACE_MS - 1000) } });
  const result = await L.match.sweepStalePlayers(m.matchId);
  assert.ok(result);
  assert.equal(result.ended, false);
  const rb = await runRow(m.runOf(b));
  assert.deepEqual([rb.status, rb.eliminatedHow], ["FINISHED", "DISCONNECT"]);

  // C komt precies binnen de wachttijd terug: geen eliminatie, score en Genees blijven.
  await L.db.quickMissionaryRun.update({ where: { id: m.runOf(c) }, data: { lastSeenAt: new Date(Date.now() - L.match.ACTIVE_GRACE_MS + 5000) } });
  assert.equal(await L.match.sweepStalePlayers(m.matchId), null);
  const rc = await runRow(m.runOf(c));
  assert.deepEqual([rc.status, rc.score], ["IN_PROGRESS", 25]);
  const ra = await runRow(m.runOf(a));
  assert.deepEqual([ra.status, ra.reviveUsed], ["REVIVE_READY", true], "de gratis Genees blijft verbruikt, de status blijft");
});

test("wegvallen: de laatste tegenstander verdwijnt, de overgebleven speler wint", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.db.quickMissionaryRun.update({ where: { id: m.runOf(b) }, data: { lastSeenAt: new Date(Date.now() - L.match.ACTIVE_GRACE_MS - 1000) } });
  const result = await L.match.sweepStalePlayers(m.matchId);
  assert.equal(result?.ended, true);
  assert.equal((await runRow(m.runOf(a))).eliminatedSeq, null);
  assert.equal((await matchRow(m.matchId)).endReason, "LAST_STANDING");
});

// --- Genees-economie in een wedstrijd ----------------------------------------------------

test("economie: gratis Genees is per run, voorraad daarna, noodkoop één keer, zelfde prijs als solo", { skip }, async () => {
  const m = await startedMatch(3, { xp: 1000 });
  const [a] = m.userIds;
  const runId = m.runOf(a);

  // 1. gratis Genees (per run, ook in een wedstrijd)
  await L.runs.reportDeath(runId, a, 0);
  await reviveAndAnswer(a, runId, true);
  await L.runs.resumeAfterRevive(runId, a);
  let r = await runRow(runId);
  assert.deepEqual([r.reviveUsed, r.stockRevivesUsed], [true, 0]);

  // 2. geen voorraad: noodkoop voor de volle prijs (100 bij voorraad 0), één keer
  await L.runs.reportDeath(runId, a, 0);
  const bought = await L.runs.buyGeneesInRun(runId, a);
  assert.ok(bought.result.ok);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: a } })).xpTotal, 900);
  await reviveAndAnswer(a, runId, false);
  r = await runRow(runId);
  assert.equal(r.status, "FINISHED", "een fout antwoord kost de poging en elimineert");
  assert.equal(r.eliminatedHow, "GENEES_WRONG");
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: a } })).geneesBalance, 0, "de gekochte Genees is verbruikt, ook bij een fout antwoord");
  assert.equal((await matchRow(m.matchId)).status, "RUNNING", "twee anderen vliegen nog");
});

// --- Solo-ranking ----------------------------------------------------------------------

test("de bestaande solo-ranking telt gezamenlijke runs niet mee", { skip }, async () => {
  const m = await startedMatch(2);
  const [a, b] = m.userIds;
  await L.match.recordBeat(m.matchId, b, 60);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 5);
  assert.equal((await runRow(m.runOf(b))).score, 60);
  const board = await L.runs.getQuickMissionaryLeaderboard(a, "all-time");
  assert.equal(board.some((entry) => entry.userId === a || entry.userId === b), false);
  const view = await L.runs.getQuickMissionaryRunView(m.runOf(b), b);
  assert.equal(view.allTimeBest, 0);
});

test("weergave: de stand is voor alle deelnemers gelijk en bevat alleen wat nodig is", { skip }, async () => {
  const m = await startedMatch(3);
  const view = await L.match.getMatchView(m.matchId);
  assert.ok(view);
  assert.equal(view.participants.length, 3);
  assert.ok(view.participants.every((p) => p.state === "ACTIVE" && p.score === 0));
  assert.equal(view.duo, null);
  assert.equal(JSON.stringify(view).includes("@test.invalid"), false, "geen e-mailadressen in de stand");
});

test("herverbinden: gratis Genees, noodkoopvlag, voorraad en score blijven zoals ze waren", { skip }, async () => {
  const m = await startedMatch(3, { xp: 1000 });
  const [a] = m.userIds;
  const runId = m.runOf(a);
  await L.match.recordBeat(m.matchId, a, 20);
  await L.runs.reportDeath(runId, a, 25);
  await reviveAndAnswer(a, runId, true);
  await L.runs.resumeAfterRevive(runId, a);
  await L.runs.reportDeath(runId, a, 30);
  const bought = await L.runs.buyGeneesInRun(runId, a);
  assert.ok(bought.result.ok);

  // "Herverbinden" = alles opnieuw opvragen: geen enkele teller mag teruggezet zijn.
  const view = await L.runs.getQuickMissionaryRunView(runId, a);
  assert.deepEqual([view.reviveUsed, view.inGamePurchaseUsed, view.geneesBalance, view.score], [true, true, 1, 30]);
  const match = await L.match.getMatchView(m.matchId);
  assert.equal(match?.participants.find((p) => p.userId === a)?.score, 30);
  // Een tweede noodkoop (ook van een tweede toestel) wordt geweigerd en kost niets extra.
  const again = await L.runs.buyGeneesInRun(runId, a);
  assert.equal(again.result.ok, false);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: a } })).xpTotal, 900);
});

test("twee toestellen: tegelijk dezelfde Genees-vraag aanvragen verbruikt precies één poging", { skip }, async () => {
  const m = await startedMatch(3, { stock: 3 });
  const [a] = m.userIds;
  const runId = m.runOf(a);
  await L.runs.reportDeath(runId, a, 0);
  await reviveAndAnswer(a, runId, true); // de gratis Genees
  await L.runs.resumeAfterRevive(runId, a);
  await L.runs.reportDeath(runId, a, 0);
  await Promise.allSettled([L.runs.requestReviveQuestion(runId, a), L.runs.requestReviveQuestion(runId, a)]);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: a } })).geneesBalance, 2);
});

// --- Duo-ranking: Duo-score = max(scoreA, scoreB) van de laatste twee ------------------------

/** Genoeg tijdlijn voor scores tot ruim 500 (ongeveer 750 s). */
const LONG = 1_500;
const duoRow = (matchId: string) => L.db.quickMissionaryDuoResult.findUniqueOrThrow({ where: { matchId } });
async function duoEntry(viewer: string, a: string, b: string) {
  const entries = await L.duo.getQuickMissionaryDuoLeaderboard(viewer);
  return entries.find((entry) => entry.key === L.duoRules.duoKey(a, b));
}

test("duo A: twee spelers, hoogste telt (150), niet de som (250) — ongeacht wie afvalt", { skip }, async () => {
  for (const loser of [0, 1]) {
    const m = await startedMatch(2, { ageSeconds: LONG });
    const [a, b] = m.userIds;
    await L.match.recordBeat(m.matchId, a, 100);
    await L.match.recordBeat(m.matchId, b, 150);
    await L.runs.finishQuickMissionaryRun(m.runOf(m.userIds[loser]), m.userIds[loser], [100, 150][loser]);
    assert.equal((await matchRow(m.matchId)).status, "ENDED");
    const row = await duoRow(m.matchId);
    assert.equal(L.duoRules.duoScore(row.scoreA, row.scoreB), 150);
    const entry = await duoEntry(a, a, b);
    assert.equal(entry?.score, 150, "niet 250");
    assert.deepEqual(new Set(entry?.players.map((p) => p.userId)), new Set([a, b]));
  }
});

test("duo B: laatste twee uit vijf spelers, score 490 (de hoogste van 487 en 490)", { skip }, async () => {
  for (const loser of ["D", "E"]) {
    const m = await startedMatch(5, { ageSeconds: LONG });
    const [a, b, c, d, e] = m.userIds;
    for (const id of [a, b, c]) await L.runs.finishQuickMissionaryRun(m.runOf(id), id, 0);
    await L.match.recordBeat(m.matchId, d, 487);
    await L.match.recordBeat(m.matchId, e, 490);
    assert.equal((await matchRow(m.matchId)).status, "RUNNING");
    const fallen = loser === "D" ? d : e;
    await L.runs.finishQuickMissionaryRun(m.runOf(fallen), fallen, loser === "D" ? 487 : 490);
    const row = await duoRow(m.matchId);
    assert.deepEqual(new Set([row.userAId, row.userBId]), new Set([d, e]), "A, B en C zitten er niet in");
    assert.equal((await duoEntry(d, d, e))?.score, 490);
    assert.equal(await duoEntry(a, a, b), undefined);
  }
});

test("duo C: geen doorspelen — na het uiteenvallen kan de laatste speler de score niet meer verhogen", { skip }, async () => {
  const m = await startedMatch(2, { ageSeconds: LONG });
  const [a, b] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 200);
  await L.match.recordBeat(m.matchId, b, 180);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 180);
  const frozen = await duoRow(m.matchId);
  assert.equal((await runRow(m.runOf(a))).status, "FINISHED", "de overlevende is direct gefinaliseerd");

  // Late score-events, late dood, late afsluiting en late hartslag veranderen niets.
  await L.match.recordBeat(m.matchId, a, 400);
  await L.runs.reportDeath(m.runOf(a), a, 400);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 400);
  await assert.rejects(() => L.runs.requestReviveQuestion(m.runOf(a), a), /INVALID_STATE/);
  assert.equal((await runRow(m.runOf(a))).score, 200);
  const after = await duoRow(m.matchId);
  assert.deepEqual([after.scoreA + after.scoreB, after.id], [frozen.scoreA + frozen.scoreB, frozen.id]);
  assert.equal((await duoEntry(a, a, b))?.score, 200);
});

test("duo D: A+B en B+A zijn hetzelfde duo; A+B en A+C verschillen", { skip }, async () => {
  const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  assert.equal(L.duoRules.duoKey(a, b), L.duoRules.duoKey(b, a));
  assert.notEqual(L.duoRules.duoKey(a, b), L.duoRules.duoKey(a, c));
  // Ook in de database: de opgeslagen A/B is altijd gesorteerd, dus bij omgekeerde lobbyvolgorde ook.
  const m = await startedMatch(2, { players: [b, a], ageSeconds: LONG });
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  const row = await duoRow(m.matchId);
  assert.deepEqual([row.userAId, row.userBId], [a, b].sort());
});

test("duo E: het beste resultaat per duo telt (300, 450, 400 geeft 450); een slechtere run verlaagt niets", { skip }, async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const scores = [300, 450, 400];
  for (const [index, score] of scores.entries()) {
    // Afwisselend A of B als host, en een andere van de twee valt af.
    const players = index % 2 === 0 ? [a, b] : [b, a];
    const m = await startedMatch(2, { players, ageSeconds: LONG });
    await L.match.recordBeat(m.matchId, a, score);
    await L.match.recordBeat(m.matchId, b, score - 50);
    await L.runs.finishQuickMissionaryRun(m.runOf(index % 2 === 0 ? b : a), index % 2 === 0 ? b : a, index % 2 === 0 ? score - 50 : score);
    assert.equal((await matchRow(m.matchId)).status, "ENDED");
  }
  const entries = (await L.duo.getQuickMissionaryDuoLeaderboard(a)).filter((entry) => entry.key === L.duoRules.duoKey(a, b));
  assert.equal(entries.length, 1, "één entry per duo");
  assert.equal(entries[0].score, 450);
  // De ruwe resultaten blijven allemaal bewaard.
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { OR: [{ userAId: a, userBId: b }, { userAId: b, userBId: a }] } }), 3);
});

test("duo F: dezelfde gebruiker met verschillende partners staat er meerdere keren in", { skip }, async () => {
  const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  for (const [partner, score] of [[b, 500], [c, 600]] as const) {
    const m = await startedMatch(2, { players: [a, partner], ageSeconds: LONG });
    await L.match.recordBeat(m.matchId, a, score);
    await L.runs.finishQuickMissionaryRun(m.runOf(partner), partner, 0);
  }
  const board = await L.duo.getQuickMissionaryDuoLeaderboard(a);
  const mine = board.filter((entry) => entry.mine);
  assert.equal(mine.find((entry) => entry.key === L.duoRules.duoKey(a, b))?.score, 500);
  assert.equal(mine.find((entry) => entry.key === L.duoRules.duoKey(a, c))?.score, 600);
  assert.ok(board.findIndex((e) => e.key === L.duoRules.duoKey(a, c)) < board.findIndex((e) => e.key === L.duoRules.duoKey(a, b)), "hoogste score eerst");
});

test("duo G: Genees houdt het duo in leven; pas bij definitief afvallen telt de volgorde", { skip }, async () => {
  const m = await startedMatch(3, { ageSeconds: LONG });
  const [a, b, c] = m.userIds;
  await L.runs.finishQuickMissionaryRun(m.runOf(c), c, 0); // C valt eerst af: A en B zijn de laatste twee
  await L.match.recordBeat(m.matchId, a, 120);
  await L.match.recordBeat(m.matchId, b, 90);
  await L.runs.reportDeath(m.runOf(a), a, 125);
  await reviveAndAnswer(a, m.runOf(a), true);
  await L.runs.resumeAfterRevive(m.runOf(a), a);
  assert.equal((await matchRow(m.matchId)).status, "RUNNING", "duo nog niet beëindigd");
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 0);

  await L.match.recordBeat(m.matchId, a, 140);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 90);
  const row = await duoRow(m.matchId);
  assert.deepEqual(new Set([row.userAId, row.userBId]), new Set([a, b]));
  assert.equal((await duoEntry(a, a, b))?.score, 140, "scores zoals ze bij de finalisatie waren");
});

test("duo H: geen resurrectie — een late correcte Genees-reactie verandert het afgesloten duo niet", { skip }, async () => {
  const m = await startedMatch(2, { ageSeconds: LONG });
  const [a, b] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 210);
  await L.runs.reportDeath(m.runOf(a), a, 210);
  await L.runs.reportDeath(m.runOf(b), b, 0);
  const asked = await L.runs.requestReviveQuestion(m.runOf(b), b); // B heeft al een vraag
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 210); // A valt af: B wacht alleen nog op een Genees
  assert.equal((await matchRow(m.matchId)).status, "ENDED");
  const before = await duoRow(m.matchId);

  const question = await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: asked.reviveQuestion!.exerciseId }, select: { options: true } });
  const correct = question.options.find((o) => o.isCorrect)!;
  await assert.rejects(() => L.runs.answerReviveQuestion(m.runOf(b), b, asked.reviveQuestion!.exerciseId, correct.id), /INVALID_STATE/);
  await L.runs.resumeAfterRevive(m.runOf(b), b);
  assert.equal((await runRow(m.runOf(b))).status, "FINISHED");
  const after = await duoRow(m.matchId);
  assert.deepEqual([after.id, after.scoreA, after.scoreB], [before.id, before.scoreA, before.scoreB]);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
});

test("duo I: bijna gelijktijdige eliminaties en dubbele finalisatie geven precies één duo-resultaat", { skip }, async () => {
  const m = await startedMatch(2, { ageSeconds: LONG });
  const [a, b] = m.userIds;
  await Promise.all([
    L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0).catch(() => {}),
    L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0).catch(() => {}),
    L.db.$transaction(async (tx) => { await L.match.lockMatch(tx, m.matchId); await L.match.settleMatch(tx, m.matchId, new Date()); }).catch(() => {}),
    L.match.sweepStalePlayers(m.matchId).catch(() => {}),
  ]);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 1);
  const board = await L.duo.getQuickMissionaryDuoLeaderboard(a);
  assert.equal(board.filter((entry) => entry.key === L.duoRules.duoKey(a, b)).length, 1);
});

test("duo J: de solo-ranking blijft ongewijzigd; Duo-scores verschijnen daar niet", { skip }, async () => {
  const m = await startedMatch(2, { ageSeconds: LONG });
  const [a, b] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 480);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  const solo = await L.runs.startQuickMissionaryRun(a);
  await L.runs.finishQuickMissionaryRun(solo.runId, a, 1);
  const board = await L.runs.getQuickMissionaryLeaderboard(a, "all-time");
  const mine = board.find((entry) => entry.userId === a);
  assert.equal(mine?.score, 1, "alleen de echte solo-run telt, niet de 480 uit de gezamenlijke run");
  assert.equal(board.some((entry) => entry.userId === b), false);
  assert.equal((await L.runs.getQuickMissionaryRunView(solo.runId, a)).allTimeBest, 1);
});

test("duo G/H: resultaten van verschillende dagen tellen samen (550 ongeacht dag) en tijdzones van A en B hebben geen invloed", { skip }, async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await L.db.user.update({ where: { id: a }, data: { timeZone: "Pacific/Auckland" } });
  await L.db.user.update({ where: { id: b }, data: { timeZone: "America/Mexico_City" } });
  const matchIds: string[] = [];
  for (const score of [400, 550, 500]) {
    const m = await startedMatch(2, { players: [a, b], ageSeconds: LONG });
    await L.match.recordBeat(m.matchId, a, score);
    await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
    matchIds.push(m.matchId);
  }
  // Drie verschillende dagen, ook ver uit elkaar.
  for (const [index, matchId] of matchIds.entries()) {
    await L.db.quickMissionaryDuoResult.update({ where: { matchId }, data: { finishedAt: new Date(Date.UTC(2026, 0, 1 + index * 40, 23, 30)) } });
  }
  const before = await duoEntry(a, a, b);
  assert.equal(before?.score, 550);
  // Andere tijdzones veranderen niets aan de uitkomst.
  await L.db.user.update({ where: { id: a }, data: { timeZone: "Asia/Tokyo" } });
  await L.db.user.update({ where: { id: b }, data: { timeZone: "Pacific/Honolulu" } });
  const after = await duoEntry(b, a, b);
  assert.deepEqual([after?.score, after?.rank], [before?.score, before?.rank]);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { OR: [{ userAId: a, userBId: b }, { userAId: b, userBId: a }] } }), 3, "alle ruwe resultaten blijven bewaard");
});

// --- Samen-scores zijn nooit solo-scores -------------------------------------------------------

import { viewModeFor } from "../src/lib/snelleZendeling/ghostState";

/** Een echte solo-run met een plausibele score: de run begon al lang geleden. */
async function soloRun(userId: string, score: number): Promise<string> {
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.db.quickMissionaryRun.update({ where: { id: runId }, data: { startedAt: new Date(Date.now() - 2_500_000) } });
  await L.runs.finishQuickMissionaryRun(runId, userId, score);
  return runId;
}
const soloBoard = async (viewer: string, board: "today" | "all-time") => (await L.runs.getQuickMissionaryLeaderboard(viewer, board)).find((entry) => entry.userId === viewer)?.score;

test("solo A-C: een solo-run van 100 telt; een Samen-run van 500 of 600 verandert Vandaag en All-time niet", { skip }, async () => {
  const a = await makeUser();
  const b = await makeUser();
  await soloRun(a, 100);
  assert.equal(await soloBoard(a, "all-time"), 100);
  assert.equal(await soloBoard(a, "today"), 100);

  for (const score of [500, 600]) {
    const m = await startedMatch(2, { players: [a, b], ageSeconds: 2_500 });
    await L.match.recordBeat(m.matchId, a, score);
    await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  }
  assert.equal(await soloBoard(a, "all-time"), 100, "All-time blijft de solo-run");
  assert.equal(await soloBoard(a, "today"), 100, "Vandaag blijft de solo-run");
  const view = await L.runs.getQuickMissionaryRunView(await soloRun(a, 90), a);
  assert.deepEqual([view.dailyBest, view.allTimeBest], [100, 100], "ook de persoonlijke records negeren Samen");
});

test("solo D-G: de overlevende (900), Genees-gebruikers (1000), een Duo-resultaat en late of dubbele finalisatie schrijven nooit een solo-score", { skip }, async () => {
  const m = await startedMatch(3, { ageSeconds: 2_500, xp: 1_000 });
  const [a, b, c] = m.userIds;
  await L.match.recordBeat(m.matchId, c, 900);
  // A gebruikt een gratis Genees en haalt 1000; hij blijft onderdeel van de run.
  await L.match.recordBeat(m.matchId, a, 1_000);
  await L.runs.reportDeath(m.runOf(a), a, 1_000);
  await reviveAndAnswer(a, m.runOf(a), true);
  await L.runs.resumeAfterRevive(m.runOf(a), a);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 1_000);
  assert.equal((await matchRow(m.matchId)).status, "ENDED");
  assert.equal((await runRow(m.runOf(c))).eliminatedSeq, null, "C is de overlevende met 900");

  // Late en dubbele gebeurtenissen.
  await L.runs.finishQuickMissionaryRun(m.runOf(c), c, 900);
  await L.runs.reportDeath(m.runOf(c), c, 900);
  await L.match.recordBeat(m.matchId, c, 950);
  await Promise.all([L.runs.finishQuickMissionaryRun(m.runOf(a), a, 1_000), L.match.sweepStalePlayers(m.matchId)]);

  for (const user of [a, b, c]) {
    assert.equal(await soloBoard(user, "all-time"), undefined, "geen solo-record");
    assert.equal(await soloBoard(user, "today"), undefined);
    const view = await L.runs.getQuickMissionaryRunView(m.runOf(user), user);
    assert.deepEqual([view.dailyBest, view.allTimeBest], [0, 0]);
  }
  // Het Duo-resultaat is er wel (laatste twee: A en C).
  const duo = await duoRow(m.matchId);
  assert.deepEqual(new Set([duo.userAId, duo.userBId]), new Set([a, c]));
  assert.equal(L.duoRules.duoScore(duo.scoreA, duo.scoreB), 1_000);
  assert.equal(await L.db.quickMissionaryRun.count({ where: { userId: { in: [a, b, c] }, matchId: null } }), 0, "geen enkele run van deze spelers is een solo-run");
});

// --- Spectator: definitief uitgeschakeld, de run loopt door -------------------------------------

const stateOf = async (matchId: string, userId: string) => (await L.match.getMatchView(matchId))!.participants.find((p) => p.userId === userId)!.state;

test("spectator 1-3: definitief afvallen (zonder Genees, bewust niet, fout antwoord) laat de run doorlopen en maakt de speler spectator", { skip }, async () => {
  const m = await startedMatch(4, { ageSeconds: LONG });
  const [a, b, c, d] = m.userIds;
  // 1/2: A kiest geen Genees (botst en rondt af).
  await L.runs.reportDeath(m.runOf(a), a, 0);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  // 3: B beantwoordt Genees fout.
  await L.runs.reportDeath(m.runOf(b), b, 0);
  await reviveAndAnswer(b, m.runOf(b), false);

  const view = (await L.match.getMatchView(m.matchId))!;
  assert.equal(view.status, "RUNNING", "C en D vliegen verder");
  const byUser = new Map(view.participants.map((p) => [p.userId, p.state]));
  assert.deepEqual([a, b, c, d].map((id) => byUser.get(id)), ["ELIMINATED", "ELIMINATED", "ACTIVE", "ACTIVE"]);
  for (const eliminated of [a, b]) assert.equal(viewModeFor(await stateOf(m.matchId, eliminated), view.status), "spectate");
  for (const flying of [c, d]) assert.equal(viewModeFor(await stateOf(m.matchId, flying), view.status), "play");
  // Spectators tellen niet als actieve speler.
  assert.equal(view.participants.filter((p) => p.state === "ACTIVE" || p.state === "REVIVE_PENDING").length, 2);
});

test("spectator 4/10: een spectator kan niet scoren, botsen, Genezen, Genees kopen, zichzelf activeren of de run stoppen", { skip }, async () => {
  const m = await startedMatch(4, { ageSeconds: LONG, xp: 1_000, stock: 2 });
  const [a, b, c, d] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 40);
  await L.runs.reportDeath(m.runOf(a), a, 40);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 40);
  const before = await runRow(m.runOf(a));
  const stock = (await L.db.user.findUniqueOrThrow({ where: { id: a } })).geneesBalance;
  const xp = (await L.db.user.findUniqueOrThrow({ where: { id: a } })).xpTotal;

  await L.match.recordBeat(m.matchId, a, 500);
  await L.runs.reportDeath(m.runOf(a), a, 500);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 500);
  await L.runs.resumeAfterRevive(m.runOf(a), a);
  await assert.rejects(() => L.runs.requestReviveQuestion(m.runOf(a), a), /INVALID_STATE/);
  const bought = await L.runs.buyGeneesInRun(m.runOf(a), a);
  assert.equal(bought.result.ok, false);
  await assert.rejects(() => L.runs.answerReviveQuestion(m.runOf(a), a, "x", "y"), /INVALID_STATE/);

  const after = await runRow(m.runOf(a));
  assert.deepEqual([after.status, after.score, after.eliminatedSeq, after.eliminatedHow], [before.status, 40, before.eliminatedSeq, before.eliminatedHow]);
  const account = await L.db.user.findUniqueOrThrow({ where: { id: a } });
  assert.deepEqual([account.geneesBalance, account.xpTotal], [stock, xp], "geen Genees verbruikt of gekocht, geen XP uitgegeven");
  assert.equal((await matchRow(m.matchId)).status, "RUNNING");
  assert.equal(await stateOf(m.matchId, a), "ELIMINATED");
  assert.deepEqual([await stateOf(m.matchId, b), await stateOf(m.matchId, c), await stateOf(m.matchId, d)], ["ACTIVE", "ACTIVE", "ACTIVE"]);
});

test("spectator 5/6/9: herverbinden, verversen en vertrekken veranderen niets; ELIMINATED + lopende run = meekijken, daarna de uitslag", { skip }, async () => {
  const m = await startedMatch(4, { ageSeconds: LONG });
  const [a, b, c, d] = m.userIds;
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  const first = await runRow(m.runOf(a));
  // Herladen/herverbinden: alles opnieuw opvragen geeft dezelfde stand, nooit ACTIVE of een nieuwe run.
  for (let i = 0; i < 3; i++) {
    const view = (await L.match.getMatchView(m.matchId))!;
    assert.equal(viewModeFor(view.participants.find((p) => p.userId === a)!.state, view.status), "spectate");
  }
  // De spectator vertrekt en blijft stil: de hartslag-controle laat hem en de rest ongemoeid.
  await L.db.quickMissionaryRun.update({ where: { id: m.runOf(a) }, data: { lastSeenAt: new Date(Date.now() - 600_000) } });
  assert.equal(await L.match.sweepStalePlayers(m.matchId), null, "niemand valt extra af");
  const afterLeaving = await runRow(m.runOf(a));
  assert.deepEqual([afterLeaving.eliminatedSeq, afterLeaving.status, afterLeaving.score], [first.eliminatedSeq, "FINISHED", first.score]);
  assert.equal((await matchRow(m.matchId)).eliminationCount, 1);
  assert.equal(await L.db.quickMissionaryDuoResult.count({ where: { matchId: m.matchId } }), 0);

  // Zodra de run eindigt: de uitslag, ook voor wie al weg was.
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 0);
  await L.runs.finishQuickMissionaryRun(m.runOf(c), c, 0);
  const ended = (await L.match.getMatchView(m.matchId))!;
  assert.equal(ended.status, "ENDED");
  for (const user of [a, b, c, d]) assert.equal(viewModeFor(ended.participants.find((p) => p.userId === user)!.state, ended.status), "result");
});

test("spectator 7/12: A en B kijken mee, C en D zijn de laatste twee; valt C af dan stopt D direct en bepaalt alleen het eindduo het resultaat", { skip }, async () => {
  const m = await startedMatch(4, { ageSeconds: LONG });
  const [a, b, c, d] = m.userIds;
  await L.match.recordBeat(m.matchId, a, 30);
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 30);
  await L.match.recordBeat(m.matchId, b, 70);
  await L.runs.finishQuickMissionaryRun(m.runOf(b), b, 70);
  assert.equal((await matchRow(m.matchId)).status, "RUNNING");
  assert.deepEqual([await stateOf(m.matchId, c), await stateOf(m.matchId, d)], ["ACTIVE", "ACTIVE"]);

  await L.match.recordBeat(m.matchId, c, 120);
  await L.match.recordBeat(m.matchId, d, 140);
  await L.runs.finishQuickMissionaryRun(m.runOf(c), c, 120);
  assert.equal((await matchRow(m.matchId)).status, "ENDED");
  assert.equal((await runRow(m.runOf(d))).status, "FINISHED", "D vliegt niet verder");
  await L.match.recordBeat(m.matchId, d, 200);
  assert.equal((await runRow(m.runOf(d))).score, 140);

  const duo = await duoRow(m.matchId);
  assert.deepEqual(new Set([duo.userAId, duo.userBId]), new Set([c, d]), "eerdere spectators hebben geen invloed");
  assert.equal(L.duoRules.duoScore(duo.scoreA, duo.scoreB), 140);
  const view = (await L.match.getMatchView(m.matchId))!;
  for (const user of [a, b, c, d]) assert.equal(viewModeFor(view.participants.find((p) => p.userId === user)!.state, view.status), "result");
});

test("spectator 8: bij precies twee spelers eindigt de run direct, zonder spectatorfase", { skip }, async () => {
  const m = await startedMatch(2, { ageSeconds: LONG });
  const [a, b] = m.userIds;
  await L.runs.finishQuickMissionaryRun(m.runOf(a), a, 0);
  const view = (await L.match.getMatchView(m.matchId))!;
  assert.equal(view.status, "ENDED");
  for (const user of [a, b]) assert.equal(viewModeFor(view.participants.find((p) => p.userId === user)!.state, view.status), "result");
});
