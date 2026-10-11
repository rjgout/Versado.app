// Alleen een eigen lokale PostgreSQL-container; geen productie-URL of accounts.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const container = `versado-word-hint-test-${randomUUID()}`;
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
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=word_hint_test", "-e", "POSTGRES_PASSWORD=word_hint_test", "-e", "POSTGRES_DB=versado_word_hint_test", "postgres:16-alpine"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "word_hint_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Testdatabase niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://word_hint_test:word_hint_test@127.0.0.1:${port}/versado_word_hint_test`;
  const base = process.env.WORD_HINT_TEST_BASE_URL ?? "http://localhost:3121";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("De testapp moet lokaal draaien");
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: url, LEARNING_TEST_DATABASE_URL: url,
    WORD_HINT_TEST_BASE_URL: base, APP_URL: base, PORT: new URL(base).port, REDIS_URL: "",
    SESSION_SECRET: "word-hint-isolated-test-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("npm", ["run", "db:generate"], env);
  await run("npx", ["tsx", "--test", "tests/word-game-hints.test.ts", "tests/word-game-hints.integration.test.ts"], env);
  await run("npm", ["run", "test:time"], env);
  if (process.argv.includes("--browser")) {
    server = spawn("npx", ["tsx", "server.ts"], { env, stdio: "inherit", detached: true });
    let available = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { available = true; break; } } catch {}
      await delay(500);
    }
    if (!available) throw new Error("Productie-app niet beschikbaar");
    await run("npx", ["tsx", "tests/word-game-hints.browser.mjs"], env);
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
}
