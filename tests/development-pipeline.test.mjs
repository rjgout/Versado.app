import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { developmentImages, publishDevelopment } from "../scripts/ci/publish-development.mjs";

const require = createRequire(import.meta.url);
const { resolveBuildProfile, loadAllowedOrigins } = require("../scripts/native/profiles.cjs");
const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/develop", GITHUB_REPOSITORY: "rjgout/Versado.app", GITHUB_SHA: "a".repeat(40) };
const digest = `sha256:${"b".repeat(64)}`;
const workflow = parse(readFileSync(".github/workflows/development.yml", "utf8"));
const productionSource = readFileSync(".github/workflows/docker-publish.yml", "utf8");

// Alleen de afgesproken grenzen vastleggen; namen, commentaar en opmaak mogen veranderen.
function assertWorkflowBoundaries(production, development) {
  assert.deepEqual(production.on.push.branches, ["main"]);
  for (const filter of ["branches-ignore", "tags", "tags-ignore"]) assert.equal(production.on.push[filter], undefined);
  const targets = production.jobs["build-and-push"].strategy.matrix.include;
  for (const [name, dockerfile] of [["jehova-app", "./Dockerfile"], ["jehova-proxy", "./deploy/nginx/Dockerfile"]]) {
    const target = targets.find((row) => row.name === name);
    assert.equal(target?.context, ".");
    assert.equal(target?.dockerfile, dockerfile);
  }

  assert.deepEqual(development.permissions, { contents: "read" });
  for (const [id, job] of Object.entries(development.jobs)) {
    assert.deepEqual(job.permissions ?? development.permissions, id === "publish" ? { contents: "read", packages: "write" } : { contents: "read" });
    assert.doesNotMatch(JSON.stringify(job.strategy?.matrix ?? {}), /deploy-agent|deploy\/agent/);
    for (const step of job.steps) {
      assert.doesNotMatch(step.with?.tags ?? "", /\blatest\b/);
      assert.doesNotMatch(step.with?.file ?? "", /deploy\/agent/);
    }
  }
  assert.equal(development.jobs.publish.if, "github.event_name == 'push' && github.ref == 'refs/heads/develop' && github.repository == 'rjgout/Versado.app'");
}

function registry({ existing = false, existingRefs = [], failPush = false, inspectFailure = false, stale = false, aliasFailure = false } = {}) {
  const calls = [], published = new Set(existingRefs);
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "gh") return { status: 0, stdout: stale ? "c".repeat(40) : env.GITHUB_SHA };
    if (args[0] === "push") {
      if (failPush && args[1].includes("jehova-proxy")) return { status: 1, stderr: "registry unavailable" };
      published.add(args[1]);
    }
    if (args[2] === "inspect") {
      if (inspectFailure) return { status: 1, stderr: "unauthorized or network unavailable" };
      return existing || published.has(args.at(-1)) ? { status: 0, stdout: JSON.stringify({ digest }) } : { status: 1, stderr: "manifest unknown" };
    }
    if (aliasFailure && args[2] === "create" && args.includes("ghcr.io/rjgout/jehova-proxy:dev")) return { status: 1 };
    return { status: 0, stdout: "" };
  };
  return { run, calls, published };
}
const execute = (fake, override = {}) => publishDevelopment({ env: { ...env, ...override }, run: fake.run, log() {} });

test("uitsluitend develop-push/PR, PR read-only, publicatie na alle controles en beide builds", () => {
  assert.deepEqual(workflow.on, { pull_request: { branches: ["develop"] }, push: { branches: ["develop"] } });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}");
  const { checks, "pr-images": pr, publish } = workflow.jobs;
  assert.ok(checks.steps.some((s) => s.run === "npm run lint"));
  assert.ok(checks.steps.some((s) => s.run?.includes("npx tsc --noEmit")));
  assert.equal(pr.if, "github.event_name == 'pull_request'");
  assert.equal(pr.needs, "checks");
  assert.equal(pr.permissions, undefined);
  assert.equal(pr.steps.filter((s) => s.uses?.startsWith("docker/login-action")).length, 0);
  assert.equal(pr.steps.find((s) => s.uses?.startsWith("docker/build-push-action")).with.push, false);
  assert.deepEqual(pr.strategy.matrix.include, [{ name: "jehova-app", dockerfile: "./Dockerfile" }, { name: "jehova-proxy", dockerfile: "./deploy/nginx/Dockerfile" }]);
  assert.equal(publish.needs, "checks");
  assert.equal(publish.if, "github.event_name == 'push' && github.ref == 'refs/heads/develop' && github.repository == 'rjgout/Versado.app'");
  assert.deepEqual(publish.permissions, { contents: "read", packages: "write" });
  const builds = publish.steps.filter((s) => s.uses?.startsWith("docker/build-push-action"));
  assert.deepEqual(builds.map((s) => s.with.file), ["./Dockerfile", "./deploy/nginx/Dockerfile"]);
  assert.ok(builds.every((s) => s.with.push === false && s.with.load === true && s.with.context === "."));
  const write = publish.steps.findIndex((s) => s.run === "node scripts/ci/publish-development.mjs");
  assert.ok(builds.every((s) => publish.steps.indexOf(s) < write));
  assert.ok(publish.steps.every((s) => !s["continue-on-error"] && !s.if));
});

test("productie blijft main-only; dev-publicatierechten, tags en bestaande Dockerfile-paden zijn gescheiden", () => {
  assertWorkflowBoundaries(parse(productionSource), workflow);
  for (const file of ["Dockerfile", "deploy/nginx/Dockerfile"]) assert.ok(readFileSync(file).length);
});

test("legitieme productie-commentaren, opmaak en stapnamen breken development-controles niet", () => {
  const changed = `# Toelichting na synchronisatie van main\n${productionSource.replace("name: ESLint", "name: Statische codecontrole")}\n`;
  assert.notDeepEqual(parse(changed), parse(productionSource)); // De displaynaam is daadwerkelijk gewijzigd.
  assertWorkflowBoundaries(parse(changed), workflow);
});

test("gerichte invarianten blijven onveilige triggers, rechten, tags en Dockerfiles weigeren", () => {
  const mutations = [
    (prod) => { prod.on.push.branches.push("develop"); },
    (prod) => { prod.on.push.tags = ["v*"]; },
    (prod) => { prod.jobs["build-and-push"].strategy.matrix.include.find((row) => row.name === "jehova-proxy").dockerfile = "./Dockerfile"; },
    (prod, dev) => { dev.permissions.packages = "write"; },
    (prod, dev) => { dev.jobs["pr-images"].permissions = { contents: "read", packages: "write" }; },
    (prod, dev) => { dev.jobs.publish.if = "github.event_name == 'pull_request'"; },
    (prod, dev) => { dev.jobs.publish.steps.find((step) => step.with?.tags).with.tags = "ghcr.io/rjgout/jehova-app:latest"; },
    (prod, dev) => { dev.jobs["pr-images"].strategy.matrix.include.push({ name: "jehova-deploy-agent", dockerfile: "./deploy/agent/Dockerfile" }); },
  ];
  for (const mutate of mutations) {
    const prod = parse(productionSource), dev = structuredClone(workflow);
    mutate(prod, dev);
    assert.throws(() => assertWorkflowBoundaries(prod, dev));
  }
});

test("PR, main, dispatch, fork en ongeldige SHA worden vóór externe acties geweigerd", () => {
  for (const override of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/main" }, { GITHUB_EVENT_NAME: "workflow_dispatch" }, { GITHUB_REPOSITORY: "fork/Versado.app" }, { GITHUB_SHA: "abc" }]) {
    const fake = registry();
    assert.throws(() => execute(fake, override));
    assert.deepEqual(fake.calls, []);
  }
  assert.ok(developmentImages(env).every((i) => i.commit.endsWith(`:dev-sha-${env.GITHUB_SHA}`) && i.alias.endsWith(":dev")));
});

test("beide commit-tags bestaan vóór dev; geen latest, deploy-agent of andere registry", () => {
  const fake = registry();
  assert.equal(execute(fake).updated, true);
  assert.equal(fake.published.size, 2);
  const firstAlias = fake.calls.findIndex((a) => a[4] === "--prefer-index=false");
  assert.equal(fake.calls.slice(0, firstAlias).filter((a) => a[1] === "push").length, 2);
  assert.equal(fake.calls.filter((a) => a[4] === "--prefer-index=false").length, 2);
  assert.doesNotMatch(JSON.stringify(fake.calls), /latest|deploy-agent|docker\.sock|portainer/i);
});

test("retry hergebruikt onveranderlijke commit-tags zonder opnieuw te pushen", () => {
  const fake = registry({ existing: true });
  assert.equal(execute(fake).updated, true);
  assert.equal(fake.calls.some((a) => a[1] === "tag" || a[1] === "push"), false);
  assert.ok(fake.calls.filter((a) => a[2] === "imagetools" && a[3] === "create").every((a) => a.at(-1).endsWith(`@${digest}`)));
});

test("gedeeltelijke pushfout bewaart voortgang maar wijzigt geen dev-alias", () => {
  const fake = registry({ failPush: true });
  assert.throws(() => execute(fake), /gestopt/);
  assert.equal(fake.published.size, 1);
  assert.equal(fake.calls.some((a) => a.includes("create")), false);
  const retry = registry({ existingRefs: fake.published });
  assert.equal(execute(retry).updated, true);
  const pushes = retry.calls.filter((a) => a[1] === "push");
  assert.equal(pushes.length, 1);
  assert.match(pushes[0][2], /jehova-proxy:dev-sha-/);
});

test("registryfouten zijn geen ontbrekende tags en leveren geen writes op", () => {
  const fake = registry({ inspectFailure: true });
  assert.throws(() => execute(fake), /Registrycontrole/);
  assert.equal(fake.calls.some((a) => a.includes("push") || a.includes("create")), false);
});

test("ongeldige registry-uitvoer faalt vóór enige publicatie", () => {
  for (const stdout of ["Name: image\nDigest: sha256:onjuist", "{}", '{"digest":"not-a-digest"}']) {
    const calls = [];
    assert.throws(() => publishDevelopment({ env, run(program, args) { calls.push([program, ...args]); return { status: 0, stdout }; }, log() {} }), /Registry/);
    assert.equal(calls.length, 1);
  }
});

test("achterhaalde run mag dev niet terugzetten; losse aliasfout blijft een echte fout", () => {
  const fake = registry({ stale: true });
  assert.equal(execute(fake).updated, false);
  assert.equal(fake.calls.some((a) => a.includes("create")), false);
  assert.throws(() => execute(registry({ existing: true, aliasFailure: true })), /gestopt/);
});

test("echte internal-allowlist staat alleen exacte dev-HTTPS toe; store-test/release blijven dicht", () => {
  const allowlist = loadAllowedOrigins();
  assert.deepEqual(allowlist, { internal: ["https://dev.versado.app"], "store-test": [] });
  const base = { CAPACITOR_BUILD_PROFILE: "local-internal", GITHUB_SHA: env.GITHUB_SHA, NATIVE_API_BASE_URL: "https://dev.versado.app" };
  assert.equal(resolveBuildProfile(base).compileProbe, false);
  for (const origin of ["https://versado.app", "http://dev.versado.app", "https://dev.versado.app/", "https://DEV.versado.app", "https://dev.versado.app.evil.com", "https://dev.versado.app:8443", "https://dev.versado.app/api", "https://user@dev.versado.app", "https://*.versado.app"]) {
    assert.throws(() => resolveBuildProfile({ ...base, NATIVE_API_BASE_URL: origin }), undefined, origin);
  }
  assert.throws(() => resolveBuildProfile({ ...base, CAPACITOR_BUILD_PROFILE: "local-store-test", NATIVE_DISTRIBUTION_CHANNEL: "testflight" }), /leeg/);
  assert.throws(() => resolveBuildProfile({ ...base, CAPACITOR_BUILD_PROFILE: "release" }), /geblokkeerd/);
});
