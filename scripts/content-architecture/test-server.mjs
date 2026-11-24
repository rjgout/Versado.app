// Productie-routehandler voor geïsoleerde HTTP-tests. Geen scheduler, seed of FSY-sync.
import { createServer } from "node:http";
import next from "next";
import {readFileSync,createReadStream,statSync} from "node:fs";
import path from "node:path";
const url = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href) throw new Error("Uitsluitend eigen lokale testomgeving");
// Alleen dit reeds begrensde, lokale testproces krijgt gecontroleerde HTTP-input.
// De productie-downloader valideert dezelfde status, headers, bytes en opslag.
if(process.env.CFM_TEST_ASSETS) {
  const root=path.resolve(process.env.CFM_TEST_ASSETS);
  if(!root.startsWith("/tmp/")||process.env.STUDY_PUBLICATION_PROFILE!=="synthetic-test")throw Error("Eigen CFM-testfixtures vereist");
  const assets=new Map([2026,2027].flatMap(year=>JSON.parse(readFileSync(`data/study-content/cfm-${year}-nl/media-lock.json`,"utf8"))).map(asset=>[asset.url,asset]));
  globalThis.__versadoCfmImageTestTransport={
    resolve:async()=>[{address:"93.184.216.34",family:4}],
    transport:async url=>{
      const asset=assets.get(url.href);
      if(!asset||!/^[A-Za-z0-9_.-]+$/.test(asset.file))throw Error("Onbekende CFM-testbron");
      const file=path.join(root,"media",asset.file),stream=createReadStream(file);
      return {status:200,headers:{"content-type":asset.mimeType,"content-length":String(statSync(file).size)},body:stream,close:()=>stream.destroy()};
    },
  };
}
const app = next({ dev: false, hostname: url.hostname, port: Number(url.port) });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((req, res) => handle(req, res));
server.listen(Number(url.port), url.hostname);
process.on("SIGTERM", () => { server.close(); void app.close().finally(() => process.exit(0)); });
