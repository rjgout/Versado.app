// Productie-routehandler voor geïsoleerde HTTP-tests. Geen scheduler, seed of FSY-sync.
import { createServer } from "node:http";
import next from "next";
const url = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href) throw new Error("Uitsluitend eigen lokale testomgeving");
const app = next({ dev: false, hostname: url.hostname, port: Number(url.port) });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((req, res) => handle(req, res));
server.listen(Number(url.port), url.hostname);
process.on("SIGTERM", () => { server.close(); void app.close().finally(() => process.exit(0)); });
