// Meting van de gezamenlijke puzzel op schaal. Alleen tegen een eigen testdatabase:
//   LEARNING_TEST_DATABASE_URL=... npx tsx scripts/puzzle/perf-multiplayer.ts
import { randomUUID } from "node:crypto";
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (!url) throw new Error("LEARNING_TEST_DATABASE_URL vereist (nooit productie)");
process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";

const { prisma } = await import("../../src/lib/db");
const coop = await import("../../src/lib/puzzle/coop");
const geometryCache = await import("../../src/lib/puzzle/geometryCache");
const engine = await import("../../src/lib/puzzle/engine");
const { jigsawCatalog } = await import("../../src/lib/jigsawGame");

const stats = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]; return { n: s.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
const ids: string[] = [];
async function person() {
  const u = await prisma.user.create({ data: { email: `perf-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Pf${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam" } });
  ids.push(u.id); return u;
}
const rows: Record<string, unknown>[] = [];
try {
  for (const count of [24, 48, 96, 150, 300] as const) {
    const people = await Promise.all([person(), person(), person(), person()]);
    for (const friend of people.slice(1)) await prisma.friendship.create({ data: { senderId: people[0].id, receiverId: friend.id, status: "ACCEPTED" } });
    const sessionId = await coop.createCoopSession(people[0].id, jigsawCatalog[0].url, count, "ADVENTURER", people.slice(1).map((p) => p.id));
    for (const friend of people.slice(1)) { const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: friend.id } }); await coop.respondToCoopInvite(friend.id, invite.id, true); }
    const state0 = await coop.getCoopState(people[0].id, sessionId);
    const geometry = geometryCache.cachedPuzzleGeometry(state0.pieceCount, state0.seed, state0.geometryVersion);
    const snapshotBytes = Buffer.byteLength(JSON.stringify(state0.snapshot));
    const stateMs: number[] = []; const commitMs: number[] = []; const deltaBytes: number[] = [];
    // Vier spelers leggen om de beurt buurparen: verplaatsen, verplaatsen, verbinden.
    const pairs: [number, number][] = [];
    for (let row = 0; row < geometry.grid.rows; row++) for (let column = 0; column + 1 < geometry.grid.columns; column += 2) pairs.push([row * geometry.grid.columns + column, row * geometry.grid.columns + column + 1]);
    const n = Math.min(pairs.length, 60);
    // Gelijktijdig: elke speler werkt op een eigen deel van de pairs, zoals vier mensen aan een groot bord.
    await Promise.all(people.map(async (player, index) => {
      for (let i = index; i < n; i += people.length) {
        const [one, two] = pairs[i];
        const act = async (piece: number, operation: import("../../src/lib/puzzle/coop").CoopOperation) => {
          const t0 = performance.now();
          const current = await coop.getCoopState(player.id, sessionId);
          stateMs.push(performance.now() - t0);
          const group = current.snapshot.groups.find((g) => g.pieceIds.includes(piece))!;
          const lock = await coop.acquireCoopLock(player.id, sessionId, group.id);
          if (!lock.ok) return;
          const start = performance.now();
          const result = await coop.commitCoopAction(player.id, sessionId, { actionId: randomUUID(), lockToken: lock.token, operation: operation.kind === "move" ? { ...operation, groupId: group.id } : operation }).catch(() => null);
          commitMs.push(performance.now() - start);
          if (result?.delta) deltaBytes.push(Buffer.byteLength(JSON.stringify(result.delta)));
          await coop.releaseCoopLocks(player.id, sessionId);
        };
        const y = 3 + (i % 20); const x = 3 + Math.floor(i / 20) * 3;
        await act(one, { kind: "move", groupId: "", x, y });
        await act(two, { kind: "move", groupId: "", x: x + 1, y });
        await act(two, { kind: "connect", a: two, b: one });
      }
    }));
    // Teken de zoektijd van een snap-zoekactie op de volle snapshot.
    const full = await coop.getCoopState(people[0].id, sessionId);
    const snapTimes: number[] = [];
    for (const group of full.snapshot.groups.slice(0, 30)) { const t0 = performance.now(); engine.findSnapConnection(full.snapshot, geometry, "ADVENTURER", group.id); snapTimes.push(performance.now() - t0); }
    const syncStart = performance.now(); await coop.syncCoopState(people[1].id, sessionId, Math.max(0, full.version - 20)); const syncMs = performance.now() - syncStart;
    const fullStart = performance.now(); await coop.syncCoopState(people[1].id, sessionId, 0); const fullSyncMs = performance.now() - fullStart;
    rows.push({ pieces: count, snapshotKB: +(snapshotBytes / 1024).toFixed(1), deltaBytes: stats(deltaBytes), commitMs: stats(commitMs), getStateMs: stats(stateMs), findSnapMs: stats(snapTimes), patchSyncMs: +syncMs.toFixed(1), fullResyncMs: +fullSyncMs.toFixed(1), finalVersion: full.version });
  }
  console.log(JSON.stringify(rows, null, 1));
} finally {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
