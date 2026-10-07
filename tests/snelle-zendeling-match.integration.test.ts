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
    data: { email, passwordHash: "x", handle: "Duo", discriminator: String(10 + seq).slice(-2), activeContentCollectionId: collectionId, xpTotal: options.xp ?? 0, geneesBalance: options.stock ?? 0 },
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
async function startedMatch(n: number, options: { stock?: number; xp?: number } = {}) {
  const userIds: string[] = [];
  for (let i = 0; i < n; i++) userIds.push(await makeUser(options));
  const game = await L.db.liveGame.create({
    data: { code: `Q${stamp.slice(-4)}${seq}`.slice(0, 8), hostId: userIds[0], mode: "QUICK_MISSIONARY", status: "LOBBY", players: { create: userIds.map((userId) => ({ userId })) } },
  });
  const started = await L.match.startMatch(game.id, userIds[0]);
  assert.ok(started.ok, "wedstrijd hoort te starten");
  if (!started.ok) throw new Error("niet gestart");
  await L.db.quickMissionaryMatch.update({ where: { id: started.matchId }, data: { startsAt: new Date(Date.now() - 120_000) } });
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
