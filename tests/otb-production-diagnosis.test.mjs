import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = "scripts/content-architecture/diagnose-otb-production-readonly.mjs";

test("OTB-productiediagnose weigert zonder bewuste read-only-bevestiging", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: {} });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--confirm-readonly/);
});

test("OTB-productiediagnose weigert zonder DATABASE_URL vóór een verbinding", () => {
  const result = spawnSync(process.execPath, [script, "--confirm-readonly"], { encoding: "utf8", env: {} });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DATABASE_URL ontbreekt/);
});

test("OTB-productiediagnose bevat uitsluitend read-only transacties en begrensde rapportage", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /BEGIN TRANSACTION READ ONLY/);
  assert.match(source, /SHOW transaction_read_only/);
  assert.match(source, /statement_timeout/);
  assert.match(source, /lock_timeout/);
  assert.match(source, /flag: "wx"/);
  assert.match(source, /mode: 0o600/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/);
});
