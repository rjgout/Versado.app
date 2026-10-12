// Realtime-toegang op dezelfde eigen productie-app als de bestaande browserrunner.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.LAYOUT_TEST_BASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_layout_test" || !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Alleen eigen browserdatabase/server");
const flag = await prisma.contentCollection.findUniqueOrThrow({ where: { id: "content_bom" }, select: { enabled: true, visibleToUsers: true, publicationState: true } });
const games = [];
let checks = 0;
async function account(admin = false) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@socket.test.invalid`, handle: randomUUID().slice(0,8), discriminator: "00", passwordHash: "synthetic", isAdmin: admin, activeContentCollectionId: "content_podcasts", hintBalance: 8, xpTotal: 100 } });
  return { id: user.id, cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}` };
}
async function join(account, event, payload, errors, successes = []) {
  const socket = io(base.origin, { transports: ["websocket"], autoConnect: false, reconnection: false, extraHeaders: { Cookie: account.cookie } });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`Geen socketantwoord op ${event}`)); }, 8000);
      const done = (kind, data) => { clearTimeout(timer); resolve({ kind, data }); };
      socket.once("connect_error", error => { clearTimeout(timer); reject(error); });
      for (const name of errors) socket.once(name, data => done("denied", data));
      for (const name of successes) socket.once(name, data => done("allowed", data));
      socket.once("connect", () => socket.emit(event, payload));
      socket.connect();
    });
  } finally { socket.disconnect(); }
}
try {
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  const owner = await account(); const admin = await account(true);
  const book = await prisma.book.create({ data: { slug: `socket-${randomUUID()}`, key: `socket/${randomUUID()}`, name: "Synthetische bron", order: 1000, contentCollectionId: "content_bom" } });
  const chapter = await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, heading: "Geen publiek exportbestand", verses: { create: { number: 1, text: "SYNTHETISCHE BRON VOOR SOCKETTEST" } } } });
  await prisma.exercise.create({ data: { chapterId: chapter.id, type: "FILL_BLANK", status: "APPROVED", order: 1, prompt: "Een ____", verseRef: "1:1", answers: JSON.stringify(["voorbeeld"]) } });
  const course = await prisma.course.create({ data: { slug: `socket-${randomUUID()}`, name: "Synthetische cursus", type: "FREE_CHOICE", contentCollectionId: "content_bom" } });
  for (const mode of ["EXERCISES", "CHAPTER_GUESS", "FAMILY_GAME", "ALLESKENNER", "STUDY", "QUICK_MISSIONARY"]) {
    const code = `S${randomUUID().slice(0,6).toUpperCase()}`;
    const game = await prisma.liveGame.create({ data: { code, hostId: owner.id, mode, status: "LOBBY", ...(mode === "EXERCISES" ? { chapterId: chapter.id } : {}), ...(mode === "CHAPTER_GUESS" ? { level: "BEGINNER", questionCount: 5 } : {}), ...(mode === "STUDY" ? { studySession: { create: { courseId: course.id } } } : {}), players: { create: { userId: owner.id } } } });
    games.push({ ...game, event: mode === "ALLESKENNER" ? "ak:join" : mode === "STUDY" ? "st:join" : mode === "QUICK_MISSIONARY" ? "qm:join" : "join_game", error: mode === "ALLESKENNER" ? "ak:error" : mode === "STUDY" ? "st:error" : mode === "QUICK_MISSIONARY" ? "qm:error" : "error_message" });
  }
  const before = { playerCount: await prisma.liveGamePlayer.count({ where: { gameId: { in: games.map(g => g.id) } } }), xp: await prisma.xPTransaction.count({ where: { userId: { in: [owner.id, admin.id] } } }), streak: await prisma.streakActivity.count({ where: { userId: { in: [owner.id,admin.id] } } }) };
  for (const patch of [{ visibleToUsers: false }, { enabled: false }, { publicationState: "DRAFT" }]) {
    await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY", ...patch } });
    for (const actor of [owner,admin]) for (const game of games) {
      const result = await join(actor, game.event, { code: game.code }, [game.error], ["lobby_update","st:state","qm:room","ak:state"]);
      assert.equal(result.kind, "denied", `${game.mode}: normale rechten ook voor admin`); checks++;
    }
  }
  assert.deepEqual({ playerCount: await prisma.liveGamePlayer.count({ where: { gameId: { in: games.map(g => g.id) } } }), xp: await prisma.xPTransaction.count({ where: { userId: { in: [owner.id,admin.id] } } }), streak: await prisma.streakActivity.count({ where: { userId: { in: [owner.id,admin.id] } } }) }, before);
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  // Bestaande partij hervatten: actuele bron podcasts, nieuwe-startsetting uit.
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", liveExercisesEnabled: false }, update: { liveExercisesEnabled: false } });
  const existing = games.find(game => game.mode === "EXERCISES");
  assert.equal((await join(owner, "join_game", { code: existing.code }, ["error_message"], ["lobby_update"])).kind, "allowed"); checks++;
  const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(after.activeContentCollectionId, "content_podcasts"); assert.equal(after.xpTotal,100); assert.equal(after.hintBalance,8);
  console.log(`Realtime: ${checks} echte socketcontroles; bronrechten, adminisolatie en hervatten zonder nieuwe-startscope geslaagd.`);
} finally { await prisma.contentCollection.update({ where: { id: "content_bom" }, data: flag }); await prisma.$disconnect(); }
