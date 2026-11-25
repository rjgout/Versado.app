// Alleen de geïsoleerde speltestserver. Geen scheduler, seed of DEV-handeling.
import {createServer} from 'node:http';
import next from 'next';
import {getIO,initGameServer} from '../../src/server/gameServer.ts';
const url=new URL(process.env.NATIVE_TEST_BASE_URL??'http://invalid');
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(url.hostname!=='127.0.0.1'||database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test'||process.env.DATABASE_URL!==database.href)throw Error('Uitsluitend eigen lokale speltestomgeving');
const app=next({dev:false,hostname:url.hostname,port:Number(url.port)});await app.prepare();
const handle=app.getRequestHandler(),server=createServer((req,res)=>handle(req,res));
initGameServer(server);
// Een browser kan de WKWebView-Origin niet instellen. Alleen deze loopback-
// fixture simuleert die header voor de cookie-vrije native browser. Een echte
// webcookie houdt zijn weboorsprong; ticketclaim, sessies en handlers zijn echt.
server.prependListener('upgrade',(req)=>{if(req.url?.startsWith('/socket.io/')&&!req.headers.cookie&&/^http:\/\/127\.0\.0\.1:\d+$/.test(req.headers.origin??''))req.headers.origin='capacitor://localhost';});
server.listen(Number(url.port),url.hostname);
process.on('SIGTERM',()=>{getIO()?.close();server.close();void app.close().finally(()=>process.exit(0));});
