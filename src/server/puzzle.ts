import type { Server as SocketIOServer, Socket } from "socket.io";
import { z } from "zod";
import { acquireCoopLock, commitCoopAction, getCoopState, releaseCoopLocks, renewCoopLock, syncCoopState } from "@/lib/puzzle/coop";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import { multiplayerConfig } from "@/lib/puzzle/multiplayerConfig";
import { commitSchema, idSchema } from "@/lib/puzzle/schemas";

// Realtime voor Samen puzzelen (Socket.IO + Redis-adapter). De database is de
// bron van waarheid: elke definitieve actie loopt door dezelfde servicefuncties
// als de HTTP-route (src/lib/puzzle/coop.ts), en die zenden de canonieke delta
// naar de room. Deze handler is dus alleen transport, aanwezigheid en
// tijdelijke sleepbeweging, die nooit wordt opgeslagen.
//
// Events (client → server, met ack): puzzle:join, puzzle:leave, puzzle:sync,
// puzzle:lock, puzzle:renew, puzzle:release, puzzle:commit; fire-and-forget:
// puzzle:drag.
// Events (server → room): puzzle:delta, puzzle:locks, puzzle:presence,
// puzzle:participants, puzzle:completed, puzzle:drag.

const roomOf = (sessionId: string) => `puzzle:${sessionId}`;
type Ack = (response: unknown) => void;
const call = (ack: unknown): Ack => (typeof ack === "function" ? (ack as Ack) : () => {});

const sessionPayload = z.object({ sessionId: idSchema });
const syncPayload = z.object({ sessionId: idSchema, version: z.number().int().nonnegative() });
const lockPayload = z.object({ sessionId: idSchema, groupId: z.string().min(1).max(64) });
const renewPayload = lockPayload.extend({ token: z.string().min(1).max(64) });
const releasePayload = z.object({ sessionId: idSchema, groupId: z.string().min(1).max(64).optional(), token: z.string().min(1).max(64).optional() });
const dragPayload = z.object({ sessionId: idSchema, groupId: z.string().min(1).max(64), x: z.number().finite().min(-200).max(200), y: z.number().finite().min(-200).max(200) });

function failure(error: unknown) {
  if (error instanceof PuzzleServiceError) return { ok: false, code: error.code, ...error.detail };
  console.error("Puzzel-socket:", error);
  return { ok: false, code: "ERROR" };
}

async function announcePresence(io: SocketIOServer, sessionId: string) {
  // fetchSockets werkt via de Redis-adapter over alle instances heen.
  const sockets = await io.in(roomOf(sessionId)).fetchSockets();
  const online = [...new Set(sockets.map((candidate) => candidate.data.userId as string).filter(Boolean))];
  io.to(roomOf(sessionId)).emit("puzzle:presence", { sessionId, online });
}

export function registerPuzzleHandlers(io: SocketIOServer, socket: Socket, user: { id: string }) {
  // Per socket: in welke puzzels, welke lock-tokens dit socket verkreeg, en een
  // eenvoudige emmer tegen overmatig sleepverkeer (bij 150-300 stukken).
  const joined = new Map<string, Set<string>>();
  const heldUntil = new Map<string, number>();
  let bucket = multiplayerConfig().dragMessagesPerSecond; let refilled = Date.now();

  socket.on("puzzle:join", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = sessionPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try {
      const state = await getCoopState(user.id, parsed.data.sessionId);
      await socket.join(roomOf(state.id));
      if (!joined.has(state.id)) joined.set(state.id, new Set());
      reply({ ok: true, state });
      void announcePresence(io, state.id);
    } catch (error) { reply(failure(error)); }
  });

  const leaveRoom = async (sessionId: string) => {
    const tokens = joined.get(sessionId);
    joined.delete(sessionId);
    await socket.leave(roomOf(sessionId));
    // Alleen de locks die dit socket zelf verkreeg; een tweede tabblad houdt de zijne.
    if (tokens?.size) await releaseCoopLocks(user.id, sessionId, { tokens: [...tokens] }).catch(() => {});
    void announcePresence(io, sessionId);
  };

  socket.on("puzzle:leave", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = sessionPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    await leaveRoom(parsed.data.sessionId); reply({ ok: true });
  });

  socket.on("puzzle:sync", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = syncPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try { reply({ ok: true, ...(await syncCoopState(user.id, parsed.data.sessionId, parsed.data.version)) }); } catch (error) { reply(failure(error)); }
  });

  socket.on("puzzle:lock", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = lockPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try {
      const result = await acquireCoopLock(user.id, parsed.data.sessionId, parsed.data.groupId);
      if (result.ok) { joined.get(parsed.data.sessionId)?.add(result.token); heldUntil.set(`${parsed.data.sessionId}:${parsed.data.groupId}`, Date.parse(result.expiresAt)); }
      reply(result);
    } catch (error) { reply(failure(error)); }
  });

  socket.on("puzzle:renew", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = renewPayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try {
      const result = await renewCoopLock(user.id, parsed.data.sessionId, parsed.data.groupId, parsed.data.token);
      if (result.ok && result.expiresAt) heldUntil.set(`${parsed.data.sessionId}:${parsed.data.groupId}`, Date.parse(result.expiresAt));
      reply(result);
    } catch (error) { reply(failure(error)); }
  });

  socket.on("puzzle:release", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = releasePayload.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try {
      await releaseCoopLocks(user.id, parsed.data.sessionId, { groupId: parsed.data.groupId, token: parsed.data.token });
      if (parsed.data.groupId) heldUntil.delete(`${parsed.data.sessionId}:${parsed.data.groupId}`);
      reply({ ok: true });
    } catch (error) { reply(failure(error)); }
  });

  socket.on("puzzle:commit", async (payload: unknown, ack?: Ack) => {
    const reply = call(ack); const parsed = commitSchema.safeParse(payload);
    if (!parsed.success) return reply({ ok: false, code: "INVALID" });
    try { reply(await commitCoopAction(user.id, parsed.data.sessionId, parsed.data)); } catch (error) { reply(failure(error)); }
  });

  // Tijdelijke beweging: alleen doorgegeven, nooit opgeslagen. Alleen voor een
  // groep die dit socket zelf vasthoudt en alleen binnen de snelheidsgrens.
  socket.on("puzzle:drag", (payload: unknown) => {
    const parsed = dragPayload.safeParse(payload);
    if (!parsed.success || !joined.has(parsed.data.sessionId)) return;
    const now = Date.now(); const limit = multiplayerConfig().dragMessagesPerSecond;
    bucket = Math.min(limit, bucket + ((now - refilled) / 1000) * limit); refilled = now;
    if (bucket < 1) return; bucket -= 1;
    if ((heldUntil.get(`${parsed.data.sessionId}:${parsed.data.groupId}`) ?? 0) < now) return;
    socket.to(roomOf(parsed.data.sessionId)).volatile.emit("puzzle:drag", { ...parsed.data, userId: user.id });
  });

  socket.on("disconnect", () => {
    // Locks verlopen sowieso na hun lease; dit geeft ze meteen vrij.
    for (const sessionId of [...joined.keys()]) void leaveRoom(sessionId);
  });
}
