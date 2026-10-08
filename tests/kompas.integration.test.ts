// Integratietests voor de opslag van Versado Kompas (src/lib/kompas/store.ts,
// KompasProgress): status vastleggen en samenvoegen, versies, de kennismaking
// uit de onboarding, het gedrag van nieuwe accounts, en dat dit alles nooit XP,
// reeksen of voortgang raakt. Draait alleen met LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:kompas
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-kompastests-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  store: await import("../src/lib/kompas/store"),
  registry: await import("../src/lib/kompas/registry"),
});
let L: Awaited<ReturnType<typeof load>>;

const run = `${Date.now()}`;
const emails: string[] = [];
let seq = 0;

async function user(): Promise<string> {
  const email = `kompas-${run}-${++seq}@test.invalid`;
  emails.push(email);
  const u = await L.db.user.create({ data: { email, passwordHash: "x", handle: "Kompas", discriminator: String(10 + seq).slice(-2) } });
  return u.id;
}

before(async () => {
  if (skip) return;
  L = await load();
});
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.$disconnect();
});

test("een nieuw account staat open voor uitnodigingen en heeft nog geen status", { skip }, async () => {
  const id = await user();
  const u = await L.db.user.findUniqueOrThrow({ where: { id } });
  assert.equal(u.kompasOffersEnabled, true);
  assert.deepEqual(await L.store.getKompasRows(id), []);
});

test("bekijken wordt vastgelegd met de huidige versie van het onderdeel", { skip }, async () => {
  const id = await user();
  const row = await L.store.recordKompas(id, { topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED" });
  assert.equal(row.version, L.registry.getTopic("learn")!.version);
  assert.deepEqual(await L.store.getKompasRows(id), [row]);
});

test("afgerond blijft afgerond; overgeslagen kan later bekeken worden", { skip }, async () => {
  const id = await user();
  const key = { topicId: "play", scope: "", kind: "TOUR" as const };
  await L.store.recordKompas(id, { ...key, status: "VIEWED" });
  await L.store.recordKompas(id, { ...key, status: "COMPLETED" });
  await L.store.recordKompas(id, { ...key, status: "VIEWED" });
  assert.equal((await L.store.getKompasRows(id)).find((r) => r.kind === "TOUR")?.status, "COMPLETED");
  const guide = { topicId: "play", scope: "", kind: "GUIDE" as const };
  await L.store.recordKompas(id, { ...guide, status: "SKIPPED" });
  await L.store.recordKompas(id, { ...guide, status: "VIEWED" });
  assert.equal((await L.store.getKompasRows(id)).find((r) => r.kind === "GUIDE")?.status, "VIEWED");
});

test("een schriftbron met eigen uitleg is een eigen status; de algemene blijft onaangetast", { skip }, async () => {
  const id = await user();
  await L.store.recordKompas(id, { topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED" });
  await L.store.recordKompas(id, { topicId: "learn", scope: "dc-testament", kind: "GUIDE", status: "SKIPPED" });
  const rows = await L.store.getKompasRows(id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.scope === "")?.status, "VIEWED");
  assert.equal(rows.find((r) => r.scope === "dc-testament")?.status, "SKIPPED");
  // Twee keer dezelfde sleutel maakt geen tweede rij.
  await L.store.recordKompas(id, { topicId: "learn", scope: "dc-testament", kind: "GUIDE", status: "VIEWED" });
  assert.equal((await L.store.getKompasRows(id)).length, 2);
});

test("een onbekend onderdeel wordt geweigerd en niets wordt opgeslagen", { skip }, async () => {
  const id = await user();
  await assert.rejects(L.store.recordKompas(id, { topicId: "bestaat-niet", scope: "", kind: "GUIDE", status: "VIEWED" }));
  assert.deepEqual(await L.store.getKompasRows(id), []);
});

test("de status van de ene gebruiker is nooit zichtbaar voor een andere", { skip }, async () => {
  const a = await user();
  const b = await user();
  await L.store.recordKompas(a, { topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED" });
  assert.equal((await L.store.getKompasRows(b)).length, 0);
});

test("de kennismaking uit de onboarding markeert Versado, Leren, Spelen en Aan de slag, zonder bestaande status te overschrijven", { skip }, async () => {
  const id = await user();
  await L.store.recordKompas(id, { topicId: "learn", scope: "", kind: "GUIDE", status: "COMPLETED" });
  await L.store.recordOnboardingIntro(id, true);
  const rows = await L.store.getKompasRows(id);
  assert.deepEqual(rows.map((r) => r.topicId).sort(), ["learn", "play", "start", "versado"]);
  assert.equal(rows.find((r) => r.topicId === "learn")?.status, "COMPLETED");
  assert.equal(rows.find((r) => r.topicId === "play")?.status, "VIEWED");

  const skipper = await user();
  await L.store.recordOnboardingIntro(skipper, false);
  assert.ok((await L.store.getKompasRows(skipper)).every((r) => r.status === "SKIPPED"));
});

test("uitleg, rondleidingen en onboarding veranderen nooit XP, reeks, scores of voortgang", { skip }, async () => {
  const id = await user();
  const before = await L.db.user.findUniqueOrThrow({ where: { id }, select: { xpTotal: true, currentStreak: true, freezeCount: true } });
  for (const kind of ["GUIDE", "TOUR"] as const) {
    for (const status of ["VIEWED", "SKIPPED", "COMPLETED"] as const) {
      await L.store.recordKompas(id, { topicId: "start", scope: "", kind, status });
    }
  }
  await L.store.recordOnboardingIntro(id, true);
  const after = await L.db.user.findUniqueOrThrow({ where: { id }, select: { xpTotal: true, currentStreak: true, freezeCount: true } });
  assert.deepEqual(after, before);
  assert.equal(await L.db.xPTransaction.count({ where: { userId: id } }), 0);
  assert.equal(await L.db.streakDay.count({ where: { userId: id } }), 0);
  assert.equal(await L.db.weeklyScore.count({ where: { userId: id } }), 0);
  assert.equal(await L.db.contentProgress.count({ where: { userId: id } }), 0);
});

test("het verwijderen van een account verwijdert zijn Kompas-status", { skip }, async () => {
  const id = await user();
  await L.store.recordKompas(id, { topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED" });
  await L.db.user.delete({ where: { id } });
  assert.equal(await L.db.kompasProgress.count({ where: { userId: id } }), 0);
});
