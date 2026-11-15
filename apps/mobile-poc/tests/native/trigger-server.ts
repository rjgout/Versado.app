/* Lokale trigger voor de runtime-flows: de Maestro-flow roept dit endpoint aan terwijl de app in beeld staat, zodat
 * de tweede client pas ÉCHT tijdens de flow een vriendenverzoek stuurt. Alleen 127.0.0.1, alleen testgebruik. */
import http from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.env.TRIGGER_PORT ?? 3199);
let busy = false;
http.createServer((req, res) => {
  if (req.url !== "/dave" || busy) { res.statusCode = busy ? 409 : 404; return res.end(); }
  busy = true;
  const child = spawn("npx", ["tsx", "tests/native/peer.ts", "dave-request"], { stdio: "inherit" });
  child.on("exit", code => { busy = false; res.statusCode = code === 0 ? 200 : 500; res.end(code === 0 ? "ok" : "fout"); });
}).listen(port, "127.0.0.1", () => console.log(`trigger luistert op ${port}`));
