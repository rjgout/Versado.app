import assert from "node:assert/strict";
import test from "node:test";
import { NativeDataRuntime, nativeContentQueryKey } from "../src/lib/data/native";
import { NativeClientError, type NativeSessionClient } from "../src/lib/native/client";
import { serializeKey, type LiveEnvironment } from "../src/lib/data/store";

const chapter = { id: "synthetic-chapter", title: "Test", verses: [{ number: 1, text: "Synthetische tekst" }], state: { read: "UNREAD" } };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(api: (path: string) => Promise<unknown> = async () => chapter) {
  let online = true, visible = true, now = 0;
  const environment: LiveEnvironment = { now: () => now, isOnline: () => online, isVisible: () => visible, random: () => 0, schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } };
  const client = { api } as NativeSessionClient;
  const runtime = new NativeDataRuntime(client, environment);
  return { runtime, setOnline: (value: boolean) => { online = value; }, setVisible: (value: boolean) => { visible = value; }, age: () => { now += 60_000; } };
}

test("twee native lezers delen dezelfde bestaande cache-aanvraag; hoofdstukidentiteit blijft exact", async () => {
  let calls = 0;
  const { runtime } = fixture(async path => { calls++; assert.equal(path, "chapters/synthetic-chapter"); return chapter; });
  const key = ["native", 0, "chapter", chapter.id];
  const options = { scopes: ["content"] as const, fetcher: () => runtime.chapter(chapter.id) };
  const a = runtime.store.observe(key, options), b = runtime.store.observe(key, options);
  await flush(); assert.equal(calls, 1); assert.deepEqual(runtime.store.getSnapshot(serializeKey(key)).data, chapter);
  a.release(); b.release(); runtime.reset();
  await assert.rejects(runtime.chapter("../../account"), /invalid_input/);
  await assert.rejects(fixture(async () => ({ ...chapter, id: "ander-hoofdstuk" })).runtime.chapter(chapter.id), /invalid_response/);
});

test("offline en achtergrond halen niets op; hervatten herstelt alleen waargenomen data", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return chapter; });
  f.setOnline(false);
  const observer = f.runtime.store.observe(["reader"], { scopes: ["progress"], fetcher: () => f.runtime.chapter(chapter.id) });
  await flush(); assert.equal(calls, 0);
  f.setOnline(true); f.setVisible(false); f.runtime.resume(); await flush(); assert.equal(calls, 0);
  f.setVisible(true); f.runtime.resume(); await flush(); assert.equal(calls, 1);
  observer.release(); f.age(); f.runtime.resume(); await flush(); assert.equal(calls, 1);
});

test("mislukte mutation wordt nooit herhaald of beloond; succes invalideert uitsluitend gedeelde scopes", async () => {
  let reads = 0, mutations = 0;
  const { runtime } = fixture(async () => { reads++; return chapter; });
  const observer = runtime.store.observe(["reader"], { scopes: ["progress"], fetcher: () => runtime.chapter(chapter.id) });
  await flush();
  await assert.rejects(runtime.mutation(async () => { mutations++; throw new NativeClientError("network_unavailable"); }, "activityCompleted"));
  await flush(); assert.equal(mutations, 1); assert.equal(reads, 1);
  await runtime.mutation(async () => { mutations++; return { ok: true }; }, "activityCompleted");
  await flush(); assert.equal(reads, 2); assert.equal(mutations, 2); observer.release();
});

test("accountwisseling wist cache en een laat mutationantwoord kan de nieuwe accountscope niet invalideren", async () => {
  const { runtime } = fixture();
  runtime.store.setData(["native", 0, "chapter"], chapter);
  let finish!: (value: unknown) => void;
  const pending = runtime.mutation(() => new Promise(resolve => { finish = resolve; }), "activityCompleted");
  const old = runtime.getSnapshot(); runtime.reset();
  assert.equal(runtime.getSnapshot(), old + 1);
  assert.equal(runtime.store.getSnapshot(serializeKey(["native", runtime.getSnapshot(), "chapter"])).data, undefined);
  finish({ ok: true }); await assert.rejects(pending, /session_changed/);
});

test("late fetch van account A komt na reset nooit in de cache van account B", async () => {
  let finish!: (value: unknown) => void;
  const { runtime } = fixture();
  const keyA = ["native", runtime.getSnapshot(), "chapter"];
  const a = runtime.store.observe(keyA, { scopes: ["content"], fetcher: () => new Promise(resolve => { finish = resolve; }) });
  runtime.reset(); a.release();
  const keyB = ["native", runtime.getSnapshot(), "chapter"];
  finish(chapter); await flush();
  assert.equal(runtime.store.getSnapshot(serializeKey(keyB)).data, undefined);
  assert.equal(runtime.store.getSnapshot(serializeKey(keyA)).data, undefined);
});

test("native realtime volgt bestaande events, controleert payloads en ruimt listeners op", async () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = { on(name: string, fn: (...args: unknown[]) => void) { handlers.set(name, fn); }, off(name: string) { handlers.delete(name); } };
  let reads = 0;
  const { runtime } = fixture(async () => { reads++; return chapter; });
  const observer = runtime.store.observe(["reader"], { scopes: ["progress"], fetcher: () => runtime.chapter(chapter.id) });
  await flush();
  const detach = runtime.attachSocket(socket as never);
  handlers.get("data_event")?.({ event: "__proto__" }); await flush(); assert.equal(reads, 1);
  handlers.get("connect")?.(); await flush(); assert.equal(reads, 2);
  detach(); assert.equal(handlers.size, 0); observer.release();
});

test("focus, hervatten en onlineherstel dedupliceren; sessiewissel en opruimen legen de bestaande store", async () => {
  let reads = 0, sessionChanged: (() => void) | undefined;
  const client = { async api() { reads++; return chapter; }, onSessionChange(listener: () => void) { sessionChanged = listener; return () => { sessionChanged = undefined; }; } } as unknown as NativeSessionClient;
  const environment: LiveEnvironment = { now: () => 0, random: () => 0, isOnline: () => true, isVisible: () => true, schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } };
  const runtime = new NativeDataRuntime(client, environment), target = new EventTarget(), page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const stop = runtime.start(target as Window, page as unknown as Document);
  const observer = runtime.store.observe(["reader"], { scopes: ["content"], fetcher: () => runtime.chapter(chapter.id) });
  await flush(); assert.equal(reads, 1);
  target.dispatchEvent(new Event("focus")); await flush(); assert.equal(reads, 1, "Verse data bij focus blijft gedeeld");
  target.dispatchEvent(new Event("online")); target.dispatchEvent(new Event("versado:app-resumed"));
  await flush(); assert.equal(reads, 3, "Samenvallende hervattriggers worden na invalidatie begrensd opnieuw gecontroleerd");
  sessionChanged!(); assert.equal(runtime.store.getSnapshot(serializeKey(["reader"])).data, undefined);
  const epoch = runtime.getSnapshot(); observer.release(); stop();
  target.dispatchEvent(new Event("online")); target.dispatchEvent(new Event("versado:app-resumed"));
  await flush(); assert.equal(reads, 3); assert.equal(sessionChanged, undefined); assert.equal(runtime.getSnapshot(), epoch + 1);
});

function contentState(userId = "account-a", version = 1) {
  return { version: 1, userId, switcherEnabled: true, picker: { selection: { activeContentCollectionId: "source-nl", contentLanguage: "nl" }, activeCollectionId: "source-nl", selectionVersion: version, works: [] } };
}
const selectionInput = { contentCollectionId: "source-en", expectedSelection: contentState().picker.selection, expectedSelectionVersion: 1, location: "/dashboard" };

test("contentkeuze gebruikt hetzelfde contract; bevestiging invalideert de bestaande contentcache", async () => {
  let calls = 0;
  const { runtime } = fixture(async path => { assert.equal(path, "content-context"); calls++; return { state: contentState(), destination: "/dashboard", changed: true }; });
  let reads = 0;
  const observer = runtime.store.observe(["content"], { scopes: ["content"], fetcher: async () => ++reads });
  await flush(); assert.equal(reads, 1);
  assert.equal((await runtime.selectContent("account-a", selectionInput)).state.userId, "account-a");
  await flush(); assert.equal(reads, 2); assert.equal(calls, 1); observer.release(); runtime.reset();
});

test("late selectie na accountwisseling en een vervalste antwoordactor invalideren account B niet", async () => {
  let finish!: (value: unknown) => void;
  const { runtime } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = runtime.selectContent("account-a", selectionInput);
  runtime.reset();
  let reads = 0;
  const b = runtime.store.observe(["account-b-content"], { scopes: ["content"], fetcher: async () => ++reads });
  await flush();
  finish({ state: contentState("account-a"), destination: "/dashboard", changed: true });
  await assert.rejects(pending, /session_changed/); await flush(); assert.equal(reads, 1);
  b.release(); runtime.reset();
  const wrong = fixture(async () => ({ state: contentState("account-b"), destination: "/dashboard", changed: true }));
  let invalidations = 0;
  wrong.runtime.store.invalidate = () => { invalidations++; };
  await assert.rejects(wrong.runtime.selectContent("account-a", selectionInput), /session_changed/);
  assert.equal(invalidations, 0);
  await assert.rejects(fixture(async () => contentState("account-b")).runtime.contentContext("account-a"), /session_changed/);
});

test("mislukte contentselectie wordt nooit automatisch opnieuw geschreven of beloond", async () => {
  let writes = 0, invalidations = 0;
  const { runtime } = fixture(async () => { writes++; throw new NativeClientError("network_unavailable"); });
  runtime.store.invalidate = () => { invalidations++; };
  await assert.rejects(runtime.selectContent("account-a", selectionInput), /network_unavailable/);
  await flush(); runtime.resume(); await flush(); assert.equal(writes, 1); assert.equal(invalidations, 0);
});


test("een late context-GET van vóór selectie B kan de bevestigde gedeelde cache niet terugzetten naar A", async () => {
  let finish!: (value: unknown) => void;
  const { runtime } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const key = ["native", runtime.getSnapshot(), ...nativeContentQueryKey("account-a")];
  const observer = runtime.store.observe(key, { scopes: ["content"], fetcher: () => runtime.contentContext("account-a") });
  const confirmed = contentState("account-a", 2);
  confirmed.picker.activeCollectionId = "source-en";
  confirmed.picker.selection = { activeContentCollectionId: "source-en", contentLanguage: "en" };
  runtime.store.setData(key, confirmed);
  finish(contentState("account-a", 1)); await flush();
  assert.deepEqual(runtime.store.getSnapshot(serializeKey(key)).data, confirmed);
  observer.release(); runtime.reset();
});

test("native start de bestaande storeklok; contextpoll stopt verborgen, offline en na opruimen", async () => {
  let now = 0, online = true, calls = 0, timerId = 0;
  const timers = new Map<number, () => void>(), target = new EventTarget(), page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const environment: LiveEnvironment = { now: () => now, random: () => 0, isOnline: () => online, isVisible: () => page.visibilityState === "visible", schedule: fn => { const id = ++timerId; timers.set(id, fn); return () => { timers.delete(id); }; } };
  const client = { async api() { calls++; return contentState(); }, onSessionChange() { return () => {}; } } as unknown as NativeSessionClient;
  const runtime = new NativeDataRuntime(client, environment), stop = runtime.start(target as Window, page as unknown as Document);
  const key = ["native", 0, ...nativeContentQueryKey("account-a")];
  const query = runtime.store.observe(key, { scopes: ["content"], pollMs: 15_000, fetcher: () => runtime.contentContext("account-a") });
  const tick = async () => { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); entry[1](); await flush(); };
  await flush(); assert.equal(calls, 1);
  now = 16_000; await tick(); assert.equal(calls, 2);
  page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange")); assert.equal(timers.size, 0);
  now = 32_000; assert.equal(calls, 2);
  online = false; page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange")); await tick(); assert.equal(calls, 2);
  online = true; target.dispatchEvent(new Event("online")); await flush(); assert.equal(calls, 3);
  query.release(); stop(); assert.equal(timers.size, 0);
});

test("een reeds ontvangen oude GET mag een bevestiging in de volgende microtaak niet terugzetten", async () => {
  let finish!: (value: unknown) => void;
  const { runtime } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const key = ["native", runtime.getSnapshot(), ...nativeContentQueryKey("account-a")];
  const observer = runtime.store.observe(key, { scopes: ["content"], fetcher: () => runtime.contentContext("account-a") });
  const confirmed = contentState("account-a", 2);
  finish(contentState("account-a", 1));
  queueMicrotask(() => runtime.store.setData(key, confirmed));
  await flush();
  assert.deepEqual(runtime.store.getSnapshot(serializeKey(key)).data, confirmed);
  observer.release(); runtime.reset();
});
