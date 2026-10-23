import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import * as profilesModule from "../scripts/native/profiles.cjs";
import { verifyBundle } from "../scripts/native/verify-distribution.mjs";

const profiles = ((profilesModule as { default?: unknown }).default ?? profilesModule) as Record<string, any>;
const { resolveBuildProfile, parseDistributionOrigin, capacitorSettings, ProfileError, COMPILE_PROBE_ORIGIN } = profiles;
const require = createRequire(import.meta.url);
void require;

const allowlist = { internal: ["https://intern.versado-test.com"], "store-test": ["https://test.versado-test.com"] };
const base = { GITHUB_SHA: "a".repeat(40), NATIVE_APP_VERSION: "0.1.0", NATIVE_BUILD_NUMBER: "7" };
const resolve = (env: Record<string, string>, extra: Record<string, unknown> = {}) => resolveBuildProfile(env, { stage: "build", allowlist, ...extra });
const refuses = (env: Record<string, string>, pattern: RegExp) => assert.throws(() => resolve(env), (error: Error) => error instanceof ProfileError && pattern.test(error.message));

test("local-internal: lokale bundel, expliciet toegestane HTTPS-origin, geen remote server.url, geen cleartext", () => {
  const resolved = resolve({ ...base, CAPACITOR_BUILD_PROFILE: "local-internal", NATIVE_API_BASE_URL: "https://intern.versado-test.com" });
  assert.equal(resolved.channel, "internal");
  assert.equal(resolved.distribution, true);
  const settings = capacitorSettings(resolved, {});
  assert.equal(settings.server.url, undefined);
  assert.equal(settings.server.cleartext, false);
});

test("local-store-test: kanaal verplicht en per platform beperkt tot bekende waarden", () => {
  const env = { ...base, CAPACITOR_BUILD_PROFILE: "local-store-test", NATIVE_API_BASE_URL: "https://test.versado-test.com" };
  refuses(env, /NATIVE_DISTRIBUTION_CHANNEL ontbreekt/);
  refuses({ ...env, NATIVE_DISTRIBUTION_CHANNEL: "production" }, /onbekend/);
  assert.equal(resolve({ ...env, NATIVE_DISTRIBUTION_CHANNEL: "testflight" }).channel, "testflight");
  assert.equal(resolve({ ...env, NATIVE_DISTRIBUTION_CHANNEL: "play-test" }).buildNumber, 7);
  refuses({ ...env, NATIVE_DISTRIBUTION_CHANNEL: "testflight", NATIVE_APP_VERSION: "" }, /NATIVE_APP_VERSION ontbreekt/);
  refuses({ ...env, NATIVE_DISTRIBUTION_CHANNEL: "testflight", NATIVE_BUILD_NUMBER: "0" }, /NATIVE_BUILD_NUMBER/);
});

test("onbekende, niet-toegestane of verkeerde profielorigin wordt geweigerd; er is geen onveilige terugval", () => {
  const env = { ...base, CAPACITOR_BUILD_PROFILE: "local-internal" };
  refuses(env, /NATIVE_API_BASE_URL ontbreekt/);
  refuses({ ...env, NATIVE_API_BASE_URL: "https://onbekend.versado-test.com" }, /allowlist/);
  refuses({ ...env, NATIVE_API_BASE_URL: "https://test.versado-test.com" }, /allowlist/); // origin van het andere profiel
  assert.throws(() => resolveBuildProfile({ ...env, NATIVE_API_BASE_URL: "https://intern.versado-test.com" }, { stage: "build", allowlist: { internal: [], "store-test": [] } }), /leeg/);
});

test("alleen exacte HTTPS-origins: geen HTTP, wildcard, credentials, pad, redirect-achtige vorm of IP/loopback", () => {
  for (const bad of [
    "http://intern.versado-test.com", "https://*.versado-test.com", "https://user:pw@intern.versado-test.com", "https://intern.versado-test.com/",
    "https://intern.versado-test.com/pad", "https://intern.versado-test.com?x=1", "https://intern.versado-test.com#a", "https://INTERN.versado-test.com",
    "https://127.0.0.1", "https://localhost", "https://example.invalid", "https://x.example.com", "ftp://intern.versado-test.com", "intern.versado-test.com", "",
    "https://intern.versado-test.com:443", " https://intern.versado-test.com",
  ]) assert.throws(() => parseDistributionOrigin(bad), ProfileError, JSON.stringify(bad));
  assert.equal(parseDistributionOrigin("https://intern.versado-test.com:8443"), "https://intern.versado-test.com:8443");
});

test("distributieprofielen weigeren HTTP-cleartext, lokale HTTP-backend en een remote server.url", () => {
  const env = { ...base, CAPACITOR_BUILD_PROFILE: "local-internal", NATIVE_API_BASE_URL: "https://intern.versado-test.com" };
  refuses({ ...env, NATIVE_ALLOW_LOCAL_HTTP_API: "1" }, /cleartext/);
  refuses({ ...env, CAPACITOR_ALLOW_CLEARTEXT: "true" }, /cleartext/);
  refuses({ ...env, CAPACITOR_SERVER_URL: "https://versado.app" }, /server\.url/);
});

test("het releaseprofiel blijft geblokkeerd, hoe de omgeving ook is ingesteld", () => {
  for (const extra of [{}, { NATIVE_COMPILE_PROBE: "1" }, { NATIVE_RELEASE_APPROVED: "1" }, { CAPACITOR_RELEASE: "true" }, { NATIVE_API_BASE_URL: "https://test.versado-test.com", NATIVE_DISTRIBUTION_CHANNEL: "testflight" }]) {
    for (const profile of ["release", "Release", "production", "local-release", "store", ""]) {
      assert.throws(() => resolveBuildProfile({ ...base, ...extra, CAPACITOR_BUILD_PROFILE: profile }, { stage: "config", allowlist, defaultProfile: profile === "" ? undefined : undefined }), ProfileError);
      assert.throws(() => resolveBuildProfile({ ...base, ...extra, CAPACITOR_BUILD_PROFILE: profile }, { stage: "build", allowlist }), ProfileError);
    }
  }
});

test("compileproef: alleen het gereserveerde .invalid-domein en uitsluitend gemarkeerd als compileproef", () => {
  const env = { ...base, CAPACITOR_BUILD_PROFILE: "local-store-test", NATIVE_DISTRIBUTION_CHANNEL: "play-test", NATIVE_COMPILE_PROBE: "1" };
  const resolved = resolve({ ...env, NATIVE_API_BASE_URL: COMPILE_PROBE_ORIGIN });
  assert.equal(resolved.compileProbe, true);
  refuses({ ...env, NATIVE_API_BASE_URL: "https://test.versado-test.com" }, /compileproef|NATIVE_COMPILE_PROBE/);
});

test("development-profielen blijven werken: local-development (met en zonder lokale HTTP) en remote-preview", () => {
  const dev = resolveBuildProfile({ CAPACITOR_BUILD_PROFILE: "local-development", NATIVE_API_BASE_URL: "https://versado.app" }, { stage: "build" });
  assert.equal(dev.distribution, false);
  assert.equal(dev.cleartext, false);
  const lan = resolveBuildProfile({ CAPACITOR_BUILD_PROFILE: "local-development", NATIVE_API_BASE_URL: "http://127.0.0.1:3000", NATIVE_ALLOW_LOCAL_HTTP_API: "1" }, { stage: "build" });
  assert.equal(lan.cleartext, true);
  assert.throws(() => resolveBuildProfile({ CAPACITOR_BUILD_PROFILE: "local-development", NATIVE_API_BASE_URL: "http://192.168.1.5:3000" }, { stage: "build" }));
  const remote = resolveBuildProfile({ CAPACITOR_BUILD_PROFILE: "remote-preview", CAPACITOR_SERVER_URL: "https://versado.app" }, { stage: "config" });
  assert.equal(remote.kind, "remote");
  assert.equal(capacitorSettings(remote, {}).server.url, "https://versado.app");
  assert.throws(() => resolveBuildProfile({ CAPACITOR_BUILD_PROFILE: "remote-preview" }, { stage: "config" }), /CAPACITOR_SERVER_URL ontbreekt/);
});

// Echte builds met de compileproef-origin: bewijs dat de bundel lokaal is en de metadata klopt.
const probeEnv = (profile: string, channel: string, outdir: string) => ({
  ...process.env, ...base, CAPACITOR_BUILD_PROFILE: profile, NATIVE_DISTRIBUTION_CHANNEL: channel, NATIVE_COMPILE_PROBE: "1",
  NATIVE_API_BASE_URL: COMPILE_PROBE_ORIGIN, NATIVE_BUILD_OUTDIR: outdir, CAPACITOR_SERVER_URL: "",
}) as NodeJS.ProcessEnv;

function buildProbe(profile: string, channel: string) {
  const outdir = mkdtempSync(join(tmpdir(), "versado-dist-"));
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/native/build.ts"], { env: probeEnv(profile, channel, outdir), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const root = mkdtempSync(join(tmpdir(), "versado-pkg-"));
  cpSync(outdir, join(root, "public"), { recursive: true });
  return { outdir, root, env: probeEnv(profile, channel, outdir) };
}

function writeConfig(root: string, env: NodeJS.ProcessEnv, outdir: string, mutate?: (config: Record<string, any>) => void) {
  const resolved = resolveBuildProfile(env, { stage: "build" });
  const settings = capacitorSettings(resolved, env);
  const config: Record<string, any> = { appId: "app.versado.app", appName: "Versado", webDir: settings.webDir, server: settings.server };
  void outdir;
  mutate?.(config);
  writeFileSync(join(root, "capacitor.config.json"), JSON.stringify(config));
}

for (const [profile, channel] of [["local-development", "internal"], ["local-internal", "internal"], ["local-store-test", "testflight"]] as const) {
  test(`build ${profile}: lokale bundel, kloppende metadata, verificatiecontract groen en negatieve gevallen rood`, () => {
    const { outdir, root, env } = buildProbe(profile, channel);
    try {
      const metadata = JSON.parse(readFileSync(join(outdir, "build.json"), "utf8"));
      assert.equal(metadata.profile, profile);
      assert.equal(metadata.appId, "app.versado.app");
      assert.equal(metadata.releaseApproved, false);
      assert.equal(metadata.apiOrigin, COMPILE_PROBE_ORIGIN);
      assert.equal(metadata.schemaVersion, 2);
      if (profile !== "local-development") {
        assert.equal(metadata.compileProbe, true);
        assert.equal(metadata.channel, channel);
        assert.equal(metadata.sourceCommit, base.GITHUB_SHA);
        assert.equal(metadata.buildNumber, 7);
      }
      const html = readFileSync(join(outdir, "index.html"), "utf8");
      assert.match(html, /connect-src https:\/\/example\.invalid wss:\/\/example\.invalid/);
      assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//);

      writeConfig(root, env, outdir);
      cpSync(join(outdir, "build.json"), join(root, "public", "build.json"));
      const opts = { platform: channel === "testflight" ? "ios" : "android", root, env, repoRoot: process.cwd() };
      assert.deepEqual(verifyBundle(opts), []);

      // negatief: remote server.url, gewijzigd bestand, onverwacht bestand, andere origin in de metadata, releasegoedkeuring
      writeConfig(root, env, outdir, (config) => { config.server.url = "https://versado.app"; });
      assert.ok(verifyBundle(opts).some((problem: string) => /server\.url/.test(problem)));
      writeConfig(root, env, outdir);
      writeFileSync(join(root, "public", "extra.js"), "x");
      assert.ok(verifyBundle(opts).some((problem: string) => /onverwacht bestand/.test(problem)));
      rmSync(join(root, "public", "extra.js"));
      const original = readFileSync(join(root, "public", "index.js"), "utf8");
      writeFileSync(join(root, "public", "index.js"), `${original}\n// gewijzigd`);
      assert.ok(verifyBundle(opts).some((problem: string) => /index\.js/.test(problem)));
      writeFileSync(join(root, "public", "index.js"), original);
      const tampered = { ...metadata, releaseApproved: true };
      writeFileSync(join(root, "public", "build.json"), JSON.stringify(tampered));
      assert.ok(verifyBundle(opts).length > 0);
      writeFileSync(join(outdir, "build.json"), JSON.stringify(tampered));
      assert.ok(verifyBundle(opts).some((problem: string) => /releaseApproved|metadata/.test(problem)));
      if (profile !== "local-development") {
        writeFileSync(join(outdir, "build.json"), JSON.stringify(metadata));
        cpSync(join(outdir, "build.json"), join(root, "public", "build.json"));
        writeConfig(root, env, outdir, (config) => { config.server.cleartext = true; });
        assert.ok(verifyBundle(opts).some((problem: string) => /cleartext/.test(problem)));
      }
    } finally {
      rmSync(outdir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("een geheim in de bundel breekt de build af", () => {
  const outdir = mkdtempSync(join(tmpdir(), "versado-dist-"));
  try {
    mkdirSync(outdir, { recursive: true });
    const env = { ...probeEnv("local-internal", "internal", outdir), NATIVE_API_BASE_URL: "https://user:geheim@example.invalid" };
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/native/build.ts"], { env, encoding: "utf8" });
    assert.notEqual(run.status, 0);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});

test("capacitor.config.ts: distributieprofiel zonder gebouwde bundel of met afwijkende metadata wordt geweigerd; release nooit", () => {
  const outdir = mkdtempSync(join(tmpdir(), "versado-dist-"));
  const run = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./capacitor.config.ts').then((m) => console.log(JSON.stringify(m.default)))"], { env, encoding: "utf8" });
  try {
    assert.notEqual(run(probeEnv("local-internal", "internal", outdir)).status, 0); // geen build.json
    const built = buildProbe("local-internal", "internal");
    try {
      const ok = run(built.env);
      assert.equal(ok.status, 0, ok.stderr);
      const config = JSON.parse(ok.stdout);
      assert.equal(config.server.url, undefined);
      assert.equal(config.appId, "app.versado.app");
      assert.notEqual(run({ ...built.env, NATIVE_BUILD_NUMBER: "8" }).status, 0); // metadata en profiel wijken af
      assert.notEqual(run({ ...built.env, CAPACITOR_BUILD_PROFILE: "local-store-test", NATIVE_DISTRIBUTION_CHANNEL: "testflight" }).status, 0);
      assert.notEqual(run({ ...built.env, CAPACITOR_BUILD_PROFILE: "release" }).status, 0);
    } finally {
      rmSync(built.outdir, { recursive: true, force: true });
      rmSync(built.root, { recursive: true, force: true });
    }
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});
