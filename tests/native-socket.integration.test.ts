import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import Redis from "ioredis";
import { prisma } from "../src/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { activeNativeSession, issueNativeSession } from "../src/lib/native/sessions";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
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

async function gate(code: string, base: string) {
  const key = `native-test:gate:${new URL(base).port}:${code}`;
  await redis.set(key, "1", "EX", 30);
  return {
    async reached() { assert.ok(await redis.blpop(`${key}:reached`, 10), "De echte handler moet na de pakketcontrole zijn read bereiken"); },
    async release() { await redis.lpush(`${key}:release`, "1"); },
  };
}
async function drained(id: string, name: string) {
  assert.ok(await redis.blpop(`native-test:done:${id}:${name}`, 10), "De echte handler moet volledig terugkeren");
}

for (const reason of ["logout", "refresh-replay", "account wissen", "wachtwoord", "andere sessie", "twee instanties"] as const) {
  test(`een lopende echte join_game mag na ${reason} geen nieuwe deelnemer vastleggen`, async () => {
    const user = await account(), host = await account(), pair = await issueNativeSession(user.id, 0);
    const code = `RACE${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const game = await prisma.liveGame.create({ data: { code, hostId: host.id, mode: "FAMILY_GAME", familyGameDiceMode: "DIGITAL" } });
    const targets = reason === "twee instanties" ? [a, b] : [b];
    const pending = [];
    for (const base of targets) {
      const joined = await open(await mint(pair.accessToken), base);
      assert.equal(joined.connected, true);
      const id = joined.socket.id!, barrier = await gate(code, base);
      joined.socket.emit("join_game", { code });
      await barrier.reached();
      pending.push({ base, id, barrier });
    }
    // De intrekking COMMIT voordat de oude read terugkeert: geen actie was gecommit.
    if (reason === "refresh-replay") {
      assert.equal((await api("refresh", { refreshToken: pair.refreshToken, actionId: randomUUID() })).response.status, 200);
      assert.equal((await api("refresh", { refreshToken: pair.refreshToken, actionId: randomUUID() })).response.status, 401);
    } else if (reason === "account wissen") {
      const result = await fetch(`${a}/api/account`, { method: "DELETE", headers: { Origin: a, Cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}` } });
      assert.equal(result.status, 200);
    } else if (reason === "wachtwoord") {
      assert.equal((await api("account/password", { currentPassword: password, newPassword: "Native-race-changed-43" }, pair.accessToken)).response.status, 200);
    } else {
      assert.equal((await api("logout", { refreshToken: pair.refreshToken, actionId: randomUUID() })).response.status, 200);
    }
    let replacement: Socket | undefined;
    if (reason === "andere sessie") {
      const next = await issueNativeSession(user.id, 0);
      replacement = (await open(await mint(next.accessToken), b)).socket;
    }
    for (const item of pending) await item.barrier.release();
    for (const item of pending) await drained(item.id, "join_game");
    assert.equal(await prisma.liveGamePlayer.count({ where: { gameId: game.id, userId: user.id } }), 0, "Een ingetrokken actie mag geen nieuwe DB-deelname aanmaken");
    // Ook een geschrapt account mag niet als spookspeler in het geheugen terugkeren.
    const hostPair = await issueNativeSession(host.id, 0);
    for (const base of targets) {
      const observer = (await open(await mint(hostPair.accessToken), base)).socket;
      const update = event(observer, "lobby_update"); observer.emit("join_game", { code });
      const state = await update as { players: { userId: string }[] };
      assert.equal(state.players.some(player => player.userId === user.id), false);
    }
    if (replacement) {
      const update = event(replacement, "lobby_update"); replacement.emit("join_game", { code }); await update;
      assert.equal(await prisma.liveGamePlayer.count({ where: { gameId: game.id, userId: user.id } }), 1, "De nieuwe sessie mag zelf opnieuw deelnemen");
    }
  });
}

test("een lopende cancel_game mag na gecommitte logout geen lobby meer verwijderen", async () => {
  const user = await account(), pair = await issueNativeSession(user.id, 0);
  const code = `RACE${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const game = await prisma.liveGame.create({ data: { code, hostId: user.id, mode: "FAMILY_GAME" } });
  const peer = (await open(await mint(pair.accessToken), b)).socket, id = peer.id!;
  const barrier = await gate(code, b);
  peer.emit("cancel_game", { code }); await barrier.reached();
  assert.equal((await api("logout", { refreshToken: pair.refreshToken, actionId: randomUUID() })).response.status, 200);
  await barrier.release(); await drained(id, "cancel_game");
  assert.equal(await prisma.liveGame.count({ where: { id: game.id } }), 1);
});

test("sessieverloop tijdens een geblokkeerde deelnamewrite rolt de write terug", async () => {
  const user = await account(), host = await account(), pair = await issueNativeSession(user.id, 0);
  const code = `RACE${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const game = await prisma.liveGame.create({ data: { code, hostId: host.id, mode: "FAMILY_GAME" } });
  const peer = (await open(await mint(pair.accessToken), b)).socket, id = peer.id!;
  const barrier = await gate(code, b); peer.emit("join_game", { code }); await barrier.reached();
  const expiry = new Date(Date.now() + 1000);
  await prisma.nativeSession.update({ where: { id: pair.refreshToken.split(".")[0] }, data: { expiresAt: expiry } });
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "LiveGamePlayer" IN ACCESS EXCLUSIVE MODE`;
    await barrier.release();
    let blocked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const waiting = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE pid != pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%LiveGamePlayer%'`;
      if (Number(waiting[0].n) > 0) { blocked = true; break; }
      await delay(10);
    }
    assert.ok(blocked, "De domeinwrite moet werkelijk op PostgreSQL wachten terwijl de sessie nog geldig is");
    await delay(Math.max(0, expiry.getTime() - Date.now()) + 30);
  }, { timeout: 5000 });
  await drained(id, "join_game");
  assert.equal(await prisma.liveGamePlayer.count({ where: { gameId: game.id, userId: user.id } }), 0);
});

test("dezelfde live-vraag mag over twee instanties hoogstens één hintbeloning geven", async () => {
  const user = await account(), pair = await issueNativeSession(user.id, 0);
  await prisma.book.create({ data: { slug: `socket-reward-${randomUUID()}`, name: "Synthetische beloningsproef", order: 1, contentCollectionId: "content_bom", chapters: { create: { number: 1, order: 1, heading: `Synthetische vraag ${randomUUID()}` } } } });
  const code = `REWARD${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  await prisma.liveGame.create({ data: { code, hostId: user.id, mode: "CHAPTER_GUESS", level: "BEGINNER", questionCount: 1 } });
  const peers = [];
  // Beide instanties laden dezelfde lobby vóór een van beide start.
  for (const base of [a, b]) {
    const peer = (await open(await mint(pair.accessToken), base)).socket;
    const lobby = event(peer, "lobby_update"); peer.emit("join_game", { code }); await lobby;
    peers.push(peer);
  }
  const questions = await Promise.all(peers.map(async peer => {
    const question = event(peer, "question"); peer.emit("start_game");
    return await question as { index: number; introText: string };
  }));
  assert.deepEqual(questions.map(question => question.index), [0, 0]);
  assert.equal(questions[0].introText, questions[1].introText, "Beide instanties moeten dezelfde synthetische vraag verwerken");
  const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance;
  await Promise.all(peers.map(async (peer, index) => {
    const chapter = await prisma.chapter.findFirstOrThrow({ where: { heading: questions[index].introText } });
    const received = event(peer, "answer_received"); peer.emit("submit_answer", { given: [chapter.id] }); await received;
  }));
  // Beide bestaande fire-and-forget writes moeten klaar zijn vóór de meting.
  await Promise.all(peers.map(peer => peer.timeout(3000).emitWithAck("native_test:reward_drain")));
  const after = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance;
  assert.equal(after - before, 1, "Eén LiveGame/vraagindex/gebruiker mag niet tweemaal beloond worden");
  // De eigen wegwerpdatabase ruimt deze data op, nadat de servertimers stoppen.
});

test("meet de echte SQL-vorm van één native sessiecontrole in de wegwerpdatabase", async () => {
  const user = await account(), pair = await issueNativeSession(user.id, 0);
  const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.href }), log: [{ level: "query", emit: "event" }] });
  const queries: { query: string; params: string }[] = [];
  measured.$on("query", event => { queries.push({ query: event.query, params: event.params }); });
  try {
    await activeNativeSession({ userId: user.id, sessionId: pair.refreshToken.split(".")[0], sessionVersion: 0 }, measured);
    const selects = queries.filter(({ query }) => /^SELECT /i.test(query));
    assert.ok(selects.length > 0);
    assert.ok(selects.some(({ query }) => query.includes('"NativeSession"')));
    const indexes = await measured.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('NativeSession', 'User') AND indexname IN ('NativeSession_pkey', 'User_pkey')`;
    assert.equal(indexes.length, 2);
    const plans = [];
    type PlanNode = { "Node Type": string; "Index Name"?: string; Plans?: PlanNode[] };
    const nodes = (plan: PlanNode): { node: string; index?: string }[] => [{ node: plan["Node Type"], index: plan["Index Name"] }, ...(plan.Plans ?? []).flatMap(nodes)];
    for (const { query, params } of selects) {
      // SQL uit Prisma zelf, waarden blijven gebonden; uitsluitend eigen test-SELECTs.
      const explained = await measured.$queryRawUnsafe<{ "QUERY PLAN": { Plan: PlanNode; "Execution Time": number }[] }[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, ...JSON.parse(params));
      const plan = explained[0]["QUERY PLAN"][0];
      plans.push({ nodes: nodes(plan.Plan), executionMs: plan["Execution Time"] });
    }
    console.log("Native controle SQL-meting (geen capaciteitstest):", JSON.stringify({ selectsPerCheck: selects.length, primaryKeyIndexes: indexes.map(row => row.indexname).sort(), plans }));
  } finally { await measured.$disconnect(); }
});

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
