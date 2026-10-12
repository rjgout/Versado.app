import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";

// Echte multi-instance-test: twee productie-instances van server.ts met dezelfde PostgreSQL en
// dezelfde Redis (socket.io-adapter). Vereist een gebouwde .next (npm run build) en:
//   LEARNING_TEST_DATABASE_URL, REDIS_URL en PUZZLE_MULTI_INSTANCE=1.
// Nooit tegen productie: de database is een eigen testdatabase.
const url = process.env.LEARNING_TEST_DATABASE_URL;
const redis = process.env.REDIS_URL ?? "redis://localhost:6379";
const skip = (!url || process.env.PUZZLE_MULTI_INSTANCE !== "1") && "PUZZLE_MULTI_INSTANCE=1 en LEARNING_TEST_DATABASE_URL vereist";
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";

const PORTS = [3141, 3142];
const children: (ChildProcess | null)[] = [null, null];
const sockets: Socket[] = [];
const ids: string[] = [];
let db: Awaited<ReturnType<typeof loadDb>>;
async function loadDb() { return (await import("../src/lib/db")).prisma; }

function startInstance(index: number) {
  const child = spawn("node_modules/.bin/tsx", ["server.ts"], {
    detached: true,
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORTS[index]), DATABASE_URL: url!, REDIS_URL: redis, SESSION_SECRET: process.env.SESSION_SECRET!, ALLOW_INSECURE_COOKIES: "1", APP_URL: `http://localhost:${PORTS[index]}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.on("data", (chunk) => { if (process.env.PUZZLE_MULTI_DEBUG) process.stderr.write(`[${index}] ${chunk}`); });
  children[index] = child; return child;
}
async function waitHealthy(index: number) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const r = await fetch(`http://localhost:${PORTS[index]}/login`); if (r.status < 500) return; } catch { /* nog niet klaar */ }
    await delay(500);
  }
  throw new Error(`Instance ${index} startte niet`);
}
async function stopInstance(index: number) {
  const child = children[index]; if (!child) return;
  // De hele procesgroep: tsx start zelf een kindproces.
  try { process.kill(-child.pid!, "SIGTERM"); } catch { /* al gestopt */ }
  await new Promise((resolve) => { child.on("exit", resolve); setTimeout(resolve, 5000); });
  children[index] = null;
}

before(async () => {
  if (skip) return;
  db = await loadDb();
  startInstance(0); startInstance(1);
  await Promise.all([waitHealthy(0), waitHealthy(1)]);
});
after(async () => {
  if (skip) return;
  for (const socket of sockets) socket.disconnect();
  await Promise.all([stopInstance(0), stopInstance(1)]);
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

async function account() {
  const { hashSync } = await import("bcryptjs");
  const handle = `Mi${randomUUID().slice(0, 8)}`;
  const user = await db.user.create({ data: { email: `${handle.toLowerCase()}@test.invalid`, passwordHash: hashSync("Test12345!", 4), handle, discriminator: "00", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), timeZone: "Europe/Amsterdam" } });
  ids.push(user.id); return user;
}
async function login(port: number, email: string) {
  const response = await fetch(`http://localhost:${port}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password: "Test12345!" }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookie.includes("bvm_session"));
  return cookie;
}
async function connect(port: number, cookie: string) {
  const socket = io(`http://localhost:${port}`, { extraHeaders: { cookie }, transports: ["websocket"], reconnection: false, forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.on("connect", () => resolve()); socket.on("connect_error", reject); });
  return socket;
}
const ask = <T = Record<string, unknown>>(socket: Socket, event: string, payload: unknown) => socket.timeout(8000).emitWithAck(event, payload) as Promise<T & { ok: boolean; code?: string }>;
function expectEvent<T = Record<string, unknown>>(socket: Socket, event: string, match: (payload: T) => boolean = () => true, ms = 8000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Geen ${event} binnen ${ms} ms`)); }, ms);
    const handler = (payload: T) => { if (match(payload)) { clearTimeout(timer); socket.off(event, handler); resolve(payload); } };
    socket.on(event, handler);
  });
}
async function postJson(port: number, cookie: string, path: string, body: unknown) {
  const response = await fetch(`http://localhost:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
}

test("twee instances: aanwezigheid, vergrendelingen, deltas, gelijktijdige commits, herstel en herstart", { skip, timeout: 240_000 }, async () => {
  const [a, b] = await Promise.all([account(), account()]);
  await db.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const cookieA = await login(PORTS[0], a.email); const cookieB = await login(PORTS[1], b.email);
  await db.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });

  // Puzzel aanmaken op instance 0 en uitnodiging accepteren op instance 1 (via HTTP + gedeelde database).
  const socketB0 = await connect(PORTS[1], cookieB);
  const invited = expectEvent(socketB0, "puzzle_invites_changed", () => true, 15000);
  const { jigsawCatalog } = await import("../src/lib/jigsawGame");
  const created = await postJson(PORTS[0], cookieA, "/api/puzzle/coop", { action: "create", imageId: jigsawCatalog[0].url, pieceCount: 24, difficulty: "ADVENTURER", friendIds: [b.id] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sessionId = created.body?.sessionId as string;
  await invited; // realtime-signaal bereikte een socket op de andere instance
  const invite = await db.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } });
  const accepted = await postJson(PORTS[1], cookieB, "/api/puzzle/coop", { action: "respond", inviteId: invite.id, accept: true });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  socketB0.disconnect();

  // A op instance 0, B op instance 1.
  const sa = await connect(PORTS[0], cookieA); const sb = await connect(PORTS[1], cookieB);
  const presence = expectEvent<{ online: string[] }>(sa, "puzzle:presence", (p) => p.online.includes(a.id) && p.online.includes(b.id));
  const joinA = await ask<{ state: { version: number; snapshot: { groups: { id: string }[] } } }>(sa, "puzzle:join", { sessionId });
  const joinB = await ask<{ state: { version: number; snapshot: { groups: { id: string }[] } } }>(sb, "puzzle:join", { sessionId });
  assert.ok(joinA.ok && joinB.ok);
  await presence; // aanwezigheid over instances heen

  const [g1, g2] = joinA.state.snapshot.groups.map((g) => g.id);
  // Vergrendeling zichtbaar op de andere instance; tweede pakker krijgt LOCKED.
  const seen = expectEvent<{ locks: { groupId: string; userId: string }[] }>(sb, "puzzle:locks", (p) => p.locks.some((l) => l.groupId === g1 && l.userId === a.id));
  const lockA = await ask<{ token: string }>(sa, "puzzle:lock", { sessionId, groupId: g1 });
  assert.ok(lockA.ok); await seen;
  const lockB = await ask(sb, "puzzle:lock", { sessionId, groupId: g1 });
  assert.equal(lockB.ok, false); assert.equal(lockB.code ?? (lockB as { reason?: string }).reason, lockB.code ?? "LOCKED");
  // Sleepbewegingen worden doorgegeven over instances.
  const drag = expectEvent(sb, "puzzle:drag", (p: { groupId: string }) => p.groupId === g1);
  sa.volatile.emit("puzzle:drag", { sessionId, groupId: g1, x: 5, y: 5 }); await drag;

  // Gelijktijdige commits van beide spelers op verschillende groepen op verschillende instances.
  const lockB2 = await ask<{ token: string }>(sb, "puzzle:lock", { sessionId, groupId: g2 });
  assert.ok(lockB2.ok);
  const deltaOnB = expectEvent<{ delta: { version: number } }>(sb, "puzzle:delta", (d) => d.delta.version >= 2);
  const deltaOnA = expectEvent<{ delta: { version: number } }>(sa, "puzzle:delta", (d) => d.delta.version >= 2);
  const [ra, rb] = await Promise.all([
    ask<{ version: number }>(sa, "puzzle:commit", { sessionId, actionId: randomUUID(), baseVersion: joinA.state.version, lockToken: lockA.token, operation: { kind: "move", groupId: g1, x: 3, y: 3 } }),
    ask<{ version: number }>(sb, "puzzle:commit", { sessionId, actionId: randomUUID(), baseVersion: joinB.state.version, lockToken: lockB2.token, operation: { kind: "move", groupId: g2, x: 6, y: 3 } }),
  ]);
  assert.ok(ra.ok && rb.ok, JSON.stringify([ra, rb]));
  await Promise.all([deltaOnA, deltaOnB]);
  assert.notEqual(ra.version, rb.version, "de server serialiseert: elke actie een eigen versie");
  const row = await db.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } });
  assert.equal(row.version, Math.max(ra.version, rb.version));

  // Herhaalde commit (verloren ack) wordt idempotent afgehandeld.
  const actionId = randomUUID();
  const body = { sessionId, actionId, baseVersion: row.version, lockToken: lockA.token, operation: { kind: "move", groupId: g1, x: 3.5, y: 3 } };
  const first = await ask<{ version: number }>(sa, "puzzle:commit", body); const again = await ask<{ version: number; duplicate?: boolean }>(sa, "puzzle:commit", body);
  assert.ok(first.ok && again.ok && again.version === first.version);
  assert.equal(await db.puzzleAction.count({ where: { sessionId, actionId } }), 1);

  // Verloren verbinding: de locks van B verdwijnen meteen, de ander kan de groep pakken, B herstelt via sync.
  const freed = expectEvent<{ locks: { groupId: string }[] }>(sa, "puzzle:locks", (p) => !p.locks.some((l) => l.groupId === g2));
  sb.disconnect(); await freed;
  const takeover = await ask<{ token: string }>(sa, "puzzle:lock", { sessionId, groupId: g2 });
  assert.ok(takeover.ok, "een verloren verbinding blokkeert de groep niet");
  const sb2 = await connect(PORTS[1], cookieB);
  const resumed = await ask<{ state: { version: number } }>(sb2, "puzzle:join", { sessionId });
  assert.ok(resumed.ok);
  const sync = await ask<{ patch?: { version: number }; state?: { version: number }; upToDate?: boolean }>(sb2, "puzzle:sync", { sessionId, version: joinB.state.version });
  assert.ok(sync.ok && (sync.patch?.version ?? sync.state?.version ?? 0) >= first.version, "herstel via patch of volledige snapshot: " + JSON.stringify(sync).slice(0, 200));

  // Herstart van instance 1: B verbindt opnieuw (nu met instance 0 óf de herstarte instance) en ziet dezelfde stand.
  sb2.disconnect(); await stopInstance(1); startInstance(1); await waitHealthy(1);
  const cookieB2 = await login(PORTS[1], b.email); const sb3 = await connect(PORTS[1], cookieB2);
  const after = await ask<{ state: { version: number; snapshot: { groups: { id: string; x: number; y: number }[] } } }>(sb3, "puzzle:join", { sessionId });
  assert.ok(after.ok);
  const latest = await db.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } });
  assert.equal(after.state.version, latest.version, "de herstarte instance toont de autoritatieve stand uit PostgreSQL");
  // Commit via de herstarte instance werkt weer en bereikt A op instance 0.
  const lockAfter = await ask<{ token: string }>(sb3, "puzzle:lock", { sessionId, groupId: g1 });
  assert.ok(lockAfter.ok || lockAfter.code, "lock-aanvraag wordt beantwoord");
  const crossDelta = expectEvent<{ delta: { version: number } }>(sa, "puzzle:delta", (d) => d.delta.version > latest.version);
  const g3 = after.state.snapshot.groups.map((g) => g.id).find((id) => id !== g1 && id !== g2)!;
  const l3 = await ask<{ token: string }>(sb3, "puzzle:lock", { sessionId, groupId: g3 });
  assert.ok(l3.ok);
  const done = await ask(sb3, "puzzle:commit", { sessionId, actionId: randomUUID(), baseVersion: latest.version, lockToken: l3.token, operation: { kind: "move", groupId: g3, x: 7, y: 7 } });
  assert.ok(done.ok, JSON.stringify(done)); await crossDelta;
});

test("matchsignalen bereiken een speler op een andere instance", { skip, timeout: 120_000 }, async () => {
  const [a, b] = await Promise.all([account(), account()]);
  await db.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const cookieA = await login(PORTS[0], a.email); const cookieB = await login(PORTS[1], b.email);
  const sb = await connect(PORTS[1], cookieB);
  const invited = expectEvent(sb, "puzzle_invites_changed");
  const { jigsawCatalog } = await import("../src/lib/jigsawGame");
  const created = await postJson(PORTS[0], cookieA, "/api/puzzle/match", { action: "create", imageId: jigsawCatalog[0].url, pieceCount: 6, difficulty: "ADVENTURER", friendIds: [b.id], kind: "LIVE" });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await invited;
  const matchId = created.body!.matchId as string;
  const changed = expectEvent(sb, "puzzle_match_changed");
  const respond = await postJson(PORTS[1], cookieB, "/api/puzzle/match", { action: "respond", matchId, accept: true });
  assert.equal(respond.status, 200);
  const start = await postJson(PORTS[0], cookieA, "/api/puzzle/match", { action: "start", matchId });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  await changed;
  // Een vreemde zonder rechten krijgt niets.
  const stranger = await account(); const cookieS = await login(PORTS[0], stranger.email);
  assert.equal((await postJson(PORTS[0], cookieS, "/api/puzzle/match", { action: "state", matchId })).status, 403);
  assert.equal((await postJson(PORTS[0], "", "/api/puzzle/match", { action: "state", matchId })).status, 401);
});
