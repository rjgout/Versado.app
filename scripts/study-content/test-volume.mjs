import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = process.env.STUDY_MEDIA_DIR,
  database = new URL(
    process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
  );
if (
  !root?.startsWith("/tmp/versado-content-migration-") ||
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/versado_content_access_test"
)
  throw new Error("Eigen geïsoleerde mediavolume vereist");
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(args) {
  const out = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (out.status !== 0) throw new Error(out.stderr || "Testcontainer mislukt");
  return out.stdout;
}
const image = "node:24-alpine";
try {
  docker(["image", "inspect", image]);
} catch {
  docker(["pull", image]);
}
const containers = [],
  replacement = `versado-study-volume-replacement:${randomUUID()}`,
  context = mkdtempSync(join(tmpdir(), "versado-study-volume-image-"));
function probe(mode, mounted = true, readonly = false) {
  const name = `versado-study-volume-${randomUUID()}`;
  containers.push(name);
  return docker([
    "run",
    "--rm",
    "--name",
    name,
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,size=16m",
    "-e",
    "STUDY_MEDIA_DIR=/data/study-media",
    "-e",
    "DATABASE_URL=postgresql://test:test@127.0.0.1:1/validation",
    "--mount",
    `type=bind,src=${resolve(".")},dst=/app,readonly`,
    ...(mounted
      ? [
          "--mount",
          `type=bind,src=${root},dst=/data/study-media${readonly ? ",readonly" : ""}`,
        ]
      : []),
    "-w",
    "/app",
    mode === "restart" ? replacement : image,
    "./node_modules/.bin/tsx",
    "scripts/study-content/volume-probe.mjs",
    mode,
  ]);
}
try {
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${image}\nENV STUDY_STORAGE_TEST_IMAGE=replacement\n`,
  );
  docker([
    "build",
    "--network=none",
    "--pull=false",
    "-t",
    replacement,
    context,
  ]);
  assert.notEqual(
    JSON.parse(docker(["image", "inspect", image]))[0].Id,
    JSON.parse(docker(["image", "inspect", replacement]))[0].Id,
  );
  const first = probe("install"),
    second = probe("restart"),
    readonly = probe("readonly", true, true),
    unmounted = probe("unmounted", false);
  const parse = (s) => JSON.parse(s.trim().split("\n").at(-1));
  assert.equal(parse(first).volumeId, parse(second).volumeId);
  assert.equal(parse(first).checksum, parse(second).checksum);
  assert.ok(parse(readonly).blocked && parse(unmounted).blocked);
  console.log(
    JSON.stringify({
      persistentStudyVolume: "passed",
      independentReplacementContainers: 2,
      actualMountVerified: true,
      changedImageVerified: true,
      readonlyAndMissingBlocked: true,
      nasTouched: false,
    }),
  );
} finally {
  for (const name of containers)
    try {
      docker(["rm", "-f", name]);
    } catch {}
  try {
    docker(["image", "rm", replacement]);
  } catch {}
  rmSync(context, { recursive: true, force: true });
}
