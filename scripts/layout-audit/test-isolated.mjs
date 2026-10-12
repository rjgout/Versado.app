// Wegwerpdatabase voor echte shell-/Woordzoeker-browsertests; nooit productie.
// Eerst een productiebuild, daarna npm run test:layout:browser [-- --probe].
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const container = `versado-layout-test-${randomUUID()}`;
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
  docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=layout_test", "-e", "POSTGRES_PASSWORD=layout_test", "-e", "POSTGRES_DB=versado_layout_test", "postgres:16-alpine"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "layout_test"]); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error("Testdatabase niet beschikbaar");
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://layout_test:layout_test@127.0.0.1:${port}/versado_layout_test`;
  const base = process.env.LAYOUT_TEST_BASE_URL ?? "http://localhost:3110";
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: url, LEARNING_TEST_DATABASE_URL: url,
    LAYOUT_TEST_BASE_URL: base, APP_URL: base, PORT: new URL(base).port, REDIS_URL: "",
    SESSION_SECRET: "layout-isolated-test-secret-only", NEXT_TELEMETRY_DISABLED: "1" };
  await run("npm", ["run", "db:migrate:deploy"], env);
  await run("npm", ["run", "db:generate"], env);
  server = spawn("npx", ["tsx", "server.ts"], { env, stdio: "inherit", detached: true });
  let available = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { available = true; break; } } catch {}
    await delay(500);
  }
  if (!available) throw new Error("Productie-app niet beschikbaar");
  if (!process.argv.includes("--socket-only")) {
  if (!process.argv.includes("--content-only")) await run("npx", ["tsx", "tests/header-wordsearch.browser.mjs", ...process.argv.slice(2)], env);
  await run("npx", ["tsx", "tests/content-picker.browser.mjs", ...process.argv.slice(2)], env);
  }
  await run("npx", ["tsx", "tests/game-availability.socket.mjs"], env);
  await run("npm", ["run", "test:cards"], env);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  try { docker(["rm", "-f", container]); } catch {}
}
