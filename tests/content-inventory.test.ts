import assert from "node:assert/strict";
import test from "node:test";
import { analyseIdentities, collectInventory, sanitizeInventory, INVENTORY_TABLES, INTEGRITY_KEYS } from "../src/lib/content-inventory/core";
import { inventoryOriginAllowed } from "../src/lib/content-inventory/origin";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const collection = (id: string, work: string | null = "bofm", language = "nl", editionKey = "default") => ({ id, work, language, editionKey, slug: id, enabled: true, visibleToUsers: true, publicationState: null });
const mock = (collections = [collection("bom")], readOnly = true) => ({ query: async (sql: string): Promise<{ rows: unknown[] }> => {
  assert.match(sql, /^SELECT\b/);
  if (sql.includes("transaction_read_only")) return { rows: [{ transaction_read_only: readOnly ? "on" : "off" }] };
  if (sql.includes("information_schema")) return { rows: [] };
  if (sql.includes("to_jsonb")) return { rows: collections };
  if (sql.includes("FROM \"_prisma_migrations\"")) return { rows: [{ migration_name: "migration", checksum: "checksum", started_at: new Date(0), finished_at: null, rolled_back_at: null, applied_steps_count: 0, logs: "SECRET" }] };
  if (sql.includes("AS \"booksWithoutCollection\"")) return { rows: [Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, "0"]))] };
  if (sql.includes('AS "publishedStatus"')) return { rows: [{ total: "1", published: "1", publishedStatus: "0", drafts: "1", draftWithPublishedCopy: "1" }] };
  return { rows: [{ count: "2", privateData: "SECRET" }] };
} });

test("meerdere edities/talen delen uitsluitend een werk; podcasts en onbekend OTHER", () => {
  const result = analyseIdentities([collection("bom-nl"), collection("bom-en", "bofm", "en"), collection("bom-alt", "bofm", "nl", "alt"), collection("pod", "podcasts"), collection("unknown", "new-source"), collection("fsy", "fsy")]);
  assert.equal(result.works.find((w) => w.key === "bofm")?.collections.length, 3);
  assert.equal(result.works.find((w) => w.key === "fsy")?.suggestedKind, "STUDY_PROGRAM");
  for (const key of ["new-source", "podcasts"]) assert.equal(result.works.find((w) => w.key === key)?.suggestedKind, "OTHER");
  assert.deepEqual(result.issues, []);
});
test("null-work, dubbele editie en botsende/lege identiteit worden gemeld", () => {
  const result = analyseIdentities([collection("key", null), collection("other", "key"), collection("duplicate", "key"), collection("empty", "")]);
  assert.deepEqual(result.nullWorkCollectionIds, ["key"]);
  for (const type of ["ambiguous-work-key", "duplicate-edition", "empty-identity"]) assert.ok(result.issues.some((i) => i.type === type));
});
test("lege catalogus, counts, FSY-concept met kopie en onafgeronde migratie", async () => {
  const report = await collectInventory(mock([]));
  assert.equal(report.collections.length, 0); assert.equal(report.readOnly, true);
  assert.equal(report.publicationFieldPresent, false);
  for (const table of INVENTORY_TABLES) assert.equal(report.counts[table], "2");
  assert.equal(report.fsy.draftWithPublishedCopy, "1");
  assert.equal(report.migrations[0].finished_at, null);
});
test("uitsluitend SELECT; schrijfbare transactie geweigerd", async () => {
  await assert.rejects(collectInventory(mock([], false)), /READ_ONLY_REQUIRED/);
  await collectInventory(mock());
});
test("allowlist saneert geneste response en export, inclusief migratielogs", async () => {
  const report = await collectInventory(mock());
  const result = sanitizeInventory({ ...report, passwordHash: "SECRET", users: [{ email: "SECRET" }], collections: report.collections.map((c) => ({ ...c, connectionString: "SECRET" })), counts: { ...report.counts, noteText: "SECRET" } });
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.deepEqual(Object.keys(result.counts).sort(), [...INVENTORY_TABLES].sort());
});
test("onvolledige, verouderde, te grote of ongeldige data geeft geen schijnrapport", async () => {
  const report = await collectInventory(mock());
  assert.throws(() => sanitizeInventory({ ...report, counts: {} }));
  assert.throws(() => sanitizeInventory({ ...report, collections: Array(5001).fill(collection("x")) }));
  assert.throws(() => sanitizeInventory({ ...report, counts: { ...report.counts, User: "secret" } }));
  await assert.rejects(collectInventory({ query: async () => { throw new Error("missing table"); } }));
});
test("CLI-fout logt geen credentials of connection string", () => {
  const child = spawnSync(process.execPath, ["scripts/content-architecture/inventory.mjs", "/tmp/unwritten-inventory.json"], { encoding: "utf8", env: { ...process.env, CONTENT_INVENTORY_DATABASE_URL: "postgresql://secret-user:secret-pass@127.0.0.1:1/missing" } });
  assert.equal(child.status, 1); assert.doesNotMatch(child.stdout + child.stderr, /secret-user|secret-pass|postgresql:\/\//);
});
test("adminpagina gebruikt gedeelde bouwstenen; geen schema of migratie in dit werkpakket", () => {
  assert.match(readFileSync("src/app/adminbackend/content/page.tsx", "utf8"), /<AdminContentInventoryClient/);
  const source = readFileSync("src/components/AdminContentInventoryClient.tsx", "utf8");
  for (const component of ["AdminSection", "AdminTable", "AdminNotice"]) assert.ok(source.includes(component));
});

test("origin achter interne HTTP-proxy blijft publiek, zonder stilzwijgende andere host/poort", () => {
  const headers = new Headers({ host: "versado.test", origin: "https://versado.test", "sec-fetch-site": "same-origin" });
  assert.equal(inventoryOriginAllowed(headers, "http://localhost:3000/api/admin/content-inventory"), true);
  assert.equal(inventoryOriginAllowed(headers, "http://localhost:3000", "https://versado.test"), true);
  for (const origin of ["https://evil.test", "https://versado.test:444", "null", "https://versado.test/path", "https://versado.test/"]) {
    headers.set("origin", origin); assert.equal(inventoryOriginAllowed(headers, "http://localhost:3000"), false);
  }
  headers.delete("origin"); assert.equal(inventoryOriginAllowed(headers, "http://localhost:3000"), false);
  headers.set("origin", "https://versado.test"); headers.set("sec-fetch-site", "cross-site"); assert.equal(inventoryOriginAllowed(headers, "http://localhost:3000"), false);
  assert.equal(inventoryOriginAllowed(new Headers({ host: "localhost:3140", origin: "http://localhost:3140" }), "http://localhost:3140"), true);
});
