// Alleen geïsoleerde productiebuild-tests, met echte geauthenticeerde Socket.io-signalen.
// Geen scheduler, imports, seed of productieverbinding.
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { parseCookieHeader } from "../../src/lib/parseCookieHeader";
import { SESSION_COOKIE, verifySessionToken } from "../../src/lib/auth";
import { setRealtimeServer } from "../../src/lib/realtime";
import { isLiveTopic, topicRoom } from "../../src/lib/data/scopes";
const url = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
const database = new URL(process.env.DORP_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href) throw Error("Alleen eigen lokale Dorp-testomgeving");
const app = next({ dev:false, hostname:url.hostname, port:Number(url.port) });
await app.prepare();
const handle=app.getRequestHandler(),server=createServer((req,res)=>handle(req,res));
const io=new Server(server,{path:"/socket.io"});setRealtimeServer(io);
io.use((socket,done)=>{
 const token=parseCookieHeader(socket.handshake.headers.cookie)[SESSION_COOKIE];
 void (token?verifySessionToken(token):Promise.resolve(null)).then(session=>{
  if(!session)return done(Error("Unauthorized"));socket.data.userId=session.userId;done();
 }).catch(()=>done(Error("Unauthorized")));
});
io.on("connection",socket=>{
 void socket.join(`user:${socket.data.userId}`);
 socket.on("data_subscribe",payload=>{if(isLiveTopic(payload?.topic))void socket.join(topicRoom(payload.topic));});
 socket.on("data_unsubscribe",payload=>{if(isLiveTopic(payload?.topic))void socket.leave(topicRoom(payload.topic));});
});
server.listen(Number(url.port),url.hostname);
process.on("SIGTERM",()=>{io.close();server.close();void app.close().finally(()=>process.exit(0));});
