// Alleen eigen lokale containers. Omgevings-DATABASE_URL, Docker-context en proddata worden niet gebruikt.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import pg from "pg";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { collectInventory } from "./inventory.mjs";

const container = `versado-content-access-${randomUUID()}`;
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
function docker(args, input, binary = false) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], { env: dockerEnv, input, ...(binary ? {} : { encoding: "utf8" }), maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error?.message || "Docker mislukt"));
  return binary ? result.stdout : result.stdout.trim();
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command}: ${code}`)));
  });
}
async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve)); return port;
}
const temporary = mkdtempSync(join(tmpdir(), "versado-content-migration-"));
let server, source;
try {
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=content_access_test", "-e", "POSTGRES_PASSWORD=content_access_test", "-e", "POSTGRES_DB=versado_content_access_test", "postgres:16-alpine"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "content_access_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Eigen testdatabase niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const database = `postgresql://content_access_test:content_access_test@127.0.0.1:${port}/versado_content_access_test`;
  const base = `http://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: database, CONTENT_ACCESS_TEST_DATABASE_URL: database,
    CONTENT_ACCESS_TEST_BASE_URL: base, LEARNING_TEST_DATABASE_URL: database, CONTENT_MIGRATION_TEST_STATE: join(temporary, "proof.json"), APP_URL: base, REDIS_URL: "", SESSION_SECRET: "content-access-isolated-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  // Eerst dezelfde 133 historische migraties via Prisma op de eigen lege DB.
  // Daarna synthetische bestaande records vóór de nieuwe additieve migratie.
  const migrationPath = join(temporary, "migrations");
  for (const name of readdirSync("prisma/migrations")) if (!["20261020120000_content_work_publication", "20261021120000_user_study_context"].includes(name)) cpSync(join("prisma/migrations",name),join(migrationPath,name),{recursive:true});
  const config = join(temporary,"prisma.config.mjs");
  const require = createRequire(import.meta.url);
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(require.resolve("prisma/config"))}; export default defineConfig({schema:${JSON.stringify(resolve("prisma/schema.prisma"))},migrations:{path:${JSON.stringify(migrationPath)}},datasource:{url:process.env.DATABASE_URL}});`);
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/content-work-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261020120000_content_work_publication",join(migrationPath,"20261020120000_content_work_publication"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/content-work-migration.mjs", "verify"], env);
  await run("node", ["tests/study-context-migration.mjs", "prepare"], env);
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("node", ["tests/study-context-migration.mjs", "verify"], env);
  await run("npm", ["run", "db:migrate:deploy"], env);
  server = spawn("node", ["scripts/content-architecture/test-server.mjs"], { env, stdio: "inherit", detached: true });
  let healthy = false;
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error("Geïsoleerde testserver gestopt");
    await delay(500);
  }
  if (!healthy) throw new Error("Productie-routehandler niet beschikbaar");
  await run("npx", ["tsx", "--test", "tests/content-access.test.ts", "tests/content-inventory.test.ts", "tests/content-inventory-validation.test.mjs", "tests/content-access.integration.test.ts", "tests/content-switch.integration.test.ts"], env);
  await run("npx", ["tsx", "--test", "tests/course-sync.integration.test.ts"], env);
  // Apart: fingerprints over alle oude tabellen en een tijdelijke fouttrigger mogen
  // niet samenvallen met fixtures van andere testprocessen.
  await run("npx", ["tsx", "--test", "tests/study-context.test.ts", "tests/study-context.integration.test.ts"], env);
  await run("npx", ["tsx", "--test", "tests/content-picker.test.ts", "tests/content-picker.integration.test.ts"], env);
  await run("npx", ["tsx", "--test", "tests/game-availability.test.ts", "tests/game-availability.integration.test.ts"], env);
  source = new pg.Client({ connectionString: database }); await source.connect();
  const inventory = await collectInventory(source);
  assert.equal(inventory.identities.issues.length, 0);
  assert.ok(Number(inventory.counts.Note) > 0, "Tests bevatten synthetische privénotities");
  assert.ok(Object.values(inventory.integrity).every(count => count === "0"));
  // De eigenaar heeft de aanvullende herstelproef bewust overgeslagen.
  // Ook deze runner maakt voortaan geen dump of herstelactie.
  console.log(JSON.stringify({ isolatedFixtureInventory: "passed", productionInventoryPerformed: false,
    backupCreated: false, restorePerformed: false, productionBackupVerified: false }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  await source?.end();
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
  rmSync(temporary,{recursive:true,force:true});
}
