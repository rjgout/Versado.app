import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterProblems, beforeProblems, signingProblems } from "../scripts/native/android-release-guard.mjs";

const good = {
  appId: "app.versado.app", profile: "local-store-test", channel: "play-test", compileProbe: false, releaseApproved: false,
  apiOrigin: "https://test.versado-test.com", version: "0.2.0", buildNumber: 42, sourceCommit: "a".repeat(40),
};
const env = { VERSADO_VERSION_CODE: "42", VERSADO_VERSION_NAME: "0.2.0", GITHUB_SHA: "a".repeat(40) };

test("een echte local-store-test/play-test-build mag getekend worden", () => {
  assert.deepEqual(signingProblems(good, env), []);
});

test("compileproef, ander profiel/kanaal, release-goedkeuring en foute origin worden nooit getekend", () => {
  const cases = [
    [{ compileProbe: true }, /compileproef/],
    [{ apiOrigin: "https://example.invalid", compileProbe: true }, /compileproef|echte HTTPS/],
    [{ apiOrigin: "https://example.invalid" }, /echte HTTPS/],
    [{ apiOrigin: "http://test.versado-test.com" }, /echte HTTPS/],
    [{ apiOrigin: "https://*.versado-test.com" }, /echte HTTPS/],
    [{ apiOrigin: "https://u:p@test.versado-test.com" }, /echte HTTPS/],
    [{ profile: "local-internal" }, /profiel/],
    [{ profile: "local-development" }, /profiel/],
    [{ channel: "testflight" }, /kanaal/],
    [{ channel: "internal" }, /kanaal/],
    [{ releaseApproved: true }, /releaseApproved/],
    [{ appId: "app.andere.app" }, /appId/],
    [{ buildNumber: 41 }, /buildNumber/],
    [{ version: "9.9.9" }, /version/],
    [{ sourceCommit: "b".repeat(40) }, /sourceCommit/],
  ];
  for (const [patch, pattern] of cases) {
    const problems = signingProblems({ ...good, ...patch }, env);
    assert.ok(problems.some((problem) => pattern.test(problem)), JSON.stringify(patch));
  }
  assert.ok(signingProblems(null, env).length > 0);
  assert.ok(signingProblems(good, { ...env, VERSADO_VERSION_CODE: undefined }).some((problem) => /VERSADO_VERSION_CODE/.test(problem)));
});

test("voorafgaande poort: ontbrekende of verouderde assets weigeren", () => {
  const root = mkdtempSync(join(tmpdir(), "versado-guard-"));
  try {
    assert.match(beforeProblems({ env, root })[0], /ontbreekt/);
    mkdirSync(join(root, "dist/native"), { recursive: true });
    mkdirSync(join(root, "android/app/src/main/assets/public"), { recursive: true });
    writeFileSync(join(root, "dist/native/build.json"), JSON.stringify(good));
    assert.match(beforeProblems({ env, root })[0], /cap sync/);
    writeFileSync(join(root, "android/app/src/main/assets/public/build.json"), JSON.stringify({ ...good, buildNumber: 1 }));
    assert.match(beforeProblems({ env, root })[0], /verouderde sync/);
    writeFileSync(join(root, "android/app/src/main/assets/public/build.json"), JSON.stringify(good));
    assert.deepEqual(beforeProblems({ env, root }), []);
    writeFileSync(join(root, "dist/native/build.json"), JSON.stringify({ ...good, compileProbe: true }));
    writeFileSync(join(root, "android/app/src/main/assets/public/build.json"), JSON.stringify({ ...good, compileProbe: true }));
    assert.ok(beforeProblems({ env, root }).some((problem) => /compileproef/.test(problem)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Echte jarsigner-controle met een wegwerpsleutel die alleen in deze test bestaat (nooit opgeslagen of gelogd).
const hasJavaTools = spawnSync("keytool", ["-help"], { encoding: "utf8" }).error === undefined && spawnSync("jarsigner", ["-help"], { encoding: "utf8" }).error === undefined;
test("getekende bundel: geldige handtekening slaagt; ongetekend en debugsleutel worden afgekeurd", { skip: !hasJavaTools }, () => {
  const dir = mkdtempSync(join(tmpdir(), "versado-sign-"));
  try {
    const run = (cmd, args) => { const result = spawnSync(cmd, args, { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr || result.stdout); };
    const password = `tmp-${process.pid}-${Date.now()}`;
    writeFileSync(join(dir, "bundle.txt"), "inhoud");
    run("jar", ["cf", join(dir, "unsigned.aab"), "-C", dir, "bundle.txt"]);
    const make = (name, dn) => run("keytool", ["-genkeypair", "-keystore", join(dir, `${name}.jks`), "-storepass", password, "-keypass", password, "-alias", name, "-dname", dn, "-keyalg", "RSA", "-keysize", "2048", "-validity", "2"]);
    make("upload", "CN=Test Upload,O=Test");
    make("debug", "CN=Android Debug,O=Android,C=US");
    for (const name of ["upload", "debug"]) {
      writeFileSync(join(dir, `${name}.aab`), readFileSync(join(dir, "unsigned.aab")));
      run("jarsigner", ["-keystore", join(dir, `${name}.jks`), "-storepass", password, "-keypass", password, join(dir, `${name}.aab`), name]);
    }
    const ok = afterProblems(join(dir, "upload.aab"));
    assert.deepEqual(ok.problems, []);
    assert.match(ok.sha256, /^[0-9a-f]{64}$/);
    assert.ok(afterProblems(join(dir, "unsigned.aab")).problems.length > 0);
    assert.ok(afterProblems(join(dir, "debug.aab")).problems.some((problem) => /debugsleutel/.test(problem)));
    assert.ok(afterProblems(join(dir, "ontbreekt.aab")).problems.some((problem) => /bestaat niet/.test(problem)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("de Gradle-poort en de guard hanteren dezelfde regels, en signing blijft optioneel zonder sleutel", () => {
  const gradle = readFileSync("android/app/build.gradle", "utf8");
  for (const needle of ["local-store-test", "play-test", "compileProbe != false", "releaseApproved != false", "VERSADO_VERSION_CODE", "VERSADO_VERSION_NAME", ".invalid"]) assert.ok(gradle.includes(needle), needle);
  assert.match(gradle, /if \(uploadKeystorePath\) signingConfig signingConfigs\.release/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|storePassword\s+"[^"]|keyPassword\s+"[^"]/);
});

test("workflowinvoer wordt nooit in shelltekst geïnterpoleerd (alleen via env), en de versienaam wordt vooraf gevalideerd", () => {
  const text = readFileSync(".github/workflows/native-android-release.yml", "utf8");
  for (const line of text.split("\n")) {
    if (/\$\{\{\s*(inputs|github\.event)\./.test(line)) assert.match(line, /^\s+[A-Z_]+:\s*\$\{\{/, `invoer buiten een env-toewijzing: ${line.trim()}`);
  }
  assert.match(text, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
});
