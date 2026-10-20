// Alleen eigen lokale containers. Omgevings-DATABASE_URL, Docker-context en proddata worden niet gebruikt.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import pg from "pg";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { collectInventory } from "./inventory.mjs";

if (process.argv.includes("--annotations") && !process.argv.includes("--focused")) throw new Error("Annotatiefixtures vereisen een eigen wegwerpdatabase; gebruik npm run test:annotations:integration naast de bestaande regressies.");
if (process.argv.includes("--study-reader") && process.argv.includes("--study-publication")) throw new Error("Reader- en publicatiefixtures vereisen ieder een eigen wegwerpdatabase; voer de bestaande suites afzonderlijk uit.");

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
let ownedPgVolumes=[];
const redisContainer = `${container}-redis`;
let hasRedis = false;
try {
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=content_access_test", "-e", "POSTGRES_PASSWORD=content_access_test", "-e", "POSTGRES_DB=versado_content_access_test", "postgres:16-alpine"]);
  ownedPgVolumes=JSON.parse(docker(["inspect",container]))[0].Mounts.filter(m=>m.Type==="volume").map(m=>m.Name);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "content_access_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Eigen testdatabase niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const database = `postgresql://content_access_test:content_access_test@127.0.0.1:${port}/versado_content_access_test`;
  const base = `http://127.0.0.1:${await freePort()}`;
  const mediaRoot=join(temporary,"study-media");mkdirSync(mediaRoot,{mode:0o700});
  writeFileSync(join(mediaRoot,".versado-study-volume.json"),JSON.stringify({version:1,purpose:"versado-study-media",volumeId:randomUUID()}),{mode:0o600});
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: database, CONTENT_ACCESS_TEST_DATABASE_URL: database,
    CONTENT_ACCESS_TEST_BASE_URL: base, LEARNING_TEST_DATABASE_URL: database, CONTENT_MIGRATION_TEST_STATE: join(temporary, "proof.json"), APP_URL: base, REDIS_URL: "", STUDY_MEDIA_DIR: mediaRoot, STUDY_MEDIA_TEST_ROOT: mediaRoot, STUDY_PUBLICATION_PROFILE: "synthetic-test", SESSION_SECRET: "content-access-isolated-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  // Eerst dezelfde 133 historische migraties via Prisma op de eigen lege DB.
  // Daarna synthetische bestaande records vóór de nieuwe additieve migratie.
  const migrationPath = join(temporary, "migrations");
  for (const name of readdirSync("prisma/migrations")) if (!["20261020120000_content_work_publication", "20261021120000_user_study_context", "20261027120000_quick_missionary_source", "20261028120000_mystery_attempt", "20261029120000_study_identity", "20261030120000_study_import_publication", "20261031120000_reading_position", "20261101120000_content_selection_version", "20261102120000_hymns_content_visibility", "20261103120000_study_publication_audit_actions", "20261104120000_annotation_targets", "20261117120000_annotation_resolution", "20261118120000_fsy_study_handover", "20261119120000_word_search_source_context", "20261121120000_study_step_progress", "20261123120000_study_step_plan_version"].includes(name)) cpSync(join("prisma/migrations",name),join(migrationPath,name),{recursive:true});
  const config = join(temporary,"prisma.config.mjs");
  const require = createRequire(import.meta.url);
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(require.resolve("prisma/config"))}; export default defineConfig({schema:${JSON.stringify(resolve("prisma/schema.prisma"))},migrations:{path:${JSON.stringify(migrationPath)}},datasource:{url:process.env.DATABASE_URL}});`);
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/content-work-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261020120000_content_work_publication",join(migrationPath,"20261020120000_content_work_publication"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/content-work-migration.mjs", "verify"], env);
  await run("node", ["tests/study-context-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261021120000_user_study_context",join(migrationPath,"20261021120000_user_study_context"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/study-context-migration.mjs", "verify"], env);
  await run("node", ["tests/quick-missionary-source-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261027120000_quick_missionary_source",join(migrationPath,"20261027120000_quick_missionary_source"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/quick-missionary-source-migration.mjs", "verify"], env);
  await run("node", ["tests/mystery-attempt-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261028120000_mystery_attempt",join(migrationPath,"20261028120000_mystery_attempt"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/mystery-attempt-migration.mjs", "verify"], env);
  await run("node", ["tests/study-identity-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261029120000_study_identity",join(migrationPath,"20261029120000_study_identity"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/study-identity-migration.mjs", "verify"], env);
  await run("node", ["tests/study-publication-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261030120000_study_import_publication",join(migrationPath,"20261030120000_study_import_publication"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/study-publication-migration.mjs", "verify"], env);
  await run("node", ["tests/reading-position-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261031120000_reading_position",join(migrationPath,"20261031120000_reading_position"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/reading-position-migration.mjs", "verify"], env);
  await run("node", ["tests/content-selection-version-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261101120000_content_selection_version",join(migrationPath,"20261101120000_content_selection_version"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/content-selection-version-migration.mjs", "verify"], env);
  await run("node", ["tests/hymns-visibility-migration.mjs", "prepare"], env);
  for (const name of ["20261102120000_hymns_content_visibility", "20261103120000_study_publication_audit_actions"]) cpSync(join("prisma/migrations",name),join(migrationPath,name),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/hymns-visibility-migration.mjs", "verify"], env);
  await run("node", ["tests/annotation-migration.mjs", "prepare"], env);
  for (const name of ["20261104120000_annotation_targets", "20261117120000_annotation_resolution"]) cpSync(join("prisma/migrations",name),join(migrationPath,name),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/annotation-migration.mjs", "verify"], env);
  await run("node", ["tests/fsy-conversion-migration.mjs", "prepare"], env);
  cpSync("prisma/migrations/20261118120000_fsy_study_handover",join(migrationPath,"20261118120000_fsy_study_handover"),{recursive:true});
  await run("npx", ["prisma", "migrate", "deploy", "--config", config], env);
  await run("node", ["tests/fsy-conversion-migration.mjs", "verify"], env);
  await run("node", ["tests/game-resolver-migration.mjs", "prepare"], env);
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("node", ["tests/game-resolver-migration.mjs", "verify"], env);
  await run("npm", ["run", "db:migrate:deploy"], env);
  if (process.argv.includes("--availability-performance")) {
    await run("npx", ["tsx", "scripts/content-architecture/benchmark-availability.mjs", ...(process.argv.includes("--assert-budget") ? ["--assert-budget"] : [])], env);
  } else if (process.argv.includes("--quick-missionary")) {
    const fixtureDb = new pg.Client({ connectionString: database }); await fixtureDb.connect();
    await fixtureDb.query(`DELETE FROM "QuickMissionaryReviveQuestion" WHERE id='qm-m-question'`); await fixtureDb.end();
    await run("npm", ["run", "test:snelle-zendeling"], env);
    await run("npm", ["run", "test:genees-economy"], env);
    await run("npx", ["tsx", "--test", "tests/quick-missionary-source.integration.test.ts", "tests/snelle-zendeling-solo-isolation.test.ts"], env);
    docker(["run", "--rm", "-d", "--name", redisContainer, "-p", "127.0.0.1::6379", "redis:7-alpine"]); hasRedis = true;
    const redisPort = docker(["port", redisContainer, "6379/tcp"]).split(":").at(-1);
    env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
    await run("npx", ["tsx", "--test", "tests/quick-missionary-source.multi-instance.test.mjs"], env);
  } else {
    server = spawn("node", ["scripts/content-architecture/test-server.mjs"], { env, stdio: "inherit", detached: true });
    let healthy = false;
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
      if (server.exitCode !== null) throw new Error("Geïsoleerde testserver gestopt");
      await delay(500);
    }
    if (!healthy) throw new Error("Productie-routehandler niet beschikbaar");
    if (process.argv.includes("--mystery")) {
      await run("npx", ["tsx", "--test", "tests/mystery-attempt.integration.test.ts"], env);
      await run("npx", ["tsx", "tests/fixtures/mystery-learning.mjs"], env);
      for (const suite of ["test:kompas", "test:time", "test:learning", "test:streak-return", "test:streak-calendar"]) await run("npm", ["run", suite], env);
      if (process.argv.includes("--browser")) await run("npx", ["tsx", "tests/mystery-attempt.browser.mjs"], env);
    } else if (!process.argv.includes("--focused")) {
    await run("npx", ["tsx", "--test", "tests/content-access.test.ts", "tests/content-inventory.test.ts", "tests/content-inventory-validation.test.mjs", "tests/content-access.integration.test.ts", "tests/content-switch.integration.test.ts"], env);
    await run("npx", ["tsx", "--test", "tests/course-sync.integration.test.ts"], env);
    // Apart: fingerprints over alle oude tabellen en een tijdelijke fouttrigger mogen
    // niet samenvallen met fixtures van andere testprocessen.
    await run("npx", ["tsx", "--test", "tests/study-context.test.ts", "tests/study-context.integration.test.ts"], env);
    await run("npx", ["tsx", "--test", "tests/content-picker.test.ts", "tests/content-picker.integration.test.ts"], env);
    await run("npx", ["tsx", "--test", "tests/game-availability.test.ts", "tests/game-availability.integration.test.ts"], env);
    }
    if ((process.argv.includes("--study-content") || process.argv.includes("--study-publication")) && !process.argv.includes("--focused")) {
      await run("npx", ["tsx", "--test", "tests/study-content.test.ts", "tests/study-content.integration.test.ts"], env);
      await run("npx", ["tsx", "tests/fixtures/mystery-learning.mjs"], env);
      for (const suite of ["test:learning", "test:streak-return", "test:streak-calendar", "test:time"]) await run("npm", ["run", suite], env);
    }
  }
  if(process.argv.includes("--lesson-word-pools")) {
    await run("npx",["tsx","--test","tests/lesson-word-pool.test.ts","tests/lesson-word-pool.integration.test.mjs"],env);
  }
  if(process.argv.includes("--game-resolver")) {
    await run("npx",["tsx","--test","tests/game-resolver.test.ts"],env);
    await run("npx",["tsx","--test","tests/game-resolver.integration.test.mjs"],env);
    await run("npx",["tsx","--test","tests/game-availability.integration.test.ts","tests/game-availability.test.ts"],env);
  }
  if(process.argv.includes("--program-integration")) {
    await run("npx",["tsx","--test","tests/fsy-presentation.test.ts","tests/program-integration.test.mjs"],env);
    await run("npm",["run","test:kompas"],env);
    if(process.argv.includes("--browser")) await run("npx",["tsx","tests/program-integration.browser.mjs"],env);
  }
  if(process.argv.includes("--fsy-conversion")) {
    await run("npx",["tsx","--test","tests/fsy-conversion.integration.test.mjs"],env);
    if(process.argv.includes("--browser")) await run("npx",["tsx","tests/fsy-conversion.browser.mjs"],env);
  }
  if(process.argv.includes("--hymns")) {
    await run("npx",["tsx","--test","tests/hymns-availability.integration.test.mjs"],env);
    if(process.argv.includes("--browser")) await run("npx",["tsx","tests/hymns-availability.browser.mjs"],env);
  }
  if(process.argv.includes("--annotations")) {
    await run("npx",["tsx","--test","tests/annotation-foundation.integration.test.mjs"],env);
    await run("npx",["tsx","--test","tests/study-folder.integration.test.mjs"],env);
    await run("npx",["tsx","--test","tests/annotation-recovery.integration.test.mjs"],env);
    await run("npx",["tsx","--test","tests/annotation-resolution-migration.test.mjs"],env);
    if(process.argv.includes("--browser")){
      await run("npx",["tsx","tests/annotation-actions.browser.mjs"],env);
      await run("npx",["tsx","tests/reader-verse-menu.browser.mjs"],env);
      await run("npx",["tsx","tests/study-folder.browser.mjs"],env);
      await run("npx",["tsx","tests/study-folder-colors.browser.mjs"],env);
      await run("npx",["tsx","tests/annotation-recovery.browser.mjs"],env);
    }
  }
  if(process.argv.includes("--cfm-import")) {
    await run("npx",["tsx","--test","tests/cfm-2026-import.integration.test.mjs"],env);
    if(process.argv.includes("--browser")) await run("npx",["tsx","tests/cfm-2026-import.browser.mjs"],env);
  }
  if(process.argv.includes("--reference-preview")) {
    const longChapterOnly = process.argv.includes("--long-chapter-only");
    if (!longChapterOnly) await run("npx",["tsx","--test","tests/reference-resolver.integration.test.mjs"],env);
    if(process.argv.includes("--browser"))await run("npx",["tsx","tests/reference-preview.browser.mjs", ...(longChapterOnly ? ["--long-chapter-only"] : [])],env);
  }
  if(process.argv.includes("--study-reader")) {
    await run("npx",["tsx","--test","tests/reading-position.integration.test.ts"],env);
    if(process.argv.includes("--browser"))await run("npx",["tsx","tests/study-reader.browser.mjs"],env);
  }
  if(process.argv.includes("--study-read")) {
    await run("npx",["tsx","--test","tests/study-read-action.test.ts","tests/study-read.integration.test.ts"],env);
    if(process.argv.includes("--browser"))await run("npx",["tsx","tests/study-read.browser.mjs"],env);
  }
  if(process.argv.includes("--study-publication")) {
    await run("npx",["tsx","--test","tests/study-publication.integration.test.ts"],env);
    if(process.argv.includes("--browser"))await run("npx",["tsx","tests/study-publication.browser.mjs"],env);
    await run("node",["scripts/study-content/test-volume.mjs"],env);
  }
  if (!process.argv.includes("--availability-performance")) await run("npx", ["tsx", "scripts/content-architecture/benchmark-availability.mjs", "--assert-budget"], env);
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
  if (hasRedis) { try { docker(["rm", "-f", "-v", redisContainer]); } catch {} }
  try { docker(["rm", "-f", "-v", container]); } catch {}
  for(const volume of ownedPgVolumes)try{docker(["volume","rm",volume]);}catch{}
  rmSync(temporary,{recursive:true,force:true});
}
