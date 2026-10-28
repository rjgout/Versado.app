import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterProblems, beforeProblems, signingProblems } from "../scripts/native/ios-release-guard.mjs";

const good = {
  appId: "app.versado.app", profile: "local-store-test", channel: "testflight", compileProbe: false, releaseApproved: false,
  apiOrigin: "https://test.versado-test.com", version: "0.2.0", buildNumber: 42, sourceCommit: "a".repeat(40),
};
const env = { NATIVE_BUILD_NUMBER: "42", NATIVE_APP_VERSION: "0.2.0", GITHUB_SHA: "a".repeat(40) };
const plistXml = (values) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${Object.entries(values).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join("")}</dict></plist>`;

test("een echte local-store-test/testflight-build mag gearchiveerd worden", () => {
  assert.deepEqual(signingProblems(good, env), []);
});

test("compileproef, ander profiel/kanaal, release-goedkeuring en foute origin worden nooit gearchiveerd", () => {
  const cases = [
    [{ compileProbe: true }, /compileproef/], [{ apiOrigin: "https://example.invalid" }, /echte HTTPS/], [{ apiOrigin: "http://test.versado-test.com" }, /echte HTTPS/],
    [{ apiOrigin: "https://u:p@test.versado-test.com" }, /echte HTTPS/], [{ profile: "local-internal" }, /profiel/], [{ profile: "local-development" }, /profiel/],
    [{ channel: "play-test" }, /kanaal/], [{ channel: "internal" }, /kanaal/], [{ releaseApproved: true }, /releaseApproved/], [{ appId: "app.andere.app" }, /appId/],
    [{ buildNumber: 41 }, /buildNumber/], [{ version: "9.9.9" }, /version/], [{ sourceCommit: "b".repeat(40) }, /sourceCommit/],
  ];
  for (const [patch, pattern] of cases) assert.ok(signingProblems({ ...good, ...patch }, env).some((problem) => pattern.test(problem)), JSON.stringify(patch));
  assert.ok(signingProblems(null, env).length > 0);
  assert.ok(signingProblems(good, { ...env, NATIVE_BUILD_NUMBER: undefined }).some((problem) => /NATIVE_BUILD_NUMBER/.test(problem)));
});

test("voorafgaande poort: ontbrekende of verouderde assets weigeren", () => {
  const root = mkdtempSync(join(tmpdir(), "versado-ios-guard-"));
  try {
    assert.match(beforeProblems({ env, root })[0], /ontbreekt/);
    mkdirSync(join(root, "dist/native"), { recursive: true });
    mkdirSync(join(root, "ios/App/App/public"), { recursive: true });
    writeFileSync(join(root, "dist/native/build.json"), JSON.stringify(good));
    assert.match(beforeProblems({ env, root })[0], /cap sync/);
    writeFileSync(join(root, "ios/App/App/public/build.json"), JSON.stringify({ ...good, buildNumber: 1 }));
    assert.match(beforeProblems({ env, root })[0], /verouderde sync/);
    writeFileSync(join(root, "ios/App/App/public/build.json"), JSON.stringify(good));
    assert.deepEqual(beforeProblems({ env, root }), []);
    writeFileSync(join(root, "dist/native/build.json"), JSON.stringify({ ...good, compileProbe: true }));
    writeFileSync(join(root, "ios/App/App/public/build.json"), JSON.stringify({ ...good, compileProbe: true }));
    assert.ok(beforeProblems({ env, root }).some((problem) => /compileproef/.test(problem)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("archiefcontrole: versie, buildnummer, bundel en privacy manifest moeten kloppen", () => {
  const root = mkdtempSync(join(tmpdir(), "versado-ios-app-"));
  const app = join(root, "App.app");
  try {
    mkdirSync(join(app, "public"), { recursive: true });
    writeFileSync(join(app, "Info.plist"), plistXml({ CFBundleIdentifier: "app.versado.app", CFBundleShortVersionString: "0.2.0", CFBundleVersion: "42" }));
    writeFileSync(join(app, "public/build.json"), JSON.stringify(good));
    writeFileSync(join(app, "PrivacyInfo.xcprivacy"), plistXml({}));
    assert.deepEqual(afterProblems(app, { root }), []);
    writeFileSync(join(app, "Info.plist"), plistXml({ CFBundleIdentifier: "app.versado.app", CFBundleShortVersionString: "0.2.0", CFBundleVersion: "41" }));
    assert.ok(afterProblems(app, { root }).some((problem) => /buildNumber/.test(problem)));
    writeFileSync(join(app, "Info.plist"), plistXml({ CFBundleIdentifier: "app.andere.app", CFBundleShortVersionString: "0.2.0", CFBundleVersion: "42" }));
    assert.ok(afterProblems(app, { root }).some((problem) => /CFBundleIdentifier/.test(problem)));
    writeFileSync(join(app, "Info.plist"), plistXml({ CFBundleIdentifier: "app.versado.app", CFBundleShortVersionString: "0.2.0", CFBundleVersion: "42" }));
    writeFileSync(join(app, "public/build.json"), JSON.stringify({ ...good, compileProbe: true }));
    assert.ok(afterProblems(app, { root }).some((problem) => /compileproef/.test(problem)));
    writeFileSync(join(app, "public/build.json"), JSON.stringify(good));
    rmSync(join(app, "PrivacyInfo.xcprivacy"));
    assert.ok(afterProblems(app, { root }).some((problem) => /PrivacyInfo/.test(problem)));
    assert.ok(afterProblems(join(root, "bestaat-niet"), { root }).length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("privacy manifest en Info.plist: geen tracking, gebundeld in het app-target, arm64 als apparaatvereiste", () => {
  const manifest = readFileSync("ios/App/App/PrivacyInfo.xcprivacy", "utf8");
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  const info = readFileSync("ios/App/App/Info.plist", "utf8");
  assert.match(info, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>/);
  assert.doesNotMatch(info, /armv7/);
  assert.doesNotMatch(project, /DEVELOPMENT_TEAM\s*=\s*[A-Z0-9]{10}/); // geen Team ID in git
});

test("workflowinvoer wordt nooit in shelltekst geïnterpoleerd (alleen via env), en de versienaam wordt vooraf gevalideerd", () => {
  const text = readFileSync(".github/workflows/native-ios-release.yml", "utf8");
  for (const line of text.split("\n")) {
    if (/\$\{\{\s*(inputs|github\.event)\./.test(line)) assert.match(line, /^\s+[A-Z_]+:\s*\$\{\{/, `invoer buiten een env-toewijzing: ${line.trim()}`);
  }
  assert.match(text, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
});
