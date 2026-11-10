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

import { distributionProblems, ipaProblems } from '../scripts/native/ios-release-guard.mjs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const workflow = require('yaml').parse(readFileSync('.github/workflows/native-ios-release.yml', 'utf8'));
const job = workflow.jobs['testflight-archive'];

test('dispatch, develop, exacte commit, environment en upload opt-in zijn verplicht', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.upload.default, false);
  assert.equal(job.environment, 'testflight');
  assert.equal(job.needs, 'branch-check');
  assert.match(job.if, /refs\/heads\/develop/);
  assert.doesNotMatch(JSON.stringify(workflow), /refs\/heads\/main|environment: ios-testflight|secrets\.APPLE_TEAM_ID|secrets\.ASC_KEY_P8/);
  const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const branch = workflow.jobs['branch-check'].steps[0];
  for (const [ref, event, ok] of [['develop','workflow_dispatch',true], ['main','workflow_dispatch',false], ['develop','push',false]]) {
    const run = spawnSync('bash', ['-c', branch.run], { env: { ...process.env, SELECTED_REF: `refs/heads/${ref}`, EVENT_NAME: event } });
    assert.equal(run.status === 0, ok);
  }
  const distribution = job.steps.find(s => s.id === 'distribution');
  assert.match(distribution.run, /ios-release-guard.mjs ipa/);
  assert.ok(distribution.run.indexOf('ios-release-guard.mjs ipa') < distribution.run.indexOf('if [ "$UPLOAD" = true ]'));
  assert.match(distribution.run, /trap .*EXIT/);
  assert.match(distribution.run, /manageAppVersionAndBuildNumber<\/key><false\/>/);
  assert.match(job.steps.at(-1).if, /always/);
});

test('ontbrekende secrets melden uitsluitend hun namen', () => {
  const step = job.steps.find(s => s.env?.HAS_TEAM);
  for (const name of ['IOS_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_API_KEY_P8_BASE64']) assert.ok(JSON.stringify(step.env).includes(`secrets.${name}`));
  const run = spawnSync('bash', ['-c', step.run], { env: { ...process.env, HAS_TEAM:'false', HAS_KEY_ID:'false', HAS_ISSUER:'false', HAS_KEY:'false', HAS_ORIGIN:'false' }, encoding:'utf8' });
  assert.notEqual(run.status, 0);
  for (const name of ['IOS_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_API_KEY_P8_BASE64']) assert.ok(run.stdout.includes(name));
});

const team = 'ABCDEFGHIJ';
const ent = { 'application-identifier': `${team}.app.versado.app`, 'com.apple.developer.team-identifier': team, 'get-task-allow': false, 'beta-reports-active': true };
const signed = () => ({ entitlements: { ...ent }, profile: { TeamIdentifier:[team], ExpirationDate:'2099-01-01', Entitlements:{ ...ent } }, authorities:['Apple Distribution: Example'], team, identifier:'app.versado.app' });
test('IPA signing weigert debug, verlopen/ad-hoc/enterprise-profielen, verkeerde identiteit en capabilities', () => {
  assert.deepEqual(distributionProblems(signed(), team), []);
  const mutations = [
    s => s.entitlements['get-task-allow'] = true,
    s => s.entitlements['aps-environment'] = 'production',
    s => s.entitlements['com.apple.developer.applesignin'] = ['Default'],
    s => s.entitlements['com.apple.developer.associated-domains'] = ['applinks:example.com'],
    s => s.profile.ProvisionedDevices = [], s => s.profile.ProvisionsAllDevices = true,
    s => s.profile.ExpirationDate = '2020-01-01', s => s.profile = null,
    s => s.authorities = ['Apple Development: Example'], s => s.team = '',
    s => s.identifier = 'nl.ringapeldoorn.ringtools', s => s.profile.TeamIdentifier = ['OTHER'],
    s => s.entitlements['application-identifier'] = `${team}.*`,
  ];
  for (const mutate of mutations) { const s = signed(); mutate(s); assert.ok(distributionProblems(s,team).length); }
  assert.ok(ipaProblems('/tmp/versado-nonexistent-app').length);
});

test('Apple-preflight weigert ontbrekende configuratie zonder sleutelmateriaal te loggen', () => {
  const run = spawnSync(process.execPath, ['scripts/native/asc-testflight-preflight.mjs'], { env:{ PATH:process.env.PATH }, encoding:'utf8' });
  assert.notEqual(run.status,0);
  assert.match(run.stderr, /Apple-preflight mislukt/);
  assert.doesNotMatch(run.stderr, /BEGIN|eyJ/);
});

test('uploadkeuze en uploadfout worden daadwerkelijk fail-closed uitgevoerd', () => {
  const step = job.steps.find(s => s.id === 'distribution');
  const tail = step.run.slice(step.run.indexOf('if [ "$UPLOAD" = true ]'));
  const root = mkdtempSync(join(tmpdir(), 'versado-upload-gate-'));
  try {
    for (const [upload, ref, result, accepted] of [['false','develop',0,false], ['true','main',0,false], ['true','develop',1,false], ['true','develop',0,true]]) {
      const summary = join(root, 'summary');
      writeFileSync(summary, '');
      const script = `set -euo pipefail\nxcrun() { return ${result}; }\n${tail}`;
      const run = spawnSync('bash', ['-c', script], { encoding:'utf8', env:{ ...process.env, UPLOAD:upload, GITHUB_REF:`refs/heads/${ref}`, GITHUB_STEP_SUMMARY:summary, GITHUB_OUTPUT:join(root,'outputs'), keydir:root, ipa:'example.ipa', ASC_KEY_ID:'EXAMPLE', ASC_ISSUER_ID:'EXAMPLE' } });
      assert.equal(readFileSync(summary,'utf8').includes('succesvol door Apple geaccepteerd'), accepted);
      if (upload === 'false') assert.match(readFileSync(summary,'utf8'), /overgeslagen/);
      if (upload === 'true' && !accepted) assert.notEqual(run.status,0);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('nieuwe Apple- en Cloudflare-geheimnamen worden in bundels geweigerd', () => {
  const { findSecrets } = require('../scripts/native/profiles.cjs');
  for (const name of ['ASC_API_KEY_P8_BASE64','CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET']) assert.ok(findSecrets(name).length);
});

test('iOS-poort weigert ongeldige versies, buildnummers en onvolledige commits ook zonder GitHub', () => {
  for (const buildNumber of [0, -1, 10000, '01', '1.2', 'not-a-number']) assert.ok(signingProblems({ ...good, buildNumber }, { ...env, NATIVE_BUILD_NUMBER:String(buildNumber) }).some(s => /Apple-buildnummer/.test(s)));
  for (const version of ['1.0', '01.0.0', '1.0.0-beta', '10000.0.0']) assert.ok(signingProblems({ ...good,version },{ ...env,NATIVE_APP_VERSION:version }).some(s => /appversie/.test(s)));
  assert.ok(signingProblems({ ...good,sourceCommit:'abc123' },{ ...env,GITHUB_SHA:undefined }).some(s => /broncommit/.test(s)));
});
