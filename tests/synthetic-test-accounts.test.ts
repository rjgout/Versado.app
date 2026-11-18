import assert from "node:assert/strict";
import test from "node:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PRODUCTION_HOSTS, TEST_DATABASE_MARK, refusalReason, type GuardFacts } from "../scripts/test-accounts/guard";

const ok: GuardFacts = { database: "versado_test", databaseComment: TEST_DATABASE_MARK, appUrl: "https://test.example.org", userCount: 1 };

test("de testvoorziening staat alleen toe als de database zelf het testmerk draagt en elke andere voorwaarde klopt", () => {
  assert.equal(refusalReason(ok), null);
  // Een omgevingsvariabele of naam alleen is geen toestemming: het merk in de database is vereist.
  assert.match(refusalReason({ ...ok, databaseComment: null })!, /testmerk/);
  assert.match(refusalReason({ ...ok, databaseComment: "iets anders" })!, /testmerk/);
  assert.match(refusalReason({ ...ok, database: "versado" })!, /test/);
  assert.match(refusalReason({ ...ok, database: "bom" })!, /test/);
  assert.match(refusalReason({ ...ok, database: "latest" })!, /test/);
  for (const host of PRODUCTION_HOSTS) assert.match(refusalReason({ ...ok, appUrl: `https://${host}/` })!, /productiedomein/);
  assert.match(refusalReason({ ...ok, appUrl: "geen-url" })!, /ongeldig/);
  assert.match(refusalReason({ ...ok, userCount: 0 })!, /beheerder/);
});

test("de set bevat twee losse inlogidentiteiten, een lege lijst en de drie vriendschapsscenario's, uitsluitend op @example.invalid", () => {
  const source = readFileSync("scripts/test-accounts/seed-synthetic-friends.ts", "utf8");
  const emails = [...source.matchAll(/email: "([^"]+)"/g)].map(match => match[1]);
  assert.equal(emails.length, 5);
  assert.ok(emails.every(email => email.endsWith("@example.invalid")));
  assert.equal([...source.matchAll(/login: true/g)].length, 2);
  assert.match(source, /becomeFriendsViaInvite/);
  assert.equal([...source.matchAll(/createFriendRequestOnce\(tx, ids\./g)].length, 2);
  // Nooit een bestaand account wijzigen: alleen de vaste adressen, nooit een brede deleteMany.
  assert.doesNotMatch(source, /deleteMany|updateMany/);
  assert.match(source, /where: \{ email: \{ in: SET\.map/);
});

test("niets in app-start, seed, migraties of deployment roept de testaccountvoorziening aan", () => {
  const hits = execSync("grep -rIl 'seed-synthetic-friends\\|test-accounts/guard\\|versado-test-omgeving' server.ts prisma src deploy docker-compose.yml .github package.json Dockerfile 2>/dev/null || true", { encoding: "utf8" }).trim();
  assert.equal(hits, "");
});
