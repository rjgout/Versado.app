import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";

const script = "scripts/test-accounts/seed-synthetic-friends.ts";
const run = (args: string[], env: Record<string, string> = {}) => spawnSync("npx", ["tsx", script, ...args], {
  encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: "postgresql://x:y@127.0.0.1:1/ongebruikt", ...env } as unknown as NodeJS.ProcessEnv,
});

test("de testvriendenvoorziening weigert zonder doelaccount, zonder testomgeving en zonder databasebevestiging", () => {
  assert.equal(run([]).status, 2);
  assert.match(run(["--voor=Eigenaar#42", "--apply"]).stderr, /VERSADO_TEST_OMGEVING=dev-test/);
  const wrong = run(["--voor=Eigenaar#42", "--apply", "--verwacht-database=elders:5432/prod"], { VERSADO_TEST_OMGEVING: "dev-test" });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /--verwacht-database=127\.0\.0\.1:1\/ongebruikt/);
  assert.equal(run(["--voor=Eigenaar#42", "--apply"], { VERSADO_TEST_OMGEVING: "production" }).status, 2);
});

test("niets in app-start, seed, migraties of deployment roept de testaccountvoorziening aan", () => {
  const hits = execSync("grep -rIl 'seed-synthetic-friends\\|VERSADO_TEST_OMGEVING' server.ts prisma src deploy docker-compose.yml .github package.json Dockerfile 2>/dev/null || true", { encoding: "utf8" }).trim();
  assert.equal(hits, "");
});
