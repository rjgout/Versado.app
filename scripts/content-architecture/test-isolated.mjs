// Eigen wegwerpdatabase met bestaande migraties; nooit productie, seeds of backups.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const container = `versado-content-inventory-test-${randomUUID()}`;
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
function docker(args) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], { env: dockerEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Docker mislukt");
  return result.stdout.trim();
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command}: ${code}`)));
  });
}
let server;
try {
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=inventory_test", "-e", "POSTGRES_PASSWORD=inventory_test", "-e", "POSTGRES_DB=versado_inventory_test", "postgres:16-alpine"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "inventory_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Testdatabase niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://inventory_test:inventory_test@127.0.0.1:${port}/versado_inventory_test`;
  const base = process.env.INVENTORY_TEST_BASE_URL ?? "http://localhost:3140";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("De testapp moet lokaal draaien");
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: url, LEARNING_TEST_DATABASE_URL: url,
    INVENTORY_TEST_BASE_URL: base, APP_URL: base, PORT: new URL(base).port, REDIS_URL: "",
    SESSION_SECRET: "inventory-isolated-test-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("npm", ["run", "db:generate"], env);
  server = spawn("npx", ["tsx", "scripts/content-architecture/serve-test.mjs"], { env, stdio: "inherit", detached: true });
  let available = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { available = true; break; } } catch {}
    await delay(500);
  }
  if (!available) throw new Error("Productie-app niet beschikbaar");
  await run("npx", ["tsx", "tests/content-inventory.integration.mjs"], env);
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
}
