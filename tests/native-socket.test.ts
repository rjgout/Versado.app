import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSocketTicket, consumeSocketTicket, socketTicketKey, type SocketTicketStore } from "../src/lib/native/socketTickets";
import { socketOriginAllowed } from "../src/lib/native/socketAuth";

function storage() {
  const entries = new Map<string, string>(); let ttl = 0;
  const store: SocketTicketStore = {
    async put(key, value, seconds) { ttl = seconds; if (entries.has(key)) return false; entries.set(key, value); return true; },
    async take(key) { const found = entries.get(key) ?? null; entries.delete(key); return found; },
  };
  return { store, entries, ttl: () => ttl };
}
const binding = () => ({ userId: "synthetic-user", sessionId: randomUUID(), sessionVersion: 3 });
test("eenmalig socketbewijs heeft maximaal 60s, bewaart geen ruwe sleutel en bindt sessie/gebruiker/versie", async () => {
  const memory = storage(), identity = binding(), result = await createSocketTicket(identity, memory.store, 100_000);
  assert.equal(result.expiresIn, 60); assert.equal(memory.ttl(), 60); assert.match(result.socketTicket, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(![...memory.entries].flat().some(value => value.includes(result.socketTicket)));
  const outcomes = await Promise.allSettled([consumeSocketTicket(result.socketTicket, memory.store, 101_000), consumeSocketTicket(result.socketTicket, memory.store, 101_000)]);
  assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1); assert.deepEqual((outcomes.find(row => row.status === "fulfilled") as PromiseFulfilledResult<unknown>).value, identity);
});
test("verlopen, toekomstig, verkeerd doel, te lange geldigheid en corrupte records falen gesloten", async () => {
  for (const patch of [{ expiresAt: 100_000 }, { issuedAt: 110_000 }, { expiresAt: 200_000 }, { purpose: "native-access" }, { userId: "" }, { sessionId: "invalid" }]) {
    const memory = storage(), proof = await createSocketTicket(binding(), memory.store, 100_000), key = socketTicketKey(proof.socketTicket);
    memory.entries.set(key, JSON.stringify({ ...JSON.parse(memory.entries.get(key)!), ...patch }));
    await assert.rejects(consumeSocketTicket(proof.socketTicket, memory.store, 101_000)); assert.equal(memory.entries.size, 0);
  }
  const memory = storage(), proof = await createSocketTicket(binding(), memory.store);memory.entries.set(socketTicketKey(proof.socketTicket), "not-json");await assert.rejects(consumeSocketTicket(proof.socketTicket, memory.store));
  await assert.rejects(consumeSocketTicket("not-a-ticket", memory.store));
});
test("Redisproblemen leveren nooit een lokaal meervoudig bruikbaar noodticket", async () => {
  const store: SocketTicketStore = { async put() { throw Error("unavailable"); }, async take() { throw Error("unavailable"); } };
  await assert.rejects(createSocketTicket(binding(), store)); await assert.rejects(consumeSocketTicket("A".repeat(43), store));
});
test("web-originbeleid blijft bestaan; native origins vereisen geconfigureerde native realtime", () => {
  const before = process.env.NATIVE_API_ENABLED; process.env.NATIVE_API_ENABLED = "0";
  try { assert.equal(socketOriginAllowed("https://localhost", "https://example.invalid"), false);assert.equal(socketOriginAllowed("https://evil.invalid", "https://example.invalid"), false);assert.equal(socketOriginAllowed("https://example.invalid", "https://example.invalid"), true);assert.equal(socketOriginAllowed(undefined, "https://example.invalid"), true); }
  finally { if (before === undefined) delete process.env.NATIVE_API_ENABLED; else process.env.NATIVE_API_ENABLED = before; }
});

test("laat socketbewijs na logout opent geen verbinding of nieuwe-accountlisteners", async () => {
  const { EventEmitter } = await import("node:events"), { NativeSessionClient } = await import("../src/lib/native/client"), { NativeSocketConnection } = await import("../src/lib/native/socketClient");
  let stored: string | null = null, release!: (value: Response) => void, requested!: () => void;
  const pending = new Promise<Response>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { requested = resolve; });
  const client = new NativeSessionClient("https://example.invalid", { async read(){return stored;}, async write(value){stored=value;}, async clear(){stored=null;} }, async url => {
    if(String(url).endsWith("/realtime/session")){requested();return pending;}
    return new Response(JSON.stringify(String(url).endsWith("/login")?{accessToken:"A-access",refreshToken:"A-refresh",expiresIn:300}:{ok:true}));
  });
  await client.login("synthetic@example.invalid","synthetic-password");
  let attempts=0;const fake=Object.assign(new EventEmitter(),{connected:false,active:false,auth:{},sendBuffer:[],receiveBuffer:[],connect(){attempts++;return this;},disconnect(){return this;}});
  const connection=new NativeSocketConnection(client,undefined,()=>fake as unknown as import("socket.io-client").Socket);
  connection.start();await started;await client.logout();release(new Response(JSON.stringify({socketTicket:"S".repeat(43),expiresIn:60})));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(attempts,0);assert.equal(fake.listenerCount("connect"),0);assert.deepEqual(fake.auth,{});connection.dispose();
});

test("sessiewisselluisteraars kunnen niet met het oude toegangstoken in de nieuwe generatie aanvragen doen",async()=>{
  const { NativeSessionClient }=await import("../src/lib/native/client");let stored:string|null=null,oldRequests=0,check:Promise<unknown>|undefined;
  const client=new NativeSessionClient("https://example.invalid",{async read(){return stored;},async write(value){stored=value;},async clear(){stored=null;}},async url=>{if(String(url).endsWith("/me"))oldRequests++;return new Response(JSON.stringify({accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresIn:300}));});
  await client.login("a@example.invalid","synthetic");const stop=client.onSessionChange(()=>{check=assert.rejects(client.api("me"));});
  await client.login("b@example.invalid","synthetic");await check;assert.equal(oldRequests,0);stop();
});

test("logout kan een door een sessieluisteraar gestarte nieuwe login niet overschrijven",async()=>{
  const { NativeSessionClient }=await import("../src/lib/native/client");let stored:string|null=null,next:Promise<unknown>|undefined;
  const client=new NativeSessionClient("https://example.invalid",{async read(){return stored;},async write(value){stored=value;},async clear(){stored=null;}},async(url,init)=>{
    if(String(url).endsWith("/login")){const input=JSON.parse(String(init?.body));return new Response(JSON.stringify({accessToken:`${input.identifier}-access`,refreshToken:`${input.identifier}-refresh`,expiresIn:300}));}
    if(String(url).endsWith("/me"))return new Response(JSON.stringify({authorization:new Headers(init?.headers).get("authorization")}));
    return new Response(JSON.stringify({ok:true}));
  });
  await client.login("A","synthetic");let stop=()=>{};stop=client.onSessionChange(()=>{stop();next=client.login("B","synthetic");});
  await client.logout();await next;assert.equal((await client.api<{authorization:string}>("me")).authorization,"Bearer B-access");assert.equal(JSON.parse(stored!).refreshToken,"B-refresh");
});
