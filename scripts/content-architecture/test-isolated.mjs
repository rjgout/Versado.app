// Alleen eigen lokale containers. Omgevings-DATABASE_URL, Docker-context en proddata worden niet gebruikt.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import pg from "pg";
import assert from "node:assert/strict";
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
async function fingerprint(client) {
  const result = {};
  for (const table of ["User", "Book", "Chapter", "Verse", "Course", "ContentProgress", "Bookmark", "Highlight", "Note", "ReadingSession", "StreakActivity", "StreakDay", "XPTransaction", "FsyLesson", "PodcastPlaybackProgress", "PodcastEpisodeProgress"]) {
    result[table] = (await client.query(`SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id), '')) AS hash FROM "${table}" t`)).rows[0].hash;
  }
  return result;
}
let server, source, restored;
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
    CONTENT_ACCESS_TEST_BASE_URL: base, APP_URL: base, REDIS_URL: "", SESSION_SECRET: "content-access-isolated-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  // Alleen bestaande main-migraties op een verse eigen database. Geen nieuwe ContentWork-DDL.
  await run("npm", ["run", "db:migrate:deploy"], env);
  server = spawn("node", ["scripts/content-architecture/test-server.mjs"], { env, stdio: "inherit", detached: true });
  let healthy = false;
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error("Geïsoleerde testserver gestopt");
    await delay(500);
  }
  if (!healthy) throw new Error("Productie-routehandler niet beschikbaar");
  await run("npx", ["tsx", "--test", "tests/content-access.test.ts", "tests/content-inventory.test.mjs", "tests/content-access.integration.test.ts"], env);
  source = new pg.Client({ connectionString: database }); await source.connect();
  const before = await collectInventory(source), protectedBefore = await fingerprint(source);
  assert.equal(before.identities.issues.length, 0);
  assert.ok(Number(before.counts.Note) > 0, "Herstelproef bevat daadwerkelijk privénotities");
  const dump = docker(["exec", container, "pg_dump", "-U", "content_access_test", "-d", "versado_content_access_test", "--format=custom", "--no-owner", "--no-privileges"], undefined, true);
  docker(["exec", container, "createdb", "-U", "content_access_test", "versado_content_access_restore"]);
  docker(["exec", "-i", container, "pg_restore", "-U", "content_access_test", "-d", "versado_content_access_restore", "--exit-on-error", "--no-owner", "--no-privileges"], dump);
  restored = new pg.Client({ connectionString: database.replace("/versado_content_access_test", "/versado_content_access_restore") }); await restored.connect();
  assert.deepEqual(await collectInventory(restored), before);
  assert.deepEqual(await fingerprint(restored), protectedBefore);
  console.log(JSON.stringify({ isolatedFixtureRestore: "passed", dumpSha256: createHash("sha256").update(dump).digest("hex"), schemaAndCountsEqual: true, protectedRecordsEqual: true, productionBackupVerified: false }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  await source?.end(); await restored?.end();
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
}
