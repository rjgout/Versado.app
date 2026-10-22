import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import Redis from "ioredis";
import { prisma } from "../src/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { issueNativeSession } from "../src/lib/native/sessions";
import { socketTicketKey, createSocketTicket, consumeSocketTicket, closeSocketTicketStore } from "../src/lib/native/socketTickets";
import { NativeSessionClient } from "../src/lib/native/client";
import { NativeSocketConnection } from "../src/lib/native/socketClient";

const db = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (db.hostname !== "127.0.0.1" || db.pathname !== "/versado_content_access_test" || db.href !== process.env.DATABASE_URL) throw Error("Alleen eigen socketdatabase");
const a = process.env.NATIVE_SOCKET_TEST_A!, b = process.env.NATIVE_SOCKET_TEST_B!;
for (const base of [a,b]) if (new URL(base).hostname !== "127.0.0.1") throw Error("Alleen eigen socketservers");
const redis = new Redis(process.env.REDIS_URL!), sockets: Socket[] = [], connections: NativeSocketConnection[] = [];
const password = "Native-socket-synthetic-42", passwordHash = await hashPassword(password);
async function account() { return prisma.user.create({ data: { email: `socket-${randomUUID()}@example.invalid`, handle: `Socket${randomUUID().slice(0,8)}`, discriminator: "01", passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date() } }); }
async function api(path: string, data: unknown, token?: string, base = a) {
  const response = await fetch(`${base}/api/v1/native/${path}`, { method: "POST", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "Content-Type": "application/json", "x-real-ip": "127.0.0.45", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  return { response, data: await response.json() };
}
async function mint(token: string, base = a) { const result = await api("realtime/session", {}, token, base); assert.equal(result.response.status, 200); return result.data.socketTicket as string; }
function event(socket: Socket, name: string, timeout = 8000) {
  return new Promise<unknown>((resolve,reject) => { const timer = setTimeout(() => reject(Error(`Geen ${name}`)),timeout); socket.once(name, value => { clearTimeout(timer); resolve(value); }); });
}
async function open(ticket: string, base = a, origin: string | null = "capacitor://localhost", extra: Record<string, unknown> = {}) {
  const socket = io(base, { transports: ["websocket"], reconnection: false, autoConnect: false, auth: { client: "native-v1", ticket }, extraHeaders: origin ? { Origin: origin } : {}, ...extra });sockets.push(socket);
  const outcome = new Promise<boolean>((resolve,reject) => { const timer=setTimeout(()=>reject(Error("Geen handshake-uitkomst")),8000);socket.once("connect",()=>{clearTimeout(timer);resolve(true);});socket.once("connect_error",()=>{clearTimeout(timer);resolve(false);}); });
  socket.connect(); return { socket, connected: await outcome };
}
async function who(socket: Socket) { return socket.timeout(3000).emitWithAck("native_test:who") as Promise<{ userId: string }>; }
async function actions(base: string, id: string) { return (await (await fetch(`${base}/__native_test_actions`)).json())[id] ?? 0; }
afterEach(() => { for (const connection of connections.splice(0)) connection.dispose(); for (const socket of sockets.splice(0)) socket.disconnect(); });
after(async () => { await closeSocketTicketStore(); redis.disconnect(); await prisma.$disconnect(); });

test("API-bewijs is maximaal 60s en uitsluitend een handshakebewijs, geen tweede sessie", async () => {
  const user = await account(), pair = await issueNativeSession(user.id, 0), before = await prisma.nativeSession.count();
  const ticket = await mint(pair.accessToken); const ttl = await redis.pttl(socketTicketKey(ticket));assert.ok(ttl > 0 && ttl <= 60_000);
  const stored = await redis.get(socketTicketKey(ticket));assert.ok(stored && !stored.includes(ticket) && !stored.includes(pair.accessToken));
  assert.equal((await api("realtime/session", { userId: "other" }, pair.accessToken)).response.status, 400);
  assert.equal((await api("realtime/session", {})).response.status, 401);
  assert.equal((await api("realtime/session", {}, ticket)).response.status, 401);
  assert.equal((await api("refresh", { refreshToken: ticket, actionId: randomUUID() })).response.status, 401);
  const joined = await open(ticket);assert.equal(joined.connected, true);assert.equal((await who(joined.socket)).userId, user.id);
  assert.equal(await redis.get(socketTicketKey(ticket)), null);assert.equal(await prisma.nativeSession.count(), before);
  assert.equal((await open(ticket,b)).connected, false);
  const expired = await mint(pair.accessToken);await redis.pexpire(socketTicketKey(expired),1);await delay(20);assert.equal((await open(expired,b)).connected,false);
});

test("parallelle replay op twee echte processen krijgt precies één winnaar, ongeacht uitgevende instantie", async () => {
  const user=await account(),pair=await issueNativeSession(user.id,0);
  for(const issuer of [a,b]){
    const ticket=await mint(pair.accessToken,issuer),results=await Promise.all([open(ticket,a),open(ticket,b)]);
    assert.equal(results.filter(result=>result.connected).length,1);assert.equal((await who(results.find(result=>result.connected)!.socket)).userId,user.id);
    for(const result of results)result.socket.disconnect();
  }
});

test("native/web doel, origin en cookies blijven gescheiden zonder cookie-terugval",async()=>{
  const user=await account(),pair=await issueNativeSession(user.id,0),cookie=`${SESSION_COOKIE}=${await createSessionToken(user.id)}`;
  for(const token of [pair.accessToken,pair.refreshToken,await createSessionToken(user.id)])assert.equal((await open(token)).connected,false);
  const ticket=await mint(pair.accessToken);
  for(const origin of [null,"https://evil.invalid",a])assert.equal((await open(ticket,a,origin)).connected,false);
  const other=await account(),foreignCookie=`${SESSION_COOKIE}=${await createSessionToken(other.id)}`;
  const nativeWithCookie=await open(await mint(pair.accessToken),a,"capacitor://localhost",{extraHeaders:{Origin:"capacitor://localhost",Cookie:foreignCookie}});assert.equal(nativeWithCookie.connected,true);assert.equal((await who(nativeWithCookie.socket)).userId,user.id,"Een ambient webcookie van B verandert de native actor A nooit");
  for(const value of [pair.accessToken,pair.refreshToken,ticket])assert.equal((await open(ticket,a,a,{auth:{},extraHeaders:{Origin:a,Cookie:`${SESSION_COOKIE}=${value}`}})).connected,false);
  assert.equal((await open(ticket,a,"capacitor://localhost",{auth:{},extraHeaders:{Origin:"capacitor://localhost",Cookie:cookie}})).connected,false);
  assert.equal((await open(ticket,a,"capacitor://localhost",{query:{ticket}})).connected,false);
  assert.equal((await open(ticket,a,"https://localhost")).connected,true,"Android-origin gebruikt hetzelfde expliciete contract");
  const web=io(b,{transports:["websocket"],reconnection:false,autoConnect:false,extraHeaders:{Origin:a,Cookie:cookie}});sockets.push(web);const connected=event(web,"connect");web.connect();await connected;assert.equal((await who(web)).userId,user.id);
});

test("Redis-adapter verspreidt gebruikersupdates en logout verbreekt uitsluitend dezelfde native sessie op andere instantie",async()=>{
  const user=await account(),other=await account(),pair=await issueNativeSession(user.id,0),second=await issueNativeSession(user.id,0),foreign=await issueNativeSession(other.id,0);
  const sa=await open(await mint(pair.accessToken),a),sb=await open(await mint(second.accessToken),b),sc=await open(await mint(foreign.accessToken),b);
  for(const joined of [sa,sb,sc])assert.equal(joined.connected,true);
  const message=randomUUID(),received=event(sb.socket,"native_test:update");let leaked=false;sc.socket.on("native_test:update",()=>{leaked=true;});
  await sa.socket.timeout(3000).emitWithAck("native_test:broadcast",message);assert.equal(await received,message);await delay(100);assert.equal(leaked,false);
  const passive=event(sb.socket,"disconnect",3000);const loggedOut=await api("logout",{refreshToken:second.refreshToken,actionId:randomUUID()},undefined,a);assert.equal(loggedOut.response.status,200);await passive;
  assert.equal(sa.socket.connected,true);assert.equal(sc.socket.connected,true);assert.equal((await api("realtime/session",{},second.accessToken)).response.status,401);
});

test("berichtcontrole blokkeert een ingetrokken sessie vóór handleruitvoering en passieve controle ziet wijzigingen",async()=>{
  const user=await account(),pair=await issueNativeSession(user.id,0),joined=await open(await mint(pair.accessToken),b);assert.equal(joined.connected,true);
  await joined.socket.timeout(3000).emitWithAck("native_test:action");assert.equal(await actions(b,user.id),1);
  await prisma.nativeSession.update({where:{id:pair.refreshToken.split('.')[0]},data:{revokedAt:new Date()}});
  const disconnected=event(joined.socket,"disconnect");joined.socket.emit("native_test:action",()=>{});await disconnected;assert.equal(await actions(b,user.id),1);
  for(const patch of [{mustChangePassword:true},{totpEnabled:true}]){
    const actor=await account(),session=await issueNativeSession(actor.id,0),socket=await open(await mint(session.accessToken),b);assert.equal(socket.connected,true);
    const ended=event(socket.socket,"disconnect");await prisma.user.update({where:{id:actor.id},data:patch});await ended;
  }
  const actor=await account(),session=await issueNativeSession(actor.id,0),socket=await open(await mint(session.accessToken),b);const ended=event(socket.socket,"disconnect");await prisma.nativeSession.update({where:{id:session.refreshToken.split('.')[0]},data:{expiresAt:new Date(Date.now()+50)}});await ended;
});

test("wachtwoordwijziging en accountverwijdering sluiten gebruikersrooms over Redis; eerder uitgegeven tickets falen",async()=>{
  const user=await account(),pair=await issueNativeSession(user.id,0),second=await issueNativeSession(user.id,0),sa=await open(await mint(pair.accessToken),a),sb=await open(await mint(second.accessToken),b);
  const oldTicket=await mint(pair.accessToken),endedA=event(sa.socket,"disconnect",3000),endedB=event(sb.socket,"disconnect",3000);
  assert.equal((await api("account/password",{currentPassword:password,newPassword:"Native-changed-synthetic-43"},pair.accessToken)).response.status,200);await Promise.all([endedA,endedB]);assert.equal((await open(oldTicket,b)).connected,false);
  const actor=await account(),session=await issueNativeSession(actor.id,0),joined=await open(await mint(session.accessToken),b),unused=await mint(session.accessToken),ended=event(joined.socket,"disconnect",3000);
  const deleted=await fetch(`${a}/api/account`,{method:"DELETE",headers:{Origin:a,Cookie:`${SESSION_COOKIE}=${await createSessionToken(actor.id)}`}});assert.equal(deleted.status,200);await ended;assert.equal((await open(unused,b)).connected,false);assert.equal(await prisma.nativeSession.count({where:{userId:actor.id}}),0);
});

test("echte native client reconnect met vers bewijs behoudt actor en herhaalt geen actie; logout stopt transport meteen",async()=>{
  const user=await account();let stored:string|null=null;const tickets:string[]=[];
  const client=new NativeSessionClient(a,{async read(){return stored;},async write(value){stored=value;},async clear(){stored=null;}},async(input,init)=>{
    const headers=new Headers(init?.headers);headers.set("Origin","capacitor://localhost");headers.set("x-real-ip","127.0.0.46");const response=await fetch(input,{...init,headers});
    if(String(input).endsWith("/realtime/session")&&response.ok)tickets.push((await response.clone().json()).socketTicket);return response;
  });
  await client.login(user.email,password);
  const connection=new NativeSocketConnection(client,undefined,(_url,options)=>io(b,{...options,extraHeaders:{Origin:"capacitor://localhost"}}));connections.push(connection);
  const first=event(connection.socket,"connect");connection.start();await first;assert.equal((await who(connection.socket)).userId,user.id);await connection.socket.timeout(3000).emitWithAck("native_test:action");
  const next=event(connection.socket,"connect");connection.socket.io.engine.close();await next;assert.equal((await who(connection.socket)).userId,user.id);assert.equal(tickets.length,2);assert.notEqual(tickets[0],tickets[1]);assert.equal(await actions(b,user.id),1);
  assert.deepEqual(connection.socket.auth,{});const logout=client.logout();assert.equal(connection.socket.connected,false,"Lokale logout sluit vóór netwerk/opslagbevestiging");await logout;await delay(700);assert.equal(tickets.length,2);assert.equal(connection.socket.sendBuffer.length,0);
});

test("gewone refresh behoudt de verbinding; refresh-replay trekt dezelfde sessie over beide processen in",async()=>{
  const user=await account(),pair=await issueNativeSession(user.id,0),joined=await open(await mint(pair.accessToken),b);assert.equal(joined.connected,true);
  const rotated=await api("refresh",{refreshToken:pair.refreshToken,actionId:randomUUID()},undefined,a);assert.equal(rotated.response.status,200);assert.equal((await who(joined.socket)).userId,user.id);
  const ended=event(joined.socket,"disconnect",3000);const replay=await api("refresh",{refreshToken:pair.refreshToken,actionId:randomUUID()},undefined,a);assert.equal(replay.response.status,401);await ended;
  assert.equal((await api("realtime/session",{},rotated.data.accessToken)).response.status,401);
});

test("echte onbereikbare Redis geeft geen uitgifte of verbruik via een lokale noodopslag",async()=>{
  const previous=process.env.REDIS_URL;process.env.REDIS_URL="redis://127.0.0.1:1";
  try{
    await assert.rejects(createSocketTicket({userId:"synthetic",sessionId:randomUUID(),sessionVersion:0}),error=>typeof error==="object"&&error!==null&&"status" in error&&error.status===503);
    await assert.rejects(consumeSocketTicket("X".repeat(43)),error=>typeof error==="object"&&error!==null&&"status" in error&&error.status===503);
  }finally{await closeSocketTicketStore();if(previous===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous;}
});

test("vastgelopen databasecontrole sluit de verbinding gesloten af vóór een bericht wordt uitgevoerd",async()=>{
  const user=await account(),pair=await issueNativeSession(user.id,0),joined=await open(await mint(pair.accessToken),b);assert.equal(joined.connected,true);
  await prisma.$transaction(async tx=>{
    // Alleen de eigen wegwerpdatabase; een echte SELECT tijdelijk blokkeren.
    await tx.$executeRawUnsafe('LOCK TABLE "NativeSession" IN ACCESS EXCLUSIVE MODE');
    const ended=event(joined.socket,"disconnect",4000);joined.socket.emit("native_test:action",()=>{});await ended;assert.equal(await actions(b,user.id),0);
  });
});
