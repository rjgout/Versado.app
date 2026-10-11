import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { analyseIdentities, collectInventory } from "../scripts/content-architecture/inventory.mjs";
const collection = (id, work, editionKey = "default", language = "nl") => ({ id, work, editionKey, language });
test("bekende werken, talen en editie-families worden zonder recreatie geïnventariseerd", () => {
  const result = analyseIdentities([collection("a", "bofm"), collection("b", "bofm", "default", "en"), collection("c", "bofm", "other"), collection("d", "fsy"), collection("e", "podcasts")]);
  assert.equal(result.works.find(w => w.key === "bofm").suggestedKind, "SCRIPTURE");
  assert.equal(result.works.find(w => w.key === "fsy").suggestedKind, "STUDY_PROGRAM");
  assert.equal(result.works.find(w => w.key === "podcasts").suggestedKind, "OTHER");
  assert.deepEqual(result.issues, []);
});
test("onbekende werken en null-work blijven OTHER; geen classificatie op titel/id", () => {
  const result = analyseIdentities([collection("bofm", null), collection("other", "unknown")]);
  assert.ok(result.works.every(w => w.suggestedKind === "OTHER"));
  assert.deepEqual(result.nullWorkCollectionIds, ["bofm"]);
});
test("werkkeyconflict, lege identiteit en dubbele editie zijn expliciete blockers", () => {
  const result = analyseIdentities([collection("legacy", null), collection("b", "legacy"), collection("c", "legacy"), collection("d", "")]);
  assert.ok(result.issues.some(i => i.type === "ambiguous-work-key"));
  assert.ok(result.issues.some(i => i.type === "duplicate-edition"));
  assert.ok(result.issues.some(i => i.type === "empty-identity"));
});
test("inventaris weigert een schrijfbare transactie en rolt die terug", async () => {
  const calls = [];
  await assert.rejects(collectInventory({ query: async sql => { calls.push(sql); return { rows: [{ transaction_read_only: "off" }] }; } }), /alleen-lezen/);
  assert.equal(calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(calls.at(-1), "ROLLBACK");
});
test("inventaris gebruikt uitsluitend SELECT binnen een read-only transactie", async () => {
  const calls = [];
  await collectInventory({ query: async sql => {
    calls.push(sql);
    if (sql.includes("current_setting")) return { rows: [{ transaction_read_only: "on" }] };
    if (sql.includes("count(*)::text AS count")) return { rows: [{ count: "0" }] };
    if (sql.includes('FROM "FsyLesson"') || sql.includes("booksWithoutCollection")) return { rows: [{}] };
    return { rows: [] };
  } });
  assert.equal(calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(calls.at(-1), "COMMIT");
  assert.ok(calls.slice(1, -1).every(sql => /^SELECT\b/.test(sql)));
});
test("een verbindingsfout exporteert geen URL, gebruikersnaam of wachtwoord", () => {
  const result = spawnSync(process.execPath, ["scripts/content-architecture/inventory.mjs", "/tmp/unused-content-inventory.json"], {
    env: { ...process.env, CONTENT_INVENTORY_DATABASE_URL: "postgresql://secret-user:secret-password@127.0.0.1:1/not-real" },
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /Inventarisatie mislukt/);
  for (const secret of ["secret-user", "secret-password", "postgresql://"]) assert.ok(!output.includes(secret));
});
