// Alleen de eigen wegwerpdatabase; echte Next-routes + Socket.io zonder scheduler.
import { createServer } from "node:http";
import next from "next";
import { initGameServer, getIO } from "../../src/server/gameServer";
import { emitToUser } from "../../src/lib/realtime";
const base = new URL(process.env.SOCKET_TEST_INSTANCE_URL ?? "http://invalid"), db = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (base.hostname !== "127.0.0.1" || db.hostname !== "127.0.0.1" || db.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== db.href) throw Error("Alleen eigen sockettestomgeving");
const app = next({ dev: false, hostname: base.hostname, port: Number(base.port) }); await app.prepare();
const handle = app.getRequestHandler(), actions = new Map<string, number>();
const server = createServer((req, res) => {
  // Uitsluitend testfixture, nooit een productie-endpoint.
  if (req.url === "/__native_test_actions") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(Object.fromEntries(actions))); return; }
  void handle(req, res);
});
initGameServer(server);
getIO()!.on("connection", socket => {
  socket.on("native_test:who", (ack: (data: unknown) => void) => ack({ userId: socket.data.userId }));
  socket.on("native_test:action", (ack: (data: unknown) => void) => { const id = socket.data.userId as string; actions.set(id, (actions.get(id) ?? 0) + 1); ack({ ok: true }); });
  socket.on("native_test:broadcast", (value: string, ack: () => void) => { emitToUser(socket.data.userId, "native_test:update", value); ack(); });
});
await new Promise<void>(resolve => server.listen(Number(base.port), base.hostname, resolve));
process.on("SIGTERM", () => { getIO()?.close(); void app.close().finally(() => process.exit(0)); });
