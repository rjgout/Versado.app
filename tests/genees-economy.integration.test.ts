// Integratietests voor de Genees-economie (voorraad, winkel, in-game noodkoop)
// tegen een echte database. Draait alleen met LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:genees-economy
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-geneeseconomie-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  runs: await import("../src/lib/snelleZendeling/runs"),
  inventory: await import("../src/lib/genees/inventory"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
const emails: string[] = [];
let seq = 0;
let collectionId = "";

async function makeUser(options: { xp?: number; stock?: number } = {}): Promise<string> {
  const email = `geneeseco-${stamp}-${++seq}@test.invalid`;
  emails.push(email);
  const user = await L.db.user.create({
    data: {
      email,
      passwordHash: "x",
      handle: "Eco",
      discriminator: String(10 + seq).slice(-2),
      activeContentCollectionId: collectionId,
      xpTotal: options.xp ?? 0,
      geneesBalance: options.stock ?? 0,
    },
  });
  return user.id;
}

const state = (userId: string) => L.db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, geneesBalance: true } });

before(async () => {
  if (skip) return;
  L = await load();
  collectionId = `geneeseco-${stamp}`;
  await L.db.contentCollection.create({ data: { id: collectionId, slug: collectionId, name: collectionId, icon: "book", work: collectionId, language: "nl", order: 901 } });
  const book = await L.db.book.create({ data: { slug: `${collectionId}-b`, name: "Boek", order: 0, contentCollectionId: collectionId } });
  const chapter = await L.db.chapter.create({ data: { bookId: book.id, number: 1, order: 0 } });
  for (let v = 1; v <= 12; v++) {
    await L.db.quickMissionaryReviveQuestion.create({
      data: {
        contentKey: `eco-${stamp}:${v}`,
        chapterId: chapter.id,
        variant: v,
        prompt: `Vraag ${v} voor de economietest van Genees?`,
        options: { create: [{ label: "Het goede antwoord", isCorrect: true, order: 0 }, { label: "Een foute keuze A", order: 1 }, { label: "Een foute keuze B", order: 2 }] },
      },
    });
  }
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.contentCollection.deleteMany({ where: { id: collectionId } });
  await L.db.$disconnect();
});

async function startAndDie(userId: string): Promise<string> {
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.runs.reportDeath(runId, userId, 0);
  return runId;
}

async function reviveAndAnswer(userId: string, runId: string, correct: boolean) {
  const view = await L.runs.requestReviveQuestion(runId, userId);
  assert.ok(view.reviveQuestion, "er hoort een vraag te zijn");
  const question = await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: view.reviveQuestion.exerciseId }, select: { options: true } });
  const option = question.options.find((o) => o.isCorrect === correct && view.reviveQuestion!.options.some((shown) => shown.id === o.id))!;
  return L.runs.answerReviveQuestion(runId, userId, view.reviveQuestion.exerciseId, option.id);
}

// --- Winkel ----------------------------------------------------------------------

test("winkel: aankoop kost de prijs, verhoogt de voorraad en logt een XP-transactie", { skip }, async () => {
  const userId = await makeUser({ xp: 500 });
  const result = await L.inventory.buyGeneesInShop(userId);
  assert.deepEqual({ ok: result.ok }, { ok: true });
  if (!result.ok) return;
  assert.equal(result.priceXp, 100);
  assert.equal(result.nextPriceXp, 125);
  assert.deepEqual(await state(userId), { xpTotal: 400, geneesBalance: 1 });
  const tx = await L.db.xPTransaction.findFirstOrThrow({ where: { userId, reason: "GENEES_PURCHASED" } });
  assert.equal(tx.amount, -100);
  assert.equal(await L.db.geneesPurchase.count({ where: { userId, source: "SHOP" } }), 1);
  // De divisiestand volgt de afschrijving net als bij hints en freezes.
  const weekly = await L.db.weeklyScore.findFirst({ where: { userId } });
  assert.equal(weekly?.xp, -100);
});

test("winkel: de prijs stijgt per Genees op voorraad: 100, 125, 150", { skip }, async () => {
  const userId = await makeUser({ xp: 1000 });
  const prices: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await L.inventory.buyGeneesInShop(userId);
    assert.ok(r.ok);
    if (r.ok) prices.push(r.priceXp);
  }
  assert.deepEqual(prices, [100, 125, 150]);
  assert.deepEqual(await state(userId), { xpTotal: 625, geneesBalance: 3 });
});

test("winkel: onvoldoende XP weigert, zonder negatieve XP of voorraad", { skip }, async () => {
  const userId = await makeUser({ xp: 99 });
  const result = await L.inventory.buyGeneesInShop(userId);
  assert.deepEqual(result, { ok: false, error: "INSUFFICIENT_XP", priceXp: 100 });
  assert.deepEqual(await state(userId), { xpTotal: 99, geneesBalance: 0 });
  assert.equal(await L.db.xPTransaction.count({ where: { userId, reason: "GENEES_PURCHASED" } }), 0);
  assert.equal(await L.db.geneesPurchase.count({ where: { userId } }), 0);
});

test("winkel: de prijs volgt de huidige voorraad, niet de koopgeschiedenis", { skip }, async () => {
  const userId = await makeUser({ xp: 1000, stock: 4 });
  const expensive = await L.inventory.buyGeneesInShop(userId);
  assert.ok(expensive.ok && expensive.priceXp === 200);
  // Voorraad 5 -> drie gebruikt -> voorraad 2: de prijs is weer 150.
  await L.db.user.update({ where: { id: userId }, data: { geneesBalance: 2 } });
  const cheaper = await L.inventory.buyGeneesInShop(userId);
  assert.ok(cheaper.ok && cheaper.priceXp === 150);
});

test("winkel: een herhaald verzoek met dezelfde sleutel schrijft maar één keer af", { skip }, async () => {
  const userId = await makeUser({ xp: 500 });
  const a = await L.inventory.buyGeneesInShop(userId, "sleutel-1");
  const b = await L.inventory.buyGeneesInShop(userId, "sleutel-1");
  assert.ok(a.ok && b.ok && b.duplicate && !a.duplicate);
  assert.deepEqual(await state(userId), { xpTotal: 400, geneesBalance: 1 });
});

test("winkel: gelijktijdige aankopen zijn veilig: nooit negatieve XP en een consistente prijsreeks", { skip }, async () => {
  const exact = await makeUser({ xp: 100 });
  const results = await Promise.all(Array.from({ length: 8 }, () => L.inventory.buyGeneesInShop(exact)));
  assert.equal(results.filter((r) => r.ok).length, 1, "precies één aankoop met 100 XP");
  assert.deepEqual(await state(exact), { xpTotal: 0, geneesBalance: 1 });

  const two = await makeUser({ xp: 225 });
  const second = await Promise.all([L.inventory.buyGeneesInShop(two), L.inventory.buyGeneesInShop(two), L.inventory.buyGeneesInShop(two)]);
  assert.equal(second.filter((r) => r.ok).length, 2, "100 + 125 = 225");
  assert.deepEqual(await state(two), { xpTotal: 0, geneesBalance: 2 });
  assert.deepEqual(
    second.flatMap((r) => (r.ok ? [r.priceXp] : [])).sort((x, y) => x - y),
    [100, 125]
  );
});

test("de database weigert een negatieve voorraad als laatste vangnet", { skip }, async () => {
  const userId = await makeUser();
  await assert.rejects(() => L.db.user.update({ where: { id: userId }, data: { geneesBalance: -1 } }));
});

// --- Gebruik in een run ------------------------------------------------------------

test("run: de gratis Genees verlaagt de voorraad niet en kan exact één keer per run", { skip }, async () => {
  const userId = await makeUser({ stock: 3 });
  const runId = await startAndDie(userId);
  assert.equal((await L.runs.getQuickMissionaryRunView(runId, userId)).deathOption, "free");
  const result = await reviveAndAnswer(userId, runId, true);
  assert.equal(result.view.status, "REVIVE_READY");
  assert.equal((await state(userId)).geneesBalance, 3, "gratis: voorraad ongewijzigd");
  const run = await L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(run.reviveUsed, true);
  assert.equal(run.stockRevivesUsed, 0);
});

test("run: na de gratis Genees verbruikt elke poging één Genees uit voorraad, ook bij een fout antwoord", { skip }, async () => {
  const userId = await makeUser({ stock: 2 });
  const runId = await startAndDie(userId);
  await reviveAndAnswer(userId, runId, true); // gratis
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  assert.equal((await L.runs.getQuickMissionaryRunView(runId, userId)).deathOption, "stock");
  const wrong = await reviveAndAnswer(userId, runId, false); // uit voorraad, fout
  assert.equal(wrong.correct, false);
  assert.equal(wrong.view.status, "FINISHED");
  assert.equal((await state(userId)).geneesBalance, 1, "de ingezette Genees is verbruikt, ook bij een fout antwoord");
});

test("run: meerdere vooraf gekochte Genezen kunnen in één run worden gebruikt, elk met een eigen vraag", { skip }, async () => {
  const userId = await makeUser({ stock: 3 });
  const runId = await startAndDie(userId);
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await L.runs.resumeAfterRevive(runId, userId);
      await L.runs.reportDeath(runId, userId, 0);
    }
    const view = await L.runs.requestReviveQuestion(runId, userId);
    seen.add(view.reviveQuestion!.exerciseId);
    const question = await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: view.reviveQuestion!.exerciseId }, select: { options: true } });
    const right = question.options.find((o) => o.isCorrect)!;
    const answered = await L.runs.answerReviveQuestion(runId, userId, view.reviveQuestion!.exerciseId, right.id);
    assert.equal(answered.correct, true);
  }
  assert.equal(seen.size, 4, "iedere Genees vereist een eigen, nieuwe vraag");
  assert.equal((await state(userId)).geneesBalance, 0, "1 gratis + 3 uit voorraad");
  const run = await L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(run.stockRevivesUsed, 3);
});

test("run: een Genees is geen automatisch extra leven, zonder vraag kom je niet verder", { skip }, async () => {
  const userId = await makeUser({ stock: 1 });
  const runId = await startAndDie(userId);
  await L.runs.requestReviveQuestion(runId, userId);
  // Hervatten kan alleen na een goed antwoord (REVIVE_READY).
  await L.runs.resumeAfterRevive(runId, userId);
  assert.equal((await L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } })).status, "DEAD_AWAITING_REVIVE");
});

test("run: dezelfde poging opnieuw opvragen (verversen, tweede toestel) verbruikt niets extra", { skip }, async () => {
  const userId = await makeUser({ stock: 1 });
  const runId = await startAndDie(userId);
  await reviveAndAnswer(userId, runId, true);
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  const results = await Promise.all([L.runs.requestReviveQuestion(runId, userId), L.runs.requestReviveQuestion(runId, userId), L.runs.requestReviveQuestion(runId, userId)]);
  assert.equal(new Set(results.map((r) => r.reviveQuestion!.exerciseId)).size, 1, "één vraag voor alle gelijktijdige aanvragen");
  assert.equal((await state(userId)).geneesBalance, 0, "precies één Genees verbruikt");
});

test("run: zonder voorraad en met gratis Genees al gebruikt geeft een nieuwe vraag NO_GENEES", { skip }, async () => {
  const userId = await makeUser();
  const runId = await startAndDie(userId);
  await reviveAndAnswer(userId, runId, true);
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  await assert.rejects(() => L.runs.requestReviveQuestion(runId, userId), /NO_GENEES/);
});

// --- In-game noodkoop ---------------------------------------------------------------

async function freeUsedAndDead(userId: string, stock = 0): Promise<string> {
  const runId = await startAndDie(userId);
  await reviveAndAnswer(userId, runId, true);
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  void stock;
  return runId;
}

test("noodkoop: eenmalig per run, voor de canonieke prijs, en daarna is de Genees te gebruiken", { skip }, async () => {
  const userId = await makeUser({ xp: 400 });
  const runId = await freeUsedAndDead(userId);
  const before = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(before.deathOption, "buy");
  assert.equal(before.geneesPriceXp, 100);
  assert.equal(before.canAffordGenees, true);

  const bought = await L.runs.buyGeneesInRun(runId, userId);
  assert.ok(bought.result.ok);
  assert.deepEqual(await state(userId), { xpTotal: 300, geneesBalance: 1 });
  assert.equal(bought.view.inGamePurchaseUsed, true);
  assert.equal(await L.db.geneesPurchase.count({ where: { userId, source: "GAME", runId } }), 1);

  const answered = await reviveAndAnswer(userId, runId, true);
  assert.equal(answered.view.status, "REVIVE_READY");
  assert.equal((await state(userId)).geneesBalance, 0);

  // Voorraad weer leeg: geen tweede noodkoop in dezelfde run.
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  const again = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(again.deathOption, "none");
  const second = await L.runs.buyGeneesInRun(runId, userId);
  assert.deepEqual(second.result, { ok: false, error: "PURCHASE_LIMIT" });
  assert.deepEqual(await state(userId), { xpTotal: 300, geneesBalance: 0 });
});

test("noodkoop: een dubbele klik of twee apparaten kopen precies één Genees", { skip }, async () => {
  const userId = await makeUser({ xp: 1000 });
  const runId = await freeUsedAndDead(userId);
  const results = await Promise.all([L.runs.buyGeneesInRun(runId, userId), L.runs.buyGeneesInRun(runId, userId), L.runs.buyGeneesInRun(runId, userId)]);
  assert.equal(results.filter((r) => r.result.ok).length, 1);
  assert.deepEqual(await state(userId), { xpTotal: 900, geneesBalance: 1 });
});

test("noodkoop: onvoldoende XP weigert en verbruikt de eenmalige kans niet", { skip }, async () => {
  const userId = await makeUser({ xp: 50 });
  const runId = await freeUsedAndDead(userId);
  const refused = await L.runs.buyGeneesInRun(runId, userId);
  assert.deepEqual(refused.result, { ok: false, error: "INSUFFICIENT_XP", priceXp: 100 });
  assert.equal(refused.view.canAffordGenees, false);
  assert.equal(refused.view.inGamePurchaseUsed, false);
  assert.deepEqual(await state(userId), { xpTotal: 50, geneesBalance: 0 });
  await L.db.user.update({ where: { id: userId }, data: { xpTotal: 100 } });
  assert.ok((await L.runs.buyGeneesInRun(runId, userId)).result.ok, "met genoeg XP lukt het alsnog");
});

test("noodkoop: niet zolang de gratis Genees nog beschikbaar is, niet met voorraad, niet tijdens een vraag", { skip }, async () => {
  const userId = await makeUser({ xp: 1000 });
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.runs.reportDeath(runId, userId, 0);
  assert.deepEqual((await L.runs.buyGeneesInRun(runId, userId)).result, { ok: false, error: "INVALID_STATE" }, "gratis Genees eerst");

  const stocked = await makeUser({ xp: 1000, stock: 2 });
  const stockedRun = await freeUsedAndDead(stocked);
  assert.deepEqual((await L.runs.buyGeneesInRun(stockedRun, stocked)).result, { ok: false, error: "INVALID_STATE" }, "met voorraad gebruik je die");

  const flying = await L.runs.startQuickMissionaryRun(userId);
  assert.deepEqual((await L.runs.buyGeneesInRun(flying.runId, userId)).result, { ok: false, error: "INVALID_STATE" }, "een vliegende run kan niets kopen");
  assert.deepEqual(await state(userId), { xpTotal: 1000, geneesBalance: 0 });
});

test("noodkoop: een nieuwe run reset de gratis Genees en de noodkoop-kans, maar nooit de accountvoorraad", { skip }, async () => {
  const userId = await makeUser({ xp: 1000 });
  const first = await freeUsedAndDead(userId);
  assert.ok((await L.runs.buyGeneesInRun(first, userId)).result.ok);
  assert.equal((await state(userId)).geneesBalance, 1);
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  const fresh = await L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(fresh.reviveUsed, false, "gratis Genees is weer beschikbaar");
  assert.equal(fresh.inGamePurchaseUsed, false, "noodkoop weer beschikbaar");
  assert.equal((await state(userId)).geneesBalance, 1, "de accountvoorraad blijft staan");
});

test("run zonder vragen in de uitgave: geen Genees, ook geen noodkoop, en niets verbruikt", { skip }, async () => {
  const email = `geneeseco-leeg-${stamp}@test.invalid`;
  emails.push(email);
  const emptyId = `geneeseco-leeg-${stamp}`;
  await L.db.contentCollection.create({ data: { id: emptyId, slug: emptyId, name: emptyId, icon: "book", work: emptyId, language: "nl", order: 902 } });
  try {
    const user = await L.db.user.create({ data: { email, passwordHash: "x", handle: "Leeg", discriminator: "77", activeContentCollectionId: emptyId, xpTotal: 500, geneesBalance: 2 } });
    const { runId } = await L.runs.startQuickMissionaryRun(user.id);
    await L.runs.reportDeath(runId, user.id, 0);
    const view = await L.runs.getQuickMissionaryRunView(runId, user.id);
    assert.equal(view.deathOption, "none");
    await assert.rejects(() => L.runs.requestReviveQuestion(runId, user.id), /NO_QUESTION/);
    const run = await L.db.quickMissionaryRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.reviveUsed, false, "geen vraag, dus niets verbruikt");
    assert.deepEqual(await state(user.id), { xpTotal: 500, geneesBalance: 2 });
  } finally {
    await L.db.user.deleteMany({ where: { email } });
    await L.db.contentCollection.delete({ where: { id: emptyId } });
  }
});
