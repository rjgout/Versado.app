import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { studyContextActionSchema, studyContextIdentity } from "../src/lib/studyContextContract";
import { scopesForEvent } from "../src/lib/data/scopes";
import { LiveDataStore, type LiveEnvironment } from "../src/lib/data/store";

test("strikt actiecontract: geen userId/preview, negatieve of onbegrensde versies of ongeldige actie-ID", () => {
  const good = { workKey: "fsy", activeLessonKey: "fsy:real-id", expectedVersion: 0, actionId: randomUUID() };
  assert.ok(studyContextActionSchema.safeParse(good).success);
  for (const change of [{ userId: "other" }, { isAdmin: true }, { preview: true }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: 2_147_483_647 }, { actionId: "retry" }, { workKey: "../user" }, { activeLessonKey: "" }]) {
    assert.ok(!studyContextActionSchema.safeParse({ ...good, ...change }).success);
  }
  assert.ok(studyContextActionSchema.safeParse({ ...good, activeLessonKey: null }).success);
});

test("studie-invalidatie raakt geen bestaande beloningen, voortgang of navigatiescopes", () => {
  assert.deepEqual(scopesForEvent("studyContextChanged"), ["studyContext", "studyContent"]);
});

test("een laat lesantwoord na contextwissel kan de nieuwe leskey niet vervuilen", async () => {
  const env: LiveEnvironment = { now: () => 100, isVisible: () => true, isOnline: () => true, random: () => 0, schedule: () => () => {} };
  const store = new LiveDataStore(env);
  let finish!: (value: string) => void;
  const a = studyContextIdentity({ workKey: "fsy", activeLessonKey: "fsy:a", version: 1 });
  const b = studyContextIdentity({ workKey: "fsy", activeLessonKey: "fsy:b", version: 2 });
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, studyContextIdentity({ workKey: "other-program", activeLessonKey: "fsy:a", version: 1 }));
  const old = store.observe(["lesson", a], { scopes: ["studyContent"], fetcher: () => new Promise<string>(resolve => { finish = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  const fresh = store.observe(["lesson", b], { scopes: ["studyContent"], fetcher: async () => "nieuwe les" });
  await new Promise(resolve => setImmediate(resolve));
  finish("oude les");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getSnapshot(fresh.entryKey).data, "nieuwe les");
  old.release(); fresh.release();
});
