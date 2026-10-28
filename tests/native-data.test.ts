import assert from "node:assert/strict";
import test from "node:test";
import { NativeDataRuntime } from "../src/lib/data/native";
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
