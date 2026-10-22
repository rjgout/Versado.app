// Alleen de eigen wegwerpdatabase; echte Next-routes + Socket.io zonder scheduler.
import { createServer } from "node:http";
import next from "next";
import { initGameServer, getIO } from "../../src/server/gameServer";
import { emitToUser } from "../../src/lib/realtime";
import { prisma } from "../../src/lib/db";
import Redis from "ioredis";
const base = new URL(process.env.SOCKET_TEST_INSTANCE_URL ?? "http://invalid"), db = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (base.hostname !== "127.0.0.1" || db.hostname !== "127.0.0.1" || db.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== db.href) throw Error("Alleen eigen sockettestomgeving");
// Alleen deze fixture vertraagt een echte, reeds afgeronde PostgreSQL-read.
// Zo kan de test intrekking definitief committen voordat de echte handler doorgaat.
const gates = new Redis(process.env.REDIS_URL!);
const pendingRewards = new Map<string, Set<Promise<unknown>>>();
const updateUser = prisma.user.update.bind(prisma.user);
prisma.user.update = ((args: Parameters<typeof updateUser>[0]) => {
  const result = Promise.resolve(updateUser(args));
  if (args.where.id && typeof args.data.hintBalance === "object" && args.data.hintBalance?.increment === 1) {
    const pending = pendingRewards.get(args.where.id) ?? new Set<Promise<unknown>>();
    pendingRewards.set(args.where.id, pending); pending.add(result);
    void result.finally(() => pending.delete(result)).catch(() => {});
  }
  return result;
}) as unknown as typeof prisma.user.update;
const findGame = prisma.liveGame.findUnique.bind(prisma.liveGame);
prisma.liveGame.findUnique = (async (args: Parameters<typeof findGame>[0]) => {
  const result = await findGame(args);
  const code = args.where.code;
  if (code?.startsWith("RACE") && !args.select) {
    const key = `native-test:gate:${base.port}:${code}`;
    if (await gates.getdel(key)) {
      const waiter = new Redis(process.env.REDIS_URL!);
      try {
        await gates.lpush(`${key}:reached`, "1");
        if (!await waiter.blpop(`${key}:release`, 15)) throw Error("Testbarrière niet vrijgegeven");
      } finally { waiter.disconnect(); }
    }
  }
  return result;
}) as unknown as typeof prisma.liveGame.findUnique;
const app = next({ dev: false, hostname: base.hostname, port: Number(base.port) }); await app.prepare();
const handle = app.getRequestHandler(), actions = new Map<string, number>();
const server = createServer((req, res) => {
  // Uitsluitend testfixture, nooit een productie-endpoint.
  if (req.url === "/__native_test_actions") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(Object.fromEntries(actions))); return; }
  void handle(req, res);
});
initGameServer(server);
getIO()!.on("connection", socket => {
  socket.on("native_test:reward_drain", async (ack: () => void) => {
    await Promise.all([...(pendingRewards.get(socket.data.userId) ?? [])]); ack();
  });
  for (const name of ["join_game", "cancel_game", "invite_friend"]) {
    const handlers = socket.listeners(name);
    socket.removeAllListeners(name);
    for (const handler of handlers) socket.on(name, (...args: unknown[]) => {
      void Promise.resolve(handler(...args)).catch(() => {}).finally(() => {
        void gates.lpush(`native-test:done:${socket.id}:${name}`, "1");
      });
    });
  }
  socket.on("native_test:who", (ack: (data: unknown) => void) => ack({ userId: socket.data.userId }));
  socket.on("native_test:action", (ack: (data: unknown) => void) => { const id = socket.data.userId as string; actions.set(id, (actions.get(id) ?? 0) + 1); ack({ ok: true }); });
  socket.on("native_test:broadcast", (value: string, ack: () => void) => { emitToUser(socket.data.userId, "native_test:update", value); ack(); });
});
await new Promise<void>(resolve => server.listen(Number(base.port), base.hostname, resolve));
process.on("SIGTERM", () => { getIO()?.close(); void app.close().finally(() => process.exit(0)); });
