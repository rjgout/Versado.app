// Altijd een eigen tijdelijke PostgreSQL-container; geen externe DATABASE_URL.
// npm run test:puzzle:integration [-- --browser]
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const container = `versado-puzzle-test-${randomUUID()}`;
const dockerArgs = ["--host=unix:///var/run/docker.sock"];
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
function docker(args) {
  const result = spawnSync("docker", [...dockerArgs, ...args], { env: dockerEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Docker mislukt");
  return result.stdout.trim();
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} eindigde met ${code}`)));
  });
}
let server;
try {
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=puzzle_test", "-e", "POSTGRES_PASSWORD=puzzle_test", "-e", "POSTGRES_DB=versado_puzzle_test", "postgres:16-alpine"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(["exec", container, "pg_isready", "-U", "puzzle_test", "-d", "versado_puzzle_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("De geïsoleerde PostgreSQL-database werd niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://puzzle_test:puzzle_test@127.0.0.1:${port}/versado_puzzle_test`;
  const env = { ...process.env, DATABASE_URL: url, LEARNING_TEST_DATABASE_URL: url, SESSION_SECRET: "puzzle-isolated-test-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("npm", ["run", "db:generate"], env);
  await run("npx", ["tsx", "--test", "tests/jigsaw.integration.test.ts", "tests/puzzle-solo.integration.test.ts"], env);
  if (process.argv.includes("--browser")) {
    const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
    env.PUZZLE_TEST_BASE_URL = base;
    env.PORT = new URL(base).port;
    env.APP_URL = base;
    env.REDIS_URL = ""; // Geen externe Redis gebruiken voor deze solotest.
    server = spawn("npx", ["tsx", "server.ts"], { env, stdio: "inherit", detached: true });
    let available = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { available = true; break; } } catch {}
      await delay(500);
    }
    if (!available) throw new Error("Testapp werd niet beschikbaar");
    await run("npx", ["tsx", "tests/puzzle-flow.browser.mjs"], env);
  }
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
}
