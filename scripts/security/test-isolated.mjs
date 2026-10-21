import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, openSync, closeSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!existsSync(".next/BUILD_ID")) throw new Error("Voer eerst npm run db:generate en npm run build uit.");
const name = `versado-security-${process.pid}-${Date.now()}`;
const pgName = `${name}-db`, redisName = `${name}-redis`;
const temporary = mkdtempSync(join(tmpdir(), "versado-security-"));
const log = join(temporary, "server.log");
let server;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Docker mislukt");
  return result.stdout.trim();
}
async function run(command, args, env) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} eindigde met ${code}`);
}
try {
  docker(["run", "-d", "--name", pgName, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=security_test", "-e", "POSTGRES_PASSWORD=security_test", "-e", "POSTGRES_DB=versado_security_test", "postgres:16-alpine"]);
  docker(["run", "-d", "--name", redisName, "-p", "127.0.0.1::6379", "redis:7-alpine"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", pgName, "pg_isready", "-U", "security_test"]); docker(["exec", redisName, "redis-cli", "ping"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Eigen Postgres/Redis niet beschikbaar");
  const pgPort = docker(["port", pgName, "5432/tcp"]).split(":").at(-1);
  const redisPort = docker(["port", redisName, "6379/tcp"]).split(":").at(-1);
  const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const database = `postgresql://security_test:security_test@127.0.0.1:${pgPort}/versado_security_test`;
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), APP_URL: base, DATABASE_URL: database,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, SESSION_SECRET: "security-isolated-fixture-secret-not-for-production",
    SECURITY_TEST_BASE_URL: base, SECURITY_TEST_DATABASE_URL: database, LEARNING_TEST_DATABASE_URL: database,
    ALLOW_INSECURE_COOKIES: "true", FEEDBACK_RECIPIENT_EMAIL: "security-operator@test.invalid", NATIVE_API_ENABLED: "0", NEXT_TELEMETRY_DISABLED: "1" };
  await run("npm", ["run", "db:migrate:deploy"], env);
  // Ook een tweede deploy moet dezelfde database zonder wijzigingen accepteren.
  await run("npm", ["run", "db:migrate:deploy"], env);
  const descriptor = openSync(log, "w");
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], { env, detached: true, stdio: ["ignore", descriptor, descriptor] });
  closeSync(descriptor);
  ready = false;
  for (let i = 0; i < 90; i++) {
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).database === "ok") { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error("Appstart mislukt");
    await delay(500);
  }
  if (!ready) throw new Error("App niet gezond");
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/security-policy.test.ts", "tests/security-hardening.integration.test.ts", "tests/registration.integration.test.ts"], env);
  console.log("Beveiligingsregressies en bestaande registratieflow geslaagd; eigen testcontainers worden verwijderd.");
} catch (error) {
  if (existsSync(log)) process.stderr.write(readFileSync(log, "utf8").slice(-8000));
  console.error(error); process.exitCode = 1;
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch {}
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(3000)]);
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
  for (const container of [redisName, pgName]) spawnSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" });
}
