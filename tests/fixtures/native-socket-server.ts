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
let bypassTestGates = false;
const pendingActions = new Map<string, Set<Promise<unknown>>>();
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
// De SQL-commit is echt voltooid; alleen terugkeer naar de echte handler wordt vertraagd.
const transaction = prisma.$transaction.bind(prisma);
prisma.$transaction = (async (...args: unknown[]) => {
  const result = await (transaction as (...args: unknown[]) => Promise<unknown>)(...args);
  if (!bypassTestGates && result && typeof result === "object" && "hintBalance" in result) {
    const key = `native-test:commit-gate:${base.port}`;
    if (!bypassTestGates && await gates.getdel(key)) {
      const waiter = new Redis(process.env.REDIS_URL!);
      try { await gates.lpush(`${key}:reached`, "1"); await waiter.blpop(`${key}:release`, 15); }
      finally { waiter.disconnect(); }
    }
  }
  return result;
}) as typeof prisma.$transaction;
const findGame = prisma.liveGame.findUnique.bind(prisma.liveGame);
prisma.liveGame.findUnique = (async (args: Parameters<typeof findGame>[0]) => {
  const result = await findGame(args);
  const code = args.where.code;
  if (code?.startsWith("RACE") && !args.select) {
    const key = `native-test:gate:${base.port}:${code}`;
    if (!bypassTestGates && await gates.getdel(key)) {
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
    await Promise.all([...(pendingActions.get(socket.data.userId) ?? []), ...(pendingRewards.get(socket.data.userId) ?? [])]); ack();
  });
  for (const name of ["join_game", "cancel_game", "invite_friend", "submit_answer", "use_hint", "start_game", "leave_game"]) {
    const handlers = socket.listeners(name);
    socket.removeAllListeners(name);
    for (const handler of handlers) socket.on(name, (...args: unknown[]) => {
      const pending = pendingActions.get(socket.data.userId) ?? new Set<Promise<unknown>>();
      pendingActions.set(socket.data.userId, pending);
      const work = (async () => {
        const key = `native-test:action-gate:${socket.id}:${name}`;
        if (!bypassTestGates && await gates.getdel(key)) {
          const waiter = new Redis(process.env.REDIS_URL!);
          try { await gates.lpush(`${key}:reached`, "1"); if (!await waiter.blpop(`${key}:release`, 15)) throw Error("Actiebarrière verlopen"); }
          finally { waiter.disconnect(); }
        }
        return handler(...args);
      })().catch(() => {}).finally(() => {
        pending.delete(work);
        if (!bypassTestGates) void gates.lpush(`native-test:done:${socket.id}:${name}`, "1");
      });
      pending.add(work);
    });
  }
  socket.on("native_test:bypass_gates", (ack: () => void) => { bypassTestGates = true; gates.disconnect(); ack(); });
  const emit = socket.emit.bind(socket);
  socket.emit = ((name: string, ...args: unknown[]) => {
    if (socket.data.dropQuizResponse && ["answer_result", "answer_received"].includes(name)) return false;
    return emit(name, ...args);
  }) as typeof socket.emit;
  socket.on("native_test:drop_response", (ack: () => void) => { socket.data.dropQuizResponse = true; ack(); });
  socket.on("native_test:who", (ack: (data: unknown) => void) => ack({ userId: socket.data.userId }));
  socket.on("native_test:action", (ack: (data: unknown) => void) => { const id = socket.data.userId as string; actions.set(id, (actions.get(id) ?? 0) + 1); ack({ ok: true }); });
  socket.on("native_test:broadcast", (value: string, ack: () => void) => { emitToUser(socket.data.userId, "native_test:update", value); ack(); });
});
await new Promise<void>(resolve => server.listen(Number(base.port), base.hostname, resolve));
process.on("SIGTERM", () => { getIO()?.close(); void app.close().finally(() => process.exit(0)); });
