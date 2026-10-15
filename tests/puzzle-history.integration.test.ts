import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Afgeronde puzzels: de hub (laatste drie) en de gepagineerde geschiedenis. Alleen met de eigen puzzeltestdatabase (test:puzzle:integration).
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/versado_puzzle_test")) throw new Error("Deze tests vereisen de lokale wegwerpdatabase van test:puzzle:integration");
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "Gebruik npm run test:puzzle:integration voor de geïsoleerde database";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  coop: await import("../src/lib/puzzle/coop"),
  match: await import("../src/lib/puzzle/match"),
  history: await import("../src/lib/puzzle/history"),
  catalog: await import("../src/lib/jigsawGame"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (skip) return; L = await load(); await L.db.puzzleSession.count(); });
after(async () => { if (skip) return; await L.db.user.deleteMany({ where: { id: { in: ids } } }); await L.db.$disconnect(); });

async function person() {
  const user = await L.db.user.create({ data: { email: `hist-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Hi${randomUUID().slice(0, 8)}`, discriminator: "00" } });
  ids.push(user.id); return user;
}
const befriend = (a: string, b: string) => L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } });
const DAY = 86_400_000;

/** Een afgeronde gezamenlijke puzzel met een vaste afrondtijd. */
async function finishedCoop(owner: string, friend: string, finishedAt: Date) {
  const id = await L.coop.createCoopSession(owner, L.catalog.jigsawCatalog[0].url, 24, "ADVENTURER", [friend]);
  await L.db.puzzleSession.update({ where: { id }, data: { status: "COMPLETED", completedAt: finishedAt, lastActivityAt: finishedAt } });
  return id;
}
/** Een afgeronde wedstrijd met een vaste afrondtijd. */
async function finishedMatch(owner: string, friend: string, finishedAt: Date, status: "FINISHED" | "RUNNING" = "FINISHED") {
  const id = await L.match.createMatch(owner, 0, 6, "ADVENTURER", [friend], "ASYNC");
  await L.db.puzzleMatch.update({ where: { id }, data: { status, finishedAt: status === "FINISHED" ? finishedAt : null } });
  return id;
}

test("hub: precies de drie laatst afgeronde, Samen en Tegen elkaar door elkaar, met een vaste volgorde bij gelijke tijd", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  const now = Date.now(); const tie = new Date(now - 1 * DAY);
  const oldest = await finishedCoop(a.id, b.id, new Date(now - 5 * DAY));
  const matchTie = await finishedMatch(a.id, b.id, tie);
  const coopTie = await finishedCoop(a.id, b.id, tie);
  const newest = await finishedMatch(a.id, b.id, new Date(now - 60_000));
  const hub = await L.history.listRecentFinishedForHub(a.id);
  assert.equal(hub.items.length, 3, "nooit meer dan drie");
  assert.deepEqual(hub.items.map((i) => i.id), [newest, matchTie, coopTie], "nieuwste eerst; bij gelijke tijd de wedstrijd vóór de gezamenlijke puzzel");
  assert.ok(hub.nextCursor, "er is meer dan de hub toont");
  assert.ok(!hub.items.some((i) => i.id === oldest));
  // een deelnemer (geen eigenaar) ziet dezelfde puzzel in zijn eigen overzicht; een alleen uitgenodigde nog niet
  assert.ok(!(await L.history.listFinishedPuzzles(b.id)).items.some((i) => i.id === coopTie));
  await L.db.puzzleSessionParticipant.create({ data: { sessionId: coopTie, userId: b.id } });
  assert.ok((await L.history.listFinishedPuzzles(b.id)).items.some((i) => i.id === coopTie));
});

test("hub: de 14-dagenregel geldt voor wedstrijden maar niet voor de geschiedenis; gezamenlijke puzzels blijven", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  const oldMatch = await finishedMatch(a.id, b.id, new Date(Date.now() - 20 * DAY));
  const oldCoop = await finishedCoop(a.id, b.id, new Date(Date.now() - 40 * DAY));
  const hub = await L.history.listRecentFinishedForHub(a.id);
  assert.deepEqual(hub.items.map((i) => i.id), [oldCoop], "de oude wedstrijd is niet meer op de hub; de gezamenlijke puzzel wel (bestaande semantiek)");
  const all = await L.history.listFinishedPuzzles(a.id);
  assert.deepEqual(all.items.map((i) => i.id), [oldMatch, oldCoop], "de geschiedenis toont beide, nieuwste eerst");
  assert.equal(await L.history.hasFinishedPuzzles(a.id), true);
  assert.equal(await L.history.hasFinishedPuzzles((await person()).id), false);
});

test("geschiedenis: paginatie sluit exact aan (geen dubbelen, geen gaten) en volgt de globale volgorde, ook bij gelijke tijden", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  const base = Date.now() - 100 * DAY; const expected: string[] = [];
  const times = [0, 1, 1, 2, 3, 3, 3, 4, 5, 6, 7];
  for (let i = 0; i < times.length; i++) {
    const at = new Date(base + times[i] * DAY);
    expected.push(i % 2 === 0 ? await finishedCoop(a.id, b.id, at) : await finishedMatch(a.id, b.id, at));
  }
  const full = (await L.history.listFinishedPuzzles(a.id, { limit: 50 })).items;
  assert.equal(full.length, times.length);
  assert.deepEqual(new Set(full.map((i) => i.id)), new Set(expected));
  for (let i = 1; i < full.length; i++) assert.ok(Date.parse(full[i - 1].finishedAt) >= Date.parse(full[i].finishedAt), "nieuwste eerst");
  for (const size of [1, 2, 3, 5]) {
    const collected: string[] = []; let cursor = null as ReturnType<typeof L.history.decodeCursor>; let pages = 0;
    for (;;) {
      const page = await L.history.listFinishedPuzzles(a.id, { limit: size, cursor }); pages++;
      assert.ok(page.items.length <= size, "een pagina overschrijdt de limiet nooit");
      collected.push(...page.items.map((i) => i.key));
      if (!page.nextCursor) break;
      cursor = L.history.decodeCursor(page.nextCursor); assert.ok(cursor);
      assert.ok(pages < 40, "geen oneindige lus");
    }
    assert.deepEqual(collected, full.map((i) => i.key), `pagina's van ${size} samen = de volledige lijst, zonder dubbelen of gaten`);
  }
  const before = await L.db.puzzleSession.count({ where: { mode: "COOP", participants: { some: { userId: a.id } } } });
  assert.equal(before, expected.filter((_, i) => i % 2 === 0).length, "lezen verwijdert niets");
});

test("geschiedenis: toegangscontrole per gebruiker; een cursor of een vreemde puzzel geeft nooit andermans gegevens", { skip }, async () => {
  const [a, b, stranger] = await Promise.all([person(), person(), person()]); await befriend(a.id, b.id);
  const mine = await finishedCoop(a.id, b.id, new Date(Date.now() - DAY));
  await finishedMatch(a.id, b.id, new Date(Date.now() - 2 * DAY));
  const page = await L.history.listFinishedPuzzles(a.id, { limit: 1 });
  assert.ok(page.nextCursor);
  const withForeignCursor = await L.history.listFinishedPuzzles(stranger.id, { limit: 5, cursor: L.history.decodeCursor(page.nextCursor) });
  assert.deepEqual(withForeignCursor.items, [], "een vreemde ziet niets, ook niet met een geldige cursor");
  assert.ok(!(await L.history.listFinishedPuzzles(stranger.id)).items.some((i) => i.id === mine));
  // een afgewezen wedstrijduitnodiging telt niet mee
  const declined = await finishedMatch(a.id, b.id, new Date(Date.now() - 3 * DAY));
  await L.db.puzzleMatchParticipant.updateMany({ where: { matchId: declined, userId: b.id }, data: { status: "DECLINED" } });
  assert.ok(!(await L.history.listFinishedPuzzles(b.id)).items.some((i) => i.id === declined));
  // een lopende of geannuleerde wedstrijd is geen afgeronde puzzel
  const running = await finishedMatch(a.id, b.id, new Date(), "RUNNING");
  assert.ok(!(await L.history.listFinishedPuzzles(a.id, { limit: 50 })).items.some((i) => i.id === running));
  assert.equal(L.history.decodeCursor("geen-cursor"), null); assert.equal(L.history.decodeCursor(""), null);
  assert.equal(L.history.decodeCursor(Buffer.from(JSON.stringify([1, 7, "x"])).toString("base64url")), null);
});

test("overzicht: lopende puzzels en wedstrijden verdwijnen niet doordat afgeronde de serverlimiet vullen", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  for (let i = 0; i < 24; i++) { await finishedCoop(a.id, b.id, new Date(Date.now() + i * 1000)); await finishedMatch(a.id, b.id, new Date(Date.now() + i * 1000 + 500)); }
  // Als laatste: een lopende puzzel en wedstrijd die ouder zijn dan alle afgeronde in activiteit (de vroegere gedeelde limiet van 20 verdrong ze).
  const active = await L.coop.createCoopSession(a.id, L.catalog.jigsawCatalog[0].url, 24, "ADVENTURER", [b.id]);
  await L.db.puzzleSession.update({ where: { id: active }, data: { lastActivityAt: new Date(Date.now() - 30 * DAY) } });
  const running = await L.match.createMatch(a.id, 0, 6, "ADVENTURER", [b.id], "ASYNC");
  await L.db.puzzleMatchParticipant.updateMany({ where: { matchId: running }, data: { createdAt: new Date(Date.now() - 30 * DAY) } });
  const coop = await L.coop.listCoopOverview(a.id); const matches = await L.match.listMatchOverview(a.id);
  assert.ok(coop.sessions.some((s) => s.id === active && s.status === "ACTIVE"), "de lopende gezamenlijke puzzel staat nog in het overzicht");
  assert.ok(matches.some((m) => m.match.id === running), "de lopende wedstrijd staat nog in het overzicht");
  assert.ok(coop.sessions.filter((s) => s.status === "COMPLETED").length <= 3 && matches.filter((m) => m.match.status === "FINISHED").length <= 3, "afgeronde zijn begrensd");
});
