// Echte Socket.IO/WebSocket-upgrade door de voorgestelde nginx-listener.
// Synthetische eenmalige bewijzen; echte backend-auth wordt door de bestaande socketintegraties getest.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const docker=(...args)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{encoding:'utf8',env:{...process.env,DOCKER_CONTEXT:'',DOCKER_HOST:'unix:///var/run/docker.sock'},stdio:['ignore','pipe','pipe']}).trim();
const root=mkdtempSync(join(tmpdir(),'versado-edge-ws-')),network=`versado-edge-${randomUUID()}`;
const containers=[],sockets=[],image=`versado-ws-test:${randomUUID()}`;
try {
  docker('build','-f','deploy/nginx/Dockerfile','--target','development','-t',image,'.');
  writeFileSync(join(root,'upstream.cjs'),`
    const {Server}=require('/deps/node_modules/socket.io');
    const http=require('node:http');
    const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});
    const io=new Server(server,{transports:['websocket']});
    const tickets=new Set(['synthetic-once','synthetic-fresh']);
    io.use((socket,next)=>{
      const h=socket.handshake;
      if(h.headers.origin!=='capacitor://localhost'||h.headers.cookie||h.headers.authorization||h.headers['cf-access-client-secret']||h.auth.client!=='native-v1'||!tickets.delete(h.auth.ticket)||Object.keys(h.query).some(k=>!['EIO','transport'].includes(k)))return next(new Error('proof_denied'));
      next();
    });
    io.on('connection',s=>s.on('check',ack=>ack({actor:'synthetic-A',transport:s.conn.transport.name})));
    server.listen(3000,'0.0.0.0',()=>console.log('SYNTHETIC_READY'));
  `);
  docker('network','create',network);
  containers.push(docker('run','-d','--rm','--network',network,'--network-alias','jehova-app','-v',`${resolve('node_modules')}:/deps/node_modules:ro`,'-v',`${root}/upstream.cjs:/test/upstream.cjs:ro`,'node:24-alpine','node','/test/upstream.cjs'));
  containers.push(docker('run','-d','--rm','--network',network,'-p','127.0.0.1::8081',image));
  const port=Number(docker('port',containers[1],'8081/tcp').split(':').at(-1));
  const connect=(ticket,origin='capacitor://localhost')=>new Promise((resolve,reject)=>{
    const socket=io(`http://127.0.0.1:${port}`,{path:'/socket.io',transports:['websocket'],forceNew:true,reconnection:false,timeout:10000,auth:{client:'native-v1',ticket},extraHeaders:{Host:'api-test.versado.app',Origin:origin,Cookie:'untrusted-web-cookie', 'CF-Access-Client-Secret':'untrusted-service-header'}});
    sockets.push(socket);socket.once('connect',()=>resolve(socket));socket.once('connect_error',reject);
  });
  // Wacht op beide lokale processen zonder een beveiligingsfout als readinesssignaal te gebruiken.
  let ready=false;
  for(let i=0;i<50;i++){
    const output=docker('logs',containers[1]);
    if(output.includes('Configuration complete')&&docker('logs',containers[0]).includes('SYNTHETIC_READY')){ready=true;break;}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(ready,true,'synthetische upstream en nginx moeten beide gestart zijn');
  const first=await connect('synthetic-once');
  const result=await first.timeout(3000).emitWithAck('check');
  assert.deepEqual(result,{actor:'synthetic-A',transport:'websocket'});first.disconnect();
  await assert.rejects(connect('synthetic-once'),/proof_denied/);
  const fresh=await connect('synthetic-fresh');assert.equal(fresh.connected,true);fresh.disconnect();
  await assert.rejects(connect('synthetic-invalid','https://dev.versado.app'));
  console.log('Echte Socket.IO via nginx: upgrade, auth-pakket zonder querybewijs, cookie/CF-verwijdering, replayweigering, vers bewijs en originweigering geslaagd. Alleen synthetische backendauthenticatie.');
} finally {
  for(const s of sockets)s.disconnect();
  for(const c of containers.reverse()){try{docker('rm','-f',c);}catch{}}
  try{docker('network','rm',network);}catch{}
  try{docker('image','rm',image);}catch{}
  rmSync(root,{recursive:true,force:true});
}
