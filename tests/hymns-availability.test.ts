import test from "node:test";
import assert from "node:assert/strict";
import { getHymnsAccess } from "../src/lib/hymnAvailability";
import { loadHymnIndex } from "../src/lib/hymnLibraryClient";

test("centrale beschikbaarheid leest de actuele backendkeuze; noodstop en sessie gaan voor", async () => {
  const saved = process.env.HYMNS_POC;
  let visible = false, reads = 0;
  const db = { contentSwitcherSettings: { findUnique: async () => { reads++; return { hymnsVisibleToUsers: visible }; } } } as unknown as NonNullable<Parameters<typeof getHymnsAccess>[1]>;
  try {
    delete process.env.HYMNS_POC;
    assert.equal(await getHymnsAccess(null, db), "login");
    assert.equal(await getHymnsAccess({ isAdmin: true }, db), "allow");
    assert.equal(reads, 0);
    assert.equal(await getHymnsAccess({ isAdmin: false }, db), "hidden");
    visible = true;
    assert.equal(await getHymnsAccess({ isAdmin: false }, db), "allow");
    visible = false;
    assert.equal(await getHymnsAccess({ isAdmin: false }, db), "hidden");
    const before = reads;
    process.env.HYMNS_POC = "0";
    for (const actor of [null, { isAdmin: false }, { isAdmin: true }]) assert.equal(await getHymnsAccess(actor, db), "hidden");
    assert.equal(reads, before, "Noodstop benadert geen beschikbaarheidsdata");
  } finally {
    if (saved === undefined) delete process.env.HYMNS_POC; else process.env.HYMNS_POC = saved;
  }
});

test("een ontbrekende instelling is verborgen en een leesfout verleent geen toegang", async () => {
  const db = { contentSwitcherSettings: { findUnique: async () => null } } as unknown as NonNullable<Parameters<typeof getHymnsAccess>[1]>;
  assert.equal(await getHymnsAccess({ isAdmin: false }, db), "hidden");
  const unavailable = { contentSwitcherSettings: { findUnique: async () => { throw Error("database unavailable"); } } } as unknown as NonNullable<Parameters<typeof getHymnsAccess>[1]>;
  await assert.rejects(getHymnsAccess({ isAdmin: false }, unavailable));
});

test("een expliciete serverweigering gebruikt nooit de eerder opgeslagen bibliotheek", async () => {
  const original = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  let cacheReads = 0;
  const cached = { dataVersion: "old", value: [{ number: 1, title: "Voorheen beschikbaar" }] };
  const request = (result: unknown) => { const value = { result, onsuccess: null as null | (() => void) }; queueMicrotask(() => value.onsuccess?.()); return value; };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => request({ transaction: () => ({ objectStore: () => ({ get: () => { cacheReads++; return request(cached); } }) }) }) } });
  try {
    for (const status of [401, 403, 404]) {
      globalThis.fetch = async () => new Response(null, { status });
      await assert.rejects(loadHymnIndex(), new RegExp(`: ${status}$`));
    }
    assert.equal(cacheReads, 0);
  } finally {
    globalThis.fetch = original;
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor); else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
