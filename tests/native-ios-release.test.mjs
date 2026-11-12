import { exportOptions } from '../scripts/native/ios-signing-assets.mjs';
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

import { distributionDiagnostics, distributionProblems, ipaProblems } from '../scripts/native/ios-release-guard.mjs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
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
  assert.match(distribution.run, /-exportOptionsPlist "\$signing\/ExportOptions.plist"/);
  const options = exportOptions('ABCDEFGHIJ', 'AB'.repeat(20), '12345678-1234-1234-1234-123456789ABC');
  assert.match(options, /manageAppVersionAndBuildNumber<\/key><false\/>/);
  assert.match(job.steps.at(-1).if, /always/);
});

test('ontbrekende secrets melden uitsluitend hun namen', () => {
  const step = job.steps.find(s => s.env?.HAS_TEAM);
  for (const name of ['IOS_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_API_KEY_P8_BASE64', 'IOS_DISTRIBUTION_P12_BASE64', 'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_PROVISIONING_PROFILE_BASE64']) assert.ok(JSON.stringify(step.env).includes(`secrets.${name}`));
  const run = spawnSync('bash', ['-c', step.run], { env: { ...process.env, HAS_TEAM:'false', HAS_KEY_ID:'false', HAS_ISSUER:'false', HAS_KEY:'false', HAS_ORIGIN:'false' }, encoding:'utf8' });
  assert.notEqual(run.status, 0);
  for (const name of ['IOS_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_API_KEY_P8_BASE64', 'IOS_DISTRIBUTION_P12_BASE64', 'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_PROVISIONING_PROFILE_BASE64']) assert.ok(run.stdout.includes(name));
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

// Alleen synthetische identiteiten; deze diagnose verandert geen acceptatieregel.
const appGroup = `${team}.app.versado.app`;
const wildcardGroup = `${team}.*`;
const keychainSigned = (profileGroups, appGroups = [appGroup]) => {
  const s = signed();
  s.entitlements['keychain-access-groups'] = appGroups;
  s.profile.ApplicationIdentifierPrefix = [team];
  if (profileGroups !== undefined) s.profile.Entitlements['keychain-access-groups'] = profileGroups;
  return s;
};

test('diagnose herkent TN3125-profielgroepen zonder de huidige enkele-groepregel te versoepelen', () => {
  const standard = keychainSigned([appGroup]);
  assert.deepEqual(distributionProblems(standard, team), []);
  assert.deepEqual(distributionDiagnostics(standard, team).profileKeychain.categories, { 'expected-app': 1 });
  for (const groups of [[wildcardGroup, 'com.apple.token'], [appGroup, 'com.apple.token']]) {
    const s = keychainSigned(groups);
    const diagnostic = distributionDiagnostics(s, team);
    assert.equal(diagnostic.profileKeychain.count, 2);
    assert.equal(diagnostic.profileKeychain.categories['apple-token'], 1);
    assert.equal(diagnostic.appKeychainCoveredByProfile, true);
    assert.equal(diagnostic.declaredPrefixMatchesExpectedTeam, true);
    assert.equal(diagnostic.declaredPrefixMatchesAppPrefix, true);
    // Bewijs van de gedocumenteerde incompatibiliteit; reparatie wacht op profielbewijs.
    assert.deepEqual(distributionProblems(s, team), ['profiel: onverwachte keychain-groep']);
  }
});

test('diagnose maakt vreemde, dubbele, misvormde en ontbrekende groepen zichtbaar zonder waarden', () => {
  for (const group of [`${team}.app.andere.app`, 'OTHERTEAM1.*', 'com.apple.token.extra', 'com.apple.*', '*']) {
    const s = keychainSigned([appGroup, group]);
    assert.deepEqual(distributionDiagnostics(s, team).profileKeychain.categories, { 'expected-app': 1, other: 1 });
    assert.ok(distributionProblems(s, team).length);
  }
  const s = keychainSigned([appGroup, appGroup, 7]);
  assert.deepEqual(distributionDiagnostics(s, team).profileKeychain, { state:'array', count:3, duplicateCount:1, categories:{ 'expected-app':2, malformed:1 } });
  for (const groups of [[], null, appGroup, undefined]) {
    const s = keychainSigned(groups);
    const d = distributionDiagnostics(s, team);
    assert.equal(d.profileKeychain.state, groups === undefined ? 'absent' : Array.isArray(groups) ? 'array' : 'malformed');
    assert.equal(d.appKeychainCoveredByProfile, false);
  }
  delete s.entitlements['keychain-access-groups'];
  assert.deepEqual(distributionDiagnostics(s, team).appKeychain, { state:'absent' });
  assert.equal(distributionDiagnostics(s, team).appKeychainCoveredByProfile, null);
});

test('App ID Prefix en Team ID worden apart vergeleken, nooit automatisch geaccepteerd', () => {
  const s = keychainSigned(['LEGACY1234.*', 'com.apple.token'], ['LEGACY1234.app.versado.app']);
  s.profile.ApplicationIdentifierPrefix = ['LEGACY1234'];
  s.entitlements['application-identifier'] = s.profile.Entitlements['application-identifier'] = 'LEGACY1234.app.versado.app';
  const d = distributionDiagnostics(s, team);
  assert.equal(d.signingTeamMatchesExpected, true);
  assert.equal(d.appPrefixMatchesExpectedTeam, false);
  assert.equal(d.profileAppPrefixMatchesExpectedTeam, false);
  assert.equal(d.declaredPrefixMatchesExpectedTeam, false);
  assert.equal(d.declaredPrefixMatchesAppPrefix, true);
  assert.deepEqual(d.appKeychain.categories, { 'profile-prefix-app':1 });
  assert.deepEqual(d.profileKeychain.categories, { 'profile-prefix-wildcard':1, 'apple-token':1 });
  assert.equal(d.appKeychainCoveredByProfile, true);
  assert.ok(distributionProblems(s, team).some(p => /application-identifier/.test(p)));
  for (const [prefix, state] of [[undefined, 'absent'], [[], 'empty'], [['INVALID'], 'malformed'], [[team, 'LEGACY1234'], 'multiple']]) {
    s.profile.ApplicationIdentifierPrefix = prefix;
    const d = distributionDiagnostics(s, team);
    assert.equal(d.declaredPrefixState, state);
    assert.equal(d.declaredPrefixCount, Array.isArray(prefix) ? prefix.length : null);
    assert.equal(d.declaredPrefixMatchesExpectedTeam, null);
  }
});

test('diagnose logt geen concrete groepen, team/prefix, profielinhoud of sleutelmateriaal', () => {
  const s = keychainSigned([appGroup, 'com.apple.token', 'SECRET-GROUP'], [appGroup]);
  s.profile.Name = s.profile.UUID = s.profile.DeveloperCertificates = 'SECRET-PROFILE';
  s.profile.ApplicationIdentifierPrefix = ['LEGACY1234'];
  s.entitlements['SECRET-ENTITLEMENT'] = 'SECRET-VALUE';
  s.profile.Entitlements['SECRET-ENTITLEMENT'] = 'SECRET-VALUE';
  s.authorities = ['Apple Distribution: SECRET-NAME'];
  const serialized = JSON.stringify(distributionDiagnostics(s, team));
  for (const forbidden of [team, 'LEGACY1234', 'app.versado.app', 'com.apple.token', 'SECRET-', 'Apple Distribution:']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(distributionDiagnostics(s, '').expectedTeamValid, false);
  assert.equal(distributionDiagnostics({ profile:null }, undefined).declaredPrefixMatchesExpectedTeam, null);
});

test('extra apprechten, verkeerde identiteit/team en ongeschikte profielen blijven afgekeurd', () => {
  const mutations = [
    s => s.entitlements['keychain-access-groups'] = [appGroup, 'com.apple.token'],
    s => s.entitlements['keychain-access-groups'] = [wildcardGroup],
    s => s.entitlements['aps-environment'] = 'production',
    s => s.entitlements['com.apple.developer.applesignin'] = ['Default'],
    s => s.entitlements['com.apple.developer.associated-domains'] = ['applinks:example.com'],
    s => s.team = 'OTHERTEAM1', s => s.profile.TeamIdentifier = ['OTHERTEAM1'],
    s => s.identifier = 'app.andere.app',
    s => s.profile.Entitlements['application-identifier'] = `${team}.*`,
    s => s.entitlements['application-identifier'] = `${team}.app.andere.app`,
    s => s.authorities = ['Apple Development: Example'],
    s => s.profile.Entitlements['get-task-allow'] = true,
    s => s.profile.ProvisionedDevices = ['synthetic-device'],
    s => s.profile.ProvisionsAllDevices = true,
    s => s.profile.ExpirationDate = '2000-01-01',
    s => delete s.profile.Entitlements['beta-reports-active'],
    s => s.profile.Entitlements['beta-reports-active'] = false,
  ];
  for (const mutate of mutations) {
    const s = keychainSigned([appGroup]);
    mutate(s);
    const before = distributionProblems(s, team);
    assert.ok(before.length, mutate.toString());
    distributionDiagnostics(s, team);
    assert.deepEqual(distributionProblems(s, team), before);
  }
});

test('IPA-foutpad voegt geschoonde diagnose toe en behoudt de afkeuring (synthetische codesign-uitvoer)', () => {
  const root = mkdtempSync(join(tmpdir(), 'versado-ipa-diagnostic-'));
  const app = join(root, 'App.app');
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawnSync;
  const s = keychainSigned([wildcardGroup, 'com.apple.token']);
  const xml = value => {
    const run = originalSpawn('python3', ['-I', '-c', 'import plistlib,json,sys;sys.stdout.buffer.write(plistlib.dumps(json.load(sys.stdin)))'], { input:JSON.stringify(value), encoding:'utf8' });
    assert.equal(run.status, 0);
    return run.stdout;
  };
  const entitlementXml = xml(s.entitlements);
  try {
    mkdirSync(join(app, 'public'), { recursive:true });
    writeFileSync(join(app, 'Info.plist'), plistXml({ CFBundleIdentifier:'app.versado.app', CFBundleShortVersionString:'0.2.0', CFBundleVersion:'42' }));
    writeFileSync(join(app, 'public/build.json'), JSON.stringify(good));
    // De fixture is geen echte IPA; bundel-/privacyfouten mogen blijven bestaan.
    for (const groups of [[wildcardGroup, 'com.apple.token'], [appGroup]]) {
      s.profile.Entitlements['keychain-access-groups'] = groups;
      const profileXml = xml(s.profile);
      childProcess.spawnSync = (name, args, options) => {
        if (name === 'codesign') return { status:0, stdout:args.includes('--entitlements') ? entitlementXml : '', stderr:args.includes('-dvv') ? `Authority=Apple Distribution: Synthetic\nTeamIdentifier=${team}\nIdentifier=app.versado.app\n` : '' };
        if (name === 'security') return { status:0, stdout:profileXml, stderr:'' };
        return originalSpawn(name, args, options);
      };
      syncBuiltinESMExports();
      const problems = ipaProblems(app, { root, env:{ IOS_TEAM_ID:team, NATIVE_API_BASE_URL:'https://test.versado-test.com' } });
      const diagnostic = problems.find(p => p.startsWith('Signingdiagnose (geschoond;'));
      if (groups.length > 1) {
        assert.ok(problems.includes('profiel: onverwachte keychain-groep'), JSON.stringify(problems));
        assert.ok(diagnostic);
        assert.match(diagnostic, /"apple-token":1/);
        assert.ok(!diagnostic.includes(team));
        assert.ok(!diagnostic.includes('com.apple.token'));
      } else {
        assert.equal(diagnostic, undefined);
      }
    }
  } finally {
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
    rmSync(root, { recursive:true, force:true });
  }
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
  for (const name of ['ASC_API_KEY_P8_BASE64','CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET','IOS_DISTRIBUTION_P12_BASE64','IOS_DISTRIBUTION_P12_PASSWORD','IOS_PROVISIONING_PROFILE_BASE64']) assert.ok(findSecrets(name).length);
});

test('iOS-poort weigert ongeldige versies, buildnummers en onvolledige commits ook zonder GitHub', () => {
  for (const buildNumber of [0, -1, 10000, '01', '1.2', 'not-a-number']) assert.ok(signingProblems({ ...good, buildNumber }, { ...env, NATIVE_BUILD_NUMBER:String(buildNumber) }).some(s => /Apple-buildnummer/.test(s)));
  for (const version of ['1.0', '01.0.0', '1.0.0-beta', '10000.0.0']) assert.ok(signingProblems({ ...good,version },{ ...env,NATIVE_APP_VERSION:version }).some(s => /appversie/.test(s)));
  assert.ok(signingProblems({ ...good,sourceCommit:'abc123' },{ ...env,GITHUB_SHA:undefined }).some(s => /broncommit/.test(s)));
});
