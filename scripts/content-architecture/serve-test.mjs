// Alleen Next's productiehandler: geen scheduler, seed, sync of socketmutaties.
import { createServer } from "node:http";
import next from "next";
const port = Number(process.env.PORT);
const app = next({ dev: false, hostname: "localhost", port });
await app.prepare();
createServer(app.getRequestHandler()).listen(port, "127.0.0.1");
